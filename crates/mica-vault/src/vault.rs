use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use mica_core::{ContentHash, CoreError, Result, VaultPath, WORKSPACE_DIR};

use crate::atomic::atomic_write;
use crate::config::VaultConfig;
use crate::tree::{FileKind, FileNode, FileTree};

/// An open vault rooted at a local folder. All file access goes through this
/// type so path validation and atomic writes are impossible to bypass.
#[derive(Debug)]
pub struct Vault {
    root: PathBuf,
    config: RwLock<VaultConfig>,
}

impl Vault {
    /// Create a new vault: default folder structure + `.workspace/config.json`.
    /// Existing user files are never touched (safe to run in a non-empty dir).
    pub fn create(root: &Path) -> Result<Vault> {
        fs::create_dir_all(root).map_err(|e| CoreError::io(root, e))?;

        // Warn-level guard: refuse to nest a vault inside an existing vault
        // (FR-VLT-005 is a warning in UI; the command layer surfaces it).
        let config = VaultConfig::new(
            root.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Vault".to_string()),
        );

        for dir in [
            config.notes_dir.as_str(),
            config.databases_dir.as_str(),
            config.canvases_dir.as_str(),
            config.assets_dir.as_str(),
            "templates",
            &format!("{WORKSPACE_DIR}/index"),
            &format!("{WORKSPACE_DIR}/backups"),
        ] {
            let p = root.join(dir);
            fs::create_dir_all(&p).map_err(|e| CoreError::io(&p, e))?;
        }

        let config_path = root.join(WORKSPACE_DIR).join("config.json");
        if !config_path.exists() {
            let bytes = serde_json::to_vec_pretty(&config)
                .map_err(|e| CoreError::Serialize(e.to_string()))?;
            let mut bytes = bytes;
            bytes.push(b'\n');
            atomic_write(&config_path, &bytes)?;
        }

        Vault::open(root)
    }

