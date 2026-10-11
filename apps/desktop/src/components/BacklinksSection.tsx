import { useEffect, useState } from "react";
import { api, BacklinkHit } from "../api";
import { useStore, titleOfPath } from "../store";
import { docEvents } from "../docEvents";

/** AFFiNE-style "Bi-directional links" section at the bottom of a doc
 * (FR2-DOC-005). */
export default function BacklinksSection({ path }: { path: string }) {
  const openDoc = useStore((s) => s.openDoc);
  const [backlinks, setBacklinks] = useState<BacklinkHit[]>([]);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      api
        .backlinks(path)
        .then((hits) => {
          if (!cancelled) setBacklinks(hits);
        })
        .catch(() => {
          if (!cancelled) setBacklinks([]);
        });
    void refresh();
    const off = docEvents.on(() => void refresh());
    return () => {
      cancelled = true;
      off();
    };
  }, [path]);

  if (backlinks.length === 0) return null;

  return (
    <div className="backlinks-section">
      <button className="backlinks-header" onClick={() => setExpanded(!expanded)}>
        <span className="chevron">{expanded ? "▾" : "▸"}</span> Bi-directional links
        <span className="nav-count">{backlinks.length}</span>
      </button>
      {expanded && (
        <div className="backlinks-list">
          {backlinks.map((b, i) => (
            <button key={i} className="backlink-card" onClick={() => openDoc(b.source)}>
              <span className="backlink-title">
                {b.source_title || titleOfPath(b.source)}
              </span>
              <span className="muted small">{b.source}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
