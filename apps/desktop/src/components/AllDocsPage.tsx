import { useMemo, useState } from "react";
import { api, DocMeta } from "../api";
import { useStore, titleOfPath } from "../store";
import { useWorkspaceMeta, tagColorValue } from "../workspaceMeta";
import { iconOf } from "./Sidebar";

type SortKey = "updated" | "created" | "title";
type KindFilter = "all" | "note" | "canvas" | "database";

/** AFFiNE-style All docs page (FR2-ALL): sortable, filterable doc list. */
export default function AllDocsPage({
  docsOverride,
  heading,
}: {
  /** When set, show these docs (tag/collection pages reuse this list UI). */
  docsOverride?: DocMeta[];
  heading?: string;
}) {
  const allDocs = useStore((s) => s.docs);
  const openDoc = useStore((s) => s.openDoc);
  const closeTab = useStore((s) => s.closeTab);
  const refreshTree = useStore((s) => s.refreshTree);
  const refreshDocs = useStore((s) => s.refreshDocs);
  const showToast = useStore((s) => s.showToast);
  const meta = useWorkspaceMeta();

  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sortAsc, setSortAsc] = useState(false);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const source = docsOverride ?? allDocs;

  const docs = useMemo(() => {
    let out = source;
    if (kindFilter !== "all") out = out.filter((d) => d.kind === kindFilter);
    if (favoritesOnly) out = out.filter((d) => meta.favorites.includes(d.path));
    if (tagFilter) out = out.filter((d) => d.tags.includes(tagFilter));
    const dir = sortAsc ? 1 : -1;
    return [...out].sort((a, b) => {
      switch (sortKey) {
        case "title":
          return dir * a.title.localeCompare(b.title);
        case "created":
          return dir * (a.created ?? a.updated).localeCompare(b.created ?? b.updated);
        default:
          return dir * a.updated.localeCompare(b.updated);
      }
    });
  }, [source, kindFilter, favoritesOnly, tagFilter, sortKey, sortAsc, meta.favorites]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const d of source) for (const t of d.tags) s.add(t);
    return [...s].sort();
  }, [source]);

  const trashDoc = async (doc: DocMeta) => {
    const moved = await api.trashMove(doc.path);
    closeTab(doc.path);
    await meta.dropPath(doc.path);
    await refreshTree();
    refreshDocs();
    showToast({
      message: `Moved "${doc.title}" to trash`,
      action: {
        label: "Undo",
        run: () => {
          api.trashRestore(moved[0]).then(() => {
            refreshTree();
            refreshDocs();
          });
        },
      },
    });
  };

  const header = (key: SortKey, label: string) => (
    <button
      className={`docs-col-header ${sortKey === key ? "active" : ""}`}
      onClick={() => {
        if (sortKey === key) setSortAsc(!sortAsc);
        else {
          setSortKey(key);
          setSortAsc(key === "title");
        }
      }}
    >
      {label} {sortKey === key ? (sortAsc ? "↑" : "↓") : ""}
    </button>
  );

  return (
    <div className="page docs-page">
      <div className="page-header">
        <h1>{heading ?? "All docs"}</h1>
        <div className="docs-filters">
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as KindFilter)}
            title="Filter by type"
          >
            <option value="all">All types</option>
            <option value="note">Docs</option>
            <option value="canvas">Whiteboards</option>
            <option value="database">Databases</option>
          </select>
          <select
            value={tagFilter ?? ""}
            onChange={(e) => setTagFilter(e.target.value || null)}
            title="Filter by tag"
          >
            <option value="">All tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </select>
          <button
            className={`chip ${favoritesOnly ? "on" : ""}`}
            onClick={() => setFavoritesOnly(!favoritesOnly)}
          >
            ★ Favorites
          </button>
        </div>
      </div>

      <div className="docs-list-header">
        {header("title", "Name")}
        <span className="docs-col-tags">Tags</span>
        {header("created", "Created")}
        {header("updated", "Updated")}
        <span className="docs-col-actions" />
      </div>

      <div className="docs-list">
        {docs.map((doc) => (
          <div key={doc.path} className="docs-row" onClick={() => openDoc(doc.path)}>
            <span className="docs-cell name">
              <span className="file-icon">{iconOf(doc.kind)}</span>
              <span className="docs-title">{doc.title || titleOfPath(doc.path)}</span>
              {doc.journal && <span className="badge">journal</span>}
              {doc.has_canvas && <span className="badge edgeless">edgeless</span>}
            </span>
            <span className="docs-cell tags">
              {doc.tags.slice(0, 3).map((t) => (
                <span
                  key={t}
                  className="doc-tag"
                  style={{ color: tagColorValue(meta.tagColors[t]) }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setTagFilter(t);
                  }}
                >
                  #{t}
                </span>
              ))}
            </span>
            <span className="docs-cell date">{formatDate(doc.created ?? doc.updated)}</span>
            <span className="docs-cell date">{formatDate(doc.updated)}</span>
            <span className="docs-cell actions" onClick={(e) => e.stopPropagation()}>
              <button
                className={`icon-button star ${meta.favorites.includes(doc.path) ? "on" : ""}`}
                title="Favorite"
                onClick={() => void meta.toggleFavorite(doc.path)}
              >
                {meta.favorites.includes(doc.path) ? "★" : "☆"}
              </button>
              <button
                className="icon-button"
                title="Reveal in Explorer"
                onClick={() => api.vaultReveal(doc.path).catch(() => {})}
              >
                📂
              </button>
              <button
                className="icon-button"
                title="Move to trash"
                onClick={() => void trashDoc(doc)}
              >
                🗑
              </button>
            </span>
          </div>
        ))}
        {docs.length === 0 && (
          <div className="placeholder">
            <p className="muted">No docs match.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
