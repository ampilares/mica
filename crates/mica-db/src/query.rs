use serde::{Deserialize, Serialize};
use serde_json::Value;

use mica_core::Result;

use crate::model::{Database, PropertyType, Row, Sort, View, ViewType};

/// One page of filtered/sorted rows for virtualized rendering (spec §6
/// `db_query`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub total: usize,
    pub rows: Vec<Row>,
    /// For kanban views: group option id (or "" for ungrouped) in board order,
    /// each with its row ids in card order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub groups: Vec<GroupResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupResult {
    pub group: String,
    pub row_ids: Vec<String>,
}

pub fn query(db: &Database, view_id: &str, offset: usize, limit: usize) -> Result<QueryResult> {
    let view = db.view(view_id).cloned().unwrap_or_else(|| View {
        id: "adhoc".into(),
        name: "All".into(),
        view_type: ViewType::Table,
        group_by: None,
        sorts: Vec::new(),
        filters: Vec::new(),
        hidden_properties: Vec::new(),
        column_order: Vec::new(),
        column_widths: Default::default(),
        group_order: Default::default(),
    });

    let mut rows: Vec<&Row> = db
        .rows
        .iter()
        .filter(|row| view.filters.iter().all(|f| matches_filter(db, row, f)))
        .collect();

    sort_rows(db, &mut rows, &view.sorts);

    let total = rows.len();

    let groups = if view.view_type == ViewType::Kanban {
        build_groups(db, &view, &rows)
    } else {
        Vec::new()
    };

    let page: Vec<Row> = rows
        .into_iter()
        .skip(offset)
        .take(if limit == 0 { usize::MAX } else { limit })
        .cloned()
        .collect();

    Ok(QueryResult {
        total,
        rows: page,
        groups,
    })
}

fn cell_value<'a>(row: &'a Row, prop_id: &str) -> Option<&'a Value> {
    row.cells.get(prop_id).map(|c| &c.value)
}

fn matches_filter(db: &Database, row: &Row, filter: &crate::model::Filter) -> bool {
    let value = cell_value(row, &filter.property);
    let target = filter.value.as_ref();
    let prop_type = db
        .property(&filter.property)
        .map(|p| p.prop_type)
        .unwrap_or(PropertyType::Text);

    match filter.operator.as_str() {
        "empty" => value.map_or(true, is_empty_value),
        "not_empty" => value.map_or(false, |v| !is_empty_value(v)),
        "checked" => value.and_then(|v| v.as_bool()).unwrap_or(false),
        "unchecked" => !value.and_then(|v| v.as_bool()).unwrap_or(false),
        "eq" => match prop_type {
            PropertyType::Number => num_of(value) == target.and_then(|t| t.as_f64()),
            _ => str_of(value).as_deref() == target.and_then(|t| t.as_str()),
        },
        "neq" => match prop_type {
            PropertyType::Number => num_of(value) != target.and_then(|t| t.as_f64()),
            _ => str_of(value).as_deref() != target.and_then(|t| t.as_str()),
        },
        "contains" => match (str_of(value), target.and_then(|t| t.as_str())) {
            (Some(v), Some(t)) => v.to_lowercase().contains(&t.to_lowercase()),
            _ => false,
        },
        "gt" | "gte" | "lt" | "lte" => {
            let cmp = match prop_type {
                PropertyType::Number => num_of(value)
                    .zip(target.and_then(|t| t.as_f64()))
                    .map(|(a, b)| a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal)),
                // Dates are ISO strings: lexicographic comparison is correct.
                _ => str_of(value)
                    .zip(target.and_then(|t| t.as_str()).map(String::from))
                    .map(|(a, b)| a.cmp(&b)),
            };
            match (filter.operator.as_str(), cmp) {
                ("gt", Some(o)) => o.is_gt(),
                ("gte", Some(o)) => o.is_ge(),
                ("lt", Some(o)) => o.is_lt(),
                ("lte", Some(o)) => o.is_le(),
                _ => false,
            }
        }
        _ => true,
    }
}

fn is_empty_value(v: &Value) -> bool {
    match v {
        Value::Null => true,
        Value::String(s) => s.is_empty(),
        Value::Array(a) => a.is_empty(),
        _ => false,
    }
}

