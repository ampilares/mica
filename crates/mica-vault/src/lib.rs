//! Vault lifecycle: create/open a vault folder, scan its file tree, and write
//! canonical files through the atomic pipeline. The vault never rewrites a
//! file it wasn't asked to touch, and unknown files are preserved untouched.

pub mod atomic;
pub mod config;
pub mod history;
pub mod trash;
pub mod tree;
pub mod vault;

pub use atomic::atomic_write;
pub use config::VaultConfig;
pub use history::HistoryEntry;
pub use trash::{TrashEntry, TrashMeta};
pub use tree::{FileKind, FileNode, FileTree};
pub use vault::{slugify, Vault};
