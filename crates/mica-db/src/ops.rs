use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

use mica_core::{now_rfc3339, CoreError, IdKind, RecordId, Result};

use crate::model::{new_row, Cell, Database, Property, PropertyType, SelectOption, View};

/// Structural + row operations applied by the core (spec §10: schema edits and
/// mutations are operations sent to the core, which owns the file).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum DbOp {
    RowCreate {
        /// Optional initial cells: prop_id → value.
        #[serde(default)]
        cells: BTreeMap<String, Value>,
    },
    RowUpdate {
        row_id: String,
        /// prop_id → new value (null clears the cell).
        cells: BTreeMap<String, Value>,
    },
    RowDelete {
        row_id: String,
    },
    PropertyAdd {
        name: String,
        prop_type: PropertyType,
    },
    PropertyRename {
        property_id: String,
        name: String,
    },
    PropertyDelete {
        property_id: String,
    },
    SelectOptionAdd {
        property_id: String,
        name: String,
        #[serde(default)]
        color: Option<String>,
    },
    ViewUpdate {
        view: View,
    },
    /// Move a kanban card: set the select value and reposition within group.
    KanbanMove {
        view_id: String,
        row_id: String,
        to_group: String,
        /// Position within the target group's card order.
        index: usize,
    },
    TitleSet {
        title: String,
    },
}

pub fn apply_ops(db: &mut Database, ops: &[DbOp]) -> Result<()> {
    for op in ops {
        apply_op(db, op)?;
    }
    db.touch();
    Ok(())
}