fn str_of(v: Option<&Value>) -> Option<String> {
    match v? {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

fn num_of(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

fn sort_rows(db: &Database, rows: &mut [&Row], sorts: &[Sort]) {
    if sorts.is_empty() {
        return;
    }
    rows.sort_by(|a, b| {
        for sort in sorts {
            let prop_type = db
                .property(&sort.property)
                .map(|p| p.prop_type)
                .unwrap_or(PropertyType::Text);
            let av = cell_value(a, &sort.property);
            let bv = cell_value(b, &sort.property);
            let ord = match prop_type {
                PropertyType::Number => {
                    let an = num_of(av);
                    let bn = num_of(bv);
                    an.partial_cmp(&bn).unwrap_or(std::cmp::Ordering::Equal)
                }
                PropertyType::Checkbox => {
                    let ab = av.and_then(|v| v.as_bool()).unwrap_or(false);
                    let bb = bv.and_then(|v| v.as_bool()).unwrap_or(false);
                    ab.cmp(&bb)
                }
                _ => {
                    let a_s = str_of(av).unwrap_or_default().to_lowercase();
                    let b_s = str_of(bv).unwrap_or_default().to_lowercase();
                    a_s.cmp(&b_s)
                }
            };
            let ord = if sort.descending { ord.reverse() } else { ord };
            if ord != std::cmp::Ordering::Equal {
                return ord;
            }
        }
        std::cmp::Ordering::Equal
    });
}

fn build_groups(db: &Database, view: &View, rows: &[&Row]) -> Vec<GroupResult> {
    let Some(group_by) = &view.group_by else {
        return vec![GroupResult {
            group: String::new(),
            row_ids: rows.iter().map(|r| r.id.clone()).collect(),
        }];
    };

    let options: Vec<String> = db
        .property(group_by)
        .map(|p| p.options.iter().map(|o| o.id.clone()).collect())
        .unwrap_or_default();

    let group_of = |row: &Row| -> String {
        cell_value(row, group_by)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };

    let mut groups: Vec<GroupResult> = Vec::new();
    // Ungrouped bucket first, then each option in schema order.
    for group_id in std::iter::once(String::new()).chain(options.into_iter()) {
        let mut ids: Vec<String> = rows
            .iter()
            .filter(|r| group_of(r) == group_id)
            .map(|r| r.id.clone())
            .collect();
        // Respect explicit per-group card order where present.
        if let Some(explicit) = view.group_order.get(&group_id) {
            ids.sort_by_key(|id| {
                explicit
                    .iter()
                    .position(|e| e == id)
                    .unwrap_or(usize::MAX)
            });
        }
        groups.push(GroupResult {
            group: group_id,
            row_ids: ids,
        });
    }
    groups
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Filter;
    use crate::ops::{apply_ops, DbOp};
    use serde_json::json;
    use std::collections::BTreeMap;

    fn db_with_rows() -> Database {
        let mut db = Database::new("T");
        for (name, status) in [("Alpha", "todo"), ("Beta", "doing"), ("Gamma", "todo")] {
            let mut cells = BTreeMap::new();
            cells.insert("prop_title".to_string(), json!(name));
            let status_prop = db.views[1].group_by.clone().unwrap();
            cells.insert(status_prop, json!(status));
            apply_ops(&mut db, &[DbOp::RowCreate { cells }]).unwrap();
        }
        db
    }

    #[test]
    fn filter_and_sort() {
        let mut db = db_with_rows();
        let status_prop = db.views[1].group_by.clone().unwrap();
        db.views[0].filters = vec![Filter {
            property: status_prop,
            operator: "eq".into(),
            value: Some(json!("todo")),
        }];
        db.views[0].sorts = vec![Sort {
            property: "prop_title".into(),
            descending: true,
        }];
        let result = query(&db, "table_default", 0, 0).unwrap();
        assert_eq!(result.total, 2);
        assert_eq!(result.rows[0].cells["prop_title"].value, json!("Gamma"));
    }

    #[test]
    fn kanban_groups() {
        let db = db_with_rows();
        let result = query(&db, "kanban_status", 0, 0).unwrap();
        let todo = result.groups.iter().find(|g| g.group == "todo").unwrap();
        assert_eq!(todo.row_ids.len(), 2);
        let doing = result.groups.iter().find(|g| g.group == "doing").unwrap();
        assert_eq!(doing.row_ids.len(), 1);
    }
}
