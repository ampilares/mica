import { useEffect, useRef, useState } from "react";
import { api, QuickSwitchHit } from "../api";
import { useStore, titleOfPath } from "../store";

export default function QuickSwitcher() {
  const open = useStore((s) => s.quickSwitcherOpen);
  const setOpen = useStore((s) => s.setQuickSwitcherOpen);
  const openTab = useStore((s) => s.openTab);
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

  const pick = (hit: QuickSwitchHit) => {
    if (hit.kind === "note" || hit.kind === "database" || hit.kind === "canvas") {
      openTab({ path: hit.path, kind: hit.kind, title: titleOfPath(hit.path) });
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
              pick(hits[selected]);
            }
          }}
        />
        <div className="palette-results">
          {hits.map((hit, i) => (
            <button
              key={hit.path}
              className={`palette-item ${i === selected ? "selected" : ""}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => pick(hit)}
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
