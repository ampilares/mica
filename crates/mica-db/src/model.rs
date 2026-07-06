use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

use mica_core::{now_rfc3339, CoreError, IdKind, RecordId, Result, DATABASE_SCHEMA_VERSION};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PropertyType {
    Title,
    Text,
    Number,
    Checkbox,
    Select,
    MultiSelect,
    Date,
    Url,
    File,
    NoteLink,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectOption {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Property {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub prop_type: PropertyType,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<SelectOption>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewType {
    Table,
    Kanban,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sort {
    pub property: String,
    #[serde(default)]
    pub descending: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Filter {
    pub property: String,
    pub operator: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct View {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub view_type: ViewType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_by: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sorts: Vec<Sort>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub filters: Vec<Filter>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hidden_properties: Vec<String>,
    /// Column order for table views; property ids.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub column_order: Vec<String>,
    /// Column widths for table views: property id → px.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub column_widths: BTreeMap<String, u32>,
    /// Kanban: per-group explicit card order (option id → row ids).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub group_order: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cell {
    #[serde(rename = "type")]
    pub cell_type: PropertyType,
    pub value: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Row {
    pub id: String,
    pub created: String,
    pub updated: String,
    /// prop_id → cell. BTreeMap keeps key order deterministic.
    #[serde(default)]
    pub cells: BTreeMap<String, Cell>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Database {
    pub schema_version: u32,
    pub id: String,
    pub title: String,
    pub created: String,
    pub updated: String,
    pub properties: Vec<Property>,
    pub views: Vec<View>,
    pub rows: Vec<Row>,
    /// Unknown top-level keys survive round-trips.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

impl Database {
    /// A new database with a title property, a Status select, a Due date,
    /// a default table view, and a kanban view grouped by Status.
    pub fn new(title: &str) -> Database {
        let now = now_rfc3339();
        let status_prop_id = format!("prop_{}", ulid_suffix());
        Database {
            schema_version: DATABASE_SCHEMA_VERSION,
            id: RecordId::new(IdKind::Database).to_string(),
            title: title.to_string(),
            created: now.clone(),
            updated: now,
            properties: vec![
                Property {
                    id: "prop_title".into(),
                    name: "Name".into(),
                    prop_type: PropertyType::Title,
                    required: true,
                    options: Vec::new(),
                },
                Property {
                    id: status_prop_id.clone(),
                    name: "Status".into(),
                    prop_type: PropertyType::Select,
                    required: false,
                    options: vec![
                        SelectOption { id: "todo".into(), name: "To do".into(), color: Some("gray".into()) },
                        SelectOption { id: "doing".into(), name: "Doing".into(), color: Some("blue".into()) },
                        SelectOption { id: "done".into(), name: "Done".into(), color: Some("green".into()) },
                    ],
                },
            ],
            views: vec![
                View {
                    id: "table_default".into(),
                    name: "Table".into(),
                    view_type: ViewType::Table,
                    group_by: None,
                    sorts: Vec::new(),
                    filters: Vec::new(),
                    hidden_properties: Vec::new(),
                    column_order: Vec::new(),
                    column_widths: BTreeMap::new(),
                    group_order: BTreeMap::new(),
                },
                View {
                    id: "kanban_status".into(),
                    name: "Kanban".into(),
                    view_type: ViewType::Kanban,
                    group_by: Some(status_prop_id),
                    sorts: Vec::new(),
                    filters: Vec::new(),
                    hidden_properties: Vec::new(),
                    column_order: Vec::new(),
                    column_widths: BTreeMap::new(),
                    group_order: BTreeMap::new(),
                },
            ],
            rows: Vec::new(),
            extra: serde_json::Map::new(),
        }
    }

    pub fn parse(json: &str) -> Result<Database> {
        serde_json::from_str(json).map_err(|e| CoreError::parse("database", e.to_string()))
    }

    /// Deterministic serialization: 2-space indent, LF, trailing newline.
    pub fn serialize(&self) -> Result<String> {
        let mut out = serde_json::to_string_pretty(self)
            .map_err(|e| CoreError::Serialize(e.to_string()))?;
        out.push('\n');
        Ok(out)
    }

    pub fn touch(&mut self) {
        self.updated = now_rfc3339();
    }

    pub fn property(&self, id: &str) -> Option<&Property> {
        self.properties.iter().find(|p| p.id == id)
    }

    pub fn view(&self, id: &str) -> Option<&View> {
        self.views.iter().find(|v| v.id == id)
    }

    pub fn title_property_id(&self) -> Option<&str> {
        self.properties
            .iter()
            .find(|p| p.prop_type == PropertyType::Title)
            .map(|p| p.id.as_str())
    }

    /// Concatenated cell text of one row (for search indexing, kanban cards).
    pub fn row_text(&self, row: &Row) -> String {
        let mut parts = Vec::new();
        for prop in &self.properties {
            if let Some(cell) = row.cells.get(&prop.id) {
                match &cell.value {
                    Value::String(s) if !s.is_empty() => parts.push(s.clone()),
                    Value::Number(n) => parts.push(n.to_string()),
                    Value::Array(items) => {
                        for item in items {
                            if let Value::String(s) = item {
                                parts.push(s.clone());
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        parts.join(" ")
    }
}

pub fn new_row() -> Row {
    let now = now_rfc3339();
    Row {
        id: RecordId::new(IdKind::Row).to_string(),
        created: now.clone(),
        updated: now,
        cells: BTreeMap::new(),
    }
}

fn ulid_suffix() -> String {
    RecordId::new(IdKind::Property)
        .to_string()
        .trim_start_matches("prop_")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_is_deterministic() {
        let db = Database::new("Tasks");
        let s1 = db.serialize().unwrap();
        let parsed = Database::parse(&s1).unwrap();
        let s2 = parsed.serialize().unwrap();
        assert_eq!(s1, s2);
        assert!(s1.ends_with('\n'));
        assert!(s1.starts_with("{\n  \"schema_version\": 1"));
    }

    #[test]
    fn unknown_keys_survive() {
        let db = Database::new("T");
        let mut json: serde_json::Value = serde_json::from_str(&db.serialize().unwrap()).unwrap();
        json.as_object_mut()
            .unwrap()
            .insert("future_field".into(), serde_json::json!({"x": 1}));
        let text = serde_json::to_string(&json).unwrap();
        let parsed = Database::parse(&text).unwrap();
        let out = parsed.serialize().unwrap();
        assert!(out.contains("future_field"));
    }
}
