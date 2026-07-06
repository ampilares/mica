//! Canvas scene model and deterministic draw.io-compatible XML (spec §4.4,
//! §11.1). Uncompressed `mxfile > diagram > mxGraphModel > root > mxCell*`;
//! app-specific data rides in `data-workspace-*` attributes so draw.io still
//! renders a labeled shape.

use quick_xml::escape::{escape, unescape};
use serde::{Deserialize, Serialize};

use mica_core::{CoreError, IdKind, RecordId, Result, CANVAS_SCHEMA_VERSION};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CellKind {
    Rectangle,
    Ellipse,
    Diamond,
    Text,
    Sticky,
    Connector,
    Frame,
    NoteLink,
    DatabaseLink,
    /// Foreign cell from a draw.io file we don't model; style preserved.
    Unknown,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Geometry {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneCell {
    pub id: String,
    pub kind: CellKind,
    #[serde(default)]
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub geometry: Option<Geometry>,
    /// Frame parent, if contained in a frame.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    /// Connector endpoints (cell ids).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    /// Raw mxCell style string. Set for Unknown cells; generated for others
    /// unless overridden (fill color etc. appended).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
    /// Relative path for note-link / database-link cells.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub href: Option<String>,
    /// View id for database-link cells.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scene {
    pub id: String,
    pub name: String,
    pub cells: Vec<SceneCell>,
}

impl Scene {
    pub fn new(name: &str) -> Scene {
        Scene {
            id: RecordId::new(IdKind::Canvas).to_string(),
            name: name.to_string(),
            cells: Vec::new(),
        }
    }

    fn default_style(kind: CellKind) -> &'static str {
        match kind {
            CellKind::Rectangle => "rounded=1;whiteSpace=wrap;html=1;",
            CellKind::Ellipse => "ellipse;whiteSpace=wrap;html=1;",
            CellKind::Diamond => "rhombus;whiteSpace=wrap;html=1;",
            CellKind::Text => "text;html=1;align=left;verticalAlign=top;",
            CellKind::Sticky => "shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;fillColor=#FFF2CC;strokeColor=#D6B656;",
            CellKind::Connector => "edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;",
            CellKind::Frame => "shape=frame;whiteSpace=wrap;html=1;verticalAlign=top;",
            CellKind::NoteLink => "rounded=1;whiteSpace=wrap;html=1;fillColor=#DAE8FC;strokeColor=#6C8EBF;",
            CellKind::DatabaseLink => "rounded=1;whiteSpace=wrap;html=1;dashed=1;fillColor=#D5E8D4;strokeColor=#82B366;",
            CellKind::Unknown => "",
        }
    }

    fn kind_from_style(style: &str, is_edge: bool, ws_type: Option<&str>) -> CellKind {
        match ws_type {
            Some("note-link") => return CellKind::NoteLink,
            Some("database-link") => return CellKind::DatabaseLink,
            _ => {}
        }
        if is_edge {
            return CellKind::Connector;
        }
        if style.starts_with("shape=note") {
            CellKind::Sticky
        } else if style.starts_with("shape=frame") {
            CellKind::Frame
        } else if style.starts_with("text;") || style == "text" {
            CellKind::Text
        } else if style.starts_with("ellipse") {
            CellKind::Ellipse
        } else if style.starts_with("rhombus") {
            CellKind::Diamond
        } else if style.starts_with("rounded=") || style.starts_with("whiteSpace=wrap") {
            CellKind::Rectangle
        } else {
            CellKind::Unknown
        }
    }

    /// Deterministic uncompressed XML: fixed attribute order, two-space
    /// indent, cells in z-order (= vector order), trailing newline.
    pub fn serialize(&self) -> Result<String> {
        let mut out = String::new();
        out.push_str(&format!(
            "<mxfile host=\"mica\" type=\"device\" version=\"1\" data-workspace-schema-version=\"{}\">\n",
            CANVAS_SCHEMA_VERSION
        ));
        out.push_str(&format!(
            "  <diagram id=\"{}\" name=\"{}\">\n",
            escape(&self.id),
            escape(&self.name)
        ));
        out.push_str("    <mxGraphModel dx=\"1200\" dy=\"800\" grid=\"1\" gridSize=\"10\" guides=\"1\" tooltips=\"1\" connect=\"1\" arrows=\"1\" fold=\"1\" page=\"0\" math=\"0\" shadow=\"0\">\n");
        out.push_str("      <root>\n");
        out.push_str("        <mxCell id=\"0\" />\n");
        out.push_str("        <mxCell id=\"1\" parent=\"0\" />\n");

        for cell in &self.cells {
            let style = cell
                .style
                .clone()
                .unwrap_or_else(|| Self::default_style(cell.kind).to_string());
            let parent = cell.parent.as_deref().unwrap_or("1");
            let is_edge = cell.kind == CellKind::Connector;

            out.push_str(&format!(
                "        <mxCell id=\"{}\" value=\"{}\" style=\"{}\"",
                escape(&cell.id),
                escape(&cell.label),
                escape(&style)
            ));
            if is_edge {
                out.push_str(" edge=\"1\"");
                if let Some(s) = &cell.source {
                    out.push_str(&format!(" source=\"{}\"", escape(s)));
                }
                if let Some(t) = &cell.target {
                    out.push_str(&format!(" target=\"{}\"", escape(t)));
                }
            } else {
                out.push_str(" vertex=\"1\"");
            }
            out.push_str(&format!(" parent=\"{}\"", escape(parent)));
            match cell.kind {
                CellKind::NoteLink => {
                    out.push_str(" data-workspace-type=\"note-link\"");
                    if let Some(h) = &cell.href {
                        out.push_str(&format!(" data-workspace-href=\"{}\"", escape(h)));
                    }
                }
                CellKind::DatabaseLink => {
                    out.push_str(" data-workspace-type=\"database-link\"");
                    if let Some(h) = &cell.href {
                        out.push_str(&format!(" data-workspace-href=\"{}\"", escape(h)));
                    }
                    if let Some(v) = &cell.view {
                        out.push_str(&format!(" data-workspace-view=\"{}\"", escape(v)));
                    }
                }
                _ => {}
            }
            out.push_str(">\n");
            if let Some(g) = &cell.geometry {
                out.push_str(&format!(
                    "          <mxGeometry x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" as=\"geometry\" />\n",
                    fmt_num(g.x),
                    fmt_num(g.y),
                    fmt_num(g.width),
                    fmt_num(g.height)
                ));
            } else if is_edge {
                out.push_str("          <mxGeometry relative=\"1\" as=\"geometry\" />\n");
            }
            out.push_str("        </mxCell>\n");
        }

        out.push_str("      </root>\n");
        out.push_str("    </mxGraphModel>\n");
        out.push_str("  </diagram>\n");
        out.push_str("</mxfile>\n");
        Ok(out)
    }

    /// Parse an uncompressed `.drawio` file (ours or a basic foreign one).
    pub fn parse(xml: &str) -> Result<Scene> {
        use quick_xml::events::Event;
        use quick_xml::Reader;

        let mut reader = Reader::from_str(xml);
        reader.config_mut().trim_text(true);

        let mut scene = Scene {
            id: String::new(),
            name: String::new(),
            cells: Vec::new(),
        };
        let mut current: Option<SceneCell> = None;
        let mut buf = Vec::new();

        loop {
            match reader
                .read_event_into(&mut buf)
                .map_err(|e| CoreError::parse("drawio", e.to_string()))?
            {
                Event::Start(e) | Event::Empty(e) => {
                    let name = e.name();
                    let tag = std::str::from_utf8(name.as_ref())
                        .map_err(|e| CoreError::parse("drawio", e.to_string()))?
                        .to_string();
                    let mut attrs = std::collections::HashMap::new();
                    for attr in e.attributes().flatten() {
                        let key = std::str::from_utf8(attr.key.as_ref())
                            .unwrap_or_default()
                            .to_string();
                        let value = unescape(
                            std::str::from_utf8(&attr.value).unwrap_or_default(),
                        )
                        .map(|s| s.to_string())
                        .unwrap_or_default();
                        attrs.insert(key, value);
                    }

                    match tag.as_str() {
                        "diagram" => {
                            scene.id = attrs.get("id").cloned().unwrap_or_default();
                            scene.name = attrs.get("name").cloned().unwrap_or_default();
                        }
                        "mxCell" => {
                            // A new mxCell closes any previous self-closing one.
                            if let Some(cell) = current.take() {
                                scene.cells.push(cell);
                            }
                            let id = attrs.get("id").cloned().unwrap_or_default();
                            if id == "0" || id == "1" {
                                buf.clear();
                                continue;
                            }
                            let style = attrs.get("style").cloned().unwrap_or_default();
                            let is_edge = attrs.get("edge").map(|v| v == "1").unwrap_or(false);
                            let ws_type = attrs.get("data-workspace-type").map(|s| s.as_str());
                            let kind = Self::kind_from_style(&style, is_edge, ws_type);
                            let parent = attrs
                                .get("parent")
                                .filter(|p| p.as_str() != "1" && p.as_str() != "0")
                                .cloned();
                            current = Some(SceneCell {
                                id,
                                kind,
                                label: attrs.get("value").cloned().unwrap_or_default(),
                                geometry: None,
                                parent,
                                source: attrs.get("source").cloned(),
                                target: attrs.get("target").cloned(),
                                style: if style.is_empty() { None } else { Some(style) },
                                href: attrs.get("data-workspace-href").cloned(),
                                view: attrs.get("data-workspace-view").cloned(),
                            });
                        }
                        "mxGeometry" => {
                            if let Some(cell) = &mut current {
                                let get = |k: &str| {
                                    attrs.get(k).and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0)
                                };
                                if attrs.contains_key("x")
                                    || attrs.contains_key("width")
                                    || attrs.contains_key("y")
                                    || attrs.contains_key("height")
                                {
                                    cell.geometry = Some(Geometry {
                                        x: get("x"),
                                        y: get("y"),
                                        width: get("width"),
                                        height: get("height"),
                                    });
                                }
                            }
                        }
                        _ => {}
                    }

                }
                Event::End(e) => {
                    let name = e.name();
                    let tag = std::str::from_utf8(name.as_ref()).unwrap_or_default();
                    if tag == "mxCell" {
                        if let Some(cell) = current.take() {
                            scene.cells.push(cell);
                        }
                    }
                }
                Event::Eof => break,
                _ => {}
            }
            buf.clear();
        }

        // Self-closing <mxCell ... /> events arrive as Event::Empty with no
        // matching End; flush any leftover.
        if let Some(cell) = current.take() {
            scene.cells.push(cell);
        }

        if scene.id.is_empty() && scene.cells.is_empty() {
            return Err(CoreError::parse("drawio", "no diagram found"));
        }
        Ok(scene)
    }
}

