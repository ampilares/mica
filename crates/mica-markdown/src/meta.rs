//! Frontmatter metadata as JSON: read for the Info panel, merge-patch for
//! property edits (spec §2.4). The body is never touched; unknown keys and
//! their order survive.

use mica_core::{now_rfc3339, CoreError, Result};

use crate::note::NoteDocument;

/// Frontmatter of `content` as a JSON object (empty object when absent).
pub fn frontmatter_json(content: &str) -> Result<serde_json::Map<String, serde_json::Value>> {
    let doc = NoteDocument::parse(content)?;
    Ok(doc
        .frontmatter
        .map(|fm| fm.to_json())
        .unwrap_or_default())
}

/// Apply a JSON merge patch to the frontmatter: each key in `patch` is set
/// (or removed when the value is `null`). Creates frontmatter if the note has
/// none — meta edits are an explicit user action, unlike autosave. Refreshes
/// `updated` and returns the full new file content.
pub fn apply_meta_patch(content: &str, patch: &serde_json::Value) -> Result<String> {
    let serde_json::Value::Object(patch) = patch else {
        return Err(CoreError::Serialize("meta patch must be an object".into()));
    };
    let mut doc = NoteDocument::parse(content)?;
    let mut fm = doc.frontmatter.take().unwrap_or_default();
    for (key, value) in patch {
        if value.is_null() {
            fm.remove(key);
        } else {
            let yaml = serde_yaml::to_value(value)
                .map_err(|e| CoreError::Serialize(e.to_string()))?;
            fm.set_value(key, yaml);
        }
    }
    if !fm.is_empty() {
        fm.set_str("updated", &now_rfc3339());
    }
    doc.frontmatter = Some(fm);
    doc.raw_frontmatter = None;
    doc.serialize()
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOTE: &str = "---\nid: note_01JZ0Q2P3M5VCB8K0HQG2YJS4P\ntitle: Plan\ncustom_key: keep-me\nschema_version: 1\n---\n\n# Plan\n\nBody stays byte-identical.\n";

    #[test]
    fn get_returns_frontmatter_as_json() {
        let json = frontmatter_json(NOTE).unwrap();
        assert_eq!(json["title"], "Plan");
        assert_eq!(json["custom_key"], "keep-me");
        assert!(frontmatter_json("no frontmatter\n").unwrap().is_empty());
    }

    #[test]
    fn patch_sets_removes_and_preserves() {
        let patch = serde_json::json!({
            "properties": { "Status": "In progress", "Points": 3 },
            "journal": "2026-07-20",
            "custom_key": null
        });
        let out = apply_meta_patch(NOTE, &patch).unwrap();
        assert!(out.contains("journal: 2026-07-20"));
        assert!(out.contains("Status: In progress"));
        assert!(out.contains("Points: 3"));
        assert!(!out.contains("custom_key"));
        // Body untouched.
        assert!(out.ends_with("# Plan\n\nBody stays byte-identical.\n"));
        // Known-key ordering intact (id before title).
        assert!(out.find("id:").unwrap() < out.find("title:").unwrap());
    }

    #[test]
    fn patch_creates_frontmatter_when_absent() {
        let out =
            apply_meta_patch("Just a body.\n", &serde_json::json!({"tags": ["a"]})).unwrap();
        assert!(out.starts_with("---\n"));
        assert!(out.contains("tags:"));
        assert!(out.contains("Just a body.\n"));
    }

    #[test]
    fn patch_is_deterministic() {
        let patch = serde_json::json!({"primary_mode": "edgeless"});
        let a = apply_meta_patch(NOTE, &patch).unwrap();
        let b = apply_meta_patch(&a, &patch).unwrap();
        // Only the `updated` timestamp may differ between runs.
        let strip = |s: &str| {
            s.lines()
                .filter(|l| !l.starts_with("updated:"))
                .collect::<Vec<_>>()
                .join("\n")
        };
        assert_eq!(strip(&a), strip(&b));
    }
}
