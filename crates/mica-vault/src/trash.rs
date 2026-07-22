//! Vault trash (spec §1.3): "delete" moves a file into `<vault>/.trash/`
//! preserving its relative path, restore moves it back, purge removes it for
//! good. Moves are plain renames — atomic on the same volume, never
//! copy-delete. A doc's edgeless sidecar canvas travels with it both ways.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use mica_core::{now_rfc3339, CoreError, Result, VaultPath, TRASH_DIR};

use crate::atomic::atomic_write;
use crate::tree::FileKind;
use crate::vault::Vault;

/// One record in `.trash/.meta.json`, keyed by the trash-relative path.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrashMeta {
    pub original: String,
    pub deleted: String,
}

/// A trash listing row for the UI (sidecar canvases are folded into their doc).
#[derive(Debug, Clone, Serialize)]
pub struct TrashEntry {
    pub trash_path: VaultPath,
    pub original: String,
    pub deleted: String,
    pub title: String,
    pub kind: FileKind,
}

impl Vault {
    fn trash_meta_abs(&self) -> PathBuf {
        self.root().join(TRASH_DIR).join(".meta.json")
    }

    fn read_trash_meta(&self) -> BTreeMap<String, TrashMeta> {
        fs::read_to_string(self.trash_meta_abs())
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    fn write_trash_meta(&self, meta: &BTreeMap<String, TrashMeta>) -> Result<()> {
        let mut bytes =
            serde_json::to_vec_pretty(meta).map_err(|e| CoreError::Serialize(e.to_string()))?;
        bytes.push(b'\n');
        atomic_write(&self.trash_meta_abs(), &bytes)?;
        Ok(())
    }

    /// Move a file (and its sidecar canvas, if any) into the trash. Returns
    /// the trashed paths, main file first.
    pub fn trash_move(&self, path: &VaultPath) -> Result<Vec<VaultPath>> {
        if !self.abs(path).is_file() {
            return Err(CoreError::NotFound(path.clone()));
        }
        let mut targets = vec![path.clone()];
        if let Some(sidecar) = path.sidecar_canvas() {
            if self.abs(&sidecar).is_file() {
                targets.push(sidecar);
            }
        }
        let mut meta = self.read_trash_meta();
        let deleted = now_rfc3339();
        let mut moved = Vec::new();
        for target in targets {
            let ideal = VaultPath::new(&format!("{TRASH_DIR}/{}", target.as_str()))?;
            let dest = if self.exists(&ideal) {
                let dir = ideal
                    .parent()
                    .map(|p| p.as_str().to_string())
                    .unwrap_or_default();
                let ext = ideal.extension().unwrap_or("md").to_string();
                self.unique_path(&dir, ideal.stem(), &ext)?
            } else {
                ideal
            };
            self.rename(&target, &dest)?;
            meta.insert(
                dest.as_str().to_string(),
                TrashMeta {
                    original: target.as_str().to_string(),
                    deleted: deleted.clone(),
                },
            );
            moved.push(dest);
        }
        self.write_trash_meta(&meta)?;
        Ok(moved)
    }

    /// List trash contents, newest deletion first. Sidecar canvases are
    /// hidden — they restore alongside their doc.
    pub fn trash_list(&self) -> Result<Vec<TrashEntry>> {
        let meta = self.read_trash_meta();
        let mut entries: Vec<TrashEntry> = meta
            .iter()
            .filter_map(|(trash_path, m)| {
                let tp = VaultPath::new(trash_path).ok()?;
                if !self.abs(&tp).is_file() {
                    return None;
                }
                let original = VaultPath::new(&m.original).ok()?;
                if original.is_sidecar_canvas() {
                    return None;
                }
                Some(TrashEntry {
                    kind: FileKind::from_path(&original),
                    title: original.stem().to_string(),
                    original: m.original.clone(),
                    deleted: m.deleted.clone(),
                    trash_path: tp,
                })
            })
            .collect();
        entries.sort_by(|a, b| b.deleted.cmp(&a.deleted).then(a.original.cmp(&b.original)));
        Ok(entries)
    }

    /// Restore one trash entry (and its sidecar) to its original location,
    /// auto-renaming on collision. Returns the restored path.
    pub fn trash_restore(&self, trash_path: &VaultPath) -> Result<VaultPath> {
        let mut meta = self.read_trash_meta();
        let original = meta
            .get(trash_path.as_str())
            .map(|m| m.original.clone())
            .or_else(|| {
                trash_path
                    .as_str()
                    .strip_prefix(&format!("{TRASH_DIR}/"))
                    .map(String::from)
            })
            .ok_or_else(|| CoreError::NotFound(trash_path.clone()))?;
        let restored = self.restore_one(trash_path, &original)?;
        meta.remove(trash_path.as_str());

        // Bring the paired sidecar back next to the restored doc.
        if let (Some(orig_sidecar), Some(dest_sidecar)) = (
            VaultPath::new(&original).ok().and_then(|p| p.sidecar_canvas()),
            restored.sidecar_canvas(),
        ) {
            let paired: Option<String> = meta
                .iter()
                .find(|(_, m)| m.original == orig_sidecar.as_str())
                .map(|(k, _)| k.clone());
            if let Some(key) = paired {
                if let Ok(tp) = VaultPath::new(&key) {
                    if self.restore_one(&tp, dest_sidecar.as_str()).is_ok() {
                        meta.remove(&key);
                    }
                }
            }
        }
        self.write_trash_meta(&meta)?;
        Ok(restored)
    }

    fn restore_one(&self, trash_path: &VaultPath, original: &str) -> Result<VaultPath> {
        if !self.abs(trash_path).is_file() {
            return Err(CoreError::NotFound(trash_path.clone()));
        }
        let mut dest = VaultPath::new(original)?;
        if self.exists(&dest) {
            let dir = dest
                .parent()
                .map(|p| p.as_str().to_string())
                .unwrap_or_default();
            let ext = dest.extension().unwrap_or("md").to_string();
            dest = self.unique_path(&dir, dest.stem(), &ext)?;
        }
        self.rename(trash_path, &dest)?;
        Ok(dest)
    }

    /// Permanently delete one trash entry (with its sidecar), or empty the
    /// whole trash when `trash_path` is None. Returns how many files were
    /// removed.
    pub fn trash_purge(&self, trash_path: Option<&VaultPath>) -> Result<u32> {
        let mut meta = self.read_trash_meta();
        match trash_path {
            Some(tp) => {
                let mut keys = vec![tp.as_str().to_string()];
                // Pair: the sidecar of this entry's original, if trashed too.
                if let Some(orig) = meta.get(tp.as_str()).map(|m| m.original.clone()) {
                    if let Some(sidecar) =
                        VaultPath::new(&orig).ok().and_then(|p| p.sidecar_canvas())
                    {
                        keys.extend(
                            meta.iter()
                                .filter(|(_, m)| m.original == sidecar.as_str())
                                .map(|(k, _)| k.clone()),
                        );
                    }
                }
                let mut count = 0u32;
                for key in keys {
                    if let Ok(p) = VaultPath::new(&key) {
                        let abs = self.abs(&p);
                        if abs.is_file() {
                            fs::remove_file(&abs).map_err(|e| CoreError::io(&abs, e))?;
                            count += 1;
                        }
                    }
                    meta.remove(&key);
                }
                self.write_trash_meta(&meta)?;
                Ok(count)
            }
            None => {
                let count = meta.len() as u32;
                let trash_root = self.root().join(TRASH_DIR);
                if trash_root.is_dir() {
                    fs::remove_dir_all(&trash_root)
                        .map_err(|e| CoreError::io(&trash_root, e))?;
                }
                Ok(count)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::create(dir.path()).unwrap();
        (dir, vault)
    }

    #[test]
    fn move_list_restore_roundtrip() {
        let (_dir, vault) = vault();
        let p = VaultPath::new("notes/keep.md").unwrap();
        vault.write_text(&p, "# Keep\n").unwrap();

        let moved = vault.trash_move(&p).unwrap();
        assert_eq!(moved.len(), 1);
        assert!(!vault.exists(&p));
        assert!(vault.exists(&moved[0]));

        let list = vault.trash_list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].original, "notes/keep.md");
        assert_eq!(list[0].title, "keep");

        let restored = vault.trash_restore(&moved[0]).unwrap();
        assert_eq!(restored.as_str(), "notes/keep.md");
        assert!(vault.exists(&p));
        assert!(vault.trash_list().unwrap().is_empty());
        let (text, _) = vault.read_text(&p).unwrap();
        assert_eq!(text, "# Keep\n");
    }

    #[test]
    fn sidecar_travels_with_doc() {
        let (_dir, vault) = vault();
        let md = VaultPath::new("notes/plan.md").unwrap();
        let sc = md.sidecar_canvas().unwrap();
        vault.write_text(&md, "# Plan\n").unwrap();
        vault.write_text(&sc, "<mxfile/>\n").unwrap();

        let moved = vault.trash_move(&md).unwrap();
        assert_eq!(moved.len(), 2);
        assert!(!vault.exists(&sc));
        // Sidecar hidden from the listing.
        assert_eq!(vault.trash_list().unwrap().len(), 1);

        let restored = vault.trash_restore(&moved[0]).unwrap();
        assert_eq!(restored.as_str(), "notes/plan.md");
        assert!(vault.exists(&sc));
        assert!(vault.trash_list().unwrap().is_empty());
    }

    #[test]
    fn restore_collision_renames() {
        let (_dir, vault) = vault();
        let p = VaultPath::new("notes/x.md").unwrap();
        vault.write_text(&p, "old\n").unwrap();
        let moved = vault.trash_move(&p).unwrap();
        vault.write_text(&p, "new occupant\n").unwrap();

        let restored = vault.trash_restore(&moved[0]).unwrap();
        assert_eq!(restored.as_str(), "notes/x 2.md");
        let (text, _) = vault.read_text(&p).unwrap();
        assert_eq!(text, "new occupant\n");
    }

    #[test]
    fn trash_collision_gets_unique_name() {
        let (_dir, vault) = vault();
        let p = VaultPath::new("notes/dup.md").unwrap();
        vault.write_text(&p, "one\n").unwrap();
        let first = vault.trash_move(&p).unwrap();
        vault.write_text(&p, "two\n").unwrap();
        let second = vault.trash_move(&p).unwrap();
        assert_ne!(first[0], second[0]);
        assert_eq!(vault.trash_list().unwrap().len(), 2);
    }

    #[test]
    fn purge_one_and_all() {
        let (_dir, vault) = vault();
        for name in ["a", "b"] {
            let p = VaultPath::new(&format!("notes/{name}.md")).unwrap();
            vault.write_text(&p, "x\n").unwrap();
            vault.trash_move(&p).unwrap();
        }
        let list = vault.trash_list().unwrap();
        assert_eq!(vault.trash_purge(Some(&list[0].trash_path)).unwrap(), 1);
        assert_eq!(vault.trash_list().unwrap().len(), 1);
        assert_eq!(vault.trash_purge(None).unwrap(), 1);
        assert!(vault.trash_list().unwrap().is_empty());
    }

    #[test]
    fn trash_is_hidden_from_tree() {
        let (_dir, vault) = vault();
        let p = VaultPath::new("notes/hidden.md").unwrap();
        vault.write_text(&p, "x\n").unwrap();
        vault.trash_move(&p).unwrap();
        let tree = vault.scan_tree().unwrap();
        assert!(tree.files().iter().all(|f| !f.path.as_str().starts_with(".trash")));
    }
}
