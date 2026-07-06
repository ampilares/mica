use mica_core::{now_rfc3339, IdKind, RecordId, Result, NOTE_SCHEMA_VERSION};

use crate::frontmatter::Frontmatter;

/// A note split into optional frontmatter and body.
#[derive(Debug, Clone)]
pub struct NoteDocument {
    pub frontmatter: Option<Frontmatter>,
    /// Raw frontmatter text between the `---` fences, as found on disk.
    /// Kept so an unmodified frontmatter round-trips byte-identically.
    pub raw_frontmatter: Option<String>,
    pub body: String,
}

/// Split a Markdown document into `(frontmatter_text, body)`.
///
/// Frontmatter is only recognized when the file starts with `---\n` and a
/// closing `---` line exists. Anything else is all body.
pub fn split_frontmatter(content: &str) -> (Option<&str>, &str) {
    // Tolerate a UTF-8 BOM from external Windows editors.
    let content = content.strip_prefix('\u{feff}').unwrap_or(content);
    let rest = match content.strip_prefix("---") {
        Some(r) if r.starts_with('\n') || r.starts_with("\r\n") => r,
        _ => return (None, content),
    };
    // Scan for a closing fence line: "---" alone on a line.
    let mut offset = 0usize;
    for line in rest.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if offset > 0 && trimmed == "---" {
            let fm = &rest[..offset];
            let body_start = offset + line.len();
            let body = &rest[body_start..];
            // Trim the single blank line conventionally following the fence.
            let body = body.strip_prefix("\r\n").or_else(|| body.strip_prefix('\n')).unwrap_or(body);
            let fm = fm.strip_prefix("\r\n").or_else(|| fm.strip_prefix('\n')).unwrap_or(fm);
            return (Some(fm), body);
        }
        offset += line.len();
    }
    (None, content)
}

impl NoteDocument {
    pub fn parse(content: &str) -> Result<NoteDocument> {
        let (fm_text, body) = split_frontmatter(content);
        let frontmatter = match fm_text {
            Some(text) => Some(Frontmatter::parse(text)?),
            None => None,
        };
        Ok(NoteDocument {
            frontmatter,
            raw_frontmatter: fm_text.map(|s| s.to_string()),
            body: body.to_string(),
        })
    }

    /// Assemble the full file content. If frontmatter exists it is serialized
    /// deterministically; a frontmatter-less note stays frontmatter-less.
    pub fn serialize(&self) -> Result<String> {
        let mut out = String::new();
        if let Some(fm) = &self.frontmatter {
            if !fm.is_empty() {
                out.push_str("---\n");
                out.push_str(&fm.serialize()?);
                out.push_str("---\n\n");
            }
        }
        out.push_str(&self.body);
        if !out.ends_with('\n') {
            out.push('\n');
        }
        Ok(out)
    }

    /// Content for a brand-new app-created note (spec §4.2).
    pub fn new_note_content(title: &str) -> Result<String> {
        let mut fm = Frontmatter::default();
        let now = now_rfc3339();
        fm.set_str("id", &RecordId::new(IdKind::Note).to_string());
        fm.set_str("title", title);
        fm.set_str("created", &now);
        fm.set_str("updated", &now);
        fm.set_u32("schema_version", NOTE_SCHEMA_VERSION);
        let doc = NoteDocument {
            frontmatter: Some(fm),
            raw_frontmatter: None,
            body: format!("# {title}\n"),
        };
        doc.serialize()
    }

    /// Update the `updated` timestamp — only when frontmatter already exists.
    /// Files without frontmatter are never given frontmatter implicitly.
    pub fn touch_updated(&mut self) {
        if let Some(fm) = &mut self.frontmatter {
            if !fm.is_empty() {
                fm.set_str("updated", &now_rfc3339());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_frontmatter() {
        let (fm, body) = split_frontmatter("---\ntitle: X\n---\n\nBody here.\n");
        assert_eq!(fm, Some("title: X\n"));
        assert_eq!(body, "Body here.\n");
    }

    #[test]
    fn no_frontmatter_is_all_body() {
        let (fm, body) = split_frontmatter("# Hello\n\n---\n\nnot frontmatter\n");
        assert!(fm.is_none());
        assert!(body.starts_with("# Hello"));
    }

    #[test]
    fn unterminated_fence_is_body() {
        let (fm, body) = split_frontmatter("---\ntitle: X\nno closing fence\n");
        assert!(fm.is_none());
        assert!(body.starts_with("---"));
    }

    #[test]
    fn new_note_has_id_and_heading() {
        let content = NoteDocument::new_note_content("My Note").unwrap();
        assert!(content.starts_with("---\nid: note_"));
        assert!(content.contains("# My Note"));
        assert!(content.contains("schema_version: 1"));
    }

    #[test]
    fn frontmatterless_note_stays_clean() {
        let mut doc = NoteDocument::parse("Just text.\n").unwrap();
        doc.touch_updated();
        assert_eq!(doc.serialize().unwrap(), "Just text.\n");
    }
}
