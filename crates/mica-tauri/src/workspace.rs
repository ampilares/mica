use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{ErrorKind, Read};
use std::path::Path;
use std::sync::Mutex;

use mica_core::{CoreError, VaultPath, WORKSPACE_DIR};
use mica_vault::Vault;
use serde::Deserialize;
use serde_json::{Map, Value};
use tauri::State;

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

const WORKSPACE_SNAPSHOT_PATH: &str = ".workspace/ui/workspace-v2.json";
const WORKSPACE_PRESET_DIR: &str = ".workspace/ui/presets";
const WORKSPACE_PRESET_PREFIX: &str = "preset-";
const WORKSPACE_PRESET_SUFFIX: &str = ".json";
const MAX_PRESET_NAME_BYTES: usize = 80;
const WORKSPACE_SCHEMA_VERSION: u32 = 2;
const MAX_SNAPSHOT_BYTES: u64 = 5 * 1024 * 1024;
const MAX_HISTORY_ENTRIES: usize = 100;
const MAX_WORKSPACE_WINDOWS: usize = 64;
const MAX_WINDOW_ID_BYTES: usize = 64;
const DEFAULT_WINDOW_ID: &str = "main";
const MIN_SPLIT_RATIO: f64 = 0.15;
const MAX_SPLIT_RATIO: f64 = 0.85;

