import { useCallback } from "react";
import { useStore } from "../../store";
import type { WorkspaceNode } from "../../workspace";
import PaneGroup from "./PaneGroup";

export default function WorkspaceRoot() {
  const root = useStore((state) => state.workspace.root);
  return (
    <main className="workspace-root" aria-label="Workspace">
      <LayoutNode node={root} />
    </main>
  );
}

function LayoutNode({ node }: { node: WorkspaceNode }) {
  if (node.type === "pane") return <PaneGroup paneId={node.paneId} />;
  return <SplitLayout node={node} />;
}

function SplitLayout({ node }: { node: Extract<WorkspaceNode, { type: "split" }> }) {
  const resize = useStore((state) => state.resizeWorkspaceSplit);
  const horizontal = node.direction === "row";

  const beginResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const splitter = event.currentTarget;
    const container = splitter.parentElement;
    if (!container) return;
    splitter.setPointerCapture(event.pointerId);
    document.body.classList.add(horizontal ? "resizing-columns" : "resizing-rows");

    const onMove = (move: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const ratio = horizontal
        ? (move.clientX - rect.left) / rect.width
        : (move.clientY - rect.top) / rect.height;
      resize(node.id, ratio);
    };
    const finish = () => {
      document.body.classList.remove("resizing-columns", "resizing-rows");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  }, [horizontal, node.id, resize]);

  const adjustByKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const decrease = horizontal ? event.key === "ArrowLeft" : event.key === "ArrowUp";
    const increase = horizontal ? event.key === "ArrowRight" : event.key === "ArrowDown";
    if (!decrease && !increase) return;
    event.preventDefault();
    const amount = event.shiftKey ? 0.1 : 0.025;
    resize(node.id, node.ratio + (increase ? amount : -amount));
  };

  const firstStyle = { flex: `${node.ratio} 1 0` };
  const secondStyle = { flex: `${1 - node.ratio} 1 0` };
  return (
    <div className={`workspace-split ${horizontal ? "split-row" : "split-column"}`}>
      <div className="workspace-split-child" style={firstStyle}>
        <LayoutNode node={node.first} />
      </div>
      <div
        className="workspace-splitter"
        role="separator"
        tabIndex={0}
        aria-label={horizontal ? "Resize panes horizontally" : "Resize panes vertically"}
        aria-orientation={horizontal ? "vertical" : "horizontal"}
        aria-valuemin={15}
        aria-valuemax={85}
        aria-valuenow={Math.round(node.ratio * 100)}
        onPointerDown={beginResize}
        onKeyDown={adjustByKeyboard}
        onDoubleClick={() => resize(node.id, 0.5)}
      />
      <div className="workspace-split-child" style={secondStyle}>
        <LayoutNode node={node.second} />
      </div>
    </div>
  );
}
