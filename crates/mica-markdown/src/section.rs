//! Heading-bounded slicing for wiki embeds (spec v2.1 §1.7 / FR21-BLK-008):
//! `![[Note#Heading]]` renders the section starting at that ATX heading and
//! ending before the next heading of the same or higher level.

use crate::note::split_frontmatter;

/// The body of `content`, or the section under `heading` when given.
/// Heading match is case-insensitive on the heading text with any trailing
/// `{#block-id}` marker stripped. Returns None when the heading is absent.
pub fn section(content: &str, heading: Option<&str>) -> Option<String> {
    let (_, body) = split_frontmatter(content);
    let Some(wanted) = heading else {
        return Some(body.to_string());
    };
    let wanted = wanted.trim().to_lowercase();

    let mut in_fence = false;
    let mut start: Option<(usize, usize)> = None; // (byte offset, level)
    let mut end: Option<usize> = None;
    let mut offset = 0usize;

    for line in body.split_inclusive('\n') {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
        }
        if !in_fence {
            if let Some((level, text)) = parse_atx(line) {
                match start {
                    None => {
                        if text == wanted {
                            start = Some((offset, level));
                        }
                    }
                    Some((_, found_level)) => {
                        if level <= found_level {
                            end = Some(offset);
                            break;
                        }
                    }
                }
            }
        }
        offset += line.len();
    }

    let (from, _) = start?;
    let to = end.unwrap_or(body.len());
    Some(body[from..to].trim_end().to_string() + "\n")
}

/// `(level, lowercased text)` for an ATX heading line, else None.
fn parse_atx(line: &str) -> Option<(usize, String)> {
    let rest = line.trim_start();
    let hashes = rest.bytes().take_while(|b| *b == b'#').count();
    if hashes == 0 || hashes > 6 {
        return None;
    }
    let after = &rest[hashes..];
    if !after.starts_with(' ') && !after.starts_with('\t') {
        return None;
    }
    let mut text = after.trim().to_string();
    // Strip a trailing block-id marker: "Heading {#block_x}".
    if let Some(idx) = text.rfind("{#") {
        if text.ends_with('}') {
            text = text[..idx].trim_end().to_string();
        }
    }
    Some((hashes, text.to_lowercase()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOC: &str = "---\ntitle: T\n---\n\n# Alpha\n\nintro\n\n## Beta {#block_1}\n\nbeta body\n\n```\n# not a heading\n```\n\nmore beta\n\n## Gamma\n\ngamma body\n\n# Omega\n\nend\n";

    #[test]
    fn whole_body_without_heading() {
        let s = section(DOC, None).unwrap();
        assert!(s.starts_with("# Alpha"));
        assert!(s.contains("end"));
    }

    #[test]
    fn heading_section_stops_at_sibling() {
        let s = section(DOC, Some("Beta")).unwrap();
        assert!(s.starts_with("## Beta"));
        assert!(s.contains("beta body"));
        assert!(s.contains("# not a heading")); // fence content included
        assert!(s.contains("more beta"));
        assert!(!s.contains("Gamma"));
    }

    #[test]
    fn heading_section_stops_at_higher_level() {
        let s = section(DOC, Some("gamma")).unwrap(); // case-insensitive
        assert!(s.contains("gamma body"));
        assert!(!s.contains("Omega"));
    }

    #[test]
    fn missing_heading_is_none() {
        assert!(section(DOC, Some("Nope")).is_none());
    }
}
