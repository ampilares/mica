//! Minimal-diff link rewriting used when a file is renamed/moved: only the
//! link targets that resolved to the old path are replaced; everything else
//! is untouched byte-for-byte.

use regex::Regex;
use std::sync::OnceLock;

fn md_link_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // [text](target) — target without spaces/parens (MVP; matches our writer)
    RE.get_or_init(|| Regex::new(r"(\]\()([^()\s]+)(\))").unwrap())
}

/// Resolve `relative` against the directory of `source` (both vault-relative,
/// forward slashes). Returns None if it escapes the vault root.
fn resolve(source: &str, relative: &str) -> Option<String> {
    let mut parts: Vec<&str> = source.split('/').collect();
    parts.pop(); // file name
    for seg in relative.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop()?;
                continue;
            }
            s => parts.push(s),
        }
    }
    Some(parts.join("/"))
}

/// Relative path from the directory of `source` to `target`.
fn relative_from(source: &str, target: &str) -> String {
    let src_dir: Vec<&str> = {
        let mut p: Vec<&str> = source.split('/').collect();
        p.pop();
        p
    };
    let tgt: Vec<&str> = target.split('/').collect();
    let mut common = 0;
    while common < src_dir.len()
        && common < tgt.len().saturating_sub(1)
        && src_dir[common] == tgt[common]
    {
        common += 1;
    }
    let mut out: Vec<String> = Vec::new();
    for _ in common..src_dir.len() {
        out.push("..".to_string());
    }
    for seg in &tgt[common..] {
        out.push((*seg).to_string());
    }
    out.join("/")
}

/// Rewrite markdown links in `content` (belonging to `source_path`) whose
/// resolved target equals `old_target`, pointing them at `new_target`.
/// Returns None when nothing changed.
pub fn rewrite_links(
    content: &str,
    source_path: &str,
    old_target: &str,
    new_target: &str,
) -> Option<String> {
    let mut changed = false;
    let result = md_link_re().replace_all(content, |caps: &regex::Captures| {
        let raw = &caps[2];
        // Split off any #fragment.
        let (path_part, fragment) = match raw.split_once('#') {
            Some((p, f)) => (p, Some(f)),
            None => (raw, None),
        };
        if !path_part.contains("://")
            && resolve(source_path, path_part).as_deref() == Some(old_target)
        {
            changed = true;
            let mut new_rel = relative_from(source_path, new_target);
            if let Some(f) = fragment {
                new_rel = format!("{new_rel}#{f}");
            }
            format!("{}{}{}", &caps[1], new_rel, &caps[3])
        } else {
            caps[0].to_string()
        }
    });
    if changed {
        Some(result.into_owned())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_only_matching_links() {
        let content = "See [a](../notes/old.md) and [b](other.md) and [x](https://e.com/old.md).\n";
        let out = rewrite_links(content, "journal/today.md", "notes/old.md", "notes/new/renamed.md")
            .unwrap();
        assert_eq!(
            out,
            "See [a](../notes/new/renamed.md) and [b](other.md) and [x](https://e.com/old.md).\n"
        );
    }

    #[test]
    fn keeps_fragment() {
        let content = "[a](old.md#sec)\n";
        let out = rewrite_links(content, "notes/src.md", "notes/old.md", "notes/new.md").unwrap();
        assert_eq!(out, "[a](new.md#sec)\n");
    }

    #[test]
    fn none_when_unchanged() {
        assert!(rewrite_links("[a](b.md)\n", "notes/x.md", "zzz.md", "y.md").is_none());
    }
}
