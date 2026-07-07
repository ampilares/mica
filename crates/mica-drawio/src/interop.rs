//! Canvas format interop (spec §4.4.1): Obsidian Canvas (`.canvas`) and
//! Excalidraw (`.excalidraw`) import/export. Imports create a scene backed by
//! our canonical `.drawio`; exports are one-shot and documented-lossy.

use serde_json::{json, Map, Value};

use mica_core::{CoreError, Result};

use crate::{CellKind, Geometry, Scene, SceneCell};

// ------------------------------------------------------- obsidian canvas ----

/// Import Obsidian Canvas JSON. `text` nodes become stickies, `file` nodes
/// become note/database links (href left as the vault path written in the
/// file; the caller re-bases it), `group` nodes become frames.
pub fn import_obsidian(name: &str, json_text: &str) -> Result<Scene> {
    let doc: Value = serde_json::from_str(json_text)
        .map_err(|e| CoreError::parse("canvas", e.to_string()))?;
    let mut scene = Scene::new(name);

    for node in doc.get("nodes").and_then(Value::as_array).unwrap_or(&vec![]) {
        let id = str_of(node, "id").unwrap_or_default();
        if id.is_empty() {
            continue;
        }
        let geometry = Some(Geometry {
            x: num_of(node, "x"),
            y: num_of(node, "y"),
            width: num_of(node, "width").max(10.0),
            height: num_of(node, "height").max(10.0),
        });
        let node_type = str_of(node, "type").unwrap_or_default();
        let cell = match node_type.as_str() {
            "text" => SceneCell {
                id,
                kind: CellKind::Sticky,
                label: str_of(node, "text").unwrap_or_default(),
                geometry,
                parent: None,
                source: None,
                target: None,
                style: None,
                href: None,
                view: None,
            },
            "file" => {
                let file = str_of(node, "file").unwrap_or_default();
                let kind = if file.ends_with(".database.json") {
                    CellKind::DatabaseLink
                } else {
                    CellKind::NoteLink
                };
                let label = file
                    .rsplit('/')
                    .next()
                    .unwrap_or(&file)
                    .trim_end_matches(".md")
                    .to_string();
                SceneCell {
                    id,
                    kind,
                    label,
                    geometry,
                    parent: None,
                    source: None,
                    target: None,
                    style: None,
                    href: Some(file),
                    view: None,
                }
            }
            "group" => SceneCell {
                id,
                kind: CellKind::Frame,
                label: str_of(node, "label").unwrap_or_default(),
                geometry,
                parent: None,
                source: None,
                target: None,
                style: None,
                href: None,
                view: None,
            },
            // Links (type "link") and unknown node types become labelled boxes.
            _ => SceneCell {
                id,
                kind: CellKind::Rectangle,
                label: str_of(node, "url")
                    .or_else(|| str_of(node, "label"))
                    .unwrap_or_default(),
                geometry,
                parent: None,
                source: None,
                target: None,
                style: None,
                href: None,
                view: None,
            },
        };
        scene.cells.push(cell);
    }

    for edge in doc.get("edges").and_then(Value::as_array).unwrap_or(&vec![]) {
        let id = str_of(edge, "id").unwrap_or_default();
        let from = str_of(edge, "fromNode");
        let to = str_of(edge, "toNode");
        let (Some(from), Some(to)) = (from, to) else { continue };
        scene.cells.push(SceneCell {
            id: if id.is_empty() { format!("edge_{from}_{to}") } else { id },
            kind: CellKind::Connector,
            label: str_of(edge, "label").unwrap_or_default(),
            geometry: None,
            parent: None,
            source: Some(from),
            target: Some(to),
            style: None,
            href: None,
            view: None,
        });
    }

    Ok(scene)
}

