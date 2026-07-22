//! Canvas scene model and deterministic draw.io-compatible XML (spec §4.4,
//! §11.1). Uncompressed `mxfile > diagram > mxGraphModel > root > mxCell*`;
//! app-specific data rides in `data-workspace-*` attributes so draw.io still
//! renders a labeled shape.

pub mod interop;

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
    /// Freehand pen stroke (FR21-EDG-003). Points live in the style string
    /// (`shape=mica-pen;points=x1,y1 x2,y2 …`); geometry is the bounding box.
    /// Degrades gracefully in draw.io: an app that doesn't know `mica-pen`
    /// renders the bounding-box vertex as a labeled shape (documented lossy).
    Pen,
    /// Native draw.io group cell (`style="group"`, FR21-EDG-002). Members
    /// reference it via `parent`; member geometry is relative to the group.
    Group,
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
    /// Generic `data-workspace-type` passthrough for cells whose type isn't
    /// implied by their kind (e.g. mindmap nodes/edges tagged `"mindmap"`).
    /// note-link / database-link still derive their type from `kind`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ws_type: Option<String>,
    /// Generic `data-workspace-parent` passthrough (mindmap parent node id).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ws_parent: Option<String>,
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
            CellKind::Pen => "shape=mica-pen;points=;strokeColor=#1A1A1A;strokeWidth=2;",
            CellKind::Group => "group",
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
        if style.starts_with("shape=mica-pen") {
            CellKind::Pen
        } else if style == "group" || style.starts_with("group;") {
            CellKind::Group
        } else if style.starts_with("shape=note") {
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
                // Generic passthrough for any other cell that carries an
                // app-specific type (e.g. mindmap nodes/edges).
                _ => {
                    if let Some(t) = &cell.ws_type {
                        out.push_str(&format!(" data-workspace-type=\"{}\"", escape(t)));
                    }
                }
            }
            if let Some(p) = &cell.ws_parent {
                out.push_str(&format!(" data-workspace-parent=\"{}\"", escape(p)));
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
                            let ws_type_raw = attrs.get("data-workspace-type").map(|s| s.as_str());
                            let kind = Self::kind_from_style(&style, is_edge, ws_type_raw);
                            // note-link / database-link are recovered from the
                            // kind; keep any other type as a generic passthrough.
                            let ws_type = match ws_type_raw {
                                Some("note-link") | Some("database-link") | None => None,
                                Some(other) => Some(other.to_string()),
                            };
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
                                ws_type,
                                ws_parent: attrs.get("data-workspace-parent").cloned(),
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
    /// Group the given cells into a native draw.io group (FR21-EDG-002):
    /// a `style="group"` vertex sized to the members' bbox, with members
    /// re-parented and their geometry made relative to the group origin.
    GroupCells { ids: Vec<String> },
    /// Dissolve a group cell: members are re-absolutized and detached, then
    /// the group cell is removed.
    UngroupCells { id: String },
    /// Add a freehand pen stroke (FR21-EDG-003). Errors unless kind is `Pen`.
    AddStroke { cell: SceneCell },
    /// Mind map (FR21-EDG-004): add a child node + connector under `parent_id`
    /// and re-lay-out that parent's direct children (tidy tree, rightward).
    MindmapAddChild { parent_id: String, label: String },
    /// Mind map: add a sibling of `sibling_id` (a child of its parent).
    MindmapAddSibling { sibling_id: String, label: String },
}

// --- mind map layout constants (FR21-EDG-004) ---
const MINDMAP_NODE_W: f64 = 160.0;
const MINDMAP_NODE_H: f64 = 40.0;
const MINDMAP_GAP_Y: f64 = 20.0;
const MINDMAP_GAP_X: f64 = 60.0;

/// Merge `updates` (key/value pairs) into a draw.io style string without
/// clobbering unknown keys. Existing `key=value` tokens are updated in place;
/// bare flag tokens (e.g. `rounded`, `ellipse`, `html`) and the leading shape
/// token are preserved in order; unseen keys are appended. Always ends with a
/// trailing `;`, matching draw.io's own formatting. Used by mind map / group
/// style composition and mirrored client-side by the style panel.
pub fn merge_style(base: &str, updates: &[(&str, &str)]) -> String {
    let mut applied = vec![false; updates.len()];
    let mut out: Vec<String> = Vec::new();
    for token in base.split(';') {
        if token.is_empty() {
            continue;
        }
        if let Some((key, _)) = token.split_once('=') {
            if let Some(i) = updates.iter().position(|(k, _)| *k == key) {
                out.push(format!("{}={}", key, updates[i].1));
                applied[i] = true;
                continue;
            }
        }
        out.push(token.to_string());
    }
    for (i, (k, v)) in updates.iter().enumerate() {
        if !applied[i] {
            out.push(format!("{k}={v}"));
        }
    }
    let mut s = out.join(";");
    s.push(';');
    s
}

