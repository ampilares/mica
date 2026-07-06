import { useEffect, useRef, useState } from "react";
import { api, SearchHit } from "../api";
import { useStore, titleOfPath } from "../store";

export default function SearchPanel() {
  const open = useStore((s) => s.searchOpen);
  const setOpen = useStore((s) => s.setSearchOpen);
  const openTab = useStore((s) => s.openTab);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  // Allow the tag browser to seed a query.
  useEffect(() => {
    const handler = (e: Event) => {
      const tag = (e as CustomEvent).detail as string;
      setQuery(tag);
    };
    window.addEventListener("mica:search", handler);
    return () => window.removeEventListener("mica:search", handler);
  }, []);

  useEffect(() => {
    if (!open || !query.trim()) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      api
        .searchQuery(query, 50)
        .then(setHits)
        .catch(() => setHits([]));
    }, 120);
    return () => clearTimeout(t);
  }, [query, open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal palette wide" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          placeholder="Search notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        />
        <div className="palette-results">
          {hits.map((hit) => (
            <button
              key={hit.path}
              className="palette-item search-hit"
              onClick={() => {
                openTab({ path: hit.path, kind: "note", title: titleOfPath(hit.path) });
                setOpen(false);
              }}
            >
              <span className="hit-title">{hit.title}</span>
              <span className="muted small">{hit.path}</span>
              <span
                className="hit-snippet"
                dangerouslySetInnerHTML={{ __html: sanitizeSnippet(hit.snippet) }}
              />
            </button>
          ))}
          {query.trim() && hits.length === 0 && (
            <p className="muted small pad">No results</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Only <mark> tags survive; everything else is escaped. */
function sanitizeSnippet(snippet: string): string {
  const escaped = snippet
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/&lt;mark&gt;/g, "<mark>")
    .replace(/&lt;\/mark&gt;/g, "</mark>");
}
