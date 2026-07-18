use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use mica_core::{ContentHash, CoreError, VaultPath, WORKSPACE_DIR};
use mica_db::{apply_ops as apply_db_ops, Database, DbOp, QueryResult};
use mica_drawio::{apply_canvas_ops, CanvasOp, Scene};
use mica_markdown::NoteDocument;
use mica_search::{BacklinkHit, Graph, QuickSwitchHit, SearchHit, SearchIndex, TagCount};
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
    // Warm start: reconcile by (mtime, size); only changed files re-parse
    // (NFR-PERF-001). A fresh/mismatched index degenerates to a full build.
    index.sync(&vault).map_err(ApiError::from)?;
    let index = Arc::new(Mutex::new(index));

    // Watcher → incremental index updates + push events to the frontend.
    let watcher = {
        let app = app.clone();
        let vault_w = vault.clone();
        let index_w = index.clone();
        VaultWatcher::start(
            vault.root(),
            filter.clone(),
            move |events: Vec<VaultEvent>| {
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
            },
        )
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

/// Returns the currently open vault without turning the normal "no vault"
/// startup state into an API error. Native windows use this to attach to the
/// process-wide vault opened by another Mica window.
#[tauri::command]
pub fn vault_current(state: State<'_, AppState>) -> ApiResult<Option<VaultInfo>> {
    let open = state.open.lock().map_err(|_| ApiError {
        code: "state_poisoned".into(),
        message: "vault state lock is poisoned".into(),
        path: None,
    })?;
    Ok(open.as_ref().map(|open| VaultInfo {
        root: open.vault.root().display().to_string(),
        name: open.vault.config().name.clone(),
    }))
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
    tauri_plugin_opener::open_path(abs.to_string_lossy().to_string(), None::<String>).map_err(|e| {
        ApiError {
            code: "open_failed".into(),
            message: e.to_string(),
            path: Some(path),
        }
    })
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
    let hash = open
        .vault
        .write_text(path, content)
        .map_err(ApiError::from)?;
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
    let config = open.vault.config();
    let dir = dir.unwrap_or_else(|| config.notes_dir.clone());
    // Naming strategy (FR-SET): kebab-case slug (default) or title verbatim.
    let stem = if config.naming == "title" {
        let cleaned: String = title
            .trim()
            .chars()
            .map(|c| {
                if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                    ' '
                } else {
                    c
                }
            })
            .collect();
        let cleaned = cleaned.trim().to_string();
        if cleaned.is_empty() {
            slugify(&title)
        } else {
            cleaned
        }
    } else {
        slugify(&title)
    };
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

    // Find referrers before the index forgets the old path.
    let referrers: Vec<VaultPath> = {
        let idx = open.index.lock().unwrap();
        idx.backlinks(&from)
            .map(|hits| hits.into_iter().map(|h| h.source).collect())
            .unwrap_or_default()
    };

    open.vault.rename(&from, &to).map_err(ApiError::from)?;

    // Rewrite relative markdown links in referring notes (minimal diffs).
    for source in referrers {
        let Ok((content, _)) = open.vault.read_text(&source) else {
            continue;
        };
        if let Some(rewritten) =
            mica_markdown::rewrite_links(&content, source.as_str(), from.as_str(), to.as_str())
        {
            if let Ok(hash) = open.vault.write_text(&source, &rewritten) {
                open.filter.record(&open.vault.abs(&source), hash);
            }
        }
    }

    let mut idx = open.index.lock().unwrap();
    if let Err(e) = idx.rename_file(&open.vault, &from, &to) {
        tracing::warn!("index rename failed: {e}");
    }
    Ok(to)
}