/// Bounding box of the given cells' geometries, if any have geometry.
fn bbox_of<'a>(cells: impl Iterator<Item = &'a SceneCell>) -> Option<Geometry> {
    let mut acc: Option<(f64, f64, f64, f64)> = None;
    for c in cells {
        if let Some(g) = &c.geometry {
            let (x0, y0, x1, y1) = (g.x, g.y, g.x + g.width, g.y + g.height);
            acc = Some(match acc {
                None => (x0, y0, x1, y1),
                Some((ax0, ay0, ax1, ay1)) => {
                    (ax0.min(x0), ay0.min(y0), ax1.max(x1), ay1.max(y1))
                }
            });
        }
    }
    acc.map(|(x0, y0, x1, y1)| Geometry {
        x: x0,
        y: y0,
        width: x1 - x0,
        height: y1 - y0,
    })
}

/// Recursively shift a mind map node and all its descendants by (dx, dy).
fn shift_mindmap_subtree(scene: &mut Scene, node_id: &str, dx: f64, dy: f64) {
    if let Some(c) = scene.cells.iter_mut().find(|c| c.id == node_id) {
        if let Some(g) = &mut c.geometry {
            g.x += dx;
            g.y += dy;
        }
    }
    let child_ids: Vec<String> = scene
        .cells
        .iter()
        .filter(|c| c.ws_parent.as_deref() == Some(node_id))
        .map(|c| c.id.clone())
        .collect();
    for cid in child_ids {
        shift_mindmap_subtree(scene, &cid, dx, dy);
    }
}

