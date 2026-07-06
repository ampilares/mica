//! Markdown note handling: frontmatter parse/serialize with deterministic key
//! order and unknown-key preservation, plus extraction of the metadata the
//! index needs (title, tags, links, plain text).
//!
//! The rich block editing round-trip lives in the frontend editor; the Rust
//! core treats the note body as canonical Markdown text and never rewrites
//! body content it did not receive from the editor.

pub mod extract;
pub mod frontmatter;
pub mod note;
pub mod rewrite;

pub use extract::{extract_metadata, ExtractedLink, LinkKind, NoteMetadata};
pub use frontmatter::Frontmatter;
pub use note::{split_frontmatter, NoteDocument};
pub use rewrite::rewrite_links;
