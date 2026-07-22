// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod error;
mod state;

use state::AppState;

fn main() {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::vault_create,
            commands::vault_open,
            commands::vault_close,
            commands::vault_tree,
            commands::vault_reveal,
            commands::vault_open_external,
            commands::config_get,
            commands::config_set,
            commands::vault_backup,
            commands::vault_import_folder,
            commands::vault_export,
            commands::note_create,
            commands::note_load,
            commands::note_save,
            commands::note_rename,
            commands::note_delete,
            commands::note_duplicate,
            commands::asset_save,
            commands::conflict_resolve,
            commands::db_create,
            commands::db_load,
            commands::db_apply,
            commands::db_query,
            commands::csv_preview,
            commands::db_import_csv,
            commands::db_export_csv,
            commands::canvas_create,
            commands::canvas_load,
            commands::canvas_apply,
            commands::canvas_import,
            commands::canvas_export,
            commands::export_file,
            commands::docs_list,
            commands::journal_ensure,
            commands::asset_stat,
            commands::link_preview,
            commands::open_url,
            commands::note_section,
            commands::template_list,
            commands::template_instantiate,
            commands::history_list,
            commands::history_read,
            commands::history_restore,
            commands::trash_move,
            commands::trash_list,
            commands::trash_restore,
            commands::trash_purge,
            commands::note_meta_get,
            commands::note_meta_set,
            commands::canvas_sidecar_ensure,
            commands::search_query,
            commands::quick_switch,
            commands::links_backlinks,
            commands::link_graph,
            commands::tags_list,
            commands::resolve_wiki,
            commands::index_rebuild,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Mica");
}
