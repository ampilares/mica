import { useEffect, useState } from "react";
import { api } from "../api";
import { useStore, kindOfPath } from "../store";
import { docEvents } from "../docEvents";
import InfoPanel from "./InfoPanel";
import JournalCalendar from "./JournalCalendar";
import HistoryPanel from "./HistoryPanel";

/** Right sidebar container (spec §3.3): Outline / Info / Calendar panels. */
export default function RightSidebar() {
  const tab = useStore((s) => s.rightPanelTab);
  const activePath = useStore((s) => s.activePath);

  if (!tab) return null;

  return (
    <div className="right-sidebar">
      <div className="right-sidebar-header">
        <span className="panel-title">
          {tab === "outline"
            ? "Outline"
            : tab === "info"
              ? "Info"
              : tab === "history"
                ? "History"
                : tab === "calendar"
                  ? "Journal"
                  : "Frames"}
        </span>
        <button
          className="icon-button"
          title="Close panel"
          onClick={() => useStore.getState().setRightPanelTab(null)}
        >
          ×
        </button>
      </div>
      {tab === "outline" && activePath && kindOfPath(activePath) === "note" && (
        <OutlinePanel path={activePath} />
      )}
      {tab === "info" && activePath && kindOfPath(activePath) === "note" && (
        <InfoPanel path={activePath} />
      )}
      {tab === "history" && activePath && kindOfPath(activePath) === "note" && (
        <HistoryPanel path={activePath} />
      )}
      {tab === "calendar" && <JournalCalendar />}
      {(tab === "outline" || tab === "info" || tab === "history") &&
        (!activePath || kindOfPath(activePath) !== "note") && (
          <p className="muted small pad">Open a doc to see this panel.</p>
        )}
    </div>
  );
}

interface OutlineItem {
  level: number;
  text: string;
}

/** Table of contents from the doc's markdown headings (FR2 outline). */
function OutlinePanel({ path }: { path: string }) {
  const [outline, setOutline] = useState<OutlineItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const file = await api.noteLoad(path);
        if (cancelled) return;
        const items: OutlineItem[] = [];
        let inFence = false;
        for (const line of file.content.split("\n")) {
          if (line.trimStart().startsWith("```")) inFence = !inFence;
          if (inFence) continue;
          const m = /^(#{1,6})\s+(.*)$/.exec(line);
          if (m)
            items.push({
              level: m[1].length,
              text: m[2].replace(/\{#[^}]*\}\s*$/, "").trim(),
            });
        }
        setOutline(items);
      } catch {
        if (!cancelled) setOutline([]);
      }
    };
    void refresh();
    const off = docEvents.on((ev) => {
      if ("path" in ev && ev.path === path) void refresh();
    });
    const interval = window.setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      off();
      window.clearInterval(interval);
    };
  }, [path]);

  const scrollTo = (text: string) => {
    // Find the rendered heading in the active editor and scroll to it.
    const panes = document.querySelectorAll(".doc-pane");
    for (const pane of panes) {
      if ((pane as HTMLElement).style.display === "none") continue;
      const headings = pane.querySelectorAll("h1, h2, h3, h4, h5, h6");
      for (const h of headings) {
        if ((h.textContent ?? "").trim() === text) {
          h.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
      }
    }
  };

  return (
    <div className="panel-body">
      {outline.length === 0 && <p className="muted small pad">No headings</p>}
      {outline.map((item, i) => (
        <button
          key={i}
          className="outline-item"
          style={{ paddingLeft: (item.level - 1) * 12 + 12 }}
          onClick={() => scrollTo(item.text)}
        >
          {item.text}
        </button>
      ))}
    </div>
  );
}
