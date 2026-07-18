import { useEffect, useMemo, useState } from "react";
import { api, LinkGraph } from "../api";
import { useStore } from "../store";
import { resourcePath, resourceViewForPath, titleForPath, type GraphViewState } from "../workspace";

interface LaidNode {
  path: string;
  title: string;
  kind: string;
  x: number;
  y: number;
}

/** Link-explorer graph (FR-SRCH-006): local graph around the active file, or
 * the whole vault. Simple force layout computed synchronously — vault-local
 * graphs are small. */
export default function GraphPanel() {
  const open = useStore((s) => s.graphOpen);
  const setOpen = useStore((s) => s.setGraphOpen);
  const activeResourcePath = useStore((s) => {
    const pane = s.workspace.panes[s.workspace.focusedPaneId];
    return pane ? resourcePath(s.workspace.tabs[pane.activeTabId].view) : undefined;
  });

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal graph-panel" onClick={(e) => e.stopPropagation()}>
        <GraphWorkspaceView
          centerPath={activeResourcePath}
          active={open}
          onClose={() => setOpen(false)}
        />
      </div>
    </div>
  );
}

export interface GraphWorkspaceViewProps {
  /** Note to focus the local graph around. Non-note paths show an unfocused graph. */
  centerPath?: string | null;
  /** Inactive workspace tabs retain their graph without issuing requests. */
  active?: boolean;
  /** Used by the legacy modal; workspace tabs normally omit this. */
  onClose?: () => void;
  location?: GraphViewState;
  onLocationChange?: (location: GraphViewState) => void;
}

/** Embeddable graph view for a workspace leaf. */
export function GraphWorkspaceView({
  centerPath = null,
  active = true,
  onClose,
  location,
  onLocationChange,
}: GraphWorkspaceViewProps) {
  const openResource = useStore((s) => s.openWorkspaceResource);
  const [graph, setGraph] = useState<LinkGraph | null>(null);
  const [center, setCenter] = useState<string | null>(() => location?.centerPath ?? notePath(centerPath));
  const [wholeVault, setWholeVault] = useState(location?.wholeVault ?? false);

  useEffect(() => {
    if (!active) return;
    setCenter(location?.centerPath ?? notePath(centerPath));
    setWholeVault(location?.wholeVault ?? false);
  }, [active, centerPath, location?.centerPath, location?.wholeVault]);

  useEffect(() => {
    if (!active || !onLocationChange) return;
    const timer = window.setTimeout(() => onLocationChange({ centerPath: center, wholeVault }), 120);
    return () => window.clearTimeout(timer);
  }, [active, center, onLocationChange, wholeVault]);

  useEffect(() => {
    if (!active) return;
    let current = true;
    api
      .linkGraph(wholeVault ? undefined : (center ?? undefined), 2)
      .then((next) => {
        if (current) setGraph(next);
      })
      .catch(() => {
        if (current) setGraph(null);
      });
    return () => {
      current = false;
    };
  }, [active, center, wholeVault]);

  const layout = useMemo(() => (graph ? runLayout(graph, center) : []), [graph, center]);
  const W = 900;
  const H = 560;

  return (
    <div className="graph-workspace-view">
      <div className="settings-header">
        <h3>
          Graph{" "}
          <span className="muted small">
            {wholeVault ? "whole vault" : center ? titleForPath(center) : "no note focused"}
          </span>
        </h3>
        <span>
          <label className="small muted" style={{ marginRight: onClose ? 10 : 0 }}>
            <input
              type="checkbox"
              checked={wholeVault}
              onChange={(e) => setWholeVault(e.target.checked)}
            />{" "}
            Whole vault
          </label>
          {onClose ? (
            <button className="small" onClick={onClose} aria-label="Close graph">
              ✕
            </button>
          ) : null}
        </span>
      </div>
      {!graph || layout.length === 0 ? (
        <div className="placeholder muted" style={{ height: H }}>
          No links yet — link notes with [[wiki links]] to grow the graph.
        </div>
      ) : (
        <svg className="graph-svg" viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
          {graph.edges.map((e, i) => {
            const a = layout.find((n) => n.path === e.source);
            const b = layout.find((n) => n.path === e.target);
            if (!a || !b) return null;
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="graph-edge" />;
          })}
          {layout.map((n) => (
            <g
              key={n.path}
              transform={`translate(${n.x},${n.y})`}
              className={`graph-node kind-${n.kind} ${n.path === center ? "center" : ""}`}
              onClick={() => {
                void openResource(resourceViewForPath(n.path));
                if (n.path.endsWith(".md")) setCenter(n.path);
              }}
            >
              <circle r={n.path === center ? 9 : 6} />
              <text dy={-11}>{n.title || titleForPath(n.path)}</text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

function notePath(path?: string | null): string | null {
  return path?.endsWith(".md") ? path : null;
}

/** Small deterministic force layout: repulsion + spring edges + centering. */
function runLayout(graph: LinkGraph, center: string | null): LaidNode[] {
  const W = 900;
  const H = 560;
  const nodes: LaidNode[] = graph.nodes.map((n, i) => {
    // Deterministic initial ring placement (no RNG → stable layout).
    const angle = (i / Math.max(1, graph.nodes.length)) * Math.PI * 2;
    const r = n.path === center ? 0 : 180 + (i % 5) * 28;
    return {
      path: n.path,
      title: n.title,
      kind: n.kind,
      x: W / 2 + Math.cos(angle) * r,
      y: H / 2 + Math.sin(angle) * r,
    };
  });
  const index = new Map(nodes.map((n, i) => [n.path, i]));
  const edges = graph.edges
    .map((e) => [index.get(e.source), index.get(e.target)] as const)
    .filter((pair): pair is readonly [number, number] => pair[0] != null && pair[1] != null);

  for (let iter = 0; iter < 250; iter++) {
    const fx = new Array(nodes.length).fill(0);
    const fy = new Array(nodes.length).fill(0);
    // Repulsion.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let dx = nodes[i].x - nodes[j].x;
        let dy = nodes[i].y - nodes[j].y;
        const d2 = Math.max(64, dx * dx + dy * dy);
        const f = 5200 / d2;
        const d = Math.sqrt(d2);
        dx /= d;
        dy /= d;
        fx[i] += dx * f;
        fy[i] += dy * f;
        fx[j] -= dx * f;
        fy[j] -= dy * f;
      }
    }
    // Springs.
    for (const [a, b] of edges) {
      const dx = nodes[b].x - nodes[a].x;
      const dy = nodes[b].y - nodes[a].y;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const f = (d - 110) * 0.02;
      fx[a] += (dx / d) * f;
      fy[a] += (dy / d) * f;
      fx[b] -= (dx / d) * f;
      fy[b] -= (dy / d) * f;
    }
    // Centering + integrate.
    for (let i = 0; i < nodes.length; i++) {
      fx[i] += (W / 2 - nodes[i].x) * 0.005;
      fy[i] += (H / 2 - nodes[i].y) * 0.005;
      nodes[i].x = Math.min(W - 30, Math.max(30, nodes[i].x + fx[i]));
      nodes[i].y = Math.min(H - 24, Math.max(24, nodes[i].y + fy[i]));
    }
  }
  return nodes;
}
