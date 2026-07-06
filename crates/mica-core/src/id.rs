use serde::{Deserialize, Serialize};
use ulid::Ulid;

use crate::error::CoreError;

/// The record/entity kinds that get prefix-typed ULIDs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum IdKind {
    Note,
    Database,
    Canvas,
    Row,
    Property,
    View,
    Block,
    Shape,
    Option,
}

impl IdKind {
    pub const fn prefix(self) -> &'static str {
        match self {
            IdKind::Note => "note",
            IdKind::Database => "db",
            IdKind::Canvas => "canvas",
            IdKind::Row => "row",
            IdKind::Property => "prop",
            IdKind::View => "view",
            IdKind::Block => "block",
            IdKind::Shape => "shape",
            IdKind::Option => "opt",
        }
    }

    fn from_prefix(prefix: &str) -> Option<Self> {
        Some(match prefix {
            "note" => IdKind::Note,
            "db" => IdKind::Database,
            "canvas" => IdKind::Canvas,
            "row" => IdKind::Row,
            "prop" => IdKind::Property,
            "view" => IdKind::View,
            "block" => IdKind::Block,
            "shape" => IdKind::Shape,
            "opt" => IdKind::Option,
            _ => return None,
        })
    }
}

/// A prefix-typed ULID such as `note_01JZ0Q2P3M5VCB8K0HQG2YJS4P`.
///
/// Serialized as its string form everywhere (JSON, frontmatter, XML, SQLite).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct RecordId {
    kind: IdKind,
    ulid: Ulid,
}

impl RecordId {
    pub fn new(kind: IdKind) -> Self {
        RecordId {
            kind,
            ulid: Ulid::new(),
        }
    }

    pub fn kind(&self) -> IdKind {
        self.kind
    }

    pub fn parse(s: &str) -> Result<Self, CoreError> {
        let (prefix, ulid_str) = s
            .rsplit_once('_')
            .ok_or_else(|| CoreError::InvalidId(s.to_string()))?;
        let kind =
            IdKind::from_prefix(prefix).ok_or_else(|| CoreError::InvalidId(s.to_string()))?;
        let ulid =
            Ulid::from_string(ulid_str).map_err(|_| CoreError::InvalidId(s.to_string()))?;
        Ok(RecordId { kind, ulid })
    }
}

impl std::fmt::Display for RecordId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}_{}", self.kind.prefix(), self.ulid)
    }
}

impl TryFrom<String> for RecordId {
    type Error = CoreError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        RecordId::parse(&value)
    }
}

impl From<RecordId> for String {
    fn from(value: RecordId) -> Self {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let id = RecordId::new(IdKind::Note);
        let s = id.to_string();
        assert!(s.starts_with("note_"));
        assert_eq!(RecordId::parse(&s).unwrap(), id);
    }

    #[test]
    fn rejects_garbage() {
        assert!(RecordId::parse("nope").is_err());
        assert!(RecordId::parse("what_123").is_err());
        assert!(RecordId::parse("note_zzz").is_err());
    }
}
