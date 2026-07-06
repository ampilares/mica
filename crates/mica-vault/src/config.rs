use serde::{Deserialize, Serialize};

use mica_core::CONFIG_SCHEMA_VERSION;

/// Per-vault settings stored at `.workspace/config.json`.
/// This file (plus `backups/`) is the only non-rebuildable content under
/// `.workspace/`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultConfig {
    pub schema_version: u32,
    /// Human-readable vault name (defaults to the folder name).
    pub name: String,
    /// Default folder for new notes, relative to the vault root.
    #[serde(default = "default_notes_dir")]
    pub notes_dir: String,
    #[serde(default = "default_databases_dir")]
    pub databases_dir: String,
    #[serde(default = "default_canvases_dir")]
    pub canvases_dir: String,
    #[serde(default = "default_assets_dir")]
    pub assets_dir: String,
    /// Unknown keys survive round-trips so newer app versions don't lose data.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

fn default_notes_dir() -> String {
    "notes".into()
}
fn default_databases_dir() -> String {
    "databases".into()
}
fn default_canvases_dir() -> String {
    "canvases".into()
}
fn default_assets_dir() -> String {
    "assets".into()
}

impl VaultConfig {
    pub fn new(name: impl Into<String>) -> Self {
        VaultConfig {
            schema_version: CONFIG_SCHEMA_VERSION,
            name: name.into(),
            notes_dir: default_notes_dir(),
            databases_dir: default_databases_dir(),
            canvases_dir: default_canvases_dir(),
            assets_dir: default_assets_dir(),
            extra: serde_json::Map::new(),
        }
    }
}