/// Export a scene as Obsidian Canvas JSON. Lossy: shape kinds collapse to
/// text cards, link cells become `file` nodes (href must already be a
/// vault-relative path — the caller re-bases before calling).
pub fn export_obsidian(scene: &Scene) -> Result<String> {
    let mut nodes = Vec::new();
    let mut edges = Vec::new();

    for cell in &scene.cells {
        match cell.kind {
            CellKind::Connector => {
                let (Some(source), Some(target)) = (&cell.source, &cell.target) else {
                    continue;
                };
                let mut e = Map::new();
                e.insert("id".into(), json!(cell.id));
                e.insert("fromNode".into(), json!(source));
                e.insert("fromSide".into(), json!("right"));
                e.insert("toNode".into(), json!(target));
                e.insert("toSide".into(), json!("left"));
                if !cell.label.is_empty() {
                    e.insert("label".into(), json!(cell.label));
                }
                edges.push(Value::Object(e));
            }
            _ => {
                let Some(g) = &cell.geometry else { continue };
                let mut n = Map::new();
                n.insert("id".into(), json!(cell.id));
                n.insert("x".into(), json!(g.x));
                n.insert("y".into(), json!(g.y));
                n.insert("width".into(), json!(g.width));
                n.insert("height".into(), json!(g.height));
                match cell.kind {
                    CellKind::Frame => {
                        n.insert("type".into(), json!("group"));
                        if !cell.label.is_empty() {
                            n.insert("label".into(), json!(cell.label));
                        }
                    }
                    CellKind::NoteLink | CellKind::DatabaseLink => {
                        n.insert("type".into(), json!("file"));
                        n.insert("file".into(), json!(cell.href.clone().unwrap_or_default()));
                    }
                    _ => {
                        n.insert("type".into(), json!("text"));
                        n.insert("text".into(), json!(cell.label));
                    }
                }
                nodes.push(Value::Object(n));
            }
        }
    }

    let doc = json!({ "nodes": nodes, "edges": edges });
    let mut out = serde_json::to_string_pretty(&doc)
        .map_err(|e| CoreError::Serialize(e.to_string()))?;
    out.push('\n');
    Ok(out)
}

// ------------------------------------------------------------ excalidraw ----

/// Import Excalidraw JSON: rectangle/ellipse/diamond/text/arrow map onto our
/// kinds; bound text becomes the container's label; other element types are
/// skipped.
pub fn import_excalidraw(name: &str, json_text: &str) -> Result<Scene> {
    let doc: Value = serde_json::from_str(json_text)
        .map_err(|e| CoreError::parse("excalidraw", e.to_string()))?;
    let elements = doc
        .get("elements")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut scene = Scene::new(name);

    // Text elements bound to a container label that container instead.
    let mut bound_text: std::collections::HashMap<String, String> = Default::default();
    for el in &elements {
        if str_of(el, "type").as_deref() == Some("text") {
            if let Some(container) = str_of(el, "containerId") {
                bound_text.insert(container, str_of(el, "text").unwrap_or_default());
            }
        }
    }

    for el in &elements {
        if el.get("isDeleted").and_then(Value::as_bool).unwrap_or(false) {
            continue;
        }
        let id = str_of(el, "id").unwrap_or_default();
        if id.is_empty() {
            continue;
        }
        let el_type = str_of(el, "type").unwrap_or_default();
        let geometry = Some(Geometry {
            x: num_of(el, "x"),
            y: num_of(el, "y"),
            width: num_of(el, "width").max(1.0),
            height: num_of(el, "height").max(1.0),
        });
        let kind = match el_type.as_str() {
            "rectangle" => CellKind::Rectangle,
            "ellipse" => CellKind::Ellipse,
            "diamond" => CellKind::Diamond,
            "text" => {
                if str_of(el, "containerId").is_some() {
                    continue; // folded into its container's label
                }
                CellKind::Text
            }
            "arrow" | "line" => {
                let source = el
                    .get("startBinding")
                    .and_then(|b| b.get("elementId"))
                    .and_then(Value::as_str)
                    .map(String::from);
                let target = el
                    .get("endBinding")
                    .and_then(|b| b.get("elementId"))
                    .and_then(Value::as_str)
                    .map(String::from);
                if source.is_none() && target.is_none() {
                    continue; // free-floating line: nothing to anchor to
                }
                scene.cells.push(SceneCell {
                    id,
                    kind: CellKind::Connector,
                    label: bound_text.remove(&str_of(el, "id").unwrap_or_default())
                        .unwrap_or_default(),
                    geometry: None,
                    parent: None,
                    source,
                    target,
                    style: None,
                    href: None,
                    view: None,
                });
                continue;
            }
            _ => continue, // freedraw, image, frame, embeds: skipped (documented-lossy)
        };
        let label = bound_text
            .remove(&id)
            .or_else(|| str_of(el, "text"))
            .unwrap_or_default();
        scene.cells.push(SceneCell {
            id,
            kind,
            label,
            geometry,
            parent: None,
            source: None,
            target: None,
            style: None,
            href: None,
            view: None,
        });
    }
    Ok(scene)
}

