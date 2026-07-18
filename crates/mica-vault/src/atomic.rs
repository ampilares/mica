use std::fs;
use std::io::Write;
use std::path::Path;

use mica_core::{ContentHash, CoreError, Result};

/// Atomic write pipeline (spec §5.2, FR-FS-005 / NFR-REL-001):
///
/// 1. write bytes to a temp file in the same directory
/// 2. fsync the temp file
/// 3. rename over the target (replace-atomic on Windows/macOS/Linux)
///
/// Returns the content hash of the written bytes so callers can register the
/// write with the watcher's self-write filter.
pub fn atomic_write(target: &Path, bytes: &[u8]) -> Result<ContentHash> {
    let dir = target
        .parent()
        .ok_or_else(|| CoreError::InvalidPath(target.display().to_string()))?;
    fs::create_dir_all(dir).map_err(|e| CoreError::io(dir, e))?;

    let mut tmp = tempfile::Builder::new()
        .prefix(".mica-tmp-")
        .suffix(".tmp")
        .tempfile_in(dir)
        .map_err(|e| CoreError::io(dir, e))?;

    tmp.write_all(bytes).map_err(|e| CoreError::io(target, e))?;
    tmp.as_file()
        .sync_all()
        .map_err(|e| CoreError::io(target, e))?;

    // `persist` renames with replace semantics on all platforms.
    tmp.persist(target)
        .map_err(|e| CoreError::io(target, e.error))?;

    sync_parent_directory(dir)?;

    Ok(ContentHash::of(bytes))
}

/// Make the renamed directory entry durable where the standard library offers
/// a safe directory handle. Unix requires this extra fsync after the atomic
/// rename. Rust's portable Windows API cannot open a directory with the flags
/// needed for `FlushFileBuffers`, so Windows retains atomic replacement but not
/// this additional power-loss durability guarantee.
#[cfg(unix)]
fn sync_parent_directory(dir: &Path) -> Result<()> {
    fs::File::open(dir)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| CoreError::io(dir, error))
}

#[cfg(not(unix))]
fn sync_parent_directory(_dir: &Path) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_and_replaces() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("file.md");
        atomic_write(&target, b"one").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "one");
        atomic_write(&target, b"two").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "two");
        // No temp litter left behind.
        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains("tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn parent_directory_can_be_synced_after_rename() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("durable.json");
        atomic_write(&target, b"durable").unwrap();
        sync_parent_directory(dir.path()).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"durable");
    }
}