/// Format numbers without trailing `.0` so output matches draw.io style.
fn fmt_num(n: f64) -> String {
    if n.fract() == 0.0 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

/// Scene operations applied in a batch (spec §11.3 `canvas_apply`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum CanvasOp {
    AddCell { cell: SceneCell },
    UpdateCell { cell: SceneCell },
    RemoveCell { id: String },
    RenameScene { name: String },
    /// Move a cell to a new z-order position (cell order = z-order).
    ReorderCell { id: String, to_index: usize },
}

pub fn apply_canvas_ops(scene: &mut Scene, ops: &[CanvasOp]) -> Result<()> {
    for op in ops {
        match op {
            CanvasOp::AddCell { cell } => {
                if scene.cells.iter().any(|c| c.id == cell.id) {
                    return Err(CoreError::Other(format!("cell already exists: {}", cell.id)));
                }
                scene.cells.push(cell.clone());
            }
            CanvasOp::UpdateCell { cell } => {
                match scene.cells.iter_mut().find(|c| c.id == cell.id) {
                    Some(existing) => *existing = cell.clone(),
                    None => scene.cells.push(cell.clone()),
                }
            }
            CanvasOp::RemoveCell { id } => {
                scene.cells.retain(|c| &c.id != id);
                // Detach connectors that referenced the removed cell.
                for c in &mut scene.cells {
                    if c.source.as_deref() == Some(id) {
                        c.source = None;
                    }
                    if c.target.as_deref() == Some(id) {
                        c.target = None;
                    }
                    if c.parent.as_deref() == Some(id) {
                        c.parent = None;
                    }
                }
            }
            CanvasOp::RenameScene { name } => {
                scene.name = name.clone();
            }
            CanvasOp::ReorderCell { id, to_index } => {
                if let Some(pos) = scene.cells.iter().position(|c| &c.id == id) {
                    let cell = scene.cells.remove(pos);
                    let idx = (*to_index).min(scene.cells.len());
                    scene.cells.insert(idx, cell);
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_scene() -> Scene {
        let mut scene = Scene::new("System Map");
        scene.cells.push(SceneCell {
            id: "shape_a".into(),
            kind: CellKind::Rectangle,
            label: "Box A".into(),
            geometry: Some(Geometry { x: 100.0, y: 80.0, width: 180.0, height: 80.0 }),
            parent: None,
            source: None,
            target: None,
            style: None,
            href: None,
            view: None,
        });
        scene.cells.push(SceneCell {
            id: "shape_b".into(),
            kind: CellKind::NoteLink,
            label: "Project Plan".into(),
            geometry: Some(Geometry { x: 400.0, y: 80.0, width: 180.0, height: 80.0 }),
            parent: None,
            source: None,
            target: None,
            style: None,
            href: Some("../notes/project-plan.md".into()),
            view: None,
        });
        scene.cells.push(SceneCell {
            id: "edge_1".into(),
            kind: CellKind::Connector,
            label: String::new(),
            geometry: None,
            parent: None,
            source: Some("shape_a".into()),
            target: Some("shape_b".into()),
            style: None,
            href: None,
            view: None,
        });
        scene
    }

    #[test]
    fn roundtrip() {
        let scene = sample_scene();
        let xml = scene.serialize().unwrap();
        assert!(xml.contains("data-workspace-type=\"note-link\""));
        assert!(xml.contains("data-workspace-href=\"../notes/project-plan.md\""));
        let parsed = Scene::parse(&xml).unwrap();
        assert_eq!(parsed.name, "System Map");
        assert_eq!(parsed.cells.len(), 3);
        assert_eq!(parsed.cells[0].kind, CellKind::Rectangle);
        assert_eq!(parsed.cells[1].kind, CellKind::NoteLink);
        assert_eq!(parsed.cells[1].href.as_deref(), Some("../notes/project-plan.md"));
        assert_eq!(parsed.cells[2].kind, CellKind::Connector);
        assert_eq!(parsed.cells[2].source.as_deref(), Some("shape_a"));
        // Determinism: serialize(parse(serialize(x))) == serialize(x)
        assert_eq!(parsed.serialize().unwrap(), xml);
    }

    #[test]
    fn ops_apply() {
        let mut scene = sample_scene();
        apply_canvas_ops(
            &mut scene,
            &[CanvasOp::RemoveCell { id: "shape_b".into() }],
        )
        .unwrap();
        assert_eq!(scene.cells.len(), 2);
        assert!(scene.cells.iter().find(|c| c.id == "edge_1").unwrap().target.is_none());
    }
}
