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
pub use timestamp::{now_rfc3339, rfc3339_from_unix};

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
/// v3: files carry created/updated/journal metadata for docs_list (spec §2.1);
///     edgeless sidecar canvases are excluded from the index (spec §2.5).
/// v4: tags(file_id) index — docs_list's per-file tag aggregation was a full
///     tags-table scan per row without it (4.3 s for 5k docs → target <150 ms).
pub const INDEX_SCHEMA_VERSION: u32 = 4;

/// Name of the hidden per-vault folder holding config, index, and backups.
pub const WORKSPACE_DIR: &str = ".workspace";

/// Name of the hidden per-vault trash folder (spec §1.3).
pub const TRASH_DIR: &str = ".trash";
