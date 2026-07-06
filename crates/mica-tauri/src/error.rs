use serde::Serialize;

use mica_core::CoreError;

/// Error shape delivered to the frontend. `code` lets the UI branch on
/// conflicts and missing files without string matching.
#[derive(Debug, Serialize)]
pub struct ApiError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

impl From<CoreError> for ApiError {
    fn from(err: CoreError) -> Self {
        let (code, path) = match &err {
            CoreError::Conflict { path } => ("conflict", Some(path.as_str().to_string())),
            CoreError::NotFound(p) => ("not_found", Some(p.as_str().to_string())),
            CoreError::AlreadyExists(p) => ("already_exists", Some(p.as_str().to_string())),
            CoreError::NoVault => ("no_vault", None),
            CoreError::PathTraversal(_) | CoreError::InvalidPath(_) => ("invalid_path", None),
            CoreError::Parse { path, .. } => ("parse_error", Some(path.clone())),
            _ => ("internal", None),
        };
        ApiError {
            code: code.to_string(),
            message: err.to_string(),
            path,
        }
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
