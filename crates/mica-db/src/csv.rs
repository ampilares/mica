//! CSV import/export (FR-IMP-002 / FR-EXP-002). Import maps CSV columns onto
//! database properties (existing, new, or skipped); export writes the rows of
//! one view in its filtered/sorted order.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

use mica_core::{CoreError, Result};

use crate::model::{Database, PropertyType, Row};
use crate::ops::{apply_ops, DbOp};
use crate::query::query;

/// How one CSV column maps onto the database (parallel to the header row).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ColumnMapping {
    /// Ignore this column.
    Skip,
    /// Write into an existing property.
    Property { property_id: String },
    /// Create a new property first, then write into it.
    New { name: String, prop_type: PropertyType },
}

/// Parsed CSV preview for the mapping UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CsvPreview {
    pub headers: Vec<String>,
    pub sample: Vec<Vec<String>>,
    pub total_rows: usize,
}

pub fn preview_csv(text: &str, sample_rows: usize) -> Result<CsvPreview> {
    let records = parse_csv(text)?;
    let mut iter = records.into_iter();
    let headers = iter.next().unwrap_or_default();
    let rest: Vec<Vec<String>> = iter.collect();
    Ok(CsvPreview {
        headers,
        sample: rest.iter().take(sample_rows).cloned().collect(),
        total_rows: rest.len(),
    })
}

/// Import CSV rows into `db` using `mapping` (one entry per CSV column).
/// The first record is treated as the header row and skipped.
/// Returns the number of rows created.
pub fn import_csv(db: &mut Database, text: &str, mapping: &[ColumnMapping]) -> Result<usize> {
    let records = parse_csv(text)?;
    if records.is_empty() {
        return Ok(0);
    }

    // Create the new properties first so rows can reference them.
    let mut resolved: Vec<Option<String>> = Vec::with_capacity(mapping.len());
    for m in mapping {
        match m {
            ColumnMapping::Skip => resolved.push(None),
            ColumnMapping::Property { property_id } => {
                if db.property(property_id).is_none() {
                    return Err(CoreError::Other(format!(
                        "mapped property not found: {property_id}"
                    )));
                }
                resolved.push(Some(property_id.clone()));
            }
            ColumnMapping::New { name, prop_type } => {
                apply_ops(
                    db,
                    &[DbOp::PropertyAdd {
                        name: name.clone(),
                        prop_type: *prop_type,
                    }],
                )?;
                let id = db
                    .properties
                    .last()
                    .map(|p| p.id.clone())
                    .expect("property just added");
                resolved.push(Some(id));
            }
        }
    }

    let mut count = 0usize;
    for record in records.into_iter().skip(1) {
        let mut cells: BTreeMap<String, Value> = BTreeMap::new();
        for (col, raw) in record.iter().enumerate() {
            let Some(Some(prop_id)) = resolved.get(col) else {
                continue;
            };
            let Some(prop) = db.property(prop_id) else {
                continue;
            };
            let raw = raw.trim();
            if raw.is_empty() {
                continue;
            }
            let value = match prop.prop_type {
                PropertyType::Number => match raw.parse::<f64>() {
                    Ok(n) => serde_json::Number::from_f64(n).map(Value::Number),
                    Err(_) => None,
                },
                PropertyType::Checkbox => Some(Value::Bool(matches!(
                    raw.to_ascii_lowercase().as_str(),
                    "true" | "yes" | "1" | "x" | "checked"
                ))),
                PropertyType::Select => Some(Value::String(resolve_option(db, prop_id, raw)?)),
                PropertyType::MultiSelect => {
                    let mut ids = Vec::new();
                    for part in raw.split(';').map(str::trim).filter(|s| !s.is_empty()) {
                        ids.push(Value::String(resolve_option(db, prop_id, part)?));
                    }
                    Some(Value::Array(ids))
                }
                _ => Some(Value::String(raw.to_string())),
            };
            if let Some(v) = value {
                cells.insert(prop_id.clone(), v);
            }
        }
        apply_ops(db, &[DbOp::RowCreate { cells }])?;
        count += 1;
    }
    Ok(count)
}

