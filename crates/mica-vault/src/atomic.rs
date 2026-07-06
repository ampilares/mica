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
    tmp.as_file().sync_all().map_err(|e| CoreError::io(target, e))?;

    // `persist` renames with replace semantics on all platforms.
    tmp.persist(target)
        .map_err(|e| CoreError::io(target, e.error))?;

    Ok(ContentHash::of(bytes))
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
}