/// Re-lay-out a mind map parent's direct children: stacked vertically to the
/// right of the parent, centered on the parent's vertical center. Each child's
/// whole subtree shifts with it so grandchildren stay attached.
fn relayout_mindmap_children(scene: &mut Scene, parent_id: &str) {
    let parent_geo = match scene.cells.iter().find(|c| c.id == parent_id) {
        Some(c) => match &c.geometry {
            Some(g) => g.clone(),
            None => return,
        },
        None => return,
    };
    let child_ids: Vec<String> = scene
        .cells
        .iter()
        .filter(|c| c.ws_parent.as_deref() == Some(parent_id))
        .map(|c| c.id.clone())
        .collect();
    let n = child_ids.len();
    if n == 0 {
        return;
    }
    let total = n as f64 * MINDMAP_NODE_H + (n as f64 - 1.0) * MINDMAP_GAP_Y;
    let start_y = parent_geo.y + parent_geo.height / 2.0 - total / 2.0;
    let x = parent_geo.x + parent_geo.width + MINDMAP_GAP_X;
    for (i, cid) in child_ids.iter().enumerate() {
        let new_y = start_y + i as f64 * (MINDMAP_NODE_H + MINDMAP_GAP_Y);
        let (old_x, old_y) = match scene.cells.iter().find(|c| &c.id == cid) {
            Some(c) => match &c.geometry {
                Some(g) => (g.x, g.y),
                None => (x, new_y),
            },
            None => continue,
        };
        shift_mindmap_subtree(scene, cid, x - old_x, new_y - old_y);
    }
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
            CanvasOp::GroupCells { ids } => {
                // Members that actually exist and have geometry (draw.io groups
                // hold vertices; connectors follow their endpoints).
                let member_ids: Vec<String> = ids
                    .iter()
                    .filter(|id| {
                        scene
                            .cells
                            .iter()
                            .any(|c| &c.id == *id && c.geometry.is_some())
                    })
                    .cloned()
                    .collect();
                if member_ids.len() < 2 {
                    continue; // nothing meaningful to group
                }
                let bbox = match bbox_of(
                    scene.cells.iter().filter(|c| member_ids.contains(&c.id)),
                ) {
                    Some(b) => b,
                    None => continue,
                };
                let group_id = RecordId::new(IdKind::Shape).to_string();
                // Insert the group behind its earliest member (z-order).
                let insert_at = member_ids
                    .iter()
                    .filter_map(|id| scene.cells.iter().position(|c| &c.id == id))
                    .min()
                    .unwrap_or(scene.cells.len());
                for c in scene.cells.iter_mut() {
                    if member_ids.contains(&c.id) {
                        c.parent = Some(group_id.clone());
                        if let Some(g) = &mut c.geometry {
                            g.x -= bbox.x;
                            g.y -= bbox.y;
                        }
                    }
                }
                let group = SceneCell {
                    id: group_id,
                    kind: CellKind::Group,
                    label: String::new(),
                    geometry: Some(bbox),
                    parent: None,
                    source: None,
                    target: None,
                    style: Some("group".to_string()),
                    href: None,
                    view: None,
                    ws_type: None,
                    ws_parent: None,
                };
                scene.cells.insert(insert_at, group);
            }
            CanvasOp::UngroupCells { id } => {
                let group_geo = scene
                    .cells
                    .iter()
                    .find(|c| &c.id == id && c.kind == CellKind::Group)
                    .and_then(|c| c.geometry.clone());
                let Some(gg) = group_geo else { continue };
                for c in scene.cells.iter_mut() {
                    if c.parent.as_deref() == Some(id.as_str()) {
                        if let Some(g) = &mut c.geometry {
                            g.x += gg.x;
                            g.y += gg.y;
                        }
                        c.parent = None;
                    }
                }
                scene.cells.retain(|c| &c.id != id);
            }
            CanvasOp::AddStroke { cell } => {
                if cell.kind != CellKind::Pen {
                    return Err(CoreError::Other(format!(
                        "add_stroke requires a pen cell, got {:?}",
                        cell.kind
                    )));
                }
                if scene.cells.iter().any(|c| c.id == cell.id) {
                    return Err(CoreError::Other(format!("cell already exists: {}", cell.id)));
                }
                scene.cells.push(cell.clone());
            }
            CanvasOp::MindmapAddChild { parent_id, label } => {
                let parent = scene
                    .cells
                    .iter()
                    .find(|c| &c.id == parent_id)
                    .ok_or_else(|| {
                        CoreError::Other(format!("mindmap parent not found: {parent_id}"))
                    })?;
                let px = parent.geometry.as_ref().map(|g| g.x).unwrap_or(0.0);
                let py = parent.geometry.as_ref().map(|g| g.y).unwrap_or(0.0);
                let node_id = RecordId::new(IdKind::Shape).to_string();
                let edge_id = RecordId::new(IdKind::Shape).to_string();
                let style = merge_style(
                    default_rect_style(),
                    &[("fillColor", "#EEF2FF"), ("strokeColor", "#6C8EBF")],
                );
                scene.cells.push(SceneCell {
                    id: node_id.clone(),
                    kind: CellKind::Rectangle,
                    label: label.clone(),
                    // Placeholder near parent; relayout overwrites it.
                    geometry: Some(Geometry {
                        x: px + MINDMAP_NODE_W,
                        y: py,
                        width: MINDMAP_NODE_W,
                        height: MINDMAP_NODE_H,
                    }),
                    parent: None,
                    source: None,
                    target: None,
                    style: Some(style),
                    href: None,
                    view: None,
                    ws_type: Some("mindmap".to_string()),
                    ws_parent: Some(parent_id.clone()),
                });
                scene.cells.push(SceneCell {
                    id: edge_id,
                    kind: CellKind::Connector,
                    label: String::new(),
                    geometry: None,
                    parent: None,
                    source: Some(parent_id.clone()),
                    target: Some(node_id),
                    style: None,
                    href: None,
                    view: None,
                    ws_type: Some("mindmap".to_string()),
                    ws_parent: None,
                });
                relayout_mindmap_children(scene, parent_id);
            }
            CanvasOp::MindmapAddSibling { sibling_id, label } => {
                let parent_id = scene
                    .cells
                    .iter()
                    .find(|c| &c.id == sibling_id)
                    .and_then(|c| c.ws_parent.clone())
                    .ok_or_else(|| {
                        CoreError::Other(format!(
                            "mindmap sibling has no parent (is it the root?): {sibling_id}"
                        ))
                    })?;
                apply_canvas_ops(
                    scene,
                    &[CanvasOp::MindmapAddChild {
                        parent_id,
                        label: label.clone(),
                    }],
                )?;
            }
        }
    }
    Ok(())
}

