use serde::{Deserialize, Serialize};

use mica_core::VaultPath;

/// What kind of record a file is, judged by extension (spec §4.1: canonical
/// files are discovered anywhere in the vault, not just default folders).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileKind {
    Note,
    Database,
    Canvas,
    Asset,
    Other,
}

impl FileKind {
    pub fn from_path(path: &VaultPath) -> FileKind {
        match path.extension() {
            Some("md") => FileKind::Note,
            Some("database.json") => FileKind::Database,
            Some("drawio") => FileKind::Canvas,
            Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "pdf" | "mp4" | "mp3"
            | "wav" | "zip") => FileKind::Asset,
            _ => FileKind::Other,
        }
    }
}

/// One node of the sidebar file tree.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileNode {
    pub path: VaultPath,
    pub name: String,
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<FileKind>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<FileNode>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FileTree {
    pub roots: Vec<FileNode>,
}

impl FileTree {
    /// Flatten to all file (non-dir) nodes.
    pub fn files(&self) -> Vec<&FileNode> {
        fn walk<'a>(nodes: &'a [FileNode], out: &mut Vec<&'a FileNode>) {
            for n in nodes {
                if n.is_dir {
                    walk(&n.children, out);
                } else {
                    out.push(n);
                }
            }
        }
        let mut out = Vec::new();
        walk(&self.roots, &mut out);
        out
    }
}
