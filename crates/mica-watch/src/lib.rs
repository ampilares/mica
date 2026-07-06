//! File watching (FR-FS-001/002, spec §8.1): a debounced recursive watcher
//! over the vault root with a self-write filter so the app's own atomic saves
//! don't echo back as external changes.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::RecommendedWatcher;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use serde::{Deserialize, Serialize};

use mica_core::{ContentHash, VaultPath, WORKSPACE_DIR};

/// A change that happened on disk, already classified and vault-relative.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum VaultEvent {
    Created { path: VaultPath },
    Modified { path: VaultPath },
    Deleted { path: VaultPath },
    Renamed { from: VaultPath, to: VaultPath },
}

impl VaultEvent {
    pub fn path(&self) -> &VaultPath {
        match self {
            VaultEvent::Created { path }
            | VaultEvent::Modified { path }
            | VaultEvent::Deleted { path } => path,
            VaultEvent::Renamed { to, .. } => to,
        }
    }
}

/// Remembers the hash of every write the app performed so watcher events for
/// our own saves can be swallowed (spec §3.2).
#[derive(Debug, Default, Clone)]
pub struct SelfWriteFilter {
    inner: Arc<Mutex<HashMap<PathBuf, ContentHash>>>,
}

impl SelfWriteFilter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record(&self, abs_path: &Path, hash: ContentHash) {
        self.inner
            .lock()
            .unwrap()
            .insert(normalize(abs_path), hash);
    }

    /// True when the on-disk content at `abs_path` matches the last app
    /// write, meaning the event is an echo of our own save.
    pub fn is_own_write(&self, abs_path: &Path) -> bool {
        let key = normalize(abs_path);
        let expected = { self.inner.lock().unwrap().get(&key).cloned() };
        match expected {
            None => false,
            Some(hash) => match std::fs::read(abs_path) {
                Ok(bytes) => ContentHash::of(&bytes) == hash,
                Err(_) => false,
            },
        }
    }

    pub fn forget(&self, abs_path: &Path) {
        self.inner.lock().unwrap().remove(&normalize(abs_path));
    }
}

fn normalize(p: &Path) -> PathBuf {
    PathBuf::from(p.to_string_lossy().replace('\\', "/").to_lowercase())
}

pub struct VaultWatcher {
    // Held for its Drop side effect: dropping stops the watcher thread.
    _debouncer: Debouncer<RecommendedWatcher, RecommendedCache>,
}

impl VaultWatcher {
    /// Start watching `root`. Classified, debounced (200 ms), self-filtered
    /// events are delivered to `on_events` in batches.
    pub fn start(
        root: &Path,
        filter: SelfWriteFilter,
        on_events: impl Fn(Vec<VaultEvent>) + Send + 'static,
    ) -> notify::Result<VaultWatcher> {
        let root_buf = root.to_path_buf();

        let mut debouncer = new_debouncer(
            Duration::from_millis(200),
            None,
            move |result: DebounceEventResult| {
                let events = match result {
                    Ok(events) => events,
                    Err(errors) => {
                        for e in errors {
                            tracing::warn!("watch error: {e}");
                        }
                        return;
                    }
                };
                let mut out: Vec<VaultEvent> = Vec::new();
                for event in events {
                    classify(&root_buf, &filter, &event.event, &mut out);
                }
                // Deduplicate identical consecutive events after coalescing.
                out.dedup_by(|a, b| format!("{a:?}") == format!("{b:?}"));
                if !out.is_empty() {
                    on_events(out);
                }
            },
        )?;

        debouncer.watch(root, notify::RecursiveMode::Recursive)?;
        Ok(VaultWatcher {
            _debouncer: debouncer,
        })
    }
}

