use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::error::{ApiError, ApiResult};

const WINDOW_LABEL_PREFIX: &str = "mica-workspace-";
const WINDOW_ID_QUERY_KEY: &str = "micaWindowId";
const MAX_WINDOW_ID_LEN: usize = 64;
const MAX_STARTUP_QUERY_LEN: usize = 4 * 1024;

static NEXT_WINDOW_ID: AtomicU64 = AtomicU64::new(1);
static WINDOW_CREATE_LOCK: Mutex<()> = Mutex::new(());

/// Request contract for opening another native Mica workspace window.
///
/// `window_id` is optional so callers can either restore a persisted identity
/// or ask the backend to allocate one. Supplying the ID of an existing window
/// is idempotent: that window is focused instead of duplicated.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWindowCreateRequest {
    pub window_id: Option<String>,
    pub startup_query: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWindowCreateResponse {
    pub window_id: String,
    pub label: String,
    pub created: bool,
}

#[derive(Debug, PartialEq, Eq)]
struct PreparedWindow {
    window_id: String,
    label: String,
    app_url: String,
}

fn invalid_request(message: impl Into<String>) -> ApiError {
    ApiError {
        code: "invalid_window_request".to_string(),
        message: message.into(),
        path: None,
    }
}

fn native_window_error(message: impl Into<String>) -> ApiError {
    ApiError {
        code: "native_window_create".to_string(),
        message: message.into(),
        path: None,
    }
}

fn validate_window_id(window_id: &str) -> ApiResult<()> {
    if window_id.is_empty() || window_id.len() > MAX_WINDOW_ID_LEN {
        return Err(invalid_request(format!(
            "windowId must contain between 1 and {MAX_WINDOW_ID_LEN} characters"
        )));
    }

    if !window_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(invalid_request(
            "windowId may only contain ASCII letters, digits, '-' and '_'",
        ));
    }

    Ok(())
}

fn normalize_startup_query(query: Option<&str>) -> ApiResult<Option<String>> {
    let Some(query) = query else {
        return Ok(None);
    };
    let query = query.strip_prefix('?').unwrap_or(query);
    if query.is_empty() {
        return Ok(None);
    }
    if query.len() > MAX_STARTUP_QUERY_LEN {
        return Err(invalid_request(format!(
            "startupQuery must not exceed {MAX_STARTUP_QUERY_LEN} bytes"
        )));
    }
    if query
        .chars()
        .any(|character| character.is_control() || character == '#')
    {
        return Err(invalid_request(
            "startupQuery must not contain control characters or a fragment",
        ));
    }
    if query.split('&').any(|pair| {
        pair.split_once('=')
            .map_or(pair, |(key, _)| key)
            .eq(WINDOW_ID_QUERY_KEY)
    }) {
        return Err(invalid_request(format!(
            "startupQuery must not override the reserved {WINDOW_ID_QUERY_KEY} parameter"
        )));
    }

    Ok(Some(query.to_string()))
}

fn prepare_window(window_id: String, startup_query: Option<&str>) -> ApiResult<PreparedWindow> {
    validate_window_id(&window_id)?;
    let startup_query = normalize_startup_query(startup_query)?;
    let label = format!("{WINDOW_LABEL_PREFIX}{window_id}");
    let app_url = match startup_query {
        Some(query) => format!("index.html?{WINDOW_ID_QUERY_KEY}={window_id}&{query}"),
        None => format!("index.html?{WINDOW_ID_QUERY_KEY}={window_id}"),
    };

    Ok(PreparedWindow {
        window_id,
        label,
        app_url,
    })
}

fn allocate_window_id(app: &AppHandle) -> String {
    loop {
        let sequence = NEXT_WINDOW_ID.fetch_add(1, Ordering::Relaxed);
        // Include process/time entropy so a freshly allocated ID cannot reuse
        // a persisted descriptor before main has recreated that old window.
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |duration| duration.as_nanos());
        let window_id = format!("window-{:x}-{timestamp:x}-{sequence:x}", std::process::id());
        let label = format!("{WINDOW_LABEL_PREFIX}{window_id}");
        if app.get_webview_window(&label).is_none() {
            return window_id;
        }
    }
}

/// Create or focus a native workspace window.
///
/// Every created window receives its stable ID through the reserved
/// `micaWindowId` URL query parameter. The frontend owns mapping that ID to a
/// window-local workspace tree and performing any cross-window tab transfer.
#[tauri::command]
pub async fn workspace_window_create(
    app: AppHandle,
    request: WorkspaceWindowCreateRequest,
) -> ApiResult<WorkspaceWindowCreateResponse> {
    create_workspace_window(app, request)
}

fn create_workspace_window(
    app: AppHandle,
    request: WorkspaceWindowCreateRequest,
) -> ApiResult<WorkspaceWindowCreateResponse> {
    let _create_guard = WINDOW_CREATE_LOCK
        .lock()
        .map_err(|_| native_window_error("native window creation lock is poisoned"))?;
    let window_id = match request.window_id {
        Some(window_id) => window_id,
        None => allocate_window_id(&app),
    };
    let prepared = prepare_window(window_id, request.startup_query.as_deref())?;

    if let Some(existing) = app.get_webview_window(&prepared.label) {
        existing
            .show()
            .map_err(|error| native_window_error(format!("failed to show window: {error}")))?;
        existing
            .set_focus()
            .map_err(|error| native_window_error(format!("failed to focus window: {error}")))?;
        return Ok(WorkspaceWindowCreateResponse {
            window_id: prepared.window_id,
            label: prepared.label,
            created: false,
        });
    }

    WebviewWindowBuilder::new(
        &app,
        &prepared.label,
        WebviewUrl::App(PathBuf::from(prepared.app_url)),
    )
    .title("Mica")
    .inner_size(1280.0, 800.0)
    .min_inner_size(800.0, 500.0)
    .build()
    .map_err(|error| native_window_error(format!("failed to create window: {error}")))?;

    Ok(WorkspaceWindowCreateResponse {
        window_id: prepared.window_id,
        label: prepared.label,
        created: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prepares_stable_label_and_startup_url() {
        let prepared = prepare_window(
            "research_2026".to_string(),
            Some("vault=notes%2Fmain&restore=true"),
        )
        .expect("valid window request");

        assert_eq!(prepared.window_id, "research_2026");
        assert_eq!(prepared.label, "mica-workspace-research_2026");
        assert_eq!(
            prepared.app_url,
            "index.html?micaWindowId=research_2026&vault=notes%2Fmain&restore=true"
        );
    }

    #[test]
    fn strips_one_leading_query_marker() {
        let prepared = prepare_window("secondary".to_string(), Some("?restore=true"))
            .expect("valid window request");
        assert_eq!(
            prepared.app_url,
            "index.html?micaWindowId=secondary&restore=true"
        );
    }

    #[test]
    fn rejects_ids_that_cannot_be_safe_window_labels() {
        for window_id in ["", "has spaces", "../escape", "emoji-🚀"] {
            let error = prepare_window(window_id.to_string(), None).expect_err("invalid ID");
            assert_eq!(error.code, "invalid_window_request");
        }
    }

    #[test]
    fn rejects_reserved_query_parameter_and_fragments() {
        for query in [
            "micaWindowId=other",
            "restore=true#fragment",
            "line=one\ntwo",
        ] {
            let error = prepare_window("secondary".to_string(), Some(query))
                .expect_err("invalid startup query");
            assert_eq!(error.code, "invalid_window_request");
        }
    }
}