/// Export a scene as Excalidraw JSON. Lossy: stickies/links become labelled
/// rectangles, frames become excalidraw frames without membership.
pub fn export_excalidraw(scene: &Scene) -> Result<String> {
    let mut elements: Vec<Value> = Vec::new();
    let centers: std::collections::HashMap<&str, (f64, f64)> = scene
        .cells
        .iter()
        .filter_map(|c| {
            c.geometry
                .as_ref()
                .map(|g| (c.id.as_str(), (g.x + g.width / 2.0, g.y + g.height / 2.0)))
        })
        .collect();

    for cell in &scene.cells {
        match cell.kind {
            CellKind::Connector => {
                let (Some(s), Some(t)) = (&cell.source, &cell.target) else { continue };
                let (Some(&(sx, sy)), Some(&(tx, ty))) =
                    (centers.get(s.as_str()), centers.get(t.as_str()))
                else {
                    continue;
                };
                elements.push(json!({
                    "id": cell.id,
                    "type": "arrow",
                    "x": sx,
                    "y": sy,
                    "width": tx - sx,
                    "height": ty - sy,
                    "points": [[0.0, 0.0], [tx - sx, ty - sy]],
                    "startBinding": { "elementId": s, "focus": 0, "gap": 4 },
                    "endBinding": { "elementId": t, "focus": 0, "gap": 4 },
                    "strokeColor": "#1e1e1e",
                    "backgroundColor": "transparent"
                }));
            }
            _ => {
                let Some(g) = &cell.geometry else { continue };
                let ex_type = match cell.kind {
                    CellKind::Ellipse => "ellipse",
                    CellKind::Diamond => "diamond",
                    CellKind::Text => "text",
                    _ => "rectangle",
                };
                let mut el = json!({
                    "id": cell.id,
                    "type": ex_type,
                    "x": g.x,
                    "y": g.y,
                    "width": g.width,
                    "height": g.height,
                    "strokeColor": "#1e1e1e",
                    "backgroundColor": "transparent"
                });
                if ex_type == "text" {
                    el["text"] = json!(cell.label);
                    el["fontSize"] = json!(16);
                    el["fontFamily"] = json!(1);
                } else if !cell.label.is_empty() {
                    // Standalone label element on top of the shape (lossy but visible).
                    let label_id = format!("{}_label", cell.id);
                    elements.push(json!({
                        "id": label_id,
                        "type": "text",
                        "x": g.x + 8.0,
                        "y": g.y + g.height / 2.0 - 10.0,
                        "width": (g.width - 16.0).max(10.0),
                        "height": 20.0,
                        "text": cell.label,
                        "fontSize": 16,
                        "fontFamily": 1,
                        "strokeColor": "#1e1e1e",
                        "backgroundColor": "transparent"
                    }));
                }
                elements.push(el);
            }
        }
    }

    let doc = json!({
        "type": "excalidraw",
        "version": 2,
        "source": "mica",
        "elements": elements,
        "appState": { "viewBackgroundColor": "#ffffff" }
    });
    let mut out = serde_json::to_string_pretty(&doc)
        .map_err(|e| CoreError::Serialize(e.to_string()))?;
    out.push('\n');
    Ok(out)
}

