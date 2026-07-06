use pulldown_cmark::{Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use regex::Regex;
use std::sync::OnceLock;

use crate::note::split_frontmatter;
use crate::Frontmatter;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkKind {
    /// `[[Page Name]]` or `[[Page Name#Heading]]`
    Wiki,
    /// Standard `[text](target)` pointing at a relative path
    Markdown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtractedLink {
    pub kind: LinkKind,
    /// Raw target as written: page name for wiki links, href for md links.
    pub target: String,
    /// Optional `#Heading` / `#^block` fragment.
    pub fragment: Option<String>,
}

/// Everything the search index needs from one note.
#[derive(Debug, Clone, Default)]
pub struct NoteMetadata {
    pub id: Option<String>,
    pub title: Option<String>,
    pub tags: Vec<String>,
    pub aliases: Vec<String>,
    pub links: Vec<ExtractedLink>,
    /// Plain text of the body (markup stripped) for full-text search.
    pub plain_text: String,
}

fn wiki_link_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[\[([^\[\]\|#]+)(#[^\[\]\|]*)?(\|[^\[\]]*)?\]\]").unwrap())
}

fn tag_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // #tag with letters/digits/-/_/ and at least one letter; not preceded by
    // a word character (so a#b or URLs with fragments don't match).
    RE.get_or_init(|| Regex::new(r"(?:^|[^\w#])#([A-Za-z][\w/-]*)").unwrap())
}

/// Extract index metadata from full note content (frontmatter + body).
pub fn extract_metadata(content: &str, fallback_title: &str) -> NoteMetadata {
    let (fm_text, body) = split_frontmatter(content);
    let mut meta = NoteMetadata::default();

    if let Some(fm_text) = fm_text {
        if let Ok(fm) = Frontmatter::parse(fm_text) {
            meta.id = fm.id().map(String::from);
            meta.title = fm.title().map(String::from);
            meta.tags = fm.tags();
            meta.aliases = fm.aliases();
        }
    }

    // Walk the Markdown body: collect plain text, md links, first H1, and
    // remember which byte ranges are code (excluded from tag/wiki scanning).
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_FOOTNOTES;
    let parser = Parser::new_ext(body, options).into_offset_iter();

    let mut plain = String::new();
    let mut first_h1: Option<String> = None;
    let mut in_h1 = false;
    let mut h1_buf = String::new();
    let mut code_ranges: Vec<std::ops::Range<usize>> = Vec::new();

    for (event, range) in parser {
        match event {
            Event::Start(Tag::Heading { level: HeadingLevel::H1, .. }) if first_h1.is_none() => {
                in_h1 = true;
                h1_buf.clear();
            }
            Event::End(TagEnd::Heading(HeadingLevel::H1)) if in_h1 => {
                in_h1 = false;
                let t = h1_buf.trim().to_string();
                if !t.is_empty() {
                    first_h1 = Some(t);
                }
            }
            Event::Start(Tag::Link { dest_url, .. }) => {
                let dest = dest_url.to_string();
                // Only index relative links as note links; external URLs are not links between notes.
                if !dest.contains("://") && !dest.starts_with("mailto:") && !dest.is_empty() {
                    let (target, fragment) = match dest.split_once('#') {
                        Some((t, f)) => (t.to_string(), Some(f.to_string())),
                        None => (dest, None),
                    };
                    if !target.is_empty() {
                        meta.links.push(ExtractedLink {
                            kind: LinkKind::Markdown,
                            target,
                            fragment,
                        });
                    }
                }
            }
            Event::Start(Tag::CodeBlock(_)) => {
                code_ranges.push(range.clone());
            }
            Event::Text(t) => {
                if in_h1 {
                    h1_buf.push_str(&t);
                }
                plain.push_str(&t);
                plain.push(' ');
            }
            Event::Code(t) => {
                code_ranges.push(range.clone());
                plain.push_str(&t);
                plain.push(' ');
            }
            Event::SoftBreak | Event::HardBreak => plain.push(' '),
            _ => {}
        }
    }

    if meta.title.is_none() {
        meta.title = first_h1.or_else(|| Some(fallback_title.to_string()));
    }

    let in_code = |pos: usize| code_ranges.iter().any(|r| r.contains(&pos));

    // Wiki links (regex over body, skipping code spans/blocks).
    for cap in wiki_link_re().captures_iter(body) {
        let m = cap.get(0).unwrap();
        if in_code(m.start()) {
            continue;
        }
        let target = cap[1].trim().to_string();
        let fragment = cap
            .get(2)
            .map(|f| f.as_str().trim_start_matches('#').trim().to_string())
            .filter(|f| !f.is_empty());
        if !target.is_empty() {
            meta.links.push(ExtractedLink {
                kind: LinkKind::Wiki,
                target,
                fragment,
            });
        }
    }

    // Inline #tags (regex over body, skipping code).
    for cap in tag_re().captures_iter(body) {
        let m = cap.get(1).unwrap();
        if in_code(m.start()) {
            continue;
        }
        let tag = m.as_str().to_string();
        if !meta.tags.contains(&tag) {
            meta.tags.push(tag);
        }
    }

    meta.plain_text = plain.trim().to_string();
    meta
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_everything() {
        let content = "---\nid: note_01JZ0Q2P3M5VCB8K0HQG2YJS4P\ntitle: My Note\ntags:\n  - alpha\n---\n\n# Heading\n\nSee [[Other Note]] and [[Plan#Goals]] plus [doc](../notes/doc.md) and [ext](https://example.com).\n\nWork on #beta today.\n\n```\n[[NotALink]] #notatag\n```\n";
        let meta = extract_metadata(content, "fallback");
        assert_eq!(meta.id.as_deref(), Some("note_01JZ0Q2P3M5VCB8K0HQG2YJS4P"));
        assert_eq!(meta.title.as_deref(), Some("My Note"));
        assert!(meta.tags.contains(&"alpha".to_string()));
        assert!(meta.tags.contains(&"beta".to_string()));
        assert!(!meta.tags.iter().any(|t| t == "notatag"));
        let wiki: Vec<_> = meta
            .links
            .iter()
            .filter(|l| l.kind == LinkKind::Wiki)
            .collect();
        assert_eq!(wiki.len(), 2);
        assert_eq!(wiki[0].target, "Other Note");
        assert_eq!(wiki[1].target, "Plan");
        assert_eq!(wiki[1].fragment.as_deref(), Some("Goals"));
        assert!(meta
            .links
            .iter()
            .any(|l| l.kind == LinkKind::Markdown && l.target == "../notes/doc.md"));
        assert!(!meta.links.iter().any(|l| l.target.contains("example.com")));
        assert!(meta.plain_text.contains("Work on"));
    }

    #[test]
    fn title_falls_back_to_h1_then_filename() {
        let meta = extract_metadata("# From Heading\n\nText\n", "file-name");
        assert_eq!(meta.title.as_deref(), Some("From Heading"));
        let meta = extract_metadata("Just text\n", "file-name");
        assert_eq!(meta.title.as_deref(), Some("file-name"));
    }
}