fn apply_op(db: &mut Database, op: &DbOp) -> Result<()> {
    match op {
        DbOp::RowCreate { cells } => {
            let mut row = new_row();
            for (prop_id, value) in cells {
                if let Some(prop) = db.property(prop_id) {
                    row.cells.insert(
                        prop_id.clone(),
                        Cell {
                            cell_type: prop.prop_type,
                            value: value.clone(),
                        },
                    );
                }
            }
            db.rows.push(row);
        }
        DbOp::RowUpdate { row_id, cells } => {
            let props: Vec<(String, PropertyType)> = db
                .properties
                .iter()
                .map(|p| (p.id.clone(), p.prop_type))
                .collect();
            let row = db
                .rows
                .iter_mut()
                .find(|r| &r.id == row_id)
                .ok_or_else(|| CoreError::Other(format!("row not found: {row_id}")))?;
            for (prop_id, value) in cells {
                let Some((_, ptype)) = props.iter().find(|(id, _)| id == prop_id) else {
                    continue;
                };
                if value.is_null() {
                    row.cells.remove(prop_id);
                } else {
                    row.cells.insert(
                        prop_id.clone(),
                        Cell {
                            cell_type: *ptype,
                            value: value.clone(),
                        },
                    );
                }
            }
            row.updated = now_rfc3339();
        }
        DbOp::RowDelete { row_id } => {
            db.rows.retain(|r| &r.id != row_id);
            for view in &mut db.views {
                for order in view.group_order.values_mut() {
                    order.retain(|id| id != row_id);
                }
            }
        }
        DbOp::PropertyAdd { name, prop_type } => {
            if *prop_type == PropertyType::Title && db.title_property_id().is_some() {
                return Err(CoreError::Other("database already has a title property".into()));
            }
            db.properties.push(Property {
                id: RecordId::new(IdKind::Property).to_string(),
                name: name.clone(),
                prop_type: *prop_type,
                required: false,
                options: Vec::new(),
            });
        }
        DbOp::PropertyRename { property_id, name } => {
            let prop = db
                .properties
                .iter_mut()
                .find(|p| &p.id == property_id)
                .ok_or_else(|| CoreError::Other(format!("property not found: {property_id}")))?;
            prop.name = name.clone();
        }
        DbOp::PropertyDelete { property_id } => {
            let is_title = db
                .property(property_id)
                .map(|p| p.prop_type == PropertyType::Title)
                .unwrap_or(false);
            if is_title {
                return Err(CoreError::Other("cannot delete the title property".into()));
            }
            db.properties.retain(|p| &p.id != property_id);
            for row in &mut db.rows {
                row.cells.remove(property_id);
            }
            for view in &mut db.views {
                view.hidden_properties.retain(|p| p != property_id);
                view.column_order.retain(|p| p != property_id);
                view.column_widths.remove(property_id);
                if view.group_by.as_deref() == Some(property_id) {
                    view.group_by = None;
                }
            }
        }
        DbOp::SelectOptionAdd {
            property_id,
            name,
            color,
        } => {
            let prop = db
                .properties
                .iter_mut()
                .find(|p| &p.id == property_id)
                .ok_or_else(|| CoreError::Other(format!("property not found: {property_id}")))?;
            if !matches!(
                prop.prop_type,
                PropertyType::Select | PropertyType::MultiSelect
            ) {
                return Err(CoreError::Other("property is not a select".into()));
            }
            let base_id: String = name
                .to_lowercase()
                .chars()
                .map(|c| if c.is_alphanumeric() { c } else { '_' })
                .collect();
            let mut opt_id = base_id.clone();
            let mut i = 2;
            while prop.options.iter().any(|o| o.id == opt_id) {
                opt_id = format!("{base_id}_{i}");
                i += 1;
            }
            prop.options.push(SelectOption {
                id: opt_id,
                name: name.clone(),
                color: color.clone(),
            });
        }
        DbOp::ViewUpdate { view } => {
            match db.views.iter_mut().find(|v| v.id == view.id) {
                Some(existing) => *existing = view.clone(),
                None => db.views.push(view.clone()),
            }
        }
        DbOp::KanbanMove {
            view_id,
            row_id,
            to_group,
            index,
        } => {
            let group_by = db
                .view(view_id)
                .and_then(|v| v.group_by.clone())
                .ok_or_else(|| CoreError::Other("view is not grouped".into()))?;
            // Update the row's select value.
            let ptype = db
                .property(&group_by)
                .map(|p| p.prop_type)
                .unwrap_or(PropertyType::Select);
            {
                let row = db
                    .rows
                    .iter_mut()
                    .find(|r| &r.id == row_id)
                    .ok_or_else(|| CoreError::Other(format!("row not found: {row_id}")))?;
                if to_group.is_empty() {
                    row.cells.remove(&group_by);
                } else {
                    row.cells.insert(
                        group_by.clone(),
                        Cell {
                            cell_type: ptype,
                            value: Value::String(to_group.clone()),
                        },
                    );
                }
                row.updated = now_rfc3339();
            }
            // Update per-group order in the view.
            let view = db
                .views
                .iter_mut()
                .find(|v| &v.id == view_id)
                .ok_or_else(|| CoreError::Other(format!("view not found: {view_id}")))?;
            for order in view.group_order.values_mut() {
                order.retain(|id| id != row_id);
            }
            let order = view.group_order.entry(to_group.clone()).or_default();
            let idx = (*index).min(order.len());
            order.insert(idx, row_id.clone());
        }
        DbOp::TitleSet { title } => {
            db.title = title.clone();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn row_lifecycle() {
        let mut db = Database::new("T");
        let mut cells = BTreeMap::new();
        cells.insert("prop_title".to_string(), json!("First task"));
        apply_ops(&mut db, &[DbOp::RowCreate { cells }]).unwrap();
        assert_eq!(db.rows.len(), 1);
        let row_id = db.rows[0].id.clone();

        let mut update = BTreeMap::new();
        update.insert("prop_title".to_string(), json!("Renamed"));
        apply_ops(&mut db, &[DbOp::RowUpdate { row_id: row_id.clone(), cells: update }]).unwrap();
        assert_eq!(db.rows[0].cells["prop_title"].value, json!("Renamed"));

        apply_ops(&mut db, &[DbOp::RowDelete { row_id }]).unwrap();
        assert!(db.rows.is_empty());
    }

    #[test]
    fn kanban_move_sets_select_and_order() {
        let mut db = Database::new("T");
        apply_ops(&mut db, &[DbOp::RowCreate { cells: BTreeMap::new() }]).unwrap();
        let row_id = db.rows[0].id.clone();
        apply_ops(
            &mut db,
            &[DbOp::KanbanMove {
                view_id: "kanban_status".into(),
                row_id: row_id.clone(),
                to_group: "doing".into(),
                index: 0,
            }],
        )
        .unwrap();
        let status_prop = db.views[1].group_by.clone().unwrap();
        assert_eq!(db.rows[0].cells[&status_prop].value, json!("doing"));
        assert_eq!(db.views[1].group_order["doing"], vec![row_id]);
    }

    #[test]
    fn cannot_delete_title() {
        let mut db = Database::new("T");
        let err = apply_ops(&mut db, &[DbOp::PropertyDelete { property_id: "prop_title".into() }]);
        assert!(err.is_err());
    }
}