/// Find a select option id by name (case-insensitive), creating the option if
/// it doesn't exist yet.
fn resolve_option(db: &mut Database, prop_id: &str, name: &str) -> Result<String> {
    if let Some(prop) = db.property(prop_id) {
        if let Some(opt) = prop
            .options
            .iter()
            .find(|o| o.name.eq_ignore_ascii_case(name) || o.id == name)
        {
            return Ok(opt.id.clone());
        }
    }
    apply_ops(
        db,
        &[DbOp::SelectOptionAdd {
            property_id: prop_id.to_string(),
            name: name.to_string(),
            color: None,
        }],
    )?;
    Ok(db
        .property(prop_id)
        .and_then(|p| p.options.last())
        .map(|o| o.id.clone())
        .expect("option just added"))
}

/// Export one view's rows (filtered + sorted, visible columns in view order)
/// as CSV text with a header row.
pub fn export_csv(db: &Database, view_id: &str) -> Result<String> {
    let view = db.view(view_id);
    let hidden: Vec<&str> = view
        .map(|v| v.hidden_properties.iter().map(String::as_str).collect())
        .unwrap_or_default();
    let mut props: Vec<&crate::model::Property> = db
        .properties
        .iter()
        .filter(|p| !hidden.contains(&p.id.as_str()))
        .collect();
    if let Some(v) = view {
        if !v.column_order.is_empty() {
            props.sort_by_key(|p| {
                v.column_order
                    .iter()
                    .position(|id| id == &p.id)
                    .map(|i| i as i64)
                    .unwrap_or(i64::MAX)
            });
        }
    }

    let result = query(db, view_id, 0, 0)?;
    let mut out = String::new();
    write_record(&mut out, props.iter().map(|p| p.name.clone()));
    for row in &result.rows {
        write_record(
            &mut out,
            props.iter().map(|p| display_value(db, p, row)),
        );
    }
    Ok(out)
}

fn display_value(db: &Database, prop: &crate::model::Property, row: &Row) -> String {
    let Some(cell) = row.cells.get(&prop.id) else {
        return String::new();
    };
    match (&prop.prop_type, &cell.value) {
        (PropertyType::Checkbox, Value::Bool(b)) => b.to_string(),
        (PropertyType::Select, Value::String(id)) => option_name(db, &prop.id, id),
        (PropertyType::MultiSelect, Value::Array(items)) => items
            .iter()
            .filter_map(|v| v.as_str())
            .map(|id| option_name(db, &prop.id, id))
            .collect::<Vec<_>>()
            .join("; "),
        (_, Value::String(s)) => s.clone(),
        (_, Value::Number(n)) => n.to_string(),
        (_, Value::Bool(b)) => b.to_string(),
        _ => String::new(),
    }
}

fn option_name(db: &Database, prop_id: &str, option_id: &str) -> String {
    db.property(prop_id)
        .and_then(|p| p.options.iter().find(|o| o.id == option_id))
        .map(|o| o.name.clone())
        .unwrap_or_else(|| option_id.to_string())
}

fn write_record(out: &mut String, fields: impl Iterator<Item = String>) {
    let mut first = true;
    for field in fields {
        if !first {
            out.push(',');
        }
        first = false;
        if field.contains(',') || field.contains('"') || field.contains('\n') || field.contains('\r')
        {
            out.push('"');
            out.push_str(&field.replace('"', "\"\""));
            out.push('"');
        } else {
            out.push_str(&field);
        }
    }
    out.push('\n');
}

