use std::sync::{Arc, Mutex};

use mica_core::{CoreError, Result};
use mica_search::SearchIndex;
use mica_vault::Vault;
use mica_watch::{SelfWriteFilter, VaultWatcher};

/// Everything that lives while one vault is open.
pub struct OpenVault {
    pub vault: Arc<Vault>,
    pub index: Arc<Mutex<SearchIndex>>,
    pub filter: SelfWriteFilter,
    /// Kept alive for its Drop; dropping stops the watch thread.
    pub _watcher: Option<VaultWatcher>,
}

#[derive(Default)]
pub struct AppState {
    pub open: Mutex<Option<Arc<OpenVault>>>,
}

impl AppState {
    pub fn current(&self) -> Result<Arc<OpenVault>> {
        self.open
            .lock()
            .unwrap()
            .as_ref()
            .cloned()
            .ok_or(CoreError::NoVault)
    }
}