fn classify(
    root: &Path,
    filter: &SelfWriteFilter,
    event: &notify::Event,
    out: &mut Vec<VaultEvent>,
) {
    use notify::event::{EventKind, ModifyKind, RenameMode};

    let to_rel = |p: &PathBuf| -> Option<VaultPath> {
        let rel = VaultPath::from_absolute(root, p).ok()?;
        // Ignore the hidden workspace folder and editor temp files.
        if rel.as_str().starts_with(WORKSPACE_DIR) {
            return None;
        }
        let name = rel.file_name();
        if name.starts_with(".mica-tmp-") || name.ends_with(".tmp") || name.starts_with('.') {
            return None;
        }
        Some(rel)
    };

    match &event.kind {
        EventKind::Create(_) => {
            for p in &event.paths {
                if let Some(rel) = to_rel(p) {
                    if filter.is_own_write(p) {
                        continue;
                    }
                    out.push(VaultEvent::Created { path: rel });
                }
            }
        }
        EventKind::Modify(ModifyKind::Name(mode)) => match mode {
            RenameMode::Both if event.paths.len() == 2 => {
                if let (Some(from), Some(to)) = (to_rel(&event.paths[0]), to_rel(&event.paths[1]))
                {
                    out.push(VaultEvent::Renamed { from, to });
                }
            }
            _ => {
                // From/To halves or unknown: emit best-effort delete/create.
                for p in &event.paths {
                    if let Some(rel) = to_rel(p) {
                        if p.exists() {
                            if !filter.is_own_write(p) {
                                out.push(VaultEvent::Created { path: rel });
                            }
                        } else {
                            out.push(VaultEvent::Deleted { path: rel });
                        }
                    }
                }
            }
        },
        EventKind::Modify(_) => {
            for p in &event.paths {
                if let Some(rel) = to_rel(p) {
                    if p.is_dir() || filter.is_own_write(p) {
                        continue;
                    }
                    if p.exists() {
                        out.push(VaultEvent::Modified { path: rel });
                    } else {
                        out.push(VaultEvent::Deleted { path: rel });
                    }
                }
            }
        }
        EventKind::Remove(_) => {
            for p in &event.paths {
                if let Some(rel) = to_rel(p) {
                    if p.exists() {
                        // Atomic saves replace the file via rename; a Remove
                        // for a path that still exists is that replacement,
                        // not a real deletion.
                        if !filter.is_own_write(p) {
                            out.push(VaultEvent::Modified { path: rel });
                        }
                    } else {
                        filter.forget(p);
                        out.push(VaultEvent::Deleted { path: rel });
                    }
                }
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn detects_external_create_and_modify() {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        let filter = SelfWriteFilter::new();
        let (tx, rx) = mpsc::channel::<Vec<VaultEvent>>();
        let _watcher = VaultWatcher::start(&root, filter.clone(), move |evs| {
            let _ = tx.send(evs);
        })
        .unwrap();

        std::thread::sleep(Duration::from_millis(300));
        std::fs::write(root.join("new.md"), "hello\n").unwrap();

        let events = rx.recv_timeout(Duration::from_secs(5)).expect("no events");
        assert!(events
            .iter()
            .any(|e| matches!(e, VaultEvent::Created { path } | VaultEvent::Modified { path } if path.as_str() == "new.md")));
    }

    #[test]
    fn own_writes_are_filtered() {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        let filter = SelfWriteFilter::new();
        let (tx, rx) = mpsc::channel::<Vec<VaultEvent>>();
        let _watcher = VaultWatcher::start(&root, filter.clone(), move |evs| {
            let _ = tx.send(evs);
        })
        .unwrap();

        std::thread::sleep(Duration::from_millis(300));
        let target = root.join("own.md");
        let content = b"app wrote this\n";
        filter.record(&target, ContentHash::of(content));
        std::fs::write(&target, content).unwrap();

        // Expect no events for our own write within the window.
        let got = rx.recv_timeout(Duration::from_millis(1500));
        assert!(
            got.is_err() || got.unwrap().iter().all(|e| e.path().as_str() != "own.md"),
            "own write should be filtered"
        );
    }
}
