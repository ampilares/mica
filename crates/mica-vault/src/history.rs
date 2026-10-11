//! Local doc history (spec v2.1 §1.10): debounced, deduped snapshots of
//! canonical files under `.workspace/history/<vault-rel-path>/<stamp>.<ext>`.
//! History is cache-class — deleting the folder loses only history, never
//! canonical truth.

use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use mica_core::{now_rfc3339, CoreError, Result, VaultPath, WORKSPACE_DIR};

use crate::atomic::atomic_write;
use crate::vault::Vault;

/// Minimum age of the newest snapshot before another one is taken.
const SNAPSHOT_DEBOUNCE: Duration = Duration::from_secs(5 * 60);

#[derive(Debug, Clone, Serialize)]
pub struct HistoryEntry {
    /// Snapshot file name: `<unix-ms>-<rfc3339-fs-safe>.<ext>`. The numeric
    /// prefix makes lexical order equal time order; the rest keeps it
    /// human-readable in a file browser.
    pub stamp: String,
    pub size: u64,
}

impl Vault {
    fn history_dir_for(&self, path: &VaultPath) -> PathBuf {
        let mut dir = self.root().join(WORKSPACE_DIR).join("history");
        for part in path.as_str().split('/') {
            dir.push(part);
        }
        dir
    }

    /// Snapshot `content` for `path`. Skipped (returns false) when the newest
    /// snapshot has identical content, or is younger than the debounce window
    /// (unless `force`, used before restores so the current state is never
    /// silently lost).
    pub fn history_snapshot(&self, path: &VaultPath, content: &str, force: bool) -> Result<bool> {
        let dir = self.history_dir_for(path);
        if let Some(newest) = self.history_list(path)?.first() {
            let newest_path = dir.join(&newest.stamp);
            if let Ok(prev) = fs::read(&newest_path) {
                if prev == content.as_bytes() {
                    return Ok(false);
                }
            }
            if !force {
                let age = fs::metadata(&newest_path)
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|t| SystemTime::now().duration_since(t).ok());
                if age.map(|a| a < SNAPSHOT_DEBOUNCE).unwrap_or(false) {
                    return Ok(false);
                }
            }
        }
        let ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let ext = path.extension().unwrap_or("txt");
        let stamp = format!("{ms:013}-{}.{ext}", now_rfc3339().replace(':', "-"));
        atomic_write(&dir.join(&stamp), content.as_bytes())?;
        Ok(true)
    }

    /// Snapshots for `path`, newest first.
    pub fn history_list(&self, path: &VaultPath) -> Result<Vec<HistoryEntry>> {
        let dir = self.history_dir_for(path);
        let Ok(read) = fs::read_dir(&dir) else {
            return Ok(Vec::new());
        };
        let mut out: Vec<HistoryEntry> = read
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
            .filter_map(|e| {
                Some(HistoryEntry {
                    stamp: e.file_name().to_str()?.to_string(),
                    size: e.metadata().ok()?.len(),
                })
            })
            .collect();
        out.sort_by(|a, b| b.stamp.cmp(&a.stamp));
        Ok(out)
    }

    pub fn history_read(&self, path: &VaultPath, stamp: &str) -> Result<String> {
        // The stamp is a bare file name from history_list; reject separators
        // so it can't escape the history dir.
        if stamp.contains('/') || stamp.contains('\\') || stamp.contains("..") {
            return Err(CoreError::InvalidPath(stamp.to_string()));
        }
        let file = self.history_dir_for(path).join(stamp);
        fs::read_to_string(&file).map_err(|e| CoreError::io(&file, e))
    }

    /// Enforce per-file count/age budgets across the whole history store.
    /// Returns the number of snapshots removed.
    pub fn history_prune(&self, max_per_file: usize, max_age_days: u64) -> Result<u32> {
        let root = self.root().join(WORKSPACE_DIR).join("history");
        if !root.is_dir() {
            return Ok(0);
        }
        let cutoff = SystemTime::now() - Duration::from_secs(max_age_days * 24 * 60 * 60);
        let mut removed = 0u32;
        for entry in walkdir::WalkDir::new(&root)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_dir())
        {
            let Ok(read) = fs::read_dir(entry.path()) else { continue };
            let mut snaps: Vec<(String, PathBuf, Option<SystemTime>)> = read
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
                .filter_map(|e| {
                    let name = e.file_name().to_str()?.to_string();
                    let mtime = e.metadata().ok().and_then(|m| m.modified().ok());
                    Some((name, e.path(), mtime))
                })
                .collect();
            snaps.sort_by(|a, b| b.0.cmp(&a.0));
            for (i, (_, p, mtime)) in snaps.iter().enumerate() {
                let too_many = i >= max_per_file;
                let too_old = mtime.map(|t| t < cutoff).unwrap_or(false);
                if (too_many || too_old) && fs::remove_file(p).is_ok() {
                    removed += 1;
                }
            }
        }
        Ok(removed)
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
    fn snapshot_dedupe_and_list() {
        let (_dir, vault) = vault();
        let p = VaultPath::new("notes/a.md").unwrap();
        assert!(vault.history_snapshot(&p, "v1\n", false).unwrap());
        // Identical content → skipped even with force.
        assert!(!vault.history_snapshot(&p, "v1\n", true).unwrap());
        // Different content within the debounce window → only with force.
        assert!(!vault.history_snapshot(&p, "v2\n", false).unwrap());
        std::thread::sleep(Duration::from_millis(5));
        assert!(vault.history_snapshot(&p, "v2\n", true).unwrap());

        let list = vault.history_list(&p).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(vault.history_read(&p, &list[0].stamp).unwrap(), "v2\n");
        assert_eq!(vault.history_read(&p, &list[1].stamp).unwrap(), "v1\n");
    }

    #[test]
    fn prune_by_count() {
        let (_dir, vault) = vault();
        let p = VaultPath::new("notes/b.md").unwrap();
        for i in 0..5 {
            vault.history_snapshot(&p, &format!("v{i}\n"), true).unwrap();
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(vault.history_list(&p).unwrap().len(), 5);
        let removed = vault.history_prune(2, 365).unwrap();
        assert_eq!(removed, 3);
        let left = vault.history_list(&p).unwrap();
        assert_eq!(left.len(), 2);
        assert_eq!(vault.history_read(&p, &left[0].stamp).unwrap(), "v4\n");
    }

    #[test]
    fn read_rejects_traversal() {
        let (_dir, vault) = vault();
        let p = VaultPath::new("notes/c.md").unwrap();
        assert!(vault.history_read(&p, "../../config.json").is_err());
    }
}
