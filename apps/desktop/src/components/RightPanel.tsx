import { useEffect, useState } from "react";
import { api, BacklinkHit } from "../api";
import { useStore } from "../store";
import { resourcePath, resourceViewForPath, titleForPath } from "../workspace";
import { docEvents } from "../docEvents";

interface OutlineItem {
  level: number;
  text: string;
}

/** Right sidebar: outline, backlinks, outgoing links for the active note. */
export default function RightPanel() {
  const open = useStore((s) => s.rightPanelOpen);
  const activeResourcePath = useStore((s) => {
    const pane = s.workspace.panes[s.workspace.focusedPaneId];
    return pane ? resourcePath(s.workspace.tabs[pane.activeTabId].view) : undefined;
  });
  const sidebar = useStore((s) => s.workspace.sidebars.right);
  const setSidebar = useStore((s) => s.setWorkspaceSidebar);
  const openResource = useStore((s) => s.openWorkspaceResource);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [backlinks, setBacklinks] = useState<BacklinkHit[]>([]);
  const [outgoing, setOutgoing] = useState<{ target: string; resolved: string | null }[]>([]);

  const isNote = activeResourcePath?.endsWith(".md") ?? false;

  useEffect(() => {
    if (!open || !activeResourcePath || !isNote) return;
    let cancelled = false;

    const refresh = async () => {
      try {
        const [file, links] = await Promise.all([
          api.noteLoad(activeResourcePath),
          api.backlinks(activeResourcePath),
        ]);
        if (cancelled) return;
        setBacklinks(links);
        // Outline from raw markdown headings (skip code fences).
        const items: OutlineItem[] = [];
        let inFence = false;
        for (const line of file.content.split("\n")) {
          if (line.trimStart().startsWith("```")) inFence = !inFence;
          if (inFence) continue;
          const m = /^(#{1,6})\s+(.*)$/.exec(line);
          if (m) items.push({ level: m[1].length, text: m[2].replace(/\{#[^}]*\}\s*$/, "").trim() });
        }
        setOutline(items);
        // Outgoing wiki links from the raw text.
        const out: { target: string; resolved: string | null }[] = [];
        const re = /\[\[([^\[\]|#]+)(#[^\[\]|]*)?(\|[^\[\]]*)?\]\]/g;
        let match: RegExpExecArray | null;
        const seen = new Set<string>();
        while ((match = re.exec(file.content)) !== null) {
          const target = match[1].trim();
          if (seen.has(target)) continue;
          seen.add(target);
          out.push({ target, resolved: null });
        }
        for (const link of out) {
          link.resolved = await api.resolveWiki(link.target).catch(() => null);
        }
        if (!cancelled) setOutgoing([...out]);
      } catch {
        if (!cancelled) {
          setOutline([]);
          setBacklinks([]);
          setOutgoing([]);
        }
      }
    };

    void refresh();
    // Refresh when this file (or anything, cheaply) changes on disk.
    const off = docEvents.on((ev) => {
      if ("path" in ev && ev.path === activeResourcePath) void refresh();
    });
    const interval = window.setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      off();
      window.clearInterval(interval);
    };
  }, [open, activeResourcePath, isNote]);

  if (!open || !activeResourcePath || !isNote) return null;

  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => setSidebar("right", { width: Math.max(210, Math.min(440, window.innerWidth - next.clientX)) });
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  };

  const openWiki = async (name: string, resolved: string | null) => {
    let target = resolved;
    if (!target) {
      const file = await api.noteCreate(name);
      target = file.path;
      await useStore.getState().refreshTree();
    }
    await openResource(resourceViewForPath(target));
  };

  return (
    <div className="right-panel" style={{ width: sidebar.width, flexBasis: sidebar.width }}>
      <div
        className="right-panel-resizer"
        role="separator"
        aria-label="Resize context sidebar"
        aria-orientation="vertical"
        aria-valuemin={210}
        aria-valuemax={440}
        aria-valuenow={Math.round(sidebar.width)}
        tabIndex={0}
        onPointerDown={beginResize}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const step = event.shiftKey ? 40 : 10;
          setSidebar("right", { width: Math.max(210, Math.min(440, sidebar.width + (event.key === "ArrowLeft" ? step : -step))) });
        }}
      />
      <div className="panel-section">
        <div className="panel-title">Outline</div>
        {outline.length === 0 && <p className="muted small">No headings</p>}
        {outline.map((item, i) => (
          <div
            key={i}
            className="outline-item"
            style={{ paddingLeft: (item.level - 1) * 12 }}
          >
            {item.text}
          </div>
        ))}
      </div>
      <div className="panel-section">
        <div className="panel-title">Backlinks</div>
        {backlinks.length === 0 && <p className="muted small">No backlinks</p>}
        {backlinks.map((b, i) => (
          <button
            key={i}
            className="panel-link"
            onClick={() =>
              openResource(resourceViewForPath(b.source))
            }
          >
            {b.source_title || titleForPath(b.source)}
            <span className="muted small">{b.source}</span>
          </button>
        ))}
      </div>
      <div className="panel-section">
        <div className="panel-title">Outgoing links</div>
        {outgoing.length === 0 && <p className="muted small">No wiki links</p>}
        {outgoing.map((l, i) => (
          <button
            key={i}
            className={`panel-link ${l.resolved ? "" : "unresolved"}`}
            onClick={() => void openWiki(l.target, l.resolved)}
          >
            {l.target}
            <span className="muted small">{l.resolved ?? "not created yet"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