#[tauri::command]
pub fn note_duplicate(state: State<'_, AppState>, path: String) -> ApiResult<LoadedFile> {
    let open = state.current().map_err(ApiError::from)?;
    let rel = VaultPath::new(&path).map_err(ApiError::from)?;
    let (content, _) = open.vault.read_text(&rel).map_err(ApiError::from)?;
    let dir = rel
        .parent()
        .map(|p| p.as_str().to_string())
        .unwrap_or_default();
    let ext = rel.extension().unwrap_or("md").to_string();
    let copy_path = open
        .vault
        .unique_path(&dir, &format!("{} copy", rel.stem()), &ext)
        .map_err(ApiError::from)?;
    // A duplicated note must not share the original's stable id.
    let content = if ext == "md" {
        let mut doc = NoteDocument::parse(&content).map_err(ApiError::from)?;
        if let Some(fm) = &mut doc.frontmatter {
            if fm.id().is_some() {
                fm.set_str(
                    "id",
                    &mica_core::RecordId::new(mica_core::IdKind::Note).to_string(),
                );
            }
        }
        doc.serialize().map_err(ApiError::from)?
    } else {
        content
    };
    let version = guarded_write(&open, &copy_path, &content, None)?;
    Ok(LoadedFile {
        path: copy_path,
        content,
        version,
    })
}

/// Save a pasted/dropped asset into the configured assets folder.
/// Returns the vault-relative path of the stored file.
#[tauri::command]
pub fn asset_save(
    state: State<'_, AppState>,
    name: String,
    data_base64: String,
) -> ApiResult<VaultPath> {
    use base64::Engine;
    let open = state.current().map_err(ApiError::from)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| ApiError {
            code: "bad_asset".into(),
            message: e.to_string(),
            path: None,
        })?;
    let safe_name: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let (stem, ext) = match safe_name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), e.to_string()),
        _ => (safe_name.clone(), "png".to_string()),
    };
    let dir = format!("{}/images", open.vault.config().assets_dir);
    let path = open
        .vault
        .unique_path(&dir, &stem, &ext)
        .map_err(ApiError::from)?;
    let hash = open
        .vault
        .write_bytes(&path, &bytes)
        .map_err(ApiError::from)?;
    open.filter.record(&open.vault.abs(&path), hash);
    Ok(path)
}

#[derive(Debug, Serialize)]
pub struct BackupOutcome {
    pub folder: String,
    pub files: usize,
}

#[tauri::command]
pub fn config_get(state: State<'_, AppState>) -> ApiResult<mica_vault::VaultConfig> {
    let open = state.current().map_err(ApiError::from)?;
    Ok(open.vault.config())
}

#[tauri::command]
pub fn config_set(
    state: State<'_, AppState>,
    config: mica_vault::VaultConfig,
) -> ApiResult<mica_vault::VaultConfig> {
    let open = state.current().map_err(ApiError::from)?;
    open.vault.set_config(config).map_err(ApiError::from)?;
    Ok(open.vault.config())
}

#[tauri::command]
pub fn vault_backup(state: State<'_, AppState>) -> ApiResult<BackupOutcome> {
    let open = state.current().map_err(ApiError::from)?;
    let (folder, files) = open.vault.backup().map_err(ApiError::from)?;
    Ok(BackupOutcome { folder, files })
}

#[tauri::command]
pub fn vault_import_folder(
    state: State<'_, AppState>,
    src: String,
    dest_dir: Option<String>,
) -> ApiResult<usize> {
    let open = state.current().map_err(ApiError::from)?;
    let dest = dest_dir.unwrap_or_else(|| open.vault.config().notes_dir.clone());
    let count = open
        .vault
        .import_folder(&PathBuf::from(&src), &dest)
        .map_err(ApiError::from)?;
    // Imported files are external writes; index them now.
    if let Err(e) = open.index.lock().unwrap().sync(&open.vault) {
        tracing::warn!("index sync after import failed: {e}");
    }
    Ok(count)
}

#[tauri::command]
pub fn vault_export(
    state: State<'_, AppState>,
    paths: Vec<String>,
    dest: String,
) -> ApiResult<usize> {
    let open = state.current().map_err(ApiError::from)?;
    let vault_paths: Result<Vec<VaultPath>, _> = paths.iter().map(|p| VaultPath::new(p)).collect();
    let vault_paths = vault_paths.map_err(ApiError::from)?;
    open.vault
        .export_files(&vault_paths, &PathBuf::from(&dest))
        .map_err(ApiError::from)
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
                let backup =
                    VaultPath::new(&format!("{WORKSPACE_DIR}/backups/{stamp}/{}", rel.as_str()))
                        .map_err(ApiError::from)?;
                open.vault
                    .write_text(&backup, &theirs)
                    .map_err(ApiError::from)?;
            }
            let disk = open.vault.hash_of(&rel).ok();
            let version =
                guarded_write(&open, &rel, &my_content, disk.as_ref().map(|h| h.as_str()))?;
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

