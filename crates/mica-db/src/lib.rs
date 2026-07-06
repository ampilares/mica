//! Database model (`.database.json`, spec §4.3): properties, views, rows,
//! deterministic serialization, and a small filter/sort engine.
//!
//! Determinism rules (FR-DB-007): fixed key order (guaranteed by struct field
//! order + serde), 2-space indent, LF, trailing newline, rows in insertion
//! order, stable ULIDs everywhere.

pub mod model;
pub mod ops;
pub mod query;

pub use model::*;
pub use ops::*;
pub use query::*;