fn str_of(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(String::from)
}

fn num_of(v: &Value, key: &str) -> f64 {
    v.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn obsidian_roundtrip_basics() {
        let src = r#"{
          "nodes": [
            {"id":"t1","type":"text","text":"Hello","x":0,"y":0,"width":250,"height":60},
            {"id":"f1","type":"file","file":"notes/roadmap.md","x":300,"y":0,"width":400,"height":300},
            {"id":"g1","type":"group","label":"Area","x":-40,"y":-40,"width":900,"height":500}
          ],
          "edges": [
            {"id":"e1","fromNode":"t1","toNode":"f1","label":"see"}
          ]
        }"#;
        let scene = import_obsidian("Imported", src).unwrap();
        assert_eq!(scene.cells.len(), 4);
        let sticky = scene.cells.iter().find(|c| c.id == "t1").unwrap();
        assert_eq!(sticky.kind, CellKind::Sticky);
        assert_eq!(sticky.label, "Hello");
        let link = scene.cells.iter().find(|c| c.id == "f1").unwrap();
        assert_eq!(link.kind, CellKind::NoteLink);
        assert_eq!(link.href.as_deref(), Some("notes/roadmap.md"));
        let frame = scene.cells.iter().find(|c| c.id == "g1").unwrap();
        assert_eq!(frame.kind, CellKind::Frame);
        let edge = scene.cells.iter().find(|c| c.id == "e1").unwrap();
        assert_eq!(edge.kind, CellKind::Connector);
        assert_eq!(edge.source.as_deref(), Some("t1"));

        // Export re-produces the same node/edge population.
        let out = export_obsidian(&scene).unwrap();
        let doc: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(doc["nodes"].as_array().unwrap().len(), 3);
        assert_eq!(doc["edges"].as_array().unwrap().len(), 1);
        // Our scene serializes to valid drawio too.
        assert!(scene.serialize().unwrap().contains("<mxfile"));
    }

    #[test]
    fn excalidraw_roundtrip_basics() {
        let src = r#"{
          "type": "excalidraw",
          "elements": [
            {"id":"r1","type":"rectangle","x":0,"y":0,"width":120,"height":80},
            {"id":"tx","type":"text","x":10,"y":30,"width":100,"height":20,"text":"inside","containerId":"r1"},
            {"id":"e1","type":"ellipse","x":300,"y":0,"width":100,"height":100},
            {"id":"a1","type":"arrow","x":120,"y":40,"width":180,"height":10,
             "points":[[0,0],[180,10]],
             "startBinding":{"elementId":"r1"},"endBinding":{"elementId":"e1"}},
            {"id":"fd","type":"freedraw","x":0,"y":0,"width":10,"height":10}
          ]
        }"#;
        let scene = import_excalidraw("Imported", src).unwrap();
        let rect = scene.cells.iter().find(|c| c.id == "r1").unwrap();
        assert_eq!(rect.kind, CellKind::Rectangle);
        assert_eq!(rect.label, "inside");
        assert!(scene.cells.iter().any(|c| c.id == "e1" && c.kind == CellKind::Ellipse));
        let arrow = scene.cells.iter().find(|c| c.id == "a1").unwrap();
        assert_eq!(arrow.kind, CellKind::Connector);
        assert_eq!(arrow.target.as_deref(), Some("e1"));
        // freedraw skipped; bound text folded in.
        assert!(!scene.cells.iter().any(|c| c.id == "fd" || c.id == "tx"));

        let out = export_excalidraw(&scene).unwrap();
        let doc: Value = serde_json::from_str(&out).unwrap();
        let els = doc["elements"].as_array().unwrap();
        assert!(els.iter().any(|e| e["type"] == "arrow"));
        assert!(els.iter().any(|e| e["type"] == "rectangle"));
    }
}