/// Read + parse an external CSV file for the import-mapping UI.
#[tauri::command]
pub fn csv_preview(src: String) -> ApiResult<mica_db::CsvPreview> {
    let text = std::fs::read_to_string(&src).map_err(|e| ApiError {
        code: "csv_read_failed".into(),
        message: e.to_string(),
        path: Some(src.clone()),
    })?;
    mica_db::preview_csv(&text, 8).map_err(ApiError::from)
}

/// Import an external CSV into an existing database using a column mapping.
#[tauri::command]
pub fn db_import_csv(
    state: State<'_, AppState>,
    path: String,
    src: String,
    mapping: Vec<mica_db::ColumnMapping>,
    base_version: String,
) -> ApiResult<DbApplyOutcome> {
    let open = state.current().map_err(ApiError::from)?;
    let rel = VaultPath::new(&path).map_err(ApiError::from)?;
    let (content, disk_version) = open.vault.read_text(&rel).map_err(ApiError::from)?;
    if disk_version.as_str() != base_version {
        return Err(ApiError::from(CoreError::Conflict { path: rel }));
    }
    let text = std::fs::read_to_string(&src).map_err(|e| ApiError {
        code: "csv_read_failed".into(),
        message: e.to_string(),
        path: Some(src.clone()),
    })?;
    let mut db = Database::parse(&content).map_err(ApiError::from)?;
    mica_db::import_csv(&mut db, &text, &mapping).map_err(ApiError::from)?;
    db.touch();
    let new_content = db.serialize().map_err(ApiError::from)?;
    let version = guarded_write(&open, &rel, &new_content, Some(disk_version.as_str()))?;
    Ok(DbApplyOutcome {
        content: new_content,
        version,
    })
}

