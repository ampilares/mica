use mica_core::{CoreError, Result};
use serde_yaml::{Mapping, Value};

/// Fixed serialization order for known keys (spec §4.2). Unknown keys keep
/// their original relative order after these; `schema_version` is always last.
const KEY_ORDER: [&str; 6] = ["id", "title", "created", "updated", "tags", "aliases"];
const SCHEMA_VERSION_KEY: &str = "schema_version";

/// Parsed YAML frontmatter that preserves unknown keys verbatim.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Frontmatter {
    map: Mapping,
}

impl Frontmatter {
    pub fn parse(yaml: &str) -> Result<Self> {
        let map: Mapping = serde_yaml::from_str(yaml)
            .map_err(|e| CoreError::parse("frontmatter", e.to_string()))?;
        Ok(Frontmatter { map })
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }

    pub fn get_str(&self, key: &str) -> Option<&str> {
        self.map.get(Value::from(key)).and_then(|v| v.as_str())
    }

    pub fn id(&self) -> Option<&str> {
        self.get_str("id")
    }

    pub fn title(&self) -> Option<&str> {
        self.get_str("title")
    }

    pub fn set_str(&mut self, key: &str, value: &str) {
        self.map.insert(Value::from(key), Value::from(value));
    }

    pub fn set_u32(&mut self, key: &str, value: u32) {
        self.map.insert(Value::from(key), Value::from(value));
    }

    pub fn set_value(&mut self, key: &str, value: Value) {
        self.map.insert(Value::from(key), value);
    }

    pub fn remove(&mut self, key: &str) {
        self.map.remove(Value::from(key));
    }

    /// Frontmatter as a JSON object (for the Info panel / `note_meta_get`).
    /// Keys that aren't strings or values that don't map to JSON are skipped.
    pub fn to_json(&self) -> serde_json::Map<String, serde_json::Value> {
        let mut out = serde_json::Map::new();
        for (k, v) in &self.map {
            let Some(key) = k.as_str() else { continue };
            if let Ok(val) = serde_json::to_value(v) {
                out.insert(key.to_string(), val);
            }
        }
        out
    }

    /// Tags from frontmatter: supports both a YAML list and a comma string.
    pub fn tags(&self) -> Vec<String> {
        match self.map.get(Value::from("tags")) {
            Some(Value::Sequence(seq)) => seq
                .iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.trim().trim_start_matches('#').to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            Some(Value::String(s)) => s
                .split(',')
                .map(|t| t.trim().trim_start_matches('#').to_string())
                .filter(|t| !t.is_empty())
                .collect(),
            _ => Vec::new(),
        }
    }

    pub fn aliases(&self) -> Vec<String> {
        match self.map.get(Value::from("aliases")) {
            Some(Value::Sequence(seq)) => seq
                .iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            _ => Vec::new(),
        }
    }

    /// Serialize with the fixed key order: known keys first, then unknown keys
    /// in their original order, `schema_version` last. Output has no leading
    /// `---` fences; the caller assembles the document.
    pub fn serialize(&self) -> Result<String> {
        let mut ordered = Mapping::new();
        for key in KEY_ORDER {
            if let Some(v) = self.map.get(Value::from(key)) {
                ordered.insert(Value::from(key), v.clone());
            }
        }
        for (k, v) in &self.map {
            let is_known = k
                .as_str()
                .map(|s| KEY_ORDER.contains(&s) || s == SCHEMA_VERSION_KEY)
                .unwrap_or(false);
            if !is_known {
                ordered.insert(k.clone(), v.clone());
            }
        }
        if let Some(v) = self.map.get(Value::from(SCHEMA_VERSION_KEY)) {
            ordered.insert(Value::from(SCHEMA_VERSION_KEY), v.clone());
        }
        serde_yaml::to_string(&ordered).map_err(|e| CoreError::Serialize(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_unknown_keys_and_orders_known() {
        let fm = Frontmatter::parse(
            "custom: hello\nschema_version: 1\ntitle: Test\nid: note_01JZ0Q2P3M5VCB8K0HQG2YJS4P\nanother: [1, 2]\n",
        )
        .unwrap();
        let out = fm.serialize().unwrap();
        let id_pos = out.find("id:").unwrap();
        let title_pos = out.find("title:").unwrap();
        let custom_pos = out.find("custom:").unwrap();
        let another_pos = out.find("another:").unwrap();
        let sv_pos = out.find("schema_version:").unwrap();
        assert!(id_pos < title_pos);
        assert!(title_pos < custom_pos);
        assert!(custom_pos < another_pos);
        assert!(another_pos < sv_pos);
    }

    #[test]
    fn tags_list_and_string() {
        let fm = Frontmatter::parse("tags:\n  - a\n  - '#b'\n").unwrap();
        assert_eq!(fm.tags(), vec!["a", "b"]);
        let fm = Frontmatter::parse("tags: x, y\n").unwrap();
        assert_eq!(fm.tags(), vec!["x", "y"]);
    }

    #[test]
    fn serialize_is_deterministic() {
        let fm =
            Frontmatter::parse("title: A\nid: note_01JZ0Q2P3M5VCB8K0HQG2YJS4P\nz: 1\na: 2\n")
                .unwrap();
        assert_eq!(fm.serialize().unwrap(), fm.serialize().unwrap());
    }
}