/// Minimal RFC-4180 CSV reader: quoted fields, escaped quotes, embedded
/// newlines, CRLF/LF. Returns records as string vectors.
fn parse_csv(text: &str) -> Result<Vec<Vec<String>>> {
    let mut records: Vec<Vec<String>> = Vec::new();
    let mut record: Vec<String> = Vec::new();
    let mut field = String::new();
    let mut in_quotes = false;
    let mut chars = text.chars().peekable();

    while let Some(c) = chars.next() {
        if in_quotes {
            match c {
                '"' => {
                    if chars.peek() == Some(&'"') {
                        chars.next();
                        field.push('"');
                    } else {
                        in_quotes = false;
                    }
                }
                _ => field.push(c),
            }
        } else {
            match c {
                '"' if field.is_empty() => in_quotes = true,
                ',' => {
                    record.push(std::mem::take(&mut field));
                }
                '\r' => {
                    if chars.peek() == Some(&'\n') {
                        chars.next();
                    }
                    record.push(std::mem::take(&mut field));
                    records.push(std::mem::take(&mut record));
                }
                '\n' => {
                    record.push(std::mem::take(&mut field));
                    records.push(std::mem::take(&mut record));
                }
                _ => field.push(c),
            }
        }
    }
    if in_quotes {
        return Err(CoreError::parse("csv", "unterminated quoted field"));
    }
    if !field.is_empty() || !record.is_empty() {
        record.push(field);
        records.push(record);
    }
    // Drop fully empty trailing records (e.g. trailing newline).
    records.retain(|r| !(r.len() == 1 && r[0].is_empty()));
    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_parse_handles_quotes_and_newlines() {
        let recs = parse_csv("a,b\n\"x,1\",\"line\nbreak\"\n\"he said \"\"hi\"\"\",z\n").unwrap();
        assert_eq!(recs[0], vec!["a", "b"]);
        assert_eq!(recs[1], vec!["x,1", "line\nbreak"]);
        assert_eq!(recs[2], vec!["he said \"hi\"", "z"]);
    }

    #[test]
    fn import_maps_columns_and_creates_options() {
        let mut db = Database::new("T");
        let status_id = db
            .properties
            .iter()
            .find(|p| p.name == "Status")
            .unwrap()
            .id
            .clone();
        let text = "Task,State,Points\nWrite docs,Doing,3\nShip it,Launched,5\n";
        let mapping = vec![
            ColumnMapping::Property { property_id: "prop_title".into() },
            ColumnMapping::Property { property_id: status_id.clone() },
            ColumnMapping::New { name: "Points".into(), prop_type: PropertyType::Number },
        ];
        let n = import_csv(&mut db, text, &mapping).unwrap();
        assert_eq!(n, 2);
        assert_eq!(db.rows.len(), 2);
        assert_eq!(db.rows[0].cells["prop_title"].value, serde_json::json!("Write docs"));
        // "Doing" matched the existing option id `doing`.
        assert_eq!(db.rows[0].cells[&status_id].value, serde_json::json!("doing"));
        // "Launched" was created as a new option.
        let launched = db
            .property(&status_id)
            .unwrap()
            .options
            .iter()
            .find(|o| o.name == "Launched")
            .unwrap()
            .id
            .clone();
        assert_eq!(db.rows[1].cells[&status_id].value, serde_json::json!(launched));
        let points_prop = db.properties.iter().find(|p| p.name == "Points").unwrap();
        assert_eq!(db.rows[1].cells[&points_prop.id].value, serde_json::json!(5.0));
    }

    #[test]
    fn export_roundtrips_view_order() {
        let mut db = Database::new("T");
        let text = "Name\nAlpha\nBravo\n";
        let mapping = vec![ColumnMapping::Property { property_id: "prop_title".into() }];
        import_csv(&mut db, text, &mapping).unwrap();
        let out = export_csv(&db, "table_default").unwrap();
        let lines: Vec<&str> = out.lines().collect();
        assert_eq!(lines[0], "Name,Status");
        assert_eq!(lines[1], "Alpha,");
        assert_eq!(lines[2], "Bravo,");
    }
}
