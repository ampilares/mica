//! Domain primitives shared by every Mica crate: typed ULIDs, vault-relative
//! paths, content hashes, timestamps, errors, and schema version constants.

pub mod error;
pub mod hash;
pub mod id;
pub mod path;
pub mod timestamp;

pub use error::{CoreError, Result};
pub use hash::ContentHash;
pub use id::{IdKind, RecordId};
pub use path::VaultPath;
pub use timestamp::now_rfc3339;

/// Schema version written into app-created Markdown frontmatter.
pub const NOTE_SCHEMA_VERSION: u32 = 1;
/// Schema version written into `.database.json` files.
pub const DATABASE_SCHEMA_VERSION: u32 = 1;
/// Schema version written into `.drawio` files (`data-workspace-schema-version`).
pub const CANVAS_SCHEMA_VERSION: u32 = 1;
/// Schema version of `.workspace/config.json`.
pub const CONFIG_SCHEMA_VERSION: u32 = 1;
/// Schema version of the SQLite index; bump to force a rebuild.
/// v2: database rows and canvas labels are FTS-indexed (FR-SRCH-002).
pub const INDEX_SCHEMA_VERSION: u32 = 2;

/// Name of the hidden per-vault folder holding config, index, and backups.
pub const WORKSPACE_DIR: &str = ".workspace";