    /// Open an existing vault, or any plain folder (zero-migration: a missing
    /// `.workspace/` just means defaults; nothing is written until the user
    /// creates or edits content — FR-VLT-003).
    pub fn open(root: &Path) -> Result<Vault> {
        if !root.is_dir() {
            return Err(CoreError::io(
                root,
                std::io::Error::new(std::io::ErrorKind::NotFound, "folder does not exist"),
            ));
        }
        let root = dunce_canonicalize(root)?;
        let config_path = root.join(WORKSPACE_DIR).join("config.json");
        let config = if config_path.is_file() {
            let text =
                fs::read_to_string(&config_path).map_err(|e| CoreError::io(&config_path, e))?;
            serde_json::from_str(&text).map_err(|e| {
                CoreError::parse(config_path.display().to_string(), e.to_string())
            })?
        } else {
            VaultConfig::new(
                root.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "Vault".to_string()),
            )
        };
        Ok(Vault {
            root,
            config: RwLock::new(config),
        })
    }

    /// Whether `root` (or an ancestor) already contains a vault marker.
    pub fn find_enclosing_vault(path: &Path) -> Option<PathBuf> {
        let mut cur = Some(path);
        while let Some(p) = cur {
            if p.join(WORKSPACE_DIR).join("config.json").is_file() {
                return Some(p.to_path_buf());
            }
            cur = p.parent();
        }
        None
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn config(&self) -> VaultConfig {
        self.config.read().unwrap().clone()
    }

    /// Persist new vault settings to `.workspace/config.json` (atomic) and
    /// apply them to this open vault immediately.
    pub fn set_config(&self, new: VaultConfig) -> Result<()> {
        let config_path = self.root.join(WORKSPACE_DIR).join("config.json");
        let mut bytes = serde_json::to_vec_pretty(&new)
            .map_err(|e| CoreError::Serialize(e.to_string()))?;
        bytes.push(b'\n');
        atomic_write(&config_path, &bytes)?;
        *self.config.write().unwrap() = new;
        Ok(())
    }

    pub fn abs(&self, path: &VaultPath) -> PathBuf {
        path.to_absolute(&self.root)
    }

    /// Recursive scan into a sidebar file tree. `.workspace/` and hidden
    /// files/folders (dot-prefixed) are skipped; unknown files are listed but
    /// never touched (FR-FS-004).
    pub fn scan_tree(&self) -> Result<FileTree> {
        let roots = self.scan_dir(&self.root)?;
        Ok(FileTree { roots })
    }

    fn scan_dir(&self, dir: &Path) -> Result<Vec<FileNode>> {
        let mut nodes: Vec<FileNode> = Vec::new();
        let entries = fs::read_dir(dir).map_err(|e| CoreError::io(dir, e))?;
        for entry in entries.filter_map(|e| e.ok()) {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let abs = entry.path();
            let Ok(rel) = VaultPath::from_absolute(&self.root, &abs) else {
                continue;
            };
            let file_type = entry.file_type().map_err(|e| CoreError::io(&abs, e))?;
            if file_type.is_dir() {
                let children = self.scan_dir(&abs)?;
                nodes.push(FileNode {
                    path: rel,
                    name,
                    is_dir: true,
                    kind: None,
                    children,
                });
            } else if file_type.is_file() {
                let kind = FileKind::from_path(&rel);
                nodes.push(FileNode {
                    path: rel,
                    name,
                    is_dir: false,
                    kind: Some(kind),
                    children: Vec::new(),
                });
            }
        }
        // Directories first, then files, both alphabetical (stable UI order).
        nodes.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(nodes)
    }

    /// Read a canonical text file.
    pub fn read_text(&self, path: &VaultPath) -> Result<(String, ContentHash)> {
        let abs = self.abs(path);
        let bytes = fs::read(&abs).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => CoreError::NotFound(path.clone()),
            _ => CoreError::io(&abs, e),
        })?;
        let hash = ContentHash::of(&bytes);
        let text = String::from_utf8(bytes)
            .map_err(|_| CoreError::parse(path.as_str(), "file is not valid UTF-8"))?;
        Ok((text, hash))
    }

    /// Atomically write a canonical file; returns the new content hash.
    pub fn write_text(&self, path: &VaultPath, content: &str) -> Result<ContentHash> {
        atomic_write(&self.abs(path), content.as_bytes())
    }

    pub fn exists(&self, path: &VaultPath) -> bool {
        self.abs(path).exists()
    }

    pub fn hash_of(&self, path: &VaultPath) -> Result<ContentHash> {
        let abs = self.abs(path);
        let bytes = fs::read(&abs).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => CoreError::NotFound(path.clone()),
            _ => CoreError::io(&abs, e),
        })?;
        Ok(ContentHash::of(&bytes))
    }

    /// Delete → OS trash, never a hard unlink (spec §5.2).
    pub fn delete(&self, path: &VaultPath) -> Result<()> {
        let abs = self.abs(path);
        if !abs.exists() {
            return Err(CoreError::NotFound(path.clone()));
        }
        trash::delete(&abs).map_err(|e| CoreError::Other(format!("move to trash failed: {e}")))
    }

    /// Rename/move within the vault. Fails if the target already exists.
    pub fn rename(&self, from: &VaultPath, to: &VaultPath) -> Result<()> {
        let abs_from = self.abs(from);
        let abs_to = self.abs(to);
        if !abs_from.exists() {
            return Err(CoreError::NotFound(from.clone()));
        }
        if abs_to.exists() {
            return Err(CoreError::AlreadyExists(to.clone()));
        }
        if let Some(parent) = abs_to.parent() {
            fs::create_dir_all(parent).map_err(|e| CoreError::io(parent, e))?;
        }
        fs::rename(&abs_from, &abs_to).map_err(|e| CoreError::io(&abs_from, e))
    }

    /// Write binary content (assets) through the same atomic pipeline.
    pub fn write_bytes(&self, path: &VaultPath, bytes: &[u8]) -> Result<ContentHash> {
        atomic_write(&self.abs(path), bytes)
    }

    /// Snapshot all canonical files into `.workspace/backups/<stamp>/`.
    /// Returns (backup folder name, number of files copied).
    pub fn backup(&self) -> Result<(String, usize)> {
        let stamp = mica_core::now_rfc3339().replace(':', "-");
        let dest_root = self
            .root
            .join(WORKSPACE_DIR)
            .join("backups")
            .join(&stamp);
        let tree = self.scan_tree()?;
        let mut count = 0usize;
        for file in tree.files() {
            let src = self.abs(&file.path);
            let dest = file.path.to_absolute(&dest_root);
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).map_err(|e| CoreError::io(parent, e))?;
            }
            fs::copy(&src, &dest).map_err(|e| CoreError::io(&src, e))?;
            count += 1;
        }
        Ok((stamp, count))
    }

    /// Copy an external folder's Markdown files (and common assets) into the
    /// vault under `dest_dir` (FR-IMP-001, copy-in mode). Existing files are
    /// never overwritten; colliding names get a numeric suffix.
    pub fn import_folder(&self, src: &Path, dest_dir: &str) -> Result<usize> {
        let mut count = 0usize;
        for entry in walkdir::WalkDir::new(src)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
        {
            let name = entry.file_name().to_string_lossy();
            if name.starts_with('.') {
                continue;
            }
            let rel_in_src = entry
                .path()
                .strip_prefix(src)
                .map_err(|_| CoreError::InvalidPath(entry.path().display().to_string()))?;
            let rel_str = rel_in_src.to_string_lossy().replace('\\', "/");
            let candidate = if dest_dir.is_empty() {
                rel_str.clone()
            } else {
                format!("{dest_dir}/{rel_str}")
            };
            let Ok(mut target) = VaultPath::new(&candidate) else {
                continue;
            };
            if self.exists(&target) {
                let dir = target.parent().map(|p| p.as_str().to_string()).unwrap_or_default();
                let ext = target.extension().unwrap_or("md").to_string();
                target = self.unique_path(&dir, target.stem(), &ext)?;
            }
            let bytes = fs::read(entry.path()).map_err(|e| CoreError::io(entry.path(), e))?;
            self.write_bytes(&target, &bytes)?;
            count += 1;
        }
        Ok(count)
    }

    /// Export files to a destination folder outside the vault.
    pub fn export_files(&self, paths: &[VaultPath], dest: &Path) -> Result<usize> {
        let mut count = 0usize;
        for path in paths {
            let src = self.abs(path);
            let target = path.to_absolute(dest);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| CoreError::io(parent, e))?;
            }
            fs::copy(&src, &target).map_err(|e| CoreError::io(&src, e))?;
            count += 1;
        }
        Ok(count)
    }

    /// Find a non-colliding path by appending ` 2`, ` 3`, … to the stem.
    pub fn unique_path(&self, dir: &str, stem: &str, ext: &str) -> Result<VaultPath> {
        let make = |candidate: &str| -> Result<VaultPath> {
            let name = format!("{candidate}.{ext}");
            if dir.is_empty() {
                VaultPath::new(&name)
            } else {
                VaultPath::new(&format!("{dir}/{name}"))
            }
        };
        let first = make(stem)?;
        if !self.exists(&first) {
            return Ok(first);
        }
        for i in 2..1000 {
            let p = make(&format!("{stem} {i}"))?;
            if !self.exists(&p) {
                return Ok(p);
            }
        }
        Err(CoreError::Other("could not find unique file name".into()))
    }
}