/// Default rectangle style, shared with mind map node composition.
fn default_rect_style() -> &'static str {
    Scene::default_style(CellKind::Rectangle)
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
            ws_type: None,
            ws_parent: None,
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
            ws_type: None,
            ws_parent: None,
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
            ws_type: None,
            ws_parent: None,
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

    // ---- Phase C6: edgeless depth (FR21-EDG-001..004) ----

    fn rect(id: &str, x: f64, y: f64, w: f64, h: f64) -> SceneCell {
        SceneCell {
            id: id.into(),
            kind: CellKind::Rectangle,
            label: id.into(),
            geometry: Some(Geometry { x, y, width: w, height: h }),
            parent: None,
            source: None,
            target: None,
            style: None,
            href: None,
            view: None,
            ws_type: None,
            ws_parent: None,
        }
    }

    #[test]
    fn merge_style_updates_and_preserves() {
        // Updates an existing key, preserves bare tokens + unknown keys, and
        // appends a brand-new key. Ends with a trailing ';'.
        let out = merge_style(
            "rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;",
            &[("fillColor", "#FF0000"), ("strokeWidth", "4")],
        );
        assert_eq!(out, "rounded=1;whiteSpace=wrap;html=1;fillColor=#FF0000;strokeWidth=4;");
        // Leading bare shape token survives.
        let e = merge_style("ellipse;whiteSpace=wrap;html=1;", &[("strokeColor", "#000")]);
        assert!(e.starts_with("ellipse;"));
        assert!(e.contains("strokeColor=#000;"));
        assert!(e.contains("whiteSpace=wrap"));
    }

    #[test]
    fn group_ungroup_relative_geometry_and_roundtrip() {
        let mut scene = Scene::new("Grouped");
        scene.cells.push(rect("a", 100.0, 100.0, 80.0, 40.0));
        scene.cells.push(rect("b", 300.0, 220.0, 80.0, 40.0));

        apply_canvas_ops(
            &mut scene,
            &[CanvasOp::GroupCells { ids: vec!["a".into(), "b".into()] }],
        )
        .unwrap();

        // A group cell exists sized to the members' bbox.
        let group = scene.cells.iter().find(|c| c.kind == CellKind::Group).unwrap();
        let gg = group.geometry.clone().unwrap();
        assert_eq!((gg.x, gg.y, gg.width, gg.height), (100.0, 100.0, 280.0, 160.0));
        let group_id = group.id.clone();
        // Members are re-parented with geometry relative to the group origin.
        let a = scene.cells.iter().find(|c| c.id == "a").unwrap();
        assert_eq!(a.parent.as_deref(), Some(group_id.as_str()));
        assert_eq!((a.geometry.as_ref().unwrap().x, a.geometry.as_ref().unwrap().y), (0.0, 0.0));
        let b = scene.cells.iter().find(|c| c.id == "b").unwrap();
        assert_eq!((b.geometry.as_ref().unwrap().x, b.geometry.as_ref().unwrap().y), (200.0, 120.0));

        // XML round-trip preserves the group + parent references.
        let xml = scene.serialize().unwrap();
        assert!(xml.contains("style=\"group\""));
        let parsed = Scene::parse(&xml).unwrap();
        let pg = parsed.cells.iter().find(|c| c.kind == CellKind::Group).unwrap();
        assert_eq!(pg.id, group_id);
        assert!(parsed.cells.iter().any(|c| c.id == "a" && c.parent.as_deref() == Some(group_id.as_str())));
        assert_eq!(parsed.serialize().unwrap(), xml);

        // Ungroup re-absolutizes and removes the group.
        apply_canvas_ops(&mut scene, &[CanvasOp::UngroupCells { id: group_id.clone() }]).unwrap();
        assert!(!scene.cells.iter().any(|c| c.kind == CellKind::Group));
        let a2 = scene.cells.iter().find(|c| c.id == "a").unwrap();
        assert_eq!((a2.geometry.as_ref().unwrap().x, a2.geometry.as_ref().unwrap().y), (100.0, 100.0));
        assert!(a2.parent.is_none());
        let b2 = scene.cells.iter().find(|c| c.id == "b").unwrap();
        assert_eq!((b2.geometry.as_ref().unwrap().x, b2.geometry.as_ref().unwrap().y), (300.0, 220.0));
    }

    #[test]
    fn pen_stroke_roundtrip() {
        let mut scene = Scene::new("Sketch");
        let stroke = SceneCell {
            id: "pen_1".into(),
            kind: CellKind::Pen,
            label: String::new(),
            geometry: Some(Geometry { x: 10.0, y: 10.0, width: 90.0, height: 40.0 }),
            parent: None,
            source: None,
            target: None,
            style: Some("shape=mica-pen;points=10,10 40,30 100,50;strokeColor=#1A1A1A;strokeWidth=2;".into()),
            href: None,
            view: None,
            ws_type: None,
            ws_parent: None,
        };
        apply_canvas_ops(&mut scene, &[CanvasOp::AddStroke { cell: stroke }]).unwrap();

        // Wrong kind is rejected.
        let bad = rect("x", 0.0, 0.0, 10.0, 10.0);
        assert!(apply_canvas_ops(&mut scene, &[CanvasOp::AddStroke { cell: bad }]).is_err());

        let xml = scene.serialize().unwrap();
        assert!(xml.contains("shape=mica-pen;points=10,10 40,30 100,50"));
        let parsed = Scene::parse(&xml).unwrap();
        let p = parsed.cells.iter().find(|c| c.id == "pen_1").unwrap();
        assert_eq!(p.kind, CellKind::Pen);
        assert!(p.style.as_deref().unwrap().contains("points=10,10 40,30 100,50"));
        assert_eq!(parsed.serialize().unwrap(), xml);
    }

    #[test]
    fn mindmap_three_nodes_layout_and_roundtrip() {
        let mut scene = Scene::new("Mind Map");
        // Root node tagged as a mindmap node.
        let mut root = rect("root", 0.0, 0.0, MINDMAP_NODE_W, MINDMAP_NODE_H);
        root.label = "Root".into();
        root.ws_type = Some("mindmap".into());
        scene.cells.push(root);

        // Two children via add_child.
        apply_canvas_ops(
            &mut scene,
            &[
                CanvasOp::MindmapAddChild { parent_id: "root".into(), label: "Child A".into() },
                CanvasOp::MindmapAddChild { parent_id: "root".into(), label: "Child B".into() },
            ],
        )
        .unwrap();

        // 3 nodes + 2 connectors.
        let nodes: Vec<&SceneCell> = scene
            .cells
            .iter()
            .filter(|c| c.ws_type.as_deref() == Some("mindmap") && c.kind == CellKind::Rectangle)
            .collect();
        assert_eq!(nodes.len(), 3);
        let edges: Vec<&SceneCell> = scene
            .cells
            .iter()
            .filter(|c| c.kind == CellKind::Connector && c.ws_type.as_deref() == Some("mindmap"))
            .collect();
        assert_eq!(edges.len(), 2);

        // Children sit to the right, stacked, centered on the parent center.
        let children: Vec<&SceneCell> = scene
            .cells
            .iter()
            .filter(|c| c.ws_parent.as_deref() == Some("root"))
            .collect();
        assert_eq!(children.len(), 2);
        for c in &children {
            assert_eq!(c.geometry.as_ref().unwrap().x, MINDMAP_NODE_W + MINDMAP_GAP_X);
        }
        let ys: Vec<f64> = children.iter().map(|c| c.geometry.as_ref().unwrap().y).collect();
        // Two children of height 40 with a 20 gap, centered on parent center (20):
        // total = 100, start = 20 - 50 = -30, ys = [-30, 30].
        assert_eq!(ys, vec![-30.0, 30.0]);

        // add_sibling of Child A adds a third child under root and relays out.
        let child_a = children.iter().find(|c| c.label == "Child A").unwrap().id.clone();
        apply_canvas_ops(
            &mut scene,
            &[CanvasOp::MindmapAddSibling { sibling_id: child_a, label: "Child C".into() }],
        )
        .unwrap();
        let count = scene.cells.iter().filter(|c| c.ws_parent.as_deref() == Some("root")).count();
        assert_eq!(count, 3);

        // Round-trips through XML with the mindmap tags intact.
        let xml = scene.serialize().unwrap();
        assert!(xml.contains("data-workspace-type=\"mindmap\""));
        assert!(xml.contains("data-workspace-parent=\"root\""));
        let parsed = Scene::parse(&xml).unwrap();
        assert_eq!(
            parsed.cells.iter().filter(|c| c.ws_parent.as_deref() == Some("root")).count(),
            3
        );
        assert_eq!(parsed.serialize().unwrap(), xml);
    }
}