/// Serializes the read-modify-write transaction used by window-local snapshot
/// updates. `Vault::write_bytes` supplies the atomic file replacement; this
/// lock prevents two native windows in this process from reading the same
/// collection and then replacing each other's entries.
static WORKSPACE_COLLECTION_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkspaceCollectionWire {
    schema_version: u32,
    windows: Vec<WorkspaceWindowSnapshotWire>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkspaceWindowSnapshotWire {
    window_id: String,
    snapshot: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkspaceSnapshotWire {
    schema_version: u32,
    saved_at: Option<String>,
    window: WindowWire,
    panes: HashMap<String, PaneWire>,
    tabs: HashMap<String, TabWire>,
    sidebars: SidebarsWire,
    #[serde(default)]
    closed_tabs: Vec<ClosedTabWire>,
    next_id: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WindowWire {
    root: NodeWire,
    focused_pane_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
enum NodeWire {
    Pane {
        #[serde(rename = "paneId")]
        pane_id: String,
    },
    Split {
        id: String,
        direction: DirectionWire,
        ratio: f64,
        first: Box<NodeWire>,
        second: Box<NodeWire>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum DirectionWire {
    Row,
    Column,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PaneWire {
    id: String,
    tab_ids: Vec<String>,
    active_tab_id: String,
    recent_tab_ids: Vec<String>,
    /// Added by the v2 stacked-tab UI. Default keeps pre-P1 snapshots valid.
    #[serde(default)]
    stacked_tabs: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TabWire {
    id: String,
    view: ViewWire,
    title: String,
    pinned: bool,
    history: Vec<NavigationWire>,
    history_index: i64,
    #[serde(default)]
    link_group_id: Option<String>,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
enum ViewWire {
    Empty,
    Note {
        path: String,
        mode: NoteModeWire,
    },
    Database {
        path: String,
    },
    Canvas {
        path: String,
    },
    Graph {
        #[serde(rename = "centerPath")]
        center_path: Option<String>,
    },
    Missing {
        original: ResourceViewWire,
        reason: String,
    },
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum NoteModeWire {
    Rich,
    Source,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
enum ResourceViewWire {
    Note { path: String, mode: NoteModeWire },
    Database { path: String },
    Canvas { path: String },
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct NavigationWire {
    view: ViewWire,
    /// View adapters own this JSON object. It is intentionally opaque, but an
    /// object (rather than any JSON value) keeps the TypeScript Record contract.
    location: Option<Map<String, Value>>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SidebarsWire {
    left: SidebarWire,
    right: SidebarWire,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SidebarWire {
    open: bool,
    width: f64,
    panel: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClosedTabWire {
    tab: TabWire,
    pane_id: String,
    index: usize,
}

/// Return the only location the UI workspace commands are permitted to access.
fn snapshot_path() -> Result<VaultPath, CoreError> {
    let path = VaultPath::new(WORKSPACE_SNAPSHOT_PATH)?;
    let workspace = VaultPath::new(WORKSPACE_DIR)?;
    if !path.starts_with(&workspace) {
        return Err(CoreError::PathTraversal(path.as_str().to_string()));
    }
    Ok(path)
}

fn preset_directory_path() -> Result<VaultPath, CoreError> {
    VaultPath::new(WORKSPACE_PRESET_DIR)
}

/// Preset names are intentionally portable across all supported filesystems.
/// The reversible byte encoding below means different accepted names can never
/// map to the same filename, including on case-insensitive filesystems.
fn validate_preset_name(name: &str) -> Result<(), CoreError> {
    let valid_length = !name.is_empty() && name.len() <= MAX_PRESET_NAME_BYTES;
    let valid_edges = name
        .as_bytes()
        .first()
        .zip(name.as_bytes().last())
        .map(|(first, last)| first.is_ascii_alphanumeric() && last.is_ascii_alphanumeric())
        .unwrap_or(false);
    let valid_characters = name
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b' ' | b'-' | b'_'));
    if !valid_length || !valid_edges || !valid_characters {
        return Err(CoreError::parse(
            WORKSPACE_PRESET_DIR,
            format!(
                "preset name must be 1-{MAX_PRESET_NAME_BYTES} ASCII bytes, begin and end with a letter or digit, and contain only letters, digits, spaces, '-' or '_'"
            ),
        ));
    }
    Ok(())
}

fn preset_filename(name: &str) -> Result<String, CoreError> {
    validate_preset_name(name)?;
    let encoded = name
        .bytes()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(format!(
        "{WORKSPACE_PRESET_PREFIX}{encoded}{WORKSPACE_PRESET_SUFFIX}"
    ))
}

fn preset_name_from_filename(filename: &str) -> Option<String> {
    let encoded = filename
        .strip_prefix(WORKSPACE_PRESET_PREFIX)?
        .strip_suffix(WORKSPACE_PRESET_SUFFIX)?;
    if encoded.is_empty()
        || encoded.len() % 2 != 0
        || !encoded.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return None;
    }
    let bytes = (0..encoded.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&encoded[index..index + 2], 16))
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    let name = String::from_utf8(bytes).ok()?;
    if validate_preset_name(&name).is_err()
        || preset_filename(&name).ok().as_deref() != Some(filename)
    {
        return None;
    }
    Some(name)
}

fn preset_path(name: &str) -> Result<VaultPath, CoreError> {
    let filename = preset_filename(name)?;
    let path = VaultPath::new(&format!("{WORKSPACE_PRESET_DIR}/{filename}"))?;
    let directory = preset_directory_path()?;
    if !path.starts_with(&directory) {
        return Err(CoreError::PathTraversal(path.as_str().to_string()));
    }
    Ok(path)
}

fn snapshot_error(message: impl Into<String>) -> CoreError {
    CoreError::parse(WORKSPACE_SNAPSHOT_PATH, message)
}

/// Reject symlinks and verify the deepest existing ancestor resolves beneath
/// the canonical vault root. Canonicalization also catches Windows junctions
/// and other reparse-point redirects that `FileType::is_symlink` may not label
/// as symlinks.
///
/// This is defense in depth using portable `std` APIs, not a race-free sandbox:
/// a process with permission to mutate the vault can still swap a component
/// after this check. Race-free confinement requires platform-specific
/// handle-relative, no-follow traversal.
fn ensure_storage_is_not_redirected(vault: &Vault, path: &VaultPath) -> Result<(), CoreError> {
    let root = vault.root();
    let mut current = root.to_path_buf();
    let mut deepest_existing = root.to_path_buf();
    for component in path.as_str().split('/') {
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(CoreError::PathTraversal(current.display().to_string()));
            }
            Ok(_) => deepest_existing = current.clone(),
            Err(error) if error.kind() == ErrorKind::NotFound => break,
            Err(error) => return Err(CoreError::io(&current, error)),
        }
    }

    let canonical = deepest_existing
        .canonicalize()
        .map_err(|error| CoreError::io(&deepest_existing, error))?;
    // Canonicalize both sides with the same API. On Windows `Vault::root`
    // intentionally strips the `\\?\` display prefix while `std` adds it.
    let canonical_root = root
        .canonicalize()
        .map_err(|error| CoreError::io(root, error))?;
    if !canonical.starts_with(&canonical_root) {
        return Err(CoreError::PathTraversal(canonical.display().to_string()));
    }
    Ok(())
}

fn validate_resource_path(path: &str) -> Result<(), CoreError> {
    if path.contains('\\')
        || path.contains('\0')
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(snapshot_error(format!(
            "unsafe workspace resource path: {path}"
        )));
    }
    let validated = VaultPath::new(path)
        .map_err(|_| snapshot_error(format!("unsafe workspace resource path: {path}")))?;
    if validated.as_str() != path {
        return Err(snapshot_error(format!(
            "non-canonical workspace resource path: {path}",
        )));
    }
    let workspace = VaultPath::new(WORKSPACE_DIR)?;
    if validated.starts_with(&workspace) {
        return Err(snapshot_error(format!(
            "workspace metadata is not a view resource: {path}",
        )));
    }
    Ok(())
}

fn validate_resource_extension(path: &str, expected: &str) -> Result<(), CoreError> {
    if path.ends_with(expected) {
        Ok(())
    } else {
        Err(snapshot_error(format!(
            "workspace resource {path} does not have the expected {expected} extension",
        )))
    }
}

fn validate_resource_view(view: &ResourceViewWire) -> Result<(), CoreError> {
    match view {
        ResourceViewWire::Note { path, mode } => {
            let _ = mode;
            validate_resource_path(path)?;
            validate_resource_extension(path, ".md")
        }
        ResourceViewWire::Database { path } => {
            validate_resource_path(path)?;
            validate_resource_extension(path, ".database.json")
        }
        ResourceViewWire::Canvas { path } => {
            validate_resource_path(path)?;
            validate_resource_extension(path, ".drawio")
        }
    }
}

fn validate_view(view: &ViewWire) -> Result<(), CoreError> {
    match view {
        ViewWire::Empty => Ok(()),
        ViewWire::Note { path, mode } => {
            let _ = mode;
            validate_resource_path(path)?;
            validate_resource_extension(path, ".md")
        }
        ViewWire::Database { path } => {
            validate_resource_path(path)?;
            validate_resource_extension(path, ".database.json")
        }
        ViewWire::Canvas { path } => {
            validate_resource_path(path)?;
            validate_resource_extension(path, ".drawio")
        }
        ViewWire::Graph { center_path } => center_path
            .as_deref()
            .map(validate_resource_path)
            .unwrap_or(Ok(())),
        ViewWire::Missing { original, reason } => {
            if reason.is_empty() {
                return Err(snapshot_error("missing-resource reason must not be empty"));
            }
            validate_resource_view(original)
        }
    }
}

fn collect_tree_ids(
    node: &NodeWire,
    panes: &mut Vec<String>,
    all_ids: &mut HashSet<String>,
) -> Result<(), CoreError> {
    match node {
        NodeWire::Pane { pane_id } => {
            if pane_id.is_empty() || !all_ids.insert(pane_id.clone()) {
                return Err(snapshot_error(
                    "pane IDs in the layout must be non-empty and unique",
                ));
            }
            panes.push(pane_id.clone());
        }
        NodeWire::Split {
            id,
            direction,
            ratio,
            first,
            second,
        } => {
            let _ = direction;
            if id.is_empty() || !all_ids.insert(id.clone()) {
                return Err(snapshot_error(
                    "split IDs must be non-empty and globally unique",
                ));
            }
            if !ratio.is_finite() || !(MIN_SPLIT_RATIO..=MAX_SPLIT_RATIO).contains(ratio) {
                return Err(snapshot_error(format!("invalid split ratio for {id}")));
            }
            collect_tree_ids(first, panes, all_ids)?;
            collect_tree_ids(second, panes, all_ids)?;
        }
    }
    Ok(())
}

fn validate_tab(tab: &TabWire, expected_id: Option<&str>) -> Result<(), CoreError> {
    if tab.id.is_empty() || expected_id.map(|id| id != tab.id).unwrap_or(false) {
        return Err(snapshot_error(
            "tab map key must match its non-empty tab ID",
        ));
    }
    validate_view(&tab.view)?;
    if tab.history.len() > MAX_HISTORY_ENTRIES {
        return Err(snapshot_error(format!(
            "tab {} history exceeds {MAX_HISTORY_ENTRIES} entries",
            tab.id
        )));
    }
    for entry in &tab.history {
        validate_view(&entry.view)?;
        let _ = &entry.location;
    }
    if tab.history_index < -1 || tab.history_index >= tab.history.len() as i64 {
        return Err(snapshot_error(format!(
            "tab {} has an invalid history index",
            tab.id
        )));
    }
    if tab.history_index == -1 && (!tab.history.is_empty() || !matches!(&tab.view, ViewWire::Empty))
    {
        return Err(snapshot_error(format!(
            "tab {} has invalid empty history",
            tab.id
        )));
    }
    if tab.link_group_id.as_deref().is_some_and(str::is_empty) {
        return Err(snapshot_error(format!(
            "tab {} has an invalid empty link group ID",
            tab.id
        )));
    }
    let _ = (&tab.title, tab.pinned);
    Ok(())
}

fn validate_snapshot_value(value: &Value) -> Result<(), CoreError> {
    let snapshot: WorkspaceSnapshotWire =
        serde_json::from_value(value.clone()).map_err(|error| snapshot_error(error.to_string()))?;
    if snapshot.schema_version != WORKSPACE_SCHEMA_VERSION {
        return Err(snapshot_error(format!(
            "unsupported workspace schema {}",
            snapshot.schema_version
        )));
    }
    if snapshot.next_id == 0 {
        return Err(snapshot_error("nextId must be a positive integer"));
    }

    let mut tree_panes = Vec::new();
    let mut all_ids = HashSet::new();
    collect_tree_ids(&snapshot.window.root, &mut tree_panes, &mut all_ids)?;
    let tree_pane_set: HashSet<&str> = tree_panes.iter().map(String::as_str).collect();
    if snapshot.panes.len() != tree_pane_set.len()
        || snapshot
            .panes
            .keys()
            .any(|id| !tree_pane_set.contains(id.as_str()))
    {
        return Err(snapshot_error(
            "pane map must exactly match the layout tree",
        ));
    }
    if !snapshot
        .panes
        .contains_key(&snapshot.window.focused_pane_id)
    {
        return Err(snapshot_error("focused pane does not exist"));
    }

    let mut owned_tabs = HashSet::new();
    for (pane_id, pane) in &snapshot.panes {
        if pane.id != *pane_id || pane.id.is_empty() || pane.tab_ids.is_empty() {
            return Err(snapshot_error(format!("invalid pane {pane_id}")));
        }
        if !pane.tab_ids.contains(&pane.active_tab_id) {
            return Err(snapshot_error(format!(
                "pane {pane_id} has an invalid active tab",
            )));
        }
        let tab_set: HashSet<&str> = pane.tab_ids.iter().map(String::as_str).collect();
        let recent_set: HashSet<&str> = pane.recent_tab_ids.iter().map(String::as_str).collect();
        if tab_set.len() != pane.tab_ids.len()
            || recent_set.len() != pane.recent_tab_ids.len()
            || tab_set != recent_set
        {
            return Err(snapshot_error(format!(
                "pane {pane_id} has invalid tab ordering",
            )));
        }
        let _ = pane.stacked_tabs;
        for tab_id in &pane.tab_ids {
            if !owned_tabs.insert(tab_id.clone()) || !snapshot.tabs.contains_key(tab_id) {
                return Err(snapshot_error(format!(
                    "tab {tab_id} has an invalid pane owner"
                )));
            }
        }
    }
    if owned_tabs.len() != snapshot.tabs.len() {
        return Err(snapshot_error(
            "every open tab must belong to exactly one pane",
        ));
    }
    for (tab_id, tab) in &snapshot.tabs {
        if all_ids.contains(tab_id) || !all_ids.insert(tab_id.clone()) {
            return Err(snapshot_error(
                "pane, split, and tab IDs must be globally unique",
            ));
        }
        validate_tab(tab, Some(tab_id))?;
    }
    let mut link_groups: HashMap<&str, Vec<&TabWire>> = HashMap::new();
    for tab in snapshot.tabs.values() {
        if let Some(group_id) = tab.link_group_id.as_deref() {
            link_groups.entry(group_id).or_default().push(tab);
        }
    }
    for (group_id, members) in link_groups {
        if members.len() < 2 {
            return Err(snapshot_error(format!(
                "link group {group_id} has fewer than two open tabs"
            )));
        }
        if all_ids.contains(group_id) {
            return Err(snapshot_error(format!(
                "link group ID {group_id} collides with a workspace node"
            )));
        }
        if members
            .iter()
            .skip(1)
            .any(|tab| tab.view != members[0].view)
        {
            return Err(snapshot_error(format!(
                "link group {group_id} has divergent resource views"
            )));
        }
    }
    for closed in &snapshot.closed_tabs {
        validate_tab(&closed.tab, None)?;
        if closed.pane_id.is_empty() {
            return Err(snapshot_error("closed tab pane ID must not be empty"));
        }
        let _ = closed.index;
    }
    for sidebar in [&snapshot.sidebars.left, &snapshot.sidebars.right] {
        if !sidebar.width.is_finite() || sidebar.width <= 0.0 || sidebar.panel.is_empty() {
            return Err(snapshot_error("invalid sidebar state"));
        }
        let _ = sidebar.open;
    }
    let _ = snapshot.saved_at;
    Ok(())
}

fn validate_window_id(window_id: &str) -> Result<(), CoreError> {
    if window_id.is_empty()
        || window_id.len() > MAX_WINDOW_ID_BYTES
        || !window_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(snapshot_error(format!(
            "windowId must be 1-{MAX_WINDOW_ID_BYTES} ASCII letters, digits, '-' or '_'"
        )));
    }
    Ok(())
}

fn validate_collection_value(value: &Value) -> Result<(), CoreError> {
    let collection: WorkspaceCollectionWire =
        serde_json::from_value(value.clone()).map_err(|error| snapshot_error(error.to_string()))?;
    if collection.schema_version != WORKSPACE_SCHEMA_VERSION {
        return Err(snapshot_error(format!(
            "unsupported workspace collection schema {}",
            collection.schema_version
        )));
    }
    if collection.windows.len() > MAX_WORKSPACE_WINDOWS {
        return Err(snapshot_error(format!(
            "workspace collection exceeds {MAX_WORKSPACE_WINDOWS} windows"
        )));
    }
    let mut ids = HashSet::new();
    for window in &collection.windows {
        validate_window_id(&window.window_id)?;
        if !ids.insert(window.window_id.as_str()) {
            return Err(snapshot_error(format!(
                "duplicate workspace windowId {}",
                window.window_id
            )));
        }
        validate_snapshot_value(&window.snapshot)?;
    }
    Ok(())
}

fn ensure_size(size: u64) -> Result<(), CoreError> {
    if size > MAX_SNAPSHOT_BYTES {
        return Err(snapshot_error(format!(
            "workspace snapshot exceeds the {} byte limit",
            MAX_SNAPSHOT_BYTES
        )));
    }
    Ok(())
}

fn read_bounded(path: &Path) -> Result<Vec<u8>, CoreError> {
    let mut file = File::open(path).map_err(|error| CoreError::io(path, error))?;
    ensure_size(
        file.metadata()
            .map_err(|error| CoreError::io(path, error))?
            .len(),
    )?;
    let mut bytes = Vec::new();
    file.by_ref()
        .take(MAX_SNAPSHOT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| CoreError::io(path, error))?;
    ensure_size(bytes.len() as u64)?;
    Ok(bytes)
}

fn read_value_at(vault: &Vault, path: &VaultPath) -> Result<Option<Value>, CoreError> {
    ensure_storage_is_not_redirected(vault, path)?;
    let absolute = vault.abs(path);
    let bytes = match read_bounded(&absolute) {
        Ok(bytes) => bytes,
        Err(CoreError::Io { source, .. }) if source.kind() == ErrorKind::NotFound => {
            return Ok(None)
        }
        Err(error) => return Err(error),
    };
    ensure_storage_is_not_redirected(vault, path)?;
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|error| snapshot_error(error.to_string()))?;
    Ok(Some(value))
}

fn write_value_at(vault: &Vault, path: &VaultPath, value: &Value) -> Result<(), CoreError> {
    let compact =
        serde_json::to_vec(value).map_err(|error| CoreError::Serialize(error.to_string()))?;
    ensure_size(compact.len() as u64)?;
    ensure_storage_is_not_redirected(vault, path)?;
    let mut content = serde_json::to_vec_pretty(value)
        .map_err(|error| CoreError::Serialize(error.to_string()))?;
    content.push(b'\n');
    ensure_size(content.len() as u64)?;
    vault.write_bytes(path, &content)?;
    // Detect a redirected result even if a component changed while writing.
    // This cannot undo a write already redirected by a privileged local racer.
    ensure_storage_is_not_redirected(vault, path)?;
    Ok(())
}

fn read_snapshot_at(vault: &Vault, path: &VaultPath) -> Result<Option<Value>, CoreError> {
    let value = read_value_at(vault, path)?;
    if let Some(value) = &value {
        validate_snapshot_value(value)?;
    }
    Ok(value)
}

fn write_snapshot_at(vault: &Vault, path: &VaultPath, snapshot: &Value) -> Result<(), CoreError> {
    validate_snapshot_value(snapshot)?;
    write_value_at(vault, path, snapshot)
}

fn collection_entries(value: Value) -> Result<Vec<Value>, CoreError> {
    if value.get("windows").is_some() {
        validate_collection_value(&value)?;
        return value
            .get("windows")
            .and_then(Value::as_array)
            .cloned()
            .ok_or_else(|| snapshot_error("workspace collection windows must be an array"));
    }

    // Legacy v2 files contained one bare snapshot. Treat it as the main
    // window; the next successful write migrates the file to the collection.
    validate_snapshot_value(&value)?;
    Ok(vec![serde_json::json!({
        "windowId": DEFAULT_WINDOW_ID,
        "snapshot": value,
    })])
}

fn read_snapshot_for_window(vault: &Vault, window_id: &str) -> Result<Option<Value>, CoreError> {
    validate_window_id(window_id)?;
    let Some(value) = read_value_at(vault, &snapshot_path()?)? else {
        return Ok(None);
    };
    let entries = collection_entries(value)?;
    Ok(entries.into_iter().find_map(|entry| {
        (entry.get("windowId").and_then(Value::as_str) == Some(window_id))
            .then(|| entry.get("snapshot").cloned())
            .flatten()
    }))
}

fn write_snapshot_for_window(
    vault: &Vault,
    window_id: &str,
    snapshot: &Value,
) -> Result<(), CoreError> {
    validate_window_id(window_id)?;
    validate_snapshot_value(snapshot)?;
    let _guard = WORKSPACE_COLLECTION_LOCK
        .lock()
        .map_err(|_| snapshot_error("workspace collection lock is poisoned"))?;
    let path = snapshot_path()?;
    let mut entries = match read_value_at(vault, &path)? {
        Some(value) => collection_entries(value)?,
        None => Vec::new(),
    };
    if let Some(entry) = entries
        .iter_mut()
        .find(|entry| entry.get("windowId").and_then(Value::as_str) == Some(window_id))
    {
        *entry = serde_json::json!({ "windowId": window_id, "snapshot": snapshot });
    } else {
        if entries.len() >= MAX_WORKSPACE_WINDOWS {
            return Err(snapshot_error(format!(
                "workspace collection exceeds {MAX_WORKSPACE_WINDOWS} windows"
            )));
        }
        entries.push(serde_json::json!({
            "windowId": window_id,
            "snapshot": snapshot,
        }));
    }
    let collection = serde_json::json!({
        "schemaVersion": WORKSPACE_SCHEMA_VERSION,
        "windows": entries,
    });
    validate_collection_value(&collection)?;
    write_value_at(vault, &path, &collection)
}

fn snapshot_window_ids(vault: &Vault) -> Result<Vec<String>, CoreError> {
    let Some(value) = read_value_at(vault, &snapshot_path()?)? else {
        return Ok(Vec::new());
    };
    let entries = collection_entries(value)?;
    Ok(entries
        .into_iter()
        .filter_map(|entry| {
            entry
                .get("windowId")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .collect())
}

#[cfg(test)]
fn read_snapshot(vault: &Vault) -> Result<Option<Value>, CoreError> {
    read_snapshot_for_window(vault, DEFAULT_WINDOW_ID)
}

#[cfg(test)]
fn write_snapshot(vault: &Vault, snapshot: &Value) -> Result<(), CoreError> {
    write_snapshot_for_window(vault, DEFAULT_WINDOW_ID, snapshot)
}

fn list_presets(vault: &Vault) -> Result<Vec<String>, CoreError> {
    let directory = preset_directory_path()?;
    ensure_storage_is_not_redirected(vault, &directory)?;
    let absolute = vault.abs(&directory);
    let entries = match fs::read_dir(&absolute) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(CoreError::io(&absolute, error)),
    };
    let mut names = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| CoreError::io(&absolute, error))?;
        let file_type = entry
            .file_type()
            .map_err(|error| CoreError::io(entry.path(), error))?;
        if file_type.is_symlink() {
            return Err(CoreError::PathTraversal(entry.path().display().to_string()));
        }
        if !file_type.is_file() {
            continue;
        }
        let Some(filename) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if let Some(name) = preset_name_from_filename(&filename) {
            names.push(name);
        }
    }
    ensure_storage_is_not_redirected(vault, &directory)?;
    names.sort();
    Ok(names)
}

fn read_preset(vault: &Vault, name: &str) -> Result<Option<Value>, CoreError> {
    read_snapshot_at(vault, &preset_path(name)?)
}

fn write_preset(vault: &Vault, name: &str, snapshot: &Value) -> Result<(), CoreError> {
    write_snapshot_at(vault, &preset_path(name)?, snapshot)
}

fn delete_preset(vault: &Vault, name: &str) -> Result<bool, CoreError> {
    let path = preset_path(name)?;
    ensure_storage_is_not_redirected(vault, &path)?;
    let absolute = vault.abs(&path);
    match fs::remove_file(&absolute) {
        Ok(()) => {
            if let Some(parent) = absolute.parent() {
                sync_deleted_entry(parent)?;
            }
            ensure_storage_is_not_redirected(vault, &preset_directory_path()?)?;
            Ok(true)
        }
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(CoreError::io(&absolute, error)),
    }
}

#[cfg(unix)]
fn sync_deleted_entry(parent: &Path) -> Result<(), CoreError> {
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| CoreError::io(parent, error))
}

#[cfg(not(unix))]
fn sync_deleted_entry(_parent: &Path) -> Result<(), CoreError> {
    Ok(())
}

#[tauri::command]
pub fn workspace_snapshot_read(
    state: State<'_, AppState>,
    window_id: Option<String>,
) -> ApiResult<Option<Value>> {
    let open = state.current().map_err(ApiError::from)?;
    read_snapshot_for_window(
        &open.vault,
        window_id.as_deref().unwrap_or(DEFAULT_WINDOW_ID),
    )
    .map_err(ApiError::from)
}

#[tauri::command]
pub fn workspace_snapshot_write(
    state: State<'_, AppState>,
    snapshot: Value,
    window_id: Option<String>,
) -> ApiResult<()> {
    let open = state.current().map_err(ApiError::from)?;
    write_snapshot_for_window(
        &open.vault,
        window_id.as_deref().unwrap_or(DEFAULT_WINDOW_ID),
        &snapshot,
    )
    .map_err(ApiError::from)
}

#[tauri::command]
pub fn workspace_snapshot_window_ids(state: State<'_, AppState>) -> ApiResult<Vec<String>> {
    let open = state.current().map_err(ApiError::from)?;
    snapshot_window_ids(&open.vault).map_err(ApiError::from)
}

#[tauri::command]
pub fn workspace_preset_list(state: State<'_, AppState>) -> ApiResult<Vec<String>> {
    let open = state.current().map_err(ApiError::from)?;
    list_presets(&open.vault).map_err(ApiError::from)
}

#[tauri::command]
pub fn workspace_preset_read(state: State<'_, AppState>, name: String) -> ApiResult<Option<Value>> {
    let open = state.current().map_err(ApiError::from)?;
    read_preset(&open.vault, &name).map_err(ApiError::from)
}

#[tauri::command]
pub fn workspace_preset_write(
    state: State<'_, AppState>,
    name: String,
    snapshot: Value,
) -> ApiResult<()> {
    let open = state.current().map_err(ApiError::from)?;
    write_preset(&open.vault, &name, &snapshot).map_err(ApiError::from)
}

#[tauri::command]
pub fn workspace_preset_delete(state: State<'_, AppState>, name: String) -> ApiResult<bool> {
    let open = state.current().map_err(ApiError::from)?;
    delete_preset(&open.vault, &name).map_err(ApiError::from)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use serde_json::json;

    use super::*;

    fn vault() -> (tempfile::TempDir, Vault) {
        let root = tempfile::tempdir().unwrap();
        let vault = Vault::create(root.path()).unwrap();
        (root, vault)
    }

    fn valid_snapshot() -> Value {
        json!({
            "schemaVersion": 2,
            "window": { "root": { "type": "pane", "paneId": "pane_1" }, "focusedPaneId": "pane_1" },
            "panes": {
                "pane_1": {
                    "id": "pane_1", "tabIds": ["tab_1"],
                    "activeTabId": "tab_1", "recentTabIds": ["tab_1"],
                    "stackedTabs": true
                }
            },
            "tabs": {
                "tab_1": {
                    "id": "tab_1", "view": { "type": "empty" },
                    "title": "New tab", "pinned": false,
                    "history": [], "historyIndex": -1
                }
            },
            "sidebars": {
                "left": { "open": true, "width": 260, "panel": "files" },
                "right": { "open": false, "width": 262, "panel": "outline" }
            },
            "closedTabs": [],
            "nextId": 2
        })
    }

    #[test]
    fn preset_names_have_reversible_collision_free_filenames() {
        let names = ["Research 2026", "research 2026", "A-B_C", "A B C"];
        let filenames = names
            .iter()
            .map(|name| preset_filename(name).unwrap())
            .collect::<HashSet<_>>();
        assert_eq!(filenames.len(), names.len());
        for name in names {
            let filename = preset_filename(name).unwrap();
            assert_eq!(preset_name_from_filename(&filename).as_deref(), Some(name));
            assert!(filename.starts_with(WORKSPACE_PRESET_PREFIX));
            assert!(filename.ends_with(WORKSPACE_PRESET_SUFFIX));
            assert!(!filename.contains(' '));
        }
        for malformed in ["preset-aéx.json", "preset-abc.json", "preset-zz.json"] {
            assert_eq!(preset_name_from_filename(malformed), None);
        }
    }

    #[test]
    fn rejects_unsafe_or_non_portable_preset_names() {
        for name in [
            "",
            " leading",
            "trailing ",
            "../escape",
            "folder/name",
            "back\\slash",
            ".",
            "two.dots",
            "emoji 🚀",
        ] {
            assert!(
                matches!(preset_path(name), Err(CoreError::Parse { .. })),
                "{name:?}"
            );
        }
        assert!(matches!(
            preset_path(&"x".repeat(MAX_PRESET_NAME_BYTES + 1)),
            Err(CoreError::Parse { .. })
        ));
    }

    #[test]
    fn presets_list_read_write_replace_and_delete_separately_from_auto_snapshot() {
        let (_root, vault) = vault();
        let automatic = valid_snapshot();
        write_snapshot(&vault, &automatic).unwrap();
        assert!(list_presets(&vault).unwrap().is_empty());

        let mut research = valid_snapshot();
        research["tabs"]["tab_1"]["title"] = json!("Research");
        let mut daily = valid_snapshot();
        daily["tabs"]["tab_1"]["title"] = json!("Daily");
        write_preset(&vault, "Research layout", &research).unwrap();
        write_preset(&vault, "Daily", &daily).unwrap();

        assert_eq!(
            list_presets(&vault).unwrap(),
            vec!["Daily".to_string(), "Research layout".to_string()]
        );
        assert_eq!(
            read_preset(&vault, "Research layout").unwrap(),
            Some(research.clone())
        );
        assert_eq!(read_snapshot(&vault).unwrap(), Some(automatic.clone()));

        research["tabs"]["tab_1"]["title"] = json!("Research replaced");
        write_preset(&vault, "Research layout", &research).unwrap();
        assert_eq!(
            read_preset(&vault, "Research layout").unwrap(),
            Some(research)
        );
        assert_eq!(read_snapshot(&vault).unwrap(), Some(automatic));
        assert_eq!(
            fs::read_dir(vault.root().join(WORKSPACE_PRESET_DIR))
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry.file_name().to_string_lossy().contains(".mica-tmp-"))
                .count(),
            0
        );

        assert!(delete_preset(&vault, "Daily").unwrap());
        assert!(!delete_preset(&vault, "Daily").unwrap());
        assert_eq!(read_preset(&vault, "Daily").unwrap(), None);
        assert_eq!(
            list_presets(&vault).unwrap(),
            vec!["Research layout".to_string()]
        );
    }

    #[test]
    fn presets_reuse_snapshot_schema_and_size_validation() {
        let (_root, vault) = vault();
        let mut future = valid_snapshot();
        future["schemaVersion"] = json!(WORKSPACE_SCHEMA_VERSION + 1);
        assert!(matches!(
            write_preset(&vault, "Future", &future),
            Err(CoreError::Parse { .. })
        ));

        let mut oversized = valid_snapshot();
        oversized["tabs"]["tab_1"]["title"] = json!("x".repeat(MAX_SNAPSHOT_BYTES as usize));
        assert!(matches!(
            write_preset(&vault, "Oversized", &oversized),
            Err(CoreError::Parse { .. })
        ));
    }

    #[test]
    fn corrupt_and_oversized_preset_files_are_rejected_on_read() {
        let (root, vault) = vault();
        let directory = root.path().join(WORKSPACE_PRESET_DIR);
        fs::create_dir_all(&directory).unwrap();
        fs::write(
            directory.join(preset_filename("Corrupt").unwrap()),
            b"not json",
        )
        .unwrap();
        assert!(matches!(
            read_preset(&vault, "Corrupt"),
            Err(CoreError::Parse { .. })
        ));

        fs::write(
            directory.join(preset_filename("Too large").unwrap()),
            vec![b' '; MAX_SNAPSHOT_BYTES as usize + 1],
        )
        .unwrap();
        assert!(matches!(
            read_preset(&vault, "Too large"),
            Err(CoreError::Parse { .. })
        ));
    }

    #[test]
    fn missing_snapshot_is_none() {
        let (_root, vault) = vault();
        assert_eq!(read_snapshot(&vault).unwrap(), None);
    }

    #[test]
    fn valid_snapshot_round_trips_and_replaces_atomically() {
        let (root, vault) = vault();
        let first = valid_snapshot();
        let mut second = valid_snapshot();
        second["tabs"]["tab_1"]["title"] = json!("Changed");

        write_snapshot(&vault, &first).unwrap();
        assert_eq!(read_snapshot(&vault).unwrap(), Some(first));
        write_snapshot(&vault, &second).unwrap();
        assert_eq!(read_snapshot(&vault).unwrap(), Some(second));

        let temp_files = fs::read_dir(root.path().join(".workspace/ui"))
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains(".mica-tmp-"))
            .count();
        assert_eq!(temp_files, 0);
    }

    #[test]
    fn window_snapshots_share_a_validated_collection_without_clobbering() {
        let (root, vault) = vault();
        let mut main = valid_snapshot();
        main["tabs"]["tab_1"]["title"] = json!("Main");
        let mut research = valid_snapshot();
        research["tabs"]["tab_1"]["title"] = json!("Research");

        write_snapshot_for_window(&vault, DEFAULT_WINDOW_ID, &main).unwrap();
        write_snapshot_for_window(&vault, "research-2", &research).unwrap();

        assert_eq!(
            read_snapshot_for_window(&vault, DEFAULT_WINDOW_ID).unwrap(),
            Some(main)
        );
        assert_eq!(
            read_snapshot_for_window(&vault, "research-2").unwrap(),
            Some(research)
        );
        assert_eq!(
            snapshot_window_ids(&vault).unwrap(),
            vec![DEFAULT_WINDOW_ID.to_string(), "research-2".to_string()]
        );

        let disk: Value =
            serde_json::from_slice(&fs::read(root.path().join(WORKSPACE_SNAPSHOT_PATH)).unwrap())
                .unwrap();
        validate_collection_value(&disk).unwrap();
        assert_eq!(disk["schemaVersion"], json!(WORKSPACE_SCHEMA_VERSION));
        assert_eq!(disk["windows"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn legacy_bare_snapshot_is_main_and_migrates_on_next_write() {
        let (root, vault) = vault();
        let legacy = valid_snapshot();
        let path = snapshot_path().unwrap();
        write_snapshot_at(&vault, &path, &legacy).unwrap();

        assert_eq!(read_snapshot(&vault).unwrap(), Some(legacy.clone()));
        assert_eq!(
            snapshot_window_ids(&vault).unwrap(),
            vec![DEFAULT_WINDOW_ID.to_string()]
        );
        assert_eq!(read_snapshot_for_window(&vault, "secondary").unwrap(), None);

        let mut secondary = valid_snapshot();
        secondary["tabs"]["tab_1"]["title"] = json!("Secondary");
        write_snapshot_for_window(&vault, "secondary", &secondary).unwrap();
        assert_eq!(read_snapshot(&vault).unwrap(), Some(legacy));
        assert_eq!(
            read_snapshot_for_window(&vault, "secondary").unwrap(),
            Some(secondary)
        );

        let disk: Value =
            serde_json::from_slice(&fs::read(root.path().join(WORKSPACE_SNAPSHOT_PATH)).unwrap())
                .unwrap();
        assert!(disk.get("windows").is_some());
        validate_collection_value(&disk).unwrap();
    }

    #[test]
    fn concurrent_window_writes_preserve_every_peer_entry() {
        use std::sync::Arc;

        let (_root, vault) = vault();
        let vault = Arc::new(vault);
        let handles = (0..8)
            .map(|index| {
                let vault = vault.clone();
                std::thread::spawn(move || {
                    let mut snapshot = valid_snapshot();
                    snapshot["tabs"]["tab_1"]["title"] = json!(format!("Window {index}"));
                    write_snapshot_for_window(&vault, &format!("window-{index}"), &snapshot)
                        .unwrap();
                })
            })
            .collect::<Vec<_>>();
        for handle in handles {
            handle.join().unwrap();
        }

        let ids = snapshot_window_ids(&vault).unwrap();
        assert_eq!(ids.len(), 8);
        for index in 0..8 {
            let snapshot = read_snapshot_for_window(&vault, &format!("window-{index}"))
                .unwrap()
                .unwrap();
            assert_eq!(
                snapshot["tabs"]["tab_1"]["title"],
                json!(format!("Window {index}"))
            );
        }
    }

    #[test]
    fn rejects_invalid_window_ids_and_collection_entries() {
        let (_root, vault) = vault();
        for id in ["", "bad window", "../escape", "emoji-🚀"] {
            assert!(matches!(
                write_snapshot_for_window(&vault, id, &valid_snapshot()),
                Err(CoreError::Parse { .. })
            ));
        }

        let duplicate = json!({
            "schemaVersion": WORKSPACE_SCHEMA_VERSION,
            "windows": [
                { "windowId": "main", "snapshot": valid_snapshot() },
                { "windowId": "main", "snapshot": valid_snapshot() }
            ]
        });
        assert!(matches!(
            validate_collection_value(&duplicate),
            Err(CoreError::Parse { .. })
        ));
    }

    #[test]
    fn rejects_unknown_schema_fields_and_unsafe_paths() {
        let (_root, vault) = vault();
        let mut future = valid_snapshot();
        future["schemaVersion"] = json!(3);
        assert!(matches!(
            write_snapshot(&vault, &future),
            Err(CoreError::Parse { .. })
        ));

        let mut unknown = valid_snapshot();
        unknown["unexpected"] = json!(true);
        assert!(matches!(
            write_snapshot(&vault, &unknown),
            Err(CoreError::Parse { .. })
        ));

        let mut unsafe_path = valid_snapshot();
        unsafe_path["tabs"]["tab_1"]["view"] =
            json!({ "type": "note", "path": "../outside.md", "mode": "rich" });
        unsafe_path["tabs"]["tab_1"]["history"] = json!([{
            "view": { "type": "note", "path": "../outside.md", "mode": "rich" }
        }]);
        unsafe_path["tabs"]["tab_1"]["historyIndex"] = json!(0);
        assert!(matches!(
            write_snapshot(&vault, &unsafe_path),
            Err(CoreError::Parse { .. })
        ));

        let mut metadata_path = valid_snapshot();
        metadata_path["tabs"]["tab_1"]["view"] =
            json!({ "type": "note", "path": ".workspace/config.json", "mode": "rich" });
        metadata_path["tabs"]["tab_1"]["history"] = json!([{
            "view": { "type": "note", "path": ".workspace/config.json", "mode": "rich" }
        }]);
        metadata_path["tabs"]["tab_1"]["historyIndex"] = json!(0);
        assert!(matches!(
            write_snapshot(&vault, &metadata_path),
            Err(CoreError::Parse { .. })
        ));
    }

    #[test]
    fn accepts_typed_resource_paths_and_opaque_location_objects() {
        let (_root, vault) = vault();
        let mut snapshot = valid_snapshot();
        snapshot["tabs"]["tab_1"]["view"] =
            json!({ "type": "note", "path": "notes/readme.md", "mode": "source" });
        snapshot["tabs"]["tab_1"]["history"] = json!([{
            "view": { "type": "note", "path": "notes/readme.md", "mode": "source" },
            "location": { "selection": { "anchor": 4 }, "scrollTop": 12 }
        }]);
        snapshot["tabs"]["tab_1"]["historyIndex"] = json!(0);
        write_snapshot(&vault, &snapshot).unwrap();
        assert_eq!(read_snapshot(&vault).unwrap(), Some(snapshot));
    }

    #[test]
    fn rejects_oversized_snapshot_before_write_and_read() {
        let (root, vault) = vault();
        let mut oversized = valid_snapshot();
        oversized["tabs"]["tab_1"]["title"] = json!("x".repeat(MAX_SNAPSHOT_BYTES as usize));
        assert!(matches!(
            write_snapshot(&vault, &oversized),
            Err(CoreError::Parse { .. })
        ));

        let ui_dir = root.path().join(".workspace/ui");
        fs::create_dir_all(&ui_dir).unwrap();
        fs::write(
            ui_dir.join("workspace-v2.json"),
            vec![b' '; MAX_SNAPSHOT_BYTES as usize + 1],
        )
        .unwrap();
        assert!(matches!(
            read_snapshot(&vault),
            Err(CoreError::Parse { .. })
        ));
    }

    #[test]
    fn corrupt_snapshot_is_a_recoverable_parse_error() {
        let (root, vault) = vault();
        let ui_dir = root.path().join(".workspace/ui");
        fs::create_dir_all(&ui_dir).unwrap();
        fs::write(ui_dir.join("workspace-v2.json"), b"not json").unwrap();
        assert!(matches!(
            read_snapshot(&vault),
            Err(CoreError::Parse { .. })
        ));
    }

    #[cfg(unix)]
    #[test]
    fn refuses_workspace_symlink_redirect() {
        use std::os::unix::fs::symlink;

        let (root, vault) = vault();
        let outside = tempfile::tempdir().unwrap();
        symlink(outside.path(), root.path().join(".workspace/ui")).unwrap();
        let result = write_snapshot(&vault, &valid_snapshot());
        assert!(matches!(result, Err(CoreError::PathTraversal(_))));
        assert!(!outside.path().join("workspace-v2.json").exists());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_preset_directory_and_file_symlink_redirects() {
        use std::os::unix::fs::symlink;

        let (root, vault) = vault();
        let outside = tempfile::tempdir().unwrap();
        let ui = root.path().join(".workspace/ui");
        fs::create_dir_all(&ui).unwrap();
        symlink(outside.path(), ui.join("presets")).unwrap();
        assert!(matches!(
            write_preset(&vault, "Research", &valid_snapshot()),
            Err(CoreError::PathTraversal(_))
        ));
        assert!(!outside
            .path()
            .join(preset_filename("Research").unwrap())
            .exists());

        fs::remove_file(ui.join("presets")).unwrap();
        fs::create_dir_all(ui.join("presets")).unwrap();
        let outside_file = outside.path().join("outside.json");
        fs::write(&outside_file, b"outside").unwrap();
        symlink(
            &outside_file,
            ui.join("presets").join(preset_filename("Linked").unwrap()),
        )
        .unwrap();
        assert!(matches!(
            read_preset(&vault, "Linked"),
            Err(CoreError::PathTraversal(_))
        ));
        assert!(matches!(
            list_presets(&vault),
            Err(CoreError::PathTraversal(_))
        ));
        assert!(matches!(
            delete_preset(&vault, "Linked"),
            Err(CoreError::PathTraversal(_))
        ));
    }
}
