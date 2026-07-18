import { useEffect, useRef, useState } from "react";
import { api, QuickSwitchHit } from "../api";
import { useStore } from "../store";
import { resourceViewForPath } from "../workspace";

export default function QuickSwitcher() {
  const open = useStore((s) => s.quickSwitcherOpen);
  const setOpen = useStore((s) => s.setQuickSwitcherOpen);
  const openWorkspaceResource = useStore((s) => s.openWorkspaceResource);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<QuickSwitchHit[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHits([]);
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      api
        .quickSwitch(query || "", 20)
        .then((h) => {
          setHits(h);
          setSelected(0);
        })
        .catch(() => setHits([]));
    }, 80);
    return () => clearTimeout(t);
  }, [query, open]);

  if (!open) return null;

  const pick = (hit: QuickSwitchHit, options?: { newTab?: boolean; activate?: boolean }) => {
    if (hit.kind === "note" || hit.kind === "database" || hit.kind === "canvas") {
      openWorkspaceResource(resourceViewForPath(hit.path), options?.newTab
        ? { newTab: true, activate: options.activate }
        : undefined);
    }
    setOpen(false);
  };

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          placeholder="Jump to note, database, or canvas…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((s) => Math.min(s + 1, hits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter" && hits[selected]) {
              pick(hits[selected], {
                newTab: e.metaKey || e.ctrlKey,
                activate: e.shiftKey,
              });
            }
          }}
        />
        <div className="palette-results">
          {hits.map((hit, i) => (
            <button
              key={hit.path}
              className={`palette-item ${i === selected ? "selected" : ""}`}
              onMouseEnter={() => setSelected(i)}
              onClick={(event) => pick(hit, {
                newTab: event.metaKey || event.ctrlKey || event.button === 1,
                activate: event.shiftKey,
              })}
              onAuxClick={(event) => {
                if (event.button === 1) pick(hit, { newTab: true, activate: false });
              }}
            >
              <span>
                {hit.kind === "note" ? "📄" : hit.kind === "database" ? "🗃️" : "🗺️"}{" "}
                {hit.title}
              </span>
              <span className="muted small">{hit.path}</span>
            </button>
          ))}
          {hits.length === 0 && <p className="muted small pad">No matches</p>}
        </div>
      </div>
    </div>
  );
}
