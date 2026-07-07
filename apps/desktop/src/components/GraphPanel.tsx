import { useEffect, useMemo, useState } from "react";
import { api, LinkGraph } from "../api";
import { useStore, titleOfPath, kindOfPath } from "../store";

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
  const activePath = useStore((s) => s.activePath);
  const openTab = useStore((s) => s.openTab);

  const [graph, setGraph] = useState<LinkGraph | null>(null);
  const [center, setCenter] = useState<string | null>(null);
  const [wholeVault, setWholeVault] = useState(false);

  useEffect(() => {
    if (open) setCenter(activePath && activePath.endsWith(".md") ? activePath : null);
  }, [open, activePath]);

  useEffect(() => {
    if (!open) return;
    api
      .linkGraph(wholeVault ? undefined : (center ?? undefined), 2)
      .then(setGraph)
      .catch(() => setGraph(null));
  }, [open, center, wholeVault]);

  const layout = useMemo(() => (graph ? runLayout(graph, center) : []), [graph, center]);

  if (!open) return null;

  const W = 900;
  const H = 560;

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal graph-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h3>
            Graph{" "}
            <span className="muted small">
              {wholeVault ? "whole vault" : center ? titleOfPath(center) : "no note focused"}
            </span>
          </h3>
          <span>
            <label className="small muted" style={{ marginRight: 10 }}>
              <input
                type="checkbox"
                checked={wholeVault}
                onChange={(e) => setWholeVault(e.target.checked)}
              />{" "}
              Whole vault
            </label>
            <button className="small" onClick={() => setOpen(false)}>
              ✕
            </button>
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
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className="graph-edge"
                />
              );
            })}
            {layout.map((n) => (
              <g
                key={n.path}
                transform={`translate(${n.x},${n.y})`}
                className={`graph-node kind-${n.kind} ${n.path === center ? "center" : ""}`}
                onClick={() => {
                  openTab({
                    path: n.path,
                    kind: kindOfPath(n.path),
                    title: titleOfPath(n.path),
                  });
                  if (n.path.endsWith(".md")) setCenter(n.path);
                }}
              >
                <circle r={n.path === center ? 9 : 6} />
                <text dy={-11}>{n.title || titleOfPath(n.path)}</text>
              </g>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
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