/// Export one view of a database as CSV to an external path.
#[tauri::command]
pub fn db_export_csv(
    state: State<'_, AppState>,
    path: String,
    view_id: String,
    dest: String,
) -> ApiResult<usize> {
    let open = state.current().map_err(ApiError::from)?;
    let rel = VaultPath::new(&path).map_err(ApiError::from)?;
    let (content, _) = open.vault.read_text(&rel).map_err(ApiError::from)?;
    let db = Database::parse(&content).map_err(ApiError::from)?;
    let csv = mica_db::export_csv(&db, &view_id).map_err(ApiError::from)?;
    let rows = csv.lines().count().saturating_sub(1);
    std::fs::write(&dest, csv.as_bytes()).map_err(|e| ApiError {
        code: "csv_write_failed".into(),
        message: e.to_string(),
        path: Some(dest.clone()),
    })?;
    Ok(rows)
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

/// Resolve an href written relative to `canvas_path`'s folder into a
/// vault-relative path ("canvases/x.drawio" + "../notes/a.md" → "notes/a.md").
fn href_to_vault_path(canvas_path: &VaultPath, href: &str) -> Option<String> {
    let dir = canvas_path
        .as_str()
        .rsplit_once('/')
        .map(|(d, _)| d)
        .unwrap_or("");
    let combined = if dir.is_empty() {
        href.to_string()
    } else {
        format!("{dir}/{href}")
    };
    VaultPath::new(&combined)
        .ok()
        .map(|p| p.as_str().to_string())
}

/// Re-base a vault-relative path so it is relative to `canvas_path`'s folder.
fn vault_path_to_href(canvas_path: &VaultPath, target: &str) -> String {
    let dir = canvas_path
        .as_str()
        .rsplit_once('/')
        .map(|(d, _)| d)
        .unwrap_or("");
    if dir.is_empty() {
        return target.to_string();
    }
    let ups = dir.split('/').count();
    format!("{}{target}", "../".repeat(ups))
}

/// Import an external canvas file (.canvas, .excalidraw, or foreign .drawio)
/// as a new canonical `.drawio` in the vault (spec §4.4.1 / FR-IMP-003).
#[tauri::command]
pub fn canvas_import(
    state: State<'_, AppState>,
    src: String,
    title: Option<String>,
) -> ApiResult<LoadedFile> {
    let open = state.current().map_err(ApiError::from)?;
    let src_path = PathBuf::from(&src);
    let text = std::fs::read_to_string(&src_path).map_err(|e| ApiError {
        code: "import_read_failed".into(),
        message: e.to_string(),
        path: Some(src.clone()),
    })?;
    let stem = title.unwrap_or_else(|| {
        src_path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Imported canvas".into())
    });
    let ext = src_path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let mut scene = match ext.as_str() {
        "canvas" => mica_drawio::interop::import_obsidian(&stem, &text).map_err(ApiError::from)?,
        "excalidraw" => {
            mica_drawio::interop::import_excalidraw(&stem, &text).map_err(ApiError::from)?
        }
        // Foreign draw.io: parse through our reader (unknown cells preserved).
        _ => Scene::parse(&text).map_err(ApiError::from)?,
    };

    let dir = open.vault.config().canvases_dir.clone();
    let path = open
        .vault
        .unique_path(&dir, &slugify(&stem), "drawio")
        .map_err(ApiError::from)?;

    // Obsidian file nodes carry vault-relative paths; re-base them onto the
    // new canvas location.
    if ext == "canvas" {
        for cell in &mut scene.cells {
            if let Some(href) = &cell.href {
                cell.href = Some(vault_path_to_href(&path, href));
            }
        }
    }

    let content = scene.serialize().map_err(ApiError::from)?;
    let version = guarded_write(&open, &path, &content, None)?;
    Ok(LoadedFile {
        path,
        content,
        version,
    })
}

/// Export a canvas to an external file as Obsidian Canvas or Excalidraw
/// (one-shot, documented-lossy — FR-EXP / spec §4.4.1).
#[tauri::command]
pub fn canvas_export(
    state: State<'_, AppState>,
    path: String,
    format: String,
    dest: String,
) -> ApiResult<()> {
    let open = state.current().map_err(ApiError::from)?;
    let rel = VaultPath::new(&path).map_err(ApiError::from)?;
    let (content, _) = open.vault.read_text(&rel).map_err(ApiError::from)?;
    let mut scene = Scene::parse(&content).map_err(ApiError::from)?;

    let out = match format.as_str() {
        "obsidian" => {
            // Obsidian wants vault-relative file paths.
            for cell in &mut scene.cells {
                if let Some(href) = &cell.href {
                    if let Some(vp) = href_to_vault_path(&rel, href) {
                        cell.href = Some(vp);
                    }
                }
            }
            mica_drawio::interop::export_obsidian(&scene).map_err(ApiError::from)?
        }
        "excalidraw" => mica_drawio::interop::export_excalidraw(&scene).map_err(ApiError::from)?,
        other => {
            return Err(ApiError {
                code: "bad_format".into(),
                message: format!("unknown canvas export format: {other}"),
                path: None,
            })
        }
    };
    std::fs::write(&dest, out.as_bytes()).map_err(|e| ApiError {
        code: "export_write_failed".into(),
        message: e.to_string(),
        path: Some(dest.clone()),
    })?;
    Ok(())
}

/// Write frontend-generated bytes (canvas PNG/SVG exports) to an external
/// path picked through the save dialog.
#[tauri::command]
pub fn export_file(dest: String, data_base64: String) -> ApiResult<()> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| ApiError {
            code: "bad_data".into(),
            message: e.to_string(),
            path: None,
        })?;
    std::fs::write(&dest, &bytes).map_err(|e| ApiError {
        code: "export_write_failed".into(),
        message: e.to_string(),
        path: Some(dest.clone()),
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
    idx.search(&query, limit.unwrap_or(50))
        .map_err(ApiError::from)
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
pub fn link_graph(
    state: State<'_, AppState>,
    center: Option<String>,
    depth: Option<usize>,
) -> ApiResult<Graph> {
    let open = state.current().map_err(ApiError::from)?;
    let center = match center {
        Some(c) => Some(VaultPath::new(&c).map_err(ApiError::from)?),
        None => None,
    };
    let idx = open.index.lock().unwrap();
    idx.graph(center.as_ref(), depth.unwrap_or(2))
        .map_err(ApiError::from)
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
