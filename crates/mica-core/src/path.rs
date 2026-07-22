use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

use crate::error::CoreError;

/// A validated vault-relative path.
///
/// Invariants:
/// - always relative (never absolute, never has a drive/UNC prefix)
/// - normalized to forward slashes on every platform (NFR-PORT-004)
/// - contains no `.` / `..` components (traversal-safe)
/// - never empty
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct VaultPath(String);

impl VaultPath {
    pub fn new(raw: &str) -> Result<Self, CoreError> {
        let normalized = raw.replace('\\', "/");
        if normalized.starts_with('/') || normalized.contains(':') {
            return Err(CoreError::InvalidPath(format!(
                "absolute paths not allowed: {raw}"
            )));
        }
        let trimmed = normalized.trim_end_matches('/');
        if trimmed.is_empty() {
            return Err(CoreError::InvalidPath("empty path".into()));
        }
        let path = Path::new(trimmed);
        let mut parts: Vec<&str> = Vec::new();
        for comp in path.components() {
            match comp {
                Component::Normal(p) => {
                    let s = p
                        .to_str()
                        .ok_or_else(|| CoreError::InvalidPath(raw.to_string()))?;
                    parts.push(s);
                }
                Component::CurDir => continue,
                Component::ParentDir => {
                    if parts.pop().is_none() {
                        return Err(CoreError::PathTraversal(raw.to_string()));
                    }
                }
                Component::RootDir | Component::Prefix(_) => {
                    return Err(CoreError::InvalidPath(format!(
                        "absolute paths not allowed: {raw}"
                    )));
                }
            }
        }
        if parts.is_empty() {
            return Err(CoreError::InvalidPath(raw.to_string()));
        }
        Ok(VaultPath(parts.join("/")))
    }

    /// Build from a path already known to be inside `root`.
    pub fn from_absolute(root: &Path, abs: &Path) -> Result<Self, CoreError> {
        let rel = abs
            .strip_prefix(root)
            .map_err(|_| CoreError::PathTraversal(abs.display().to_string()))?;
        let s = rel
            .to_str()
            .ok_or_else(|| CoreError::InvalidPath(abs.display().to_string()))?;
        VaultPath::new(s)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Resolve to an absolute filesystem path under `root`.
    pub fn to_absolute(&self, root: &Path) -> PathBuf {
        let mut p = root.to_path_buf();
        for part in self.0.split('/') {
            p.push(part);
        }
        p
    }

    pub fn file_name(&self) -> &str {
        self.0.rsplit('/').next().unwrap_or(&self.0)
    }

    /// File stem (name without the final extension; `.database.json` is
    /// treated as a single compound extension).
    pub fn stem(&self) -> &str {
        let name = self.file_name();
        if let Some(s) = name.strip_suffix(".database.json") {
            return s;
        }
        match name.rsplit_once('.') {
            Some((stem, _)) if !stem.is_empty() => stem,
            _ => name,
        }
    }

    pub fn parent(&self) -> Option<VaultPath> {
        self.0
            .rsplit_once('/')
            .map(|(dir, _)| VaultPath(dir.to_string()))
    }

    pub fn join(&self, child: &str) -> Result<VaultPath, CoreError> {
        VaultPath::new(&format!("{}/{}", self.0, child))
    }

    pub fn starts_with(&self, prefix: &VaultPath) -> bool {
        self.0 == prefix.0 || self.0.starts_with(&format!("{}/", prefix.0))
    }

    /// Whether this is a doc's edgeless sidecar canvas (`<stem>.canvas.drawio`,
    /// spec §1.2). Sidecars are reachable through their doc and hidden from
    /// doc listings, quick search, and the index.
    pub fn is_sidecar_canvas(&self) -> bool {
        self.0.ends_with(".canvas.drawio")
    }

    /// The edgeless sidecar canvas path for a `.md` doc (spec §1.2), or None
    /// for non-markdown paths.
    pub fn sidecar_canvas(&self) -> Option<VaultPath> {
        let stem_path = self.0.strip_suffix(".md")?;
        Some(VaultPath(format!("{stem_path}.canvas.drawio")))
    }

    pub fn extension(&self) -> Option<&str> {
        let name = self.file_name();
        if name.ends_with(".database.json") {
            return Some("database.json");
        }
        name.rsplit_once('.').map(|(_, ext)| ext)
    }
}

impl std::fmt::Display for VaultPath {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl TryFrom<String> for VaultPath {
    type Error = CoreError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        VaultPath::new(&value)
    }
}

impl From<VaultPath> for String {
    fn from(value: VaultPath) -> Self {
        value.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_separators() {
        assert_eq!(
            VaultPath::new("notes\\sub\\a.md").unwrap().as_str(),
            "notes/sub/a.md"
        );
    }

    #[test]
    fn rejects_traversal() {
        assert!(VaultPath::new("../etc/passwd").is_err());
        assert!(VaultPath::new("notes/../../x").is_err());
        assert!(VaultPath::new("C:\\Windows\\system32").is_err());
        assert!(VaultPath::new("/abs/path").is_err());
    }

    #[test]
    fn resolves_inner_dotdot() {
        assert_eq!(
            VaultPath::new("notes/sub/../a.md").unwrap().as_str(),
            "notes/a.md"
        );
    }

    #[test]
    fn compound_extension() {
        let p = VaultPath::new("databases/tasks.database.json").unwrap();
        assert_eq!(p.extension(), Some("database.json"));
        assert_eq!(p.stem(), "tasks");
    }
}