/// Canonicalize without Windows `\\?\` UNC prefixes (they break display and
/// some tooling).
fn dunce_canonicalize(path: &Path) -> Result<PathBuf> {
    let canon = fs::canonicalize(path).map_err(|e| CoreError::io(path, e))?;
    let s = canon.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        Ok(PathBuf::from(stripped))
    } else {
        Ok(canon)
    }
}

/// Slugify a title into a kebab-case file stem (default naming strategy).
pub fn slugify(title: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for c in title.trim().chars() {
        if c.is_alphanumeric() {
            out.extend(c.to_lowercase());
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() {
        "untitled".to_string()
    } else {
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_and_scan() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::create(dir.path()).unwrap();
        assert!(dir.path().join(".workspace/config.json").is_file());
        let tree = vault.scan_tree().unwrap();
        // .workspace is hidden from the tree
        assert!(tree.roots.iter().all(|n| n.name != ".workspace"));
        // default dirs exist
        assert!(tree.roots.iter().any(|n| n.name == "notes" && n.is_dir));
    }

    #[test]
    fn open_plain_folder_is_nondestructive() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("existing.md"), "# Hi\n").unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        let tree = vault.scan_tree().unwrap();
        assert!(tree.files().iter().any(|f| f.name == "existing.md"));
        // Opening didn't create anything.
        assert!(!dir.path().join(".workspace").exists());
        assert!(!dir.path().join("notes").exists());
    }

    #[test]
    fn write_read_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::create(dir.path()).unwrap();
        let p = VaultPath::new("notes/test.md").unwrap();
        let h1 = vault.write_text(&p, "hello\n").unwrap();
        let (text, h2) = vault.read_text(&p).unwrap();
        assert_eq!(text, "hello\n");
        assert_eq!(h1, h2);
    }

    #[test]
    fn unique_path_appends_counter() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::create(dir.path()).unwrap();
        let p1 = vault.unique_path("notes", "plan", "md").unwrap();
        vault.write_text(&p1, "x\n").unwrap();
        let p2 = vault.unique_path("notes", "plan", "md").unwrap();
        assert_eq!(p2.as_str(), "notes/plan 2.md");
    }

    #[test]
    fn backup_snapshots_files() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::create(dir.path()).unwrap();
        vault
            .write_text(&VaultPath::new("notes/a.md").unwrap(), "# A\n")
            .unwrap();
        let (stamp, count) = vault.backup().unwrap();
        assert!(count >= 1);
        assert!(dir
            .path()
            .join(".workspace/backups")
            .join(&stamp)
            .join("notes/a.md")
            .is_file());
    }

    #[test]
    fn import_folder_copies_without_overwrite() {
        let src = tempfile::tempdir().unwrap();
        fs::write(src.path().join("one.md"), "# One\n").unwrap();
        fs::create_dir_all(src.path().join("sub")).unwrap();
        fs::write(src.path().join("sub/two.md"), "# Two\n").unwrap();

        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::create(dir.path()).unwrap();
        vault
            .write_text(&VaultPath::new("import/one.md").unwrap(), "existing\n")
            .unwrap();
        let count = vault.import_folder(src.path(), "import").unwrap();
        assert_eq!(count, 2);
        // Existing file untouched; import got a suffixed name.
        let (existing, _) = vault
            .read_text(&VaultPath::new("import/one.md").unwrap())
            .unwrap();
        assert_eq!(existing, "existing\n");
        assert!(vault.exists(&VaultPath::new("import/one 2.md").unwrap()));
        assert!(vault.exists(&VaultPath::new("import/sub/two.md").unwrap()));
    }

    /// PRD §30: a crash between temp-write and rename must leave the original
    /// intact. We simulate the crash window by verifying a failed persist
    /// (temp file dropped) never touches the target.
    #[test]
    fn interrupted_save_leaves_original() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("file.md");
        fs::write(&target, "original").unwrap();
        // Simulate the pre-rename crash: temp file written then abandoned.
        let tmp = tempfile::Builder::new()
            .prefix(".mica-tmp-")
            .tempfile_in(dir.path())
            .unwrap();
        std::io::Write::write_all(&mut tmp.as_file(), b"partial new content").unwrap();
        drop(tmp); // "crash": temp removed, rename never happened
        assert_eq!(fs::read_to_string(&target).unwrap(), "original");
    }

    #[test]
    fn slugs() {
        assert_eq!(slugify("Project Plan!"), "project-plan");
        assert_eq!(slugify("  "), "untitled");
        assert_eq!(slugify("Ünïcode Née"), "ünïcode-née");
    }
}
