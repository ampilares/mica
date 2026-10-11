import { useCallback, useEffect, useRef, useState } from "react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { api, CanvasOp, CellKind, Scene, SceneCell, isApiError } from "../api";
import { docEvents } from "../docEvents";
import { useStore, kindOfPath, titleOfPath } from "../store";
import { relativeTo } from "../editor/paths";
import "./CanvasView.css";

type Tool =
  | "select"
  | "hand"
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "text"
  | "sticky"
  | "connector"
  | "frame"
  | "pen";

const SHAPE_DEFAULT_SIZE: Record<string, { w: number; h: number }> = {
  rectangle: { w: 180, h: 80 },
  ellipse: { w: 160, h: 100 },
  diamond: { w: 160, h: 120 },
  text: { w: 200, h: 40 },
  sticky: { w: 180, h: 140 },
  frame: { w: 480, h: 320 },
};

/** Fixed palette for the style panel (FR21-EDG-001). Canvas content colors are
 * data (persisted into draw.io style strings), not theme tokens — hex is
 * correct here. */
const STYLE_PALETTE = [
  "#1A1A1A",
  "#E03131",
  "#F08C00",
  "#F1C21B",
  "#2F9E44",
  "#1971C2",
  "#7048E8",
  "#FFFFFF",
];

const MINDMAP_NODE = { w: 160, h: 40 };

/** Parse a draw.io style string into a key→value map (bare flag tokens ignored). */
function parseStyleMap(style?: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const token of (style ?? "").split(";")) {
    const eq = token.indexOf("=");
    if (eq > 0) map[token.slice(0, eq)] = token.slice(eq + 1);
  }
  return map;
}

/** Merge key/value updates into a style string without clobbering unknown
 * keys — mirrors `mica_drawio::merge_style`. Preserves bare tokens + order,
 * updates existing keys in place, appends new ones, ends with a trailing ';'. */
function mergeStyle(base: string | undefined, updates: Record<string, string>): string {
  const applied = new Set<string>();
  const out: string[] = [];
  for (const token of (base ?? "").split(";")) {
    if (!token) continue;
    const eq = token.indexOf("=");
    if (eq > 0) {
      const key = token.slice(0, eq);
      if (key in updates) {
        out.push(`${key}=${updates[key]}`);
        applied.add(key);
        continue;
      }
    }
    out.push(token);
  }
  for (const [k, v] of Object.entries(updates)) if (!applied.has(k)) out.push(`${k}=${v}`);
  return out.join(";") + ";";
}

