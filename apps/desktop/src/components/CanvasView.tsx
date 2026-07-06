import { useCallback, useEffect, useRef, useState } from "react";
import { api, CanvasOp, CellKind, Scene, SceneCell, isApiError } from "../api";
import { docEvents } from "../docEvents";
import { useStore, kindOfPath, titleOfPath } from "../store";

type Tool =
  | "select"
  | "hand"
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "text"
  | "sticky"
  | "connector"
  | "frame";

const SHAPE_DEFAULT_SIZE: Record<string, { w: number; h: number }> = {
  rectangle: { w: 180, h: 80 },
  ellipse: { w: 160, h: 100 },
  diamond: { w: 160, h: 120 },
  text: { w: 200, h: 40 },
  sticky: { w: 180, h: 140 },
  frame: { w: 480, h: 320 },
};

let cellCounter = 0;
function newCellId(): string {
  cellCounter += 1;
  return `shape_${Date.now().toString(36)}${cellCounter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export default function CanvasView({ path, active }: { path: string; active: boolean }) {
  const [scene, setScene] = useState<Scene | null>(null);
  const [version, setVersion] = useState("");
  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [viewBox, setViewBox] = useState({ x: -100, y: -100, zoom: 1 });
  const [editingLabel, setEditingLabel] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef(path);
  pathRef.current = path;
  const versionRef = useRef(version);
  versionRef.current = version;
  const dragState = useRef<{
    mode: "move" | "pan" | "resize";
    cellId?: string;
    startX: number;
    startY: number;
    orig?: { x: number; y: number; width: number; height: number };
    origView?: { x: number; y: number };
    moved?: boolean;
  } | null>(null);

  const openTab = useStore((s) => s.openTab);

  const load = useCallback(async () => {
    try {
      const file = await api.canvasLoad(pathRef.current);
      setVersion(file.version);
      setScene(parseSceneFromXml(file.content));
      setError(null);
    } catch (e) {
      setError(isApiError(e) ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, path]);

  useEffect(() => {
    return docEvents.on((ev) => {
      if ("path" in ev && ev.path === pathRef.current) void load();
    });
  }, [load]);

  const apply = useCallback(
    async (ops: CanvasOp[]) => {
      try {
        const result = await api.canvasApply(pathRef.current, ops, versionRef.current);
        setVersion(result.version);
        setScene(parseSceneFromXml(result.content));
        setError(null);
      } catch (e) {
        if (isApiError(e) && e.code === "conflict") {
          await load();
          setError("Canvas changed on disk — reloaded.");
        } else {
          setError(isApiError(e) ? e.message : String(e));
        }
      }
    },
    [load],
  );

  // Optimistic local update for smooth dragging; commit on mouse-up.
  const updateLocal = (cell: SceneCell) => {
    setScene((s) =>
      s ? { ...s, cells: s.cells.map((c) => (c.id === cell.id ? cell : c)) } : s,
    );
  };

  const toWorld = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / viewBox.zoom + viewBox.x,
      y: (clientY - rect.top) / viewBox.zoom + viewBox.y,
    };
  };

  const onCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || tool === "hand" || e.altKey) {
      dragState.current = {
        mode: "pan",
        startX: e.clientX,
        startY: e.clientY,
        origView: { x: viewBox.x, y: viewBox.y },
      };
      return;
    }
    if (tool !== "select" && tool !== "connector") {
      const { x, y } = toWorld(e.clientX, e.clientY);
      const size = SHAPE_DEFAULT_SIZE[tool] ?? { w: 160, h: 80 };
      const kind = tool as CellKind;
      const cell: SceneCell = {
        id: newCellId(),
        kind,
        label: tool === "text" ? "Text" : tool === "sticky" ? "Note" : "",
        geometry: { x: Math.round(x - size.w / 2), y: Math.round(y - size.h / 2), width: size.w, height: size.h },
      };
      void apply([{ op: "add_cell", cell }]);
      setTool("select");
      setSelected(cell.id);
      return;
    }
    setSelected(null);
    setConnectFrom(null);
  };

  const onCellMouseDown = (e: React.MouseEvent, cell: SceneCell) => {
    e.stopPropagation();
    if (tool === "connector") {
      if (!connectFrom) {
        setConnectFrom(cell.id);
      } else if (connectFrom !== cell.id) {
        const edge: SceneCell = {
          id: newCellId().replace("shape_", "edge_"),
          kind: "connector",
          label: "",
          source: connectFrom,
          target: cell.id,
        };
        void apply([{ op: "add_cell", cell: edge }]);
        setConnectFrom(null);
        setTool("select");
      }
      return;
    }
    setSelected(cell.id);
    if (cell.geometry) {
      const { x, y } = toWorld(e.clientX, e.clientY);
      dragState.current = {
        mode: "move",
        cellId: cell.id,
        startX: x,
        startY: y,
        orig: { ...cell.geometry },
      };
    }
  };

  const onResizeMouseDown = (e: React.MouseEvent, cell: SceneCell) => {
    e.stopPropagation();
    if (!cell.geometry) return;
    const { x, y } = toWorld(e.clientX, e.clientY);
    dragState.current = {
      mode: "resize",
      cellId: cell.id,
      startX: x,
      startY: y,
      orig: { ...cell.geometry },
    };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const drag = dragState.current;
    if (!drag || !scene) return;
    drag.moved = true;
    if (drag.mode === "pan" && drag.origView) {
      setViewBox((v) => ({
        ...v,
        x: drag.origView!.x - (e.clientX - drag.startX) / v.zoom,
        y: drag.origView!.y - (e.clientY - drag.startY) / v.zoom,
      }));
      return;
    }
    const cell = scene.cells.find((c) => c.id === drag.cellId);
    if (!cell || !drag.orig) return;
    const { x, y } = toWorld(e.clientX, e.clientY);
    const dx = x - drag.startX;
    const dy = y - drag.startY;
    if (drag.mode === "move") {
      updateLocal({
        ...cell,
        geometry: { ...drag.orig, x: Math.round(drag.orig.x + dx), y: Math.round(drag.orig.y + dy) },
      });
    } else if (drag.mode === "resize") {
      updateLocal({
        ...cell,
        geometry: {
          ...drag.orig,
          width: Math.max(24, Math.round(drag.orig.width + dx)),
          height: Math.max(24, Math.round(drag.orig.height + dy)),
        },
      });
    }
  };

  const onMouseUp = () => {
    const drag = dragState.current;
    dragState.current = null;
    if (!drag || drag.mode === "pan" || !drag.moved || !scene) return;
    const cell = scene.cells.find((c) => c.id === drag.cellId);
    if (cell) void apply([{ op: "update_cell", cell }]);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setViewBox((v) => {
        const zoom = Math.min(4, Math.max(0.1, v.zoom * factor));
        // Zoom around cursor.
        const rect = svgRef.current!.getBoundingClientRect();
        const cx = (e.clientX - rect.left) / v.zoom + v.x;
        const cy = (e.clientY - rect.top) / v.zoom + v.y;
        return {
          zoom,
          x: cx - (e.clientX - rect.left) / zoom,
          y: cy - (e.clientY - rect.top) / zoom,
        };
      });
    } else {
      setViewBox((v) => ({ ...v, x: v.x + e.deltaX / v.zoom, y: v.y + e.deltaY / v.zoom }));
    }
  };

  const onCellDoubleClick = (cell: SceneCell) => {
    if ((cell.kind === "note_link" || cell.kind === "database_link") && cell.href) {
      // href is relative to the canvas file.
      const parts = pathRef.current.split("/").slice(0, -1);
      for (const seg of cell.href.split("/")) {
        if (seg === "..") parts.pop();
        else if (seg !== "." && seg !== "") parts.push(seg);
      }
      const target = parts.join("/");
      const kind = kindOfPath(target);
      if (kind === "note" || kind === "database") {
        openTab({ path: target, kind, title: titleOfPath(target) });
      }
      return;
    }
    setEditingLabel(cell.id);
  };

  const deleteSelected = useCallback(() => {
    if (selected) {
      void apply([{ op: "remove_cell", id: selected }]);
      setSelected(null);
    }
  }, [selected, apply]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selected && !editingLabel) {
        const el = document.activeElement;
        if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, selected, editingLabel, deleteSelected]);

  // Drop a note/database from a quick prompt (MVP: toolbar button).
  const addLink = async (kind: "note_link" | "database_link") => {
    const q = prompt(kind === "note_link" ? "Note title to link" : "Database title to link");
    if (!q) return;
    const hits = await api.quickSwitch(q, 5);
    const hit = hits.find((h) =>
      kind === "note_link" ? h.kind === "note" : h.kind === "database",
    );
    if (!hit) {
      alert("Not found");
      return;
    }
    // Compute path relative to the canvas file.
    const fromParts = pathRef.current.split("/").slice(0, -1);
    const toParts = hit.path.split("/");
    let common = 0;
    while (
      common < fromParts.length &&
      common < toParts.length - 1 &&
      fromParts[common] === toParts[common]
    )
      common++;
    const rel = [
      ...Array(fromParts.length - common).fill(".."),
      ...toParts.slice(common),
    ].join("/");

    const cell: SceneCell = {
      id: newCellId(),
      kind,
      label: hit.title,
      href: rel,
      view: kind === "database_link" ? "table_default" : undefined,
      geometry: {
        x: Math.round(viewBox.x + 200),
        y: Math.round(viewBox.y + 160),
        width: 200,
        height: 90,
      },
    };
    void apply([{ op: "add_cell", cell }]);
  };

  if (error && !scene) return <div className="placeholder error">{error}</div>;
  if (!scene) return <div className="placeholder muted">Loading…</div>;

  const vertices = scene.cells.filter((c) => c.kind !== "connector");
  const edges = scene.cells.filter((c) => c.kind === "connector");
  const selectedCell = scene.cells.find((c) => c.id === selected);

  const TOOLS: { id: Tool; label: string }[] = [
    { id: "select", label: "Select" },
    { id: "hand", label: "Hand" },
    { id: "rectangle", label: "Rect" },
    { id: "ellipse", label: "Ellipse" },
    { id: "diamond", label: "Diamond" },
    { id: "text", label: "Text" },
    { id: "sticky", label: "Sticky" },
    { id: "connector", label: "Connect" },
    { id: "frame", label: "Frame" },
  ];

  return (
    <div className="canvas-view">
      <div className="canvas-toolbar">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={tool === t.id ? "active" : ""}
            onClick={() => {
              setTool(t.id);
              setConnectFrom(null);
            }}
          >
            {t.label}
          </button>
        ))}
        <div className="spacer" />
        <button onClick={() => addLink("note_link")}>+ Note link</button>
        <button onClick={() => addLink("database_link")}>+ DB link</button>
        <span className="muted small">{Math.round(viewBox.zoom * 100)}%</span>
      </div>
      {error && <div className="banner warning">{error}</div>}
      {connectFrom && (
        <div className="banner info">Click a second shape to connect.</div>
      )}
      <svg
        ref={svgRef}
        className={`canvas-svg tool-${tool}`}
        onMouseDown={onCanvasMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--edge-color)" />
          </marker>
        </defs>
        <g
          transform={`scale(${viewBox.zoom}) translate(${-viewBox.x}, ${-viewBox.y})`}
        >
          {edges.map((edge) => (
            <EdgeShape
              key={edge.id}
              edge={edge}
              cells={vertices}
              selected={selected === edge.id}
              onMouseDown={(e) => onCellMouseDown(e, edge)}
            />
          ))}
          {vertices.map((cell) => (
            <VertexShape
              key={cell.id}
              cell={cell}
              selected={selected === cell.id}
              connectCandidate={tool === "connector"}
              connectFrom={connectFrom === cell.id}
              editing={editingLabel === cell.id}
              onMouseDown={(e) => onCellMouseDown(e, cell)}
              onDoubleClick={() => onCellDoubleClick(cell)}
              onResizeMouseDown={(e) => onResizeMouseDown(e, cell)}
              onLabelCommit={(label) => {
                setEditingLabel(null);
                if (label !== cell.label) void apply([{ op: "update_cell", cell: { ...cell, label } }]);
              }}
            />
          ))}
        </g>
      </svg>
      {selectedCell && (
        <div className="canvas-inspector">
          <span className="muted small">{selectedCell.kind}</span>
          <button className="small danger" onClick={deleteSelected}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function VertexShape({
  cell,
  selected,
  connectCandidate,
  connectFrom,
  editing,
  onMouseDown,
  onDoubleClick,
  onResizeMouseDown,
  onLabelCommit,
}: {
  cell: SceneCell;
  selected: boolean;
  connectCandidate: boolean;
  connectFrom: boolean;
  editing: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onResizeMouseDown: (e: React.MouseEvent) => void;
  onLabelCommit: (label: string) => void;
}) {
  const g = cell.geometry ?? { x: 0, y: 0, width: 120, height: 60 };
  const cls = `cell cell-${cell.kind} ${selected ? "selected" : ""} ${
    connectCandidate ? "connectable" : ""
  } ${connectFrom ? "connect-from" : ""}`;

  let shape: JSX.Element;
  switch (cell.kind) {
    case "ellipse":
      shape = (
        <ellipse cx={g.x + g.width / 2} cy={g.y + g.height / 2} rx={g.width / 2} ry={g.height / 2} />
      );
      break;
    case "diamond":
      shape = (
        <polygon
          points={`${g.x + g.width / 2},${g.y} ${g.x + g.width},${g.y + g.height / 2} ${
            g.x + g.width / 2
          },${g.y + g.height} ${g.x},${g.y + g.height / 2}`}
        />
      );
      break;
    case "frame":
      shape = <rect x={g.x} y={g.y} width={g.width} height={g.height} rx={2} />;
      break;
    default:
      shape = <rect x={g.x} y={g.y} width={g.width} height={g.height} rx={cell.kind === "sticky" ? 2 : 8} />;
  }

  return (
    <g className={cls} onMouseDown={onMouseDown} onDoubleClick={onDoubleClick}>
      {shape}
      {editing ? (
        <foreignObject x={g.x} y={g.y} width={g.width} height={g.height}>
          <input
            className="cell-label-input"
            defaultValue={cell.label}
            autoFocus
            onBlur={(e) => onLabelCommit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") onLabelCommit(cell.label);
              e.stopPropagation();
            }}
            onMouseDown={(e) => e.stopPropagation()}
          />
        </foreignObject>
      ) : (
        <text
          x={g.x + g.width / 2}
          y={cell.kind === "frame" ? g.y + 16 : g.y + g.height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {cell.label}
        </text>
      )}
      {(cell.kind === "note_link" || cell.kind === "database_link") && (
        <text
          className="cell-sub"
          x={g.x + g.width / 2}
          y={g.y + g.height / 2 + 16}
          textAnchor="middle"
        >
          {cell.kind === "note_link" ? "📄 note" : "🗃️ database"}
        </text>
      )}
      {selected && (
        <rect
          className="resize-handle"
          x={g.x + g.width - 6}
          y={g.y + g.height - 6}
          width={12}
          height={12}
          onMouseDown={onResizeMouseDown}
        />
      )}
    </g>
  );
}

function EdgeShape({
  edge,
  cells,
  selected,
  onMouseDown,
}: {
  edge: SceneCell;
  cells: SceneCell[];
  selected: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const source = cells.find((c) => c.id === edge.source);
  const target = cells.find((c) => c.id === edge.target);
  if (!source?.geometry || !target?.geometry) return null;
  const s = source.geometry;
  const t = target.geometry;
  const x1 = s.x + s.width / 2;
  const y1 = s.y + s.height / 2;
  const x2 = t.x + t.width / 2;
  const y2 = t.y + t.height / 2;
  // Trim ends at the bounding boxes so the arrowhead is visible.
  const trim = (
    fx: number,
    fy: number,
    tx: number,
    ty: number,
    box: { x: number; y: number; width: number; height: number },
  ) => {
    const dx = tx - fx;
    const dy = ty - fy;
    const len = Math.hypot(dx, dy) || 1;
    const half = Math.min(box.width, box.height) / 2;
    return { x: fx + (dx / len) * half, y: fy + (dy / len) * half };
  };
  const p1 = trim(x1, y1, x2, y2, s);
  const p2 = trim(x2, y2, x1, y1, t);

  return (
    <g className={`edge ${selected ? "selected" : ""}`} onMouseDown={onMouseDown}>
      <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} markerEnd="url(#arrow)" />
      <line className="edge-hit" x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} />
    </g>
  );
}

/**
 * Minimal client-side reader for the deterministic XML our own core emits —
 * enough to render; the core remains the only writer.
 */
function parseSceneFromXml(xml: string): Scene {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const diagram = doc.querySelector("diagram");
  const cells: SceneCell[] = [];
  doc.querySelectorAll("mxCell").forEach((el) => {
    const id = el.getAttribute("id") ?? "";
    if (id === "0" || id === "1") return;
    const style = el.getAttribute("style") ?? "";
    const isEdge = el.getAttribute("edge") === "1";
    const wsType = el.getAttribute("data-workspace-type");
    let kind: CellKind = "unknown";
    if (wsType === "note-link") kind = "note_link";
    else if (wsType === "database-link") kind = "database_link";
    else if (isEdge) kind = "connector";
    else if (style.startsWith("shape=note")) kind = "sticky";
    else if (style.startsWith("shape=frame")) kind = "frame";
    else if (style.startsWith("text")) kind = "text";
    else if (style.startsWith("ellipse")) kind = "ellipse";
    else if (style.startsWith("rhombus")) kind = "diamond";
    else kind = "rectangle";

    const geoEl = el.querySelector("mxGeometry");
    const geometry =
      geoEl && !isEdge
        ? {
            x: Number(geoEl.getAttribute("x") ?? 0),
            y: Number(geoEl.getAttribute("y") ?? 0),
            width: Number(geoEl.getAttribute("width") ?? 0),
            height: Number(geoEl.getAttribute("height") ?? 0),
          }
        : undefined;

    cells.push({
      id,
      kind,
      label: el.getAttribute("value") ?? "",
      geometry,
      parent:
        el.getAttribute("parent") && el.getAttribute("parent") !== "1"
          ? el.getAttribute("parent")!
          : undefined,
      source: el.getAttribute("source") ?? undefined,
      target: el.getAttribute("target") ?? undefined,
      style: style || undefined,
      href: el.getAttribute("data-workspace-href") ?? undefined,
      view: el.getAttribute("data-workspace-view") ?? undefined,
    });
  });
  return {
    id: diagram?.getAttribute("id") ?? "",
    name: diagram?.getAttribute("name") ?? "",
    cells,
  };
}
