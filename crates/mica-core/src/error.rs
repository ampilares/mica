use crate::path::VaultPath;

pub type Result<T, E = CoreError> = std::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("io error at {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },

    #[error("path escapes the vault: {0}")]
    PathTraversal(String),

    #[error("invalid path: {0}")]
    InvalidPath(String),

    #[error("not found: {0}")]
    NotFound(VaultPath),

    #[error("already exists: {0}")]
    AlreadyExists(VaultPath),

    #[error("parse error in {path}: {message}")]
    Parse { path: String, message: String },

    #[error("serialize error: {0}")]
    Serialize(String),

    #[error("save conflict on {path}: file changed on disk since it was loaded")]
    Conflict { path: VaultPath },

    #[error("no vault is open")]
    NoVault,

    #[error("invalid id: {0}")]
    InvalidId(String),

    #[error("index error: {0}")]
    Index(String),

    #[error("{0}")]
    Other(String),
}

impl CoreError {
    pub fn io(path: impl AsRef<std::path::Path>, source: std::io::Error) -> Self {
        CoreError::Io {
            path: path.as_ref().display().to_string(),
            source,
        }
    }

    pub fn parse(path: impl Into<String>, message: impl Into<String>) -> Self {
        CoreError::Parse {
            path: path.into(),
            message: message.into(),
        }
    }
}
