import { useEffect, useState } from "react";
import { api, BacklinkHit } from "../api";
import { useStore, titleOfPath, kindOfPath } from "../store";
import { docEvents } from "../docEvents";

interface OutlineItem {
  level: number;
  text: string;
}

/** Right sidebar: outline, backlinks, outgoing links for the active note. */
export default function RightPanel() {
  const open = useStore((s) => s.rightPanelOpen);
  const activePath = useStore((s) => s.activePath);
  const openTab = useStore((s) => s.openTab);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [backlinks, setBacklinks] = useState<BacklinkHit[]>([]);
  const [outgoing, setOutgoing] = useState<{ target: string; resolved: string | null }[]>([]);

  const isNote = activePath?.endsWith(".md") ?? false;

  useEffect(() => {
    if (!open || !activePath || !isNote) return;
    let cancelled = false;

    const refresh = async () => {
      try {
        const [file, links] = await Promise.all([
          api.noteLoad(activePath),
          api.backlinks(activePath),
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
      if ("path" in ev && ev.path === activePath) void refresh();
    });
    const interval = window.setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      off();
      window.clearInterval(interval);
    };
  }, [open, activePath, isNote]);

  if (!open || !activePath || !isNote) return null;

  const openWiki = async (name: string, resolved: string | null) => {
    let target = resolved;
    if (!target) {
      const file = await api.noteCreate(name);
      target = file.path;
      await useStore.getState().refreshTree();
    }
    openTab({ path: target, kind: "note", title: titleOfPath(target) });
  };

  return (
    <div className="right-panel">
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
              openTab({
                path: b.source,
                kind: kindOfPath(b.source) === "note" ? "note" : "note",
                title: titleOfPath(b.source),
              })
            }
          >
            {b.source_title || titleOfPath(b.source)}
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
