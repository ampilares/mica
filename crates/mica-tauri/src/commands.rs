use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use mica_core::{ContentHash, CoreError, VaultPath, WORKSPACE_DIR};
use mica_db::{apply_ops as apply_db_ops, Database, DbOp, QueryResult};
use mica_drawio::{apply_canvas_ops, CanvasOp, Scene};
use mica_markdown::NoteDocument;
use mica_search::{BacklinkHit, QuickSwitchHit, SearchHit, SearchIndex, TagCount};
use mica_vault::{slugify, FileTree, Vault};
use mica_watch::{SelfWriteFilter, VaultEvent, VaultWatcher};

use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, OpenVault};

#[derive(Debug, Serialize)]
pub struct VaultInfo {
    pub root: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct LoadedFile {
    pub path: VaultPath,
    pub content: String,
    pub version: ContentHash,
}

#[derive(Debug, Serialize)]
pub struct SaveOutcome {
    pub version: ContentHash,
}

// ---------------------------------------------------------------- vault ----

fn open_vault_inner(app: &AppHandle, state: &AppState, vault: Vault) -> ApiResult<VaultInfo> {
    let vault = Arc::new(vault);
    let filter = SelfWriteFilter::new();

    let index_path = vault
        .root()
        .join(WORKSPACE_DIR)
        .join("index")
        .join("index.db");
    let mut index = SearchIndex::open(&index_path).map_err(ApiError::from)?;
    // MVP: full rebuild on open. Warm-start diffing comes with the perf phase.
    index.rebuild(&vault).map_err(ApiError::from)?;
    let index = Arc::new(Mutex::new(index));

    // Watcher → incremental index updates + push events to the frontend.
    let watcher = {
        let app = app.clone();
        let vault_w = vault.clone();
        let index_w = index.clone();
        VaultWatcher::start(vault.root(), filter.clone(), move |events: Vec<VaultEvent>| {
            {
                let mut idx = index_w.lock().unwrap();
                for event in &events {
                    let result = match event {
                        VaultEvent::Created { path } | VaultEvent::Modified { path } => {
                            if vault_w.exists(path) {
                                idx.update_file(&vault_w, path)
                            } else {
                                idx.remove_file(path)
                            }
                        }
                        VaultEvent::Deleted { path } => idx.remove_file(path),
                        VaultEvent::Renamed { from, to } => idx.rename_file(&vault_w, from, to),
                    };
                    if let Err(e) = result {
                        tracing::warn!("incremental index update failed: {e}");
                    }
                }
            }
            let _ = app.emit("vault:events", &events);
        })
        .map_err(|e| ApiError {
            code: "watch_failed".into(),
            message: e.to_string(),
            path: None,
        })?
    };

    let info = VaultInfo {
        root: vault.root().display().to_string(),
        name: vault.config().name.clone(),
    };

    *state.open.lock().unwrap() = Some(Arc::new(OpenVault {
        vault,
        index,
        filter,
        _watcher: Some(watcher),
    }));

    Ok(info)
}

#[tauri::command]
pub fn vault_create(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> ApiResult<VaultInfo> {
    let root = PathBuf::from(&path);
    if let Some(existing) = Vault::find_enclosing_vault(&root) {
        if existing != root {
            return Err(ApiError {
                code: "nested_vault".into(),
                message: format!(
                    "This folder is inside an existing vault at {}",
                    existing.display()
                ),
                path: None,
            });
        }
    }
    let vault = Vault::create(&root).map_err(ApiError::from)?;
    open_vault_inner(&app, &state, vault)
}

#[tauri::command]
pub fn vault_open(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> ApiResult<VaultInfo> {
    let vault = Vault::open(&PathBuf::from(&path)).map_err(ApiError::from)?;
    open_vault_inner(&app, &state, vault)
}

#[tauri::command]
pub fn vault_close(state: State<'_, AppState>) -> ApiResult<()> {
    *state.open.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
pub fn vault_tree(state: State<'_, AppState>) -> ApiResult<FileTree> {
    let open = state.current().map_err(ApiError::from)?;
    open.vault.scan_tree().map_err(ApiError::from)
}

#[tauri::command]
pub fn vault_reveal(state: State<'_, AppState>, path: String) -> ApiResult<()> {
    let open = state.current().map_err(ApiError::from)?;
    let rel = VaultPath::new(&path).map_err(ApiError::from)?;
    let abs = open.vault.abs(&rel);
    tauri_plugin_opener::reveal_item_in_dir(&abs).map_err(|e| ApiError {
        code: "reveal_failed".into(),
        message: e.to_string(),
        path: Some(path),
    })
}

#[tauri::command]
pub fn vault_open_external(state: State<'_, AppState>, path: String) -> ApiResult<()> {
    let open = state.current().map_err(ApiError::from)?;
    let rel = VaultPath::new(&path).map_err(ApiError::from)?;
    let abs = open.vault.abs(&rel);
    tauri_plugin_opener::open_path(abs.to_string_lossy().to_string(), None::<String>).map_err(
        |e| ApiError {
            code: "open_failed".into(),
            message: e.to_string(),
            path: Some(path),
        },
    )
}

// ---------------------------------------------------------------- notes ----

/// Save with `base_version` conflict detection; shared by all record types.
fn guarded_write(
    open: &OpenVault,
    path: &VaultPath,
    content: &str,
    base_version: Option<&str>,
) -> ApiResult<ContentHash> {
    if open.vault.exists(path) {
        let disk = open.vault.hash_of(path).map_err(ApiError::from)?;
        match base_version {
            Some(base) if disk.as_str() == base => {}
            None => {
                // New-file save over an existing file → conflict.
                return Err(ApiError::from(CoreError::Conflict { path: path.clone() }));
            }
            Some(_) => {
                return Err(ApiError::from(CoreError::Conflict { path: path.clone() }));
            }
        }
    }
    let hash = open.vault.write_text(path, content).map_err(ApiError::from)?;
    open.filter.record(&open.vault.abs(path), hash.clone());
    // Keep the index in sync immediately (the watcher event is filtered).
    if let Err(e) = open.index.lock().unwrap().update_file(&open.vault, path) {
        tracing::warn!("index update after save failed: {e}");
    }
    Ok(hash)
}

#[tauri::command]
pub fn note_create(
    state: State<'_, AppState>,
    dir: Option<String>,
    title: String,
) -> ApiResult<LoadedFile> {
    let open = state.current().map_err(ApiError::from)?;
    let dir = dir.unwrap_or_else(|| open.vault.config().notes_dir.clone());
    let stem = slugify(&title);
    let path = open
        .vault
        .unique_path(&dir, &stem, "md")
        .map_err(ApiError::from)?;
    let content = NoteDocument::new_note_content(&title).map_err(ApiError::from)?;
    let version = guarded_write(&open, &path, &content, None)?;
    Ok(LoadedFile {
        path,
        content,
        version,
    })
}

#[tauri::command]
pub fn note_load(state: State<'_, AppState>, path: String) -> ApiResult<LoadedFile> {
    let open = state.current().map_err(ApiError::from)?;
    let rel = VaultPath::new(&path).map_err(ApiError::from)?;
    let (content, version) = open.vault.read_text(&rel).map_err(ApiError::from)?;
    Ok(LoadedFile {
        path: rel,
        content,
        version,
    })
}

#[tauri::command]
pub fn note_save(
    state: State<'_, AppState>,
    path: String,
    content: String,
    base_version: Option<String>,
) -> ApiResult<SaveOutcome> {
    let open = state.current().map_err(ApiError::from)?;
    let rel = VaultPath::new(&path).map_err(ApiError::from)?;

    // Refresh `updated` in existing frontmatter; never inject frontmatter.
    let mut doc = NoteDocument::parse(&content).map_err(ApiError::from)?;
    doc.touch_updated();
    let final_content = doc.serialize().map_err(ApiError::from)?;

    let version = guarded_write(&open, &rel, &final_content, base_version.as_deref())?;
    Ok(SaveOutcome { version })
}

#[tauri::command]
pub fn note_rename(
    state: State<'_, AppState>,
    path: String,
    new_path: String,
) -> ApiResult<VaultPath> {
    let open = state.current().map_err(ApiError::from)?;
    let from = VaultPath::new(&path).map_err(ApiError::from)?;
    let to = VaultPath::new(&new_path).map_err(ApiError::from)?;
    open.vault.rename(&from, &to).map_err(ApiError::from)?;
    let mut idx = open.index.lock().unwrap();
    if let Err(e) = idx.rename_file(&open.vault, &from, &to) {
        tracing::warn!("index rename failed: {e}");
    }
    Ok(to)
}

#[tauri::command]
pub fn note_delete(state: State<'_, AppState>, path: String) -> ApiResult<()> {
    let open = state.current().map_err(ApiError::from)?;
    let rel = VaultPath::new(&path).map_err(ApiError::from)?;
    open.vault.delete(&rel).map_err(ApiError::from)?;
    if let Err(e) = open.index.lock().unwrap().remove_file(&rel) {
        tracing::warn!("index remove failed: {e}");
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictResolution {
    KeepMine,
    TakeTheirs,
    KeepBoth,
}

#[derive(Debug, Serialize)]
pub struct ConflictOutcome {
    /// Path of the file the editor should now show.
    pub path: VaultPath,
    pub content: String,
    pub version: ContentHash,
}

#[tauri::command]
pub fn conflict_resolve(
    state: State<'_, AppState>,
    path: String,
    resolution: ConflictResolution,
    my_content: String,
) -> ApiResult<ConflictOutcome> {
    let open = state.current().map_err(ApiError::from)?;
    let rel = VaultPath::new(&path).map_err(ApiError::from)?;

    match resolution {
        ConflictResolution::TakeTheirs => {
            let (content, version) = open.vault.read_text(&rel).map_err(ApiError::from)?;
            Ok(ConflictOutcome {
                path: rel,
                content,
                version,
            })
        }
        ConflictResolution::KeepMine => {
            // Back up theirs into .workspace/backups before overwriting.
            if open.vault.exists(&rel) {
                let (theirs, _) = open.vault.read_text(&rel).map_err(ApiError::from)?;
                let stamp = mica_core::now_rfc3339().replace(':', "-");
                let backup = VaultPath::new(&format!(
                    "{WORKSPACE_DIR}/backups/{stamp}/{}",
                    rel.as_str()
                ))
                .map_err(ApiError::from)?;
                open.vault
                    .write_text(&backup, &theirs)
                    .map_err(ApiError::from)?;
            }
            let disk = open.vault.hash_of(&rel).ok();
            let version = guarded_write(
                &open,
                &rel,
                &my_content,
                disk.as_ref().map(|h| h.as_str()),
            )?;
            Ok(ConflictOutcome {
                path: rel,
                content: my_content,
                version,
            })
        }
        ConflictResolution::KeepBoth => {
            let stamp = mica_core::now_rfc3339().replace(':', "-");
            let dir = rel
                .parent()
                .map(|p| p.as_str().to_string())
                .unwrap_or_default();
            let new_path = open
                .vault
                .unique_path(&dir, &format!("{} (conflict {stamp})", rel.stem()), "md")
                .map_err(ApiError::from)?;
            let version = guarded_write(&open, &new_path, &my_content, None)?;
            Ok(ConflictOutcome {
                path: new_path,
                content: my_content,
                version,
            })
        }
    }
}

// ------------------------------------------------------------- databases ----

#[tauri::command]
pub fn db_create(
    state: State<'_, AppState>,
    dir: Option<String>,
    title: String,
) -> ApiResult<LoadedFile> {
    let open = state.current().map_err(ApiError::from)?;
    let dir = dir.unwrap_or_else(|| open.vault.config().databases_dir.clone());
    let stem = slugify(&title);
    let path = open
        .vault
        .unique_path(&dir, &stem, "database.json")
        .map_err(ApiError::from)?;
    let db = Database::new(&title);
    let content = db.serialize().map_err(ApiError::from)?;
    let version = guarded_write(&open, &path, &content, None)?;
    Ok(LoadedFile {
        path,
        content,
        version,
    })
}

#[tauri::command]
pub fn db_load(state: State<'_, AppState>, path: String) -> ApiResult<LoadedFile> {
    let open = state.current().map_err(ApiError::from)?;
    let rel = VaultPath::new(&path).map_err(ApiError::from)?;
    let (content, version) = open.vault.read_text(&rel).map_err(ApiError::from)?;
    // Validate before handing to the UI so bad JSON is surfaced, not edited.
    Database::parse(&content).map_err(ApiError::from)?;
    Ok(LoadedFile {
        path: rel,
        content,
        version,
    })
}

#[derive(Debug, Serialize)]
pub struct DbApplyOutcome {
    pub content: String,
    pub version: ContentHash,
}

#[tauri::command]
pub fn db_apply(
    state: State<'_, AppState>,
    path: String,
    ops: Vec<DbOp>,
    base_version: String,
) -> ApiResult<DbApplyOutcome> {
    let open = state.current().map_err(ApiError::from)?;
    let rel = VaultPath::new(&path).map_err(ApiError::from)?;
    let (content, disk_version) = open.vault.read_text(&rel).map_err(ApiError::from)?;
    if disk_version.as_str() != base_version {
        return Err(ApiError::from(CoreError::Conflict { path: rel }));
    }
    let mut db = Database::parse(&content).map_err(ApiError::from)?;
    apply_db_ops(&mut db, &ops).map_err(ApiError::from)?;
    let new_content = db.serialize().map_err(ApiError::from)?;
    let version = guarded_write(&open, &rel, &new_content, Some(disk_version.as_str()))?;
    Ok(DbApplyOutcome {
        content: new_content,
        version,
    })
}

#[tauri::command]
pub fn db_query(
    state: State<'_, AppState>,
    path: String,
    view_id: String,
    offset: usize,
    limit: usize,
) -> ApiResult<QueryResult> {
    let open = state.current().map_err(ApiError::from)?;
    let rel = VaultPath::new(&path).map_err(ApiError::from)?;
    let (content, _) = open.vault.read_text(&rel).map_err(ApiError::from)?;
    let db = Database::parse(&content).map_err(ApiError::from)?;
    mica_db::query(&db, &view_id, offset, limit).map_err(ApiError::from)
}

// ---------------------------------------------------------------- canvas ----

#[tauri::command]
pub fn canvas_create(
    state: State<'_, AppState>,
    dir: Option<String>,
    title: String,
) -> ApiResult<LoadedFile> {
    let open = state.current().map_err(ApiError::from)?;
    let dir = dir.unwrap_or_else(|| open.vault.config().canvases_dir.clone());
    let stem = slugify(&title);
    let path = open
        .vault
        .unique_path(&dir, &stem, "drawio")
        .map_err(ApiError::from)?;
    let scene = Scene::new(&title);
    let content = scene.serialize().map_err(ApiError::from)?;
    let version = guarded_write(&open, &path, &content, None)?;
    Ok(LoadedFile {
        path,
        content,
        version,
    })
}

#[tauri::command]
pub fn canvas_load(state: State<'_, AppState>, path: String) -> ApiResult<LoadedFile> {
    let open = state.current().map_err(ApiError::from)?;
    let rel = VaultPath::new(&path).map_err(ApiError::from)?;
    let (content, version) = open.vault.read_text(&rel).map_err(ApiError::from)?;
    Scene::parse(&content).map_err(ApiError::from)?;
    Ok(LoadedFile {
        path: rel,
        content,
        version,
    })
}

#[derive(Debug, Serialize)]
pub struct CanvasApplyOutcome {
    pub content: String,
    pub version: ContentHash,
}

#[tauri::command]
pub fn canvas_apply(
    state: State<'_, AppState>,
    path: String,
    ops: Vec<CanvasOp>,
    base_version: String,
) -> ApiResult<CanvasApplyOutcome> {
    let open = state.current().map_err(ApiError::from)?;
    let rel = VaultPath::new(&path).map_err(ApiError::from)?;
    let (content, disk_version) = open.vault.read_text(&rel).map_err(ApiError::from)?;
    if disk_version.as_str() != base_version {
        return Err(ApiError::from(CoreError::Conflict { path: rel }));
    }
    // Validate before save: never overwrite a file we can't parse.
    let mut scene = Scene::parse(&content).map_err(ApiError::from)?;
    apply_canvas_ops(&mut scene, &ops).map_err(ApiError::from)?;
    let new_content = scene.serialize().map_err(ApiError::from)?;
    let version = guarded_write(&open, &rel, &new_content, Some(disk_version.as_str()))?;
    Ok(CanvasApplyOutcome {
        content: new_content,
        version,
    })
}

// ---------------------------------------------------------------- search ----

#[tauri::command]
pub fn search_query(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> ApiResult<Vec<SearchHit>> {
    let open = state.current().map_err(ApiError::from)?;
    let idx = open.index.lock().unwrap();
    idx.search(&query, limit.unwrap_or(50)).map_err(ApiError::from)
}

#[tauri::command]
pub fn quick_switch(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> ApiResult<Vec<QuickSwitchHit>> {
    let open = state.current().map_err(ApiError::from)?;
    let idx = open.index.lock().unwrap();
    idx.quick_switch(&query, limit.unwrap_or(20))
        .map_err(ApiError::from)
}

#[tauri::command]
pub fn links_backlinks(state: State<'_, AppState>, path: String) -> ApiResult<Vec<BacklinkHit>> {
    let open = state.current().map_err(ApiError::from)?;
    let rel = VaultPath::new(&path).map_err(ApiError::from)?;
    let idx = open.index.lock().unwrap();
    idx.backlinks(&rel).map_err(ApiError::from)
}

#[tauri::command]
pub fn tags_list(state: State<'_, AppState>) -> ApiResult<Vec<TagCount>> {
    let open = state.current().map_err(ApiError::from)?;
    let idx = open.index.lock().unwrap();
    idx.tags().map_err(ApiError::from)
}

#[tauri::command]
pub fn resolve_wiki(state: State<'_, AppState>, name: String) -> ApiResult<Option<VaultPath>> {
    let open = state.current().map_err(ApiError::from)?;
    let idx = open.index.lock().unwrap();
    idx.resolve_wiki(&name).map_err(ApiError::from)
}

#[tauri::command]
pub fn index_rebuild(state: State<'_, AppState>) -> ApiResult<usize> {
    let open = state.current().map_err(ApiError::from)?;
    let mut idx = open.index.lock().unwrap();
    idx.rebuild(&open.vault).map_err(ApiError::from)
}

// A tiny sanity command used by the frontend splash to verify IPC.
#[tauri::command]
pub fn ping() -> String {
    "pong".to_string()
}

// Unused-import guard helpers (BTreeMap used by DbOp payloads deserialization)
#[allow(unused)]
fn _typecheck(_: BTreeMap<String, serde_json::Value>) {}
