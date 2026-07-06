import { useCallback, useEffect, useRef, useState } from "react";
import { api, CanvasOp, CellKind, Scene, SceneCell, isApiError } from "../api";
import { docEvents } from "../docEvents";
import { useStore, kindOfPath, titleOfPath } from "../store";
import { relativeTo } from "../editor/paths";

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
function newCellId(prefix = "shape"): string {
  cellCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${cellCounter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

interface Marquee {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export default function CanvasView({ path, active }: { path: string; active: boolean }) {
  const [scene, setScene] = useState<Scene | null>(null);
  const [version, setVersion] = useState("");
  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [viewBox, setViewBox] = useState({ x: -100, y: -100, zoom: 1 });
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef(path);
  pathRef.current = path;
  const versionRef = useRef(version);
  versionRef.current = version;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const dragState = useRef<{
    mode: "move" | "pan" | "resize" | "marquee";
    cellId?: string;
    startX: number;
    startY: number;
    /** original geometry of every cell being dragged (multi-select + frame contents) */
    origs?: Map<string, { x: number; y: number; width: number; height: number }>;
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

  const updateLocal = (cells: SceneCell[]) => {
    setScene((s) => {
      if (!s) return s;
      const byId = new Map(cells.map((c) => [c.id, c]));
      return { ...s, cells: s.cells.map((c) => byId.get(c.id) ?? c) };
    });
  };

  const toWorld = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / viewBox.zoom + viewBox.x,
      y: (clientY - rect.top) / viewBox.zoom + viewBox.y,
    };
  };

  /** Cells that should move together with `cell`: itself, other selected
   * cells, and — for frames — every cell geometrically inside the frame. */
  const dragGroup = (cell: SceneCell): SceneCell[] => {
    const s = sceneRef.current;
    if (!s) return [cell];
    const ids = new Set<string>(
      selectedRef.current.has(cell.id) ? selectedRef.current : [cell.id],
    );
    for (const id of [...ids]) {
      const c = s.cells.find((x) => x.id === id);
      if (c?.kind === "frame" && c.geometry) {
        const f = c.geometry;
        for (const other of s.cells) {
          if (other.id === c.id || !other.geometry || other.kind === "connector") continue;
          const g = other.geometry;
          const cx = g.x + g.width / 2;
          const cy = g.y + g.height / 2;
          if (cx >= f.x && cx <= f.x + f.width && cy >= f.y && cy <= f.y + f.height) {
            ids.add(other.id);
          }
        }
      }
    }
    return s.cells.filter((c) => ids.has(c.id) && c.geometry != null);
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
      const cell: SceneCell = {
        id: newCellId(),
        kind: tool as CellKind,
        label: tool === "text" ? "Text" : tool === "sticky" ? "Note" : "",
        geometry: {
          x: Math.round(x - size.w / 2),
          y: Math.round(y - size.h / 2),
          width: size.w,
          height: size.h,
        },
      };
      void apply([{ op: "add_cell", cell }]);
      setTool("select");
      setSelected(new Set([cell.id]));
      return;
    }
    if (tool === "select") {
      // Start marquee selection on empty canvas.
      const { x, y } = toWorld(e.clientX, e.clientY);
      dragState.current = { mode: "marquee", startX: x, startY: y };
      setMarquee({ x1: x, y1: y, x2: x, y2: y });
    }
    if (!e.shiftKey) setSelected(new Set());
    setConnectFrom(null);
  };

  const onCellMouseDown = (e: React.MouseEvent, cell: SceneCell) => {
    e.stopPropagation();
    if (tool === "connector") {
      if (!connectFrom) {
        setConnectFrom(cell.id);
      } else if (connectFrom !== cell.id) {
        const edge: SceneCell = {
          id: newCellId("edge"),
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
    setSelected((prev) => {
      if (e.shiftKey) {
        const next = new Set(prev);
        if (next.has(cell.id)) next.delete(cell.id);
        else next.add(cell.id);
        return next;
      }
      return prev.has(cell.id) ? prev : new Set([cell.id]);
    });
    if (cell.geometry) {
      const { x, y } = toWorld(e.clientX, e.clientY);
      // note: selection state updates async; compute group from refs on move
      dragState.current = {
        mode: "move",
        cellId: cell.id,
        startX: x,
        startY: y,
        origs: undefined,
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
    const { x, y } = toWorld(e.clientX, e.clientY);
    if (drag.mode === "marquee") {
      setMarquee({ x1: drag.startX, y1: drag.startY, x2: x, y2: y });
      return;
    }
    const dx = x - drag.startX;
    const dy = y - drag.startY;
    if (drag.mode === "move") {
      const anchor = scene.cells.find((c) => c.id === drag.cellId);
      if (!anchor) return;
      if (!drag.origs) {
        drag.origs = new Map(
          dragGroup(anchor).map((c) => [c.id, { ...c.geometry! }]),
        );
      }
      const moved: SceneCell[] = [];
      for (const [id, orig] of drag.origs) {
        const c = scene.cells.find((x) => x.id === id);
        if (!c) continue;
        moved.push({
          ...c,
          geometry: { ...orig, x: Math.round(orig.x + dx), y: Math.round(orig.y + dy) },
        });
      }
      updateLocal(moved);
    } else if (drag.mode === "resize" && drag.orig) {
      const cell = scene.cells.find((c) => c.id === drag.cellId);
      if (!cell) return;
      updateLocal([
        {
          ...cell,
          geometry: {
            ...drag.orig,
            width: Math.max(24, Math.round(drag.orig.width + dx)),
            height: Math.max(24, Math.round(drag.orig.height + dy)),
          },
        },
      ]);
    }
  };

  const onMouseUp = () => {
    const drag = dragState.current;
    dragState.current = null;
    if (!drag) return;
    if (drag.mode === "marquee") {
      const m = marquee;
      setMarquee(null);
      if (m && scene && (Math.abs(m.x2 - m.x1) > 4 || Math.abs(m.y2 - m.y1) > 4)) {
        const [minX, maxX] = [Math.min(m.x1, m.x2), Math.max(m.x1, m.x2)];
        const [minY, maxY] = [Math.min(m.y1, m.y2), Math.max(m.y1, m.y2)];
        const hit = scene.cells
          .filter((c) => c.geometry && c.kind !== "connector")
          .filter((c) => {
            const g = c.geometry!;
            return g.x >= minX && g.x + g.width <= maxX && g.y >= minY && g.y + g.height <= maxY;
          })
          .map((c) => c.id);
        if (hit.length) setSelected(new Set(hit));
      }
      return;
    }
    if (drag.mode === "pan" || !drag.moved || !scene) return;
    if (drag.mode === "move" && drag.origs) {
      const ops: CanvasOp[] = [];
      for (const id of drag.origs.keys()) {
        const cell = scene.cells.find((c) => c.id === id);
        if (cell) ops.push({ op: "update_cell", cell });
      }
      if (ops.length) void apply(ops);
    } else if (drag.mode === "resize" && drag.cellId) {
      const cell = scene.cells.find((c) => c.id === drag.cellId);
      if (cell) void apply([{ op: "update_cell", cell }]);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setViewBox((v) => {
        const zoom = Math.min(4, Math.max(0.1, v.zoom * factor));
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

  const zoomToFit = () => {
    if (!scene || !svgRef.current) return;
    const boxes = scene.cells.filter((c) => c.geometry).map((c) => c.geometry!);
    if (boxes.length === 0) {
      setViewBox({ x: -100, y: -100, zoom: 1 });
      return;
    }
    const minX = Math.min(...boxes.map((g) => g.x)) - 60;
    const minY = Math.min(...boxes.map((g) => g.y)) - 60;
    const maxX = Math.max(...boxes.map((g) => g.x + g.width)) + 60;
    const maxY = Math.max(...boxes.map((g) => g.y + g.height)) + 60;
    const rect = svgRef.current.getBoundingClientRect();
    const zoom = Math.min(
      4,
      Math.max(0.1, Math.min(rect.width / (maxX - minX), rect.height / (maxY - minY))),
    );
    setViewBox({
      zoom,
      x: minX - (rect.width / zoom - (maxX - minX)) / 2,
      y: minY - (rect.height / zoom - (maxY - minY)) / 2,
    });
  };

  const onCellDoubleClick = (cell: SceneCell) => {
    if ((cell.kind === "note_link" || cell.kind === "database_link") && cell.href) {
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
    const ids = [...selectedRef.current];
    if (ids.length) {
      void apply(ids.map((id) => ({ op: "remove_cell", id }) as CanvasOp));
      setSelected(new Set());
    }
  }, [apply]);

  const duplicateSelected = useCallback(() => {
    const s = sceneRef.current;
    if (!s) return;
    const ops: CanvasOp[] = [];
    const newIds: string[] = [];
    for (const id of selectedRef.current) {
      const cell = s.cells.find((c) => c.id === id);
      if (!cell || cell.kind === "connector") continue;
      const copy: SceneCell = {
        ...cell,
        id: newCellId(),
        geometry: cell.geometry
          ? { ...cell.geometry, x: cell.geometry.x + 24, y: cell.geometry.y + 24 }
          : undefined,
      };
      newIds.push(copy.id);
      ops.push({ op: "add_cell", cell: copy });
    }
    if (ops.length) {
      void apply(ops).then(() => setSelected(new Set(newIds)));
    }
  }, [apply]);

  const reorderSelected = useCallback(
    (toFront: boolean) => {
      const s = sceneRef.current;
      if (!s) return;
      const ops: CanvasOp[] = [];
      for (const id of selectedRef.current) {
        ops.push({ op: "reorder_cell", id, to_index: toFront ? s.cells.length : 0 });
      }
      if (ops.length) void apply(ops);
    },
    [apply],
  );

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.getAttribute("contenteditable"))) {
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedRef.current.size && !editingLabel) {
        deleteSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "d") {
        e.preventDefault();
        duplicateSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "0") {
        e.preventDefault();
        setViewBox({ x: -100, y: -100, zoom: 1 });
      } else if ((e.ctrlKey || e.metaKey) && e.key === "1") {
        e.preventDefault();
        zoomToFit();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        const s = sceneRef.current;
        if (s) setSelected(new Set(s.cells.filter((c) => c.kind !== "connector").map((c) => c.id)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, editingLabel, deleteSelected, duplicateSelected]);

  // Drop a note/database dragged from the sidebar → link cell.
  const onDrop = (e: React.DragEvent) => {
    const dropped = e.dataTransfer.getData("application/x-mica-path");
    if (!dropped) return;
    e.preventDefault();
    const kind = kindOfPath(dropped);
    if (kind !== "note" && kind !== "database") return;
    const { x, y } = toWorld(e.clientX, e.clientY);
    const cell: SceneCell = {
      id: newCellId(),
      kind: kind === "note" ? "note_link" : "database_link",
      label: titleOfPath(dropped),
      href: relativeTo(pathRef.current, dropped),
      view: kind === "database" ? "table_default" : undefined,
      geometry: { x: Math.round(x - 100), y: Math.round(y - 45), width: 200, height: 90 },
    };
    void apply([{ op: "add_cell", cell }]);
  };

  if (error && !scene) return <div className="placeholder error">{error}</div>;
  if (!scene) return <div className="placeholder muted">Loading…</div>;

  const vertices = scene.cells.filter((c) => c.kind !== "connector");
  const edges = scene.cells.filter((c) => c.kind === "connector");
  const selectionCount = selected.size;

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
        <button onClick={zoomToFit} title="Zoom to fit (Ctrl+1)">
          Fit
        </button>
        <button
          onClick={() => setViewBox({ x: -100, y: -100, zoom: 1 })}
          title="Reset zoom (Ctrl+0)"
        >
          100%
        </button>
        <span className="muted small">{Math.round(viewBox.zoom * 100)}%</span>
      </div>
      {error && <div className="banner warning">{error}</div>}
      {connectFrom && <div className="banner info">Click a second shape to connect.</div>}
      <svg
        ref={svgRef}
        className={`canvas-svg tool-${tool}`}
        onMouseDown={onCanvasMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("application/x-mica-path")) e.preventDefault();
        }}
        onDrop={onDrop}
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
        <g transform={`scale(${viewBox.zoom}) translate(${-viewBox.x}, ${-viewBox.y})`}>
          {edges.map((edge) => (
            <EdgeShape
              key={edge.id}
              edge={edge}
              cells={vertices}
              selected={selected.has(edge.id)}
              onMouseDown={(e) => {
                e.stopPropagation();
                setSelected(new Set([edge.id]));
              }}
            />
          ))}
          {vertices.map((cell) => (
            <VertexShape
              key={cell.id}
              cell={cell}
              selected={selected.has(cell.id)}
              connectCandidate={tool === "connector"}
              connectFrom={connectFrom === cell.id}
              editing={editingLabel === cell.id}
              onMouseDown={(e) => onCellMouseDown(e, cell)}
              onDoubleClick={() => onCellDoubleClick(cell)}
              onResizeMouseDown={(e) => onResizeMouseDown(e, cell)}
              onLabelCommit={(label) => {
                setEditingLabel(null);
                if (label !== cell.label)
                  void apply([{ op: "update_cell", cell: { ...cell, label } }]);
              }}
            />
          ))}
          {marquee && (
            <rect
              className="marquee"
              x={Math.min(marquee.x1, marquee.x2)}
              y={Math.min(marquee.y1, marquee.y2)}
              width={Math.abs(marquee.x2 - marquee.x1)}
              height={Math.abs(marquee.y2 - marquee.y1)}
            />
          )}
        </g>
      </svg>
      {selectionCount > 0 && (
        <div className="canvas-inspector">
          <span className="muted small">
            {selectionCount === 1
              ? scene.cells.find((c) => selected.has(c.id))?.kind
              : `${selectionCount} selected`}
          </span>
          <button className="small" onClick={() => reorderSelected(true)} title="Bring to front">
            ⬆ Front
          </button>
          <button className="small" onClick={() => reorderSelected(false)} title="Send to back">
            ⬇ Back
          </button>
          <button className="small" onClick={duplicateSelected} title="Duplicate (Ctrl+D)">
            ⧉
          </button>
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
      shape = (
        <rect x={g.x} y={g.y} width={g.width} height={g.height} rx={cell.kind === "sticky" ? 2 : 8} />
      );
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
  const trim = (
    fx: number,
    fy: number,
    tx: number,
    ty: number,
    box: { width: number; height: number },
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

/** Minimal client-side reader for the deterministic XML our core emits. */
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