/** Extract the polyline points of a pen stroke from its style string. */
function penPointsFromStyle(style?: string): { x: number; y: number }[] {
  const m = /points=([^;]*)/.exec(style ?? "");
  if (!m || !m[1]) return [];
  return m[1]
    .trim()
    .split(/\s+/)
    .map((p) => {
      const [x, y] = p.split(",").map(Number);
      return { x, y };
    })
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

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

/** Frames in stable presentation order (FR2-EDG-002): top-to-bottom, then
 * left-to-right by frame geometry; ties fall back to scene order (stable
 * sort). Used by both the frames panel and presentation stepping. */
function frameOrder(cells: SceneCell[]): SceneCell[] {
  return cells
    .filter((c) => c.kind === "frame" && c.geometry)
    .sort((a, b) => a.geometry!.y - b.geometry!.y || a.geometry!.x - b.geometry!.x);
}

/** Absolute geometry of a cell, resolving one level of group parenting
 * (group members store geometry relative to the group origin, FR21-EDG-002). */
function resolveGeom(
  cell: SceneCell,
  byId: Map<string, SceneCell>,
): SceneCell["geometry"] {
  const g = cell.geometry;
  if (!g) return undefined;
  const p = cell.parent ? byId.get(cell.parent) : undefined;
  if (p && p.kind === "group" && p.geometry) {
    return { x: g.x + p.geometry.x, y: g.y + p.geometry.y, width: g.width, height: g.height };
  }
  return g;
}

function ExportMenu({
  onExport,
}: {
  onExport: (format: "svg" | "png" | "obsidian" | "excalidraw") => void;
}) {
  const [open, setOpen] = useState(false);
  const pick = (f: "svg" | "png" | "obsidian" | "excalidraw") => {
    setOpen(false);
    onExport(f);
  };
  return (
    <span className="menu-anchor">
      <button className="small" onClick={() => setOpen(!open)}>
        Export ▾
      </button>
      {open && (
        <div className="dropdown" onMouseLeave={() => setOpen(false)}>
          <button onClick={() => pick("png")}>PNG image…</button>
          <button onClick={() => pick("svg")}>SVG image…</button>
          <button onClick={() => pick("obsidian")}>Obsidian Canvas…</button>
          <button onClick={() => pick("excalidraw")}>Excalidraw…</button>
        </div>
      )}
    </span>
  );
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
  const [framesPanelOpen, setFramesPanelOpen] = useState(false);
  // Presentation step index (FR2-EDG-002 P1); null = not presenting.
  const [presentIndex, setPresentIndex] = useState<number | null>(null);
  // Live pen stroke points in world coords while drawing (FR21-EDG-003).
  const [penPoints, setPenPoints] = useState<{ x: number; y: number }[] | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef(path);
  pathRef.current = path;
  const versionRef = useRef(version);
  versionRef.current = version;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  // Source of truth for the in-progress pen stroke (state mirrors it for
  // rendering; the ref stays accurate for the commit on mouse-up).
  const penRef = useRef<{ x: number; y: number }[]>([]);

  const dragState = useRef<{
    mode: "move" | "pan" | "resize" | "marquee" | "pen";
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
   * cells, and — for frames — every cell geometrically inside the frame.
   * Group members are excluded: moving the group cell (which stores absolute
   * geometry) carries them along because their geometry is group-relative
   * (FR21-EDG-002). */
  const dragGroup = (cell: SceneCell): SceneCell[] => {
    const s = sceneRef.current;
    if (!s) return [cell];
    const byId = new Map(s.cells.map((c) => [c.id, c]));
    const isGroupedMember = (c: SceneCell) =>
      c.parent != null && byId.get(c.parent)?.kind === "group";
    const ids = new Set<string>(
      selectedRef.current.has(cell.id) ? selectedRef.current : [cell.id],
    );
    for (const id of [...ids]) {
      const c = byId.get(id);
      if (c?.kind === "frame" && c.geometry) {
        const f = c.geometry;
        for (const other of s.cells) {
          if (other.id === c.id || !other.geometry || other.kind === "connector") continue;
          if (isGroupedMember(other)) continue;
          const g = resolveGeom(other, byId)!;
          const cx = g.x + g.width / 2;
          const cy = g.y + g.height / 2;
          if (cx >= f.x && cx <= f.x + f.width && cy >= f.y && cy <= f.y + f.height) {
            ids.add(other.id);
          }
        }
      }
    }
    return s.cells.filter(
      (c) => ids.has(c.id) && c.geometry != null && !isGroupedMember(c),
    );
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
    if (tool === "pen") {
      const { x, y } = toWorld(e.clientX, e.clientY);
      dragState.current = { mode: "pen", startX: x, startY: y };
      penRef.current = [{ x, y }];
      setPenPoints([{ x, y }]);
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

  const onCellMouseDown = (e: React.MouseEvent, rawCell: SceneCell) => {
    e.stopPropagation();
    // Clicking a group member selects/drags the whole group (draw.io behavior).
    const s0 = sceneRef.current;
    let cell = rawCell;
    if (s0 && rawCell.parent) {
      const p = s0.cells.find((c) => c.id === rawCell.parent);
      if (p?.kind === "group") cell = p;
    }
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
    if (drag.mode === "pen") {
      // Throttle to ~4px of movement to keep strokes compact.
      const pts = penRef.current;
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(x - last.x, y - last.y) >= 4) {
        penRef.current = [...pts, { x, y }];
        setPenPoints(penRef.current);
      }
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
        const byId = new Map(scene.cells.map((c) => [c.id, c]));
        const hit = scene.cells
          .filter((c) => c.geometry && c.kind !== "connector")
          // Group members are represented by their group, not selected directly.
          .filter((c) => !(c.parent && byId.get(c.parent)?.kind === "group"))
          .filter((c) => {
            const g = resolveGeom(c, byId)!;
            return g.x >= minX && g.x + g.width <= maxX && g.y >= minY && g.y + g.height <= maxY;
          })
          .map((c) => c.id);
        if (hit.length) setSelected(new Set(hit));
      }
      return;
    }
    if (drag.mode === "pen") {
      const pts = penRef.current;
      penRef.current = [];
      setPenPoints(null);
      if (pts.length >= 2) {
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const width = Math.max(1, Math.max(...xs) - minX);
        const height = Math.max(1, Math.max(...ys) - minY);
        const pointStr = pts.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(" ");
        const cell: SceneCell = {
          id: newCellId("pen"),
          kind: "pen",
          label: "",
          geometry: { x: Math.round(minX), y: Math.round(minY), width: Math.round(width), height: Math.round(height) },
          style: `shape=mica-pen;points=${pointStr};strokeColor=#1A1A1A;strokeWidth=2;`,
        };
        void apply([{ op: "add_stroke", cell }]);
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
    const byId = new Map(scene.cells.map((c) => [c.id, c]));
    const boxes = scene.cells
      .filter((c) => c.geometry && !(c.parent && byId.get(c.parent)?.kind === "group"))
      .map((c) => resolveGeom(c, byId)!);
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

  /** Zoom the viewport to one frame's bounds (FR-CAN-008). */
  const zoomToRect = (g: { x: number; y: number; width: number; height: number }) => {
    if (!svgRef.current) return;
    const pad = 40;
    const rect = svgRef.current.getBoundingClientRect();
    const zoom = Math.min(
      4,
      Math.max(0.1, Math.min(rect.width / (g.width + pad * 2), rect.height / (g.height + pad * 2))),
    );
    setViewBox({
      zoom,
      x: g.x - (rect.width / zoom - g.width) / 2,
      y: g.y - (rect.height / zoom - g.height) / 2,
    });
  };

  /** Zoom by a factor about the canvas center, reusing the same viewBox
   * transform as wheel-zoom (FR2-EDG-001 zoom cluster). */
  const zoomBy = (factor: number) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    setViewBox((v) => {
      const zoom = Math.min(4, Math.max(0.1, v.zoom * factor));
      const cx = rect.width / 2 / v.zoom + v.x;
      const cy = rect.height / 2 / v.zoom + v.y;
      return { zoom, x: cx - rect.width / 2 / zoom, y: cy - rect.height / 2 / zoom };
    });
  };

  /** Standalone SVG of the current scene: DOM clone + inlined styles. */
  const buildExportSvg = (): string | null => {
    const src = svgRef.current;
    const s = sceneRef.current;
    if (!src || !s) return null;
    const clone = src.cloneNode(true) as SVGSVGElement;
    const srcEls = src.querySelectorAll<SVGElement>("*");
    const cloneEls = clone.querySelectorAll<SVGElement>("*");
    const KEEP = [
      "fill",
      "stroke",
      "stroke-width",
      "stroke-dasharray",
      "font-size",
      "font-family",
      "font-weight",
      "opacity",
      "text-anchor",
      "dominant-baseline",
    ];
    srcEls.forEach((el, i) => {
      const target = cloneEls[i];
      if (!target) return;
      const cs = getComputedStyle(el);
      const style = KEEP.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";");
      target.setAttribute("style", style);
    });
    // Strip interaction-only artifacts.
    clone.querySelectorAll(".marquee, .handle, foreignObject").forEach((el) => el.remove());
    // Frame the content.
    const byId = new Map(s.cells.map((c) => [c.id, c]));
    const boxes = s.cells
      .filter((c) => c.geometry && !(c.parent && byId.get(c.parent)?.kind === "group"))
      .map((c) => resolveGeom(c, byId)!);
    if (boxes.length === 0) return null;
    const minX = Math.min(...boxes.map((g) => g.x)) - 40;
    const minY = Math.min(...boxes.map((g) => g.y)) - 40;
    const maxX = Math.max(...boxes.map((g) => g.x + g.width)) + 40;
    const maxY = Math.max(...boxes.map((g) => g.y + g.height)) + 40;
    const w = Math.ceil(maxX - minX);
    const h = Math.ceil(maxY - minY);
    const g = clone.querySelector("g");
    g?.setAttribute("transform", `translate(${-minX}, ${-minY})`);
    clone.setAttribute("viewBox", `0 0 ${w} ${h}`);
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const bg = getComputedStyle(src).backgroundColor;
    return (
      `<svg ${Array.from(clone.attributes).map((a) => `${a.name}="${a.value}"`).join(" ")}>` +
      `<rect width="100%" height="100%" fill="${bg}"/>` +
      clone.innerHTML +
      `</svg>`
    );
  };

  const exportCanvas = async (format: "svg" | "png" | "obsidian" | "excalidraw") => {
    const stem = titleOfPath(pathRef.current);
    if (format === "obsidian" || format === "excalidraw") {
      const ext = format === "obsidian" ? "canvas" : "excalidraw";
      const dest = await saveDialog({
        defaultPath: `${stem}.${ext}`,
        filters: [{ name: format, extensions: [ext] }],
      });
      if (typeof dest !== "string") return;
      await api.canvasExport(pathRef.current, format, dest);
      return;
    }
    const svgText = buildExportSvg();
    if (!svgText) return;
    if (format === "svg") {
      const dest = await saveDialog({
        defaultPath: `${stem}.svg`,
        filters: [{ name: "SVG", extensions: ["svg"] }],
      });
      if (typeof dest !== "string") return;
      await api.exportFile(dest, btoa(unescape(encodeURIComponent(svgText))));
      return;
    }
    // PNG: rasterize the SVG at 2x.
    const dest = await saveDialog({
      defaultPath: `${stem}.png`,
      filters: [{ name: "PNG", extensions: ["png"] }],
    });
    if (typeof dest !== "string") return;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVG rasterization failed"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth * 2;
    canvas.height = img.naturalHeight * 2;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    const dataUrl = canvas.toDataURL("image/png");
    await api.exportFile(dest, dataUrl.split(",")[1]);
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

  // FR21-EDG-002: group the current multi-selection (Ctrl+G).
  const groupSelection = useCallback(() => {
    const s = sceneRef.current;
    if (!s) return;
    const ids = [...selectedRef.current].filter((id) => {
      const c = s.cells.find((x) => x.id === id);
      return c && c.geometry != null && c.kind !== "connector" && c.kind !== "group";
    });
    if (ids.length < 2) return;
    void apply([{ op: "group_cells", ids }]).then(() => {
      const ns = sceneRef.current;
      const grp = ns?.cells.find(
        (c) => c.kind === "group" && ids.every((id) => ns.cells.some((m) => m.id === id && m.parent === c.id)),
      );
      if (grp) setSelected(new Set([grp.id]));
    });
  }, [apply]);

  // FR21-EDG-002: ungroup the selected group cell(s) (Ctrl+Shift+G).
  const ungroupSelection = useCallback(() => {
    const s = sceneRef.current;
    if (!s) return;
    const groups = [...selectedRef.current]
      .map((id) => s.cells.find((c) => c.id === id))
      .filter((c): c is SceneCell => !!c && c.kind === "group");
    if (!groups.length) return;
    const memberIds = s.cells
      .filter((c) => c.parent && groups.some((g) => g.id === c.parent))
      .map((c) => c.id);
    void apply(groups.map((g) => ({ op: "ungroup_cells", id: g.id }) as CanvasOp)).then(() =>
      setSelected(new Set(memberIds)),
    );
  }, [apply]);

  const mindmapNodeIds = (s: Scene) =>
    new Set(s.cells.filter((c) => c.ws_type === "mindmap" && c.kind !== "connector").map((c) => c.id));

  // After a mindmap op, select + label-edit the newly created node.
  const focusNewMindmapNode = useCallback(
    (before: Set<string>) => {
      const ns = sceneRef.current;
      if (!ns) return;
      const created = ns.cells.find(
        (c) => c.ws_type === "mindmap" && c.kind !== "connector" && !before.has(c.id),
      );
      if (created) {
        setSelected(new Set([created.id]));
        setEditingLabel(created.id);
      }
    },
    [],
  );

  // FR21-EDG-004: insert a standalone mind map root at the viewport center.
  const insertMindmapRoot = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 / viewBox.zoom + viewBox.x : 0;
    const cy = rect ? rect.height / 2 / viewBox.zoom + viewBox.y : 0;
    const cell: SceneCell = {
      id: newCellId("node"),
      kind: "rectangle",
      label: "Idea",
      geometry: {
        x: Math.round(cx - MINDMAP_NODE.w / 2),
        y: Math.round(cy - MINDMAP_NODE.h / 2),
        width: MINDMAP_NODE.w,
        height: MINDMAP_NODE.h,
      },
      style: "rounded=1;whiteSpace=wrap;html=1;fillColor=#EEF2FF;strokeColor=#6C8EBF;",
      ws_type: "mindmap",
    };
    void apply([{ op: "add_cell", cell }]).then(() => {
      setSelected(new Set([cell.id]));
      setEditingLabel(cell.id);
    });
  }, [apply, viewBox]);

  const mindmapAddChild = useCallback(
    (parentId: string) => {
      const s = sceneRef.current;
      if (!s) return;
      const before = mindmapNodeIds(s);
      void apply([{ op: "mindmap_add_child", parent_id: parentId, label: "Idea" }]).then(() =>
        focusNewMindmapNode(before),
      );
    },
    [apply, focusNewMindmapNode],
  );

  const mindmapAddSibling = useCallback(
    (siblingId: string) => {
      const s = sceneRef.current;
      if (!s) return;
      const before = mindmapNodeIds(s);
      void apply([{ op: "mindmap_add_sibling", sibling_id: siblingId, label: "Idea" }]).then(() =>
        focusNewMindmapNode(before),
      );
    },
    [apply, focusNewMindmapNode],
  );

  // FR21-EDG-001: merge style keys into every selected cell (never clobbering
  // unknown keys) via update_cell ops.
  const applyStyleUpdate = useCallback(
    (updates: Record<string, string>) => {
      const s = sceneRef.current;
      if (!s) return;
      const ops: CanvasOp[] = [];
      for (const id of selectedRef.current) {
        const cell = s.cells.find((c) => c.id === id);
        if (!cell) continue;
        ops.push({ op: "update_cell", cell: { ...cell, style: mergeStyle(cell.style, updates) } });
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
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "g") {
        // FR21-EDG-002: Ctrl+G group / Ctrl+Shift+G ungroup.
        e.preventDefault();
        if (e.shiftKey) ungroupSelection();
        else groupSelection();
      } else if ((e.key === "Tab" || e.key === "Enter") && !editingLabel && selectedRef.current.size === 1) {
        // FR21-EDG-004: grow the mind map from the selected node.
        const s = sceneRef.current;
        const id = [...selectedRef.current][0];
        const cell = s?.cells.find((c) => c.id === id);
        if (cell && cell.ws_type === "mindmap" && cell.kind !== "connector") {
          e.preventDefault();
          if (e.key === "Tab") mindmapAddChild(id);
          else mindmapAddSibling(id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    active,
    editingLabel,
    deleteSelected,
    duplicateSelected,
    groupSelection,
    ungroupSelection,
    mindmapAddChild,
    mindmapAddSibling,
  ]);

  // Presentation mode (FR2-EDG-002 P1): fit the current frame on every step
  // change and, while active, own Arrow/Escape via a scoped listener that is
  // removed on exit.
  useEffect(() => {
    if (presentIndex === null) return;
    const frames = frameOrder(sceneRef.current?.cells ?? []);
    const f = frames[presentIndex];
    if (f?.geometry) zoomToRect(f.geometry);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        setPresentIndex((i) => Math.min((i ?? 0) + 1, frames.length - 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setPresentIndex((i) => Math.max((i ?? 0) - 1, 0));
      } else if (e.key === "Escape") {
        e.preventDefault();
        setPresentIndex(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentIndex]);

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
  const frames = frameOrder(scene.cells);
  const presenting = presentIndex !== null;
  // Resolved absolute geometry for every cell (groups offset their members).
  const cellsById = new Map(scene.cells.map((c) => [c.id, c]));
  const geomById = new Map<string, NonNullable<SceneCell["geometry"]>>();
  for (const c of scene.cells) {
    const g = resolveGeom(c, cellsById);
    if (g) geomById.set(c.id, g);
  }
  // Style of the first selected cell drives the panel's active-state markers.
  const selectedCells = scene.cells.filter((c) => selected.has(c.id));
  const styleMap0: Record<string, string> = selectedCells.length
    ? parseStyleMap(selectedCells[0].style)
    : {};

  // Compact glyph + title tooltip; behavior/shortcuts unchanged (FR2-EDG-001).
  const TOOLS: { id: Tool; glyph: string; label: string }[] = [
    { id: "select", glyph: "↖", label: "Select" },
    { id: "hand", glyph: "✋", label: "Hand (pan)" },
    { id: "rectangle", glyph: "▭", label: "Rectangle" },
    { id: "ellipse", glyph: "◯", label: "Ellipse" },
    { id: "diamond", glyph: "◇", label: "Diamond" },
    { id: "text", glyph: "T", label: "Text" },
    { id: "sticky", glyph: "🗒", label: "Sticky note" },
    { id: "connector", glyph: "⇢", label: "Connector" },
    { id: "frame", glyph: "⛶", label: "Frame" },
    { id: "pen", glyph: "✏", label: "Pen (freehand)" },
  ];

  return (
    <div className="canvas-view canvas-edgeless">
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
              geomById={geomById}
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
              geom={geomById.get(cell.id)}
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
          {penPoints && penPoints.length > 1 && (
            <polyline
              className="pen-live"
              points={penPoints.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
            />
          )}
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

      {/* FR21-EDG-001: selection-scoped style panel, top-right. */}
      {!presenting && selectionCount > 0 && (
        <div className="edgeless-float edgeless-style">
          <div className="edgeless-style-row">
            <span className="edgeless-style-label">Fill</span>
            <div className="edgeless-swatches">
              <button
                className={`swatch swatch-none${styleMap0.fillColor === "none" ? " active" : ""}`}
                title="No fill"
                aria-label="No fill"
                onClick={() => applyStyleUpdate({ fillColor: "none" })}
              />
              {STYLE_PALETTE.map((c) => (
                <button
                  key={`fill-${c}`}
                  className={`swatch${styleMap0.fillColor === c ? " active" : ""}`}
                  style={{ background: c }}
                  title={`Fill ${c}`}
                  aria-label={`Fill ${c}`}
                  onClick={() => applyStyleUpdate({ fillColor: c })}
                />
              ))}
            </div>
          </div>
          <div className="edgeless-style-row">
            <span className="edgeless-style-label">Stroke</span>
            <div className="edgeless-swatches">
              {STYLE_PALETTE.map((c) => (
                <button
                  key={`stroke-${c}`}
                  className={`swatch${styleMap0.strokeColor === c ? " active" : ""}`}
                  style={{ background: c }}
                  title={`Stroke ${c}`}
                  aria-label={`Stroke ${c}`}
                  onClick={() => applyStyleUpdate({ strokeColor: c })}
                />
              ))}
            </div>
          </div>
          <div className="edgeless-style-row">
            <span className="edgeless-style-label">Width</span>
            <div className="edgeless-seg">
              {["1", "2", "4"].map((w) => (
                <button
                  key={`w-${w}`}
                  className={styleMap0.strokeWidth === w ? "active" : ""}
                  onClick={() => applyStyleUpdate({ strokeWidth: w })}
                >
                  {w}
                </button>
              ))}
            </div>
            <span className="edgeless-style-label">Text</span>
            <div className="edgeless-seg">
              {[
                ["S", "12"],
                ["M", "16"],
                ["L", "24"],
              ].map(([lbl, v]) => (
                <button
                  key={`t-${v}`}
                  className={styleMap0.fontSize === v ? "active" : ""}
                  onClick={() => applyStyleUpdate({ fontSize: v })}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* FR2-EDG-001: zoom cluster, bottom left. */}
      {!presenting && (
        <div className="edgeless-float edgeless-zoom">
          <button onClick={() => zoomBy(1 / 1.2)} title="Zoom out">
            −
          </button>
          <button
            className="edgeless-pct"
            onClick={() => setViewBox({ x: -100, y: -100, zoom: 1 })}
            title="Reset zoom (Ctrl+0)"
          >
            {Math.round(viewBox.zoom * 100)}%
          </button>
          <button onClick={() => zoomBy(1.2)} title="Zoom in">
            +
          </button>
          <button onClick={zoomToFit} title="Zoom to fit (Ctrl+1)">
            ⤢
          </button>
        </div>
      )}

      {/* FR2-EDG-001: centered pill tool toolbar, bottom center. */}
      {!presenting && (
        <div className="edgeless-float edgeless-tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={tool === t.id ? "active" : ""}
              title={t.label}
              aria-label={t.label}
              onClick={() => {
                setTool(t.id);
                setConnectFrom(null);
              }}
            >
              {t.glyph}
            </button>
          ))}
          <span className="edgeless-sep" />
          <button
            title="Insert mind map node (Tab: child, Enter: sibling)"
            aria-label="Insert mind map"
            onClick={insertMindmapRoot}
          >
            🧠
          </button>
          <button
            className={framesPanelOpen ? "active" : ""}
            title="Frames panel"
            aria-label="Frames panel"
            onClick={() => setFramesPanelOpen((v) => !v)}
          >
            ⊞
          </button>
          <button
            title={frames.length ? "Present frames" : "Add a frame to present"}
            aria-label="Present"
            disabled={frames.length === 0}
            onClick={() => frames.length && setPresentIndex(0)}
          >
            ▷
          </button>
          <ExportMenu onExport={(f) => void exportCanvas(f)} />
        </div>
      )}

      {/* FR2-EDG-002: frames panel overlay, right side. */}
      {!presenting && framesPanelOpen && (
        <div className="edgeless-float edgeless-frames">
          <div className="edgeless-frames-head">
            <span>Frames ({frames.length})</span>
            <button className="icon-button" title="Close" onClick={() => setFramesPanelOpen(false)}>
              ✕
            </button>
          </div>
          <div className="edgeless-frames-list">
            {frames.length === 0 ? (
              <div className="edgeless-empty">No frames yet. Use the Frame tool to add one.</div>
            ) : (
              frames.map((f, i) => (
                <button key={f.id} onClick={() => zoomToRect(f.geometry!)}>
                  <span className="edgeless-frame-idx">{i + 1}</span>
                  <span>{f.label || `Frame ${i + 1}`}</span>
                </button>
              ))
            )}
          </div>
          <div className="edgeless-frames-foot">
            <button disabled={frames.length === 0} onClick={() => setPresentIndex(0)}>
              ▷ Present
            </button>
          </div>
        </div>
      )}

      {/* FR2-EDG-002 P1: presentation controls (Arrow/Esc handled in effect). */}
      {presenting && (
        <div className="edgeless-present">
          <button
            title="Previous (←)"
            disabled={presentIndex === 0}
            onClick={() => setPresentIndex((i) => Math.max((i ?? 0) - 1, 0))}
          >
            ‹
          </button>
          <span className="edgeless-present-count">
            {(presentIndex ?? 0) + 1} / {frames.length}
          </span>
          <button
            title="Next (→)"
            disabled={presentIndex === frames.length - 1}
            onClick={() => setPresentIndex((i) => Math.min((i ?? 0) + 1, frames.length - 1))}
          >
            ›
          </button>
          <button
            className="edgeless-present-exit"
            title="Exit (Esc)"
            onClick={() => setPresentIndex(null)}
          >
            ✕
          </button>
        </div>
      )}

      {!presenting && selectionCount > 0 && (
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
  geom,
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
  geom?: SceneCell["geometry"];
  selected: boolean;
  connectCandidate: boolean;
  connectFrom: boolean;
  editing: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onResizeMouseDown: (e: React.MouseEvent) => void;
  onLabelCommit: (label: string) => void;
}) {
  const g = geom ?? cell.geometry ?? { x: 0, y: 0, width: 120, height: 60 };
  const cls = `cell cell-${cell.kind} ${selected ? "selected" : ""} ${
    connectCandidate ? "connectable" : ""
  } ${connectFrom ? "connect-from" : ""}`;

  // Style-panel keys applied inline (they win over the CSS class defaults).
  // Stroke overrides are suppressed while selected so the accent selection
  // outline stays visible (FR21-EDG-001).
  const sm = parseStyleMap(cell.style);
  const shapeStyle: React.CSSProperties = {};
  if (sm.fillColor) shapeStyle.fill = sm.fillColor;
  if (!selected && sm.strokeColor) shapeStyle.stroke = sm.strokeColor;
  if (!selected && sm.strokeWidth) shapeStyle.strokeWidth = Number(sm.strokeWidth);
  const textStyle: React.CSSProperties = {};
  if (sm.fontSize) textStyle.fontSize = Number(sm.fontSize);

  // Pen strokes render as an absolute polyline from the style points.
  if (cell.kind === "pen") {
    const pts = penPointsFromStyle(cell.style);
    const stroke = sm.strokeColor || "#1A1A1A";
    const sw = sm.strokeWidth ? Number(sm.strokeWidth) : 2;
    return (
      <g className={cls} onMouseDown={onMouseDown} onDoubleClick={onDoubleClick}>
        {selected && (
          <rect
            className="pen-bounds"
            x={g.x - 3}
            y={g.y - 3}
            width={g.width + 6}
            height={g.height + 6}
          />
        )}
        <polyline
          className="cell-pen-line"
          points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={selected ? "var(--accent)" : stroke}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    );
  }

  let shape: JSX.Element;
  switch (cell.kind) {
    case "ellipse":
      shape = (
        <ellipse
          cx={g.x + g.width / 2}
          cy={g.y + g.height / 2}
          rx={g.width / 2}
          ry={g.height / 2}
          style={shapeStyle}
        />
      );
      break;
    case "diamond":
      shape = (
        <polygon
          points={`${g.x + g.width / 2},${g.y} ${g.x + g.width},${g.y + g.height / 2} ${
            g.x + g.width / 2
          },${g.y + g.height} ${g.x},${g.y + g.height / 2}`}
          style={shapeStyle}
        />
      );
      break;
    case "frame":
      shape = <rect x={g.x} y={g.y} width={g.width} height={g.height} rx={2} style={shapeStyle} />;
      break;
    case "group":
      shape = <rect x={g.x} y={g.y} width={g.width} height={g.height} rx={4} style={shapeStyle} />;
      break;
    default:
      shape = (
        <rect
          x={g.x}
          y={g.y}
          width={g.width}
          height={g.height}
          rx={cell.kind === "sticky" ? 2 : 8}
          style={shapeStyle}
        />
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
          style={textStyle}
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
      {selected && cell.kind !== "group" && (
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
  geomById,
  selected,
  onMouseDown,
}: {
  edge: SceneCell;
  geomById: Map<string, NonNullable<SceneCell["geometry"]>>;
  selected: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const s = edge.source ? geomById.get(edge.source) : undefined;
  const t = edge.target ? geomById.get(edge.target) : undefined;
  if (!s || !t) return null;
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
    else if (style.startsWith("shape=mica-pen")) kind = "pen";
    else if (style === "group" || style.startsWith("group;")) kind = "group";
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
      ws_type:
        wsType && wsType !== "note-link" && wsType !== "database-link" ? wsType : undefined,
      ws_parent: el.getAttribute("data-workspace-parent") ?? undefined,
    });
  });
  return {
    id: diagram?.getAttribute("id") ?? "",
    name: diagram?.getAttribute("name") ?? "",
    cells,
  };
}
