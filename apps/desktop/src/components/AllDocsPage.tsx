import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, DocMeta } from "../api";
import { useStore, titleOfPath } from "../store";
import { useWorkspaceMeta, tagColorValue } from "../workspaceMeta";
import { iconOf } from "./Sidebar";
import "./AllDocsPage.css";

type SortKey = "updated" | "created" | "title";
type KindFilter = "all" | "note" | "canvas" | "database";

/** Fixed row height, enforced via .docs-row in AllDocsPage.css. */
const ROW_HEIGHT = 38;
/** Below this doc count, render every row (zero behavior change). */
const VIRTUALIZE_THRESHOLD = 200;
/** Extra rows rendered beyond the viewport on each side. */
const OVERSCAN = 10;

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

  // Windowed rendering (NFR2-001): only rows in/near the viewport are mounted
  // once the list grows past VIRTUALIZE_THRESHOLD, so 10k+ docs stay smooth.
  const pageRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  // Distance from the top of the scrollable content to the top of .docs-list.
  const [listOffset, setListOffset] = useState(0);

  const virtual = docs.length > VIRTUALIZE_THRESHOLD;

  const measure = () => {
    const el = pageRef.current;
    if (!el) return;
    setViewportH(el.clientHeight);
    setScrollTop(el.scrollTop);
    const list = listRef.current;
    if (list) {
      setListOffset(
        list.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop,
      );
    }
  };

  // Re-measure on container resize and whenever the docs array changes.
  useLayoutEffect(() => {
    measure();
    const el = pageRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, heading]);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const onScroll = () => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = pageRef.current;
      if (el) setScrollTop(el.scrollTop);
    });
  };

  const total = docs.length;
  let startIndex = 0;
  let endIndex = total;
  if (virtual && viewportH > 0) {
    const first = Math.floor((scrollTop - listOffset) / ROW_HEIGHT);
    const visibleCount = Math.ceil(viewportH / ROW_HEIGHT);
    startIndex = Math.max(0, first - OVERSCAN);
    endIndex = Math.min(total, first + visibleCount + OVERSCAN);
  }
  const visibleDocs = virtual ? docs.slice(startIndex, endIndex) : docs;
  const topPad = startIndex * ROW_HEIGHT;
  const bottomPad = (total - endIndex) * ROW_HEIGHT;

  const renderRow = (doc: DocMeta) => (
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
  );

  return (
    <div className="page docs-page" ref={pageRef} onScroll={onScroll}>
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

      <div className="docs-list" ref={listRef}>
        {virtual && topPad > 0 && <div className="docs-vspacer" style={{ height: topPad }} />}
        {visibleDocs.map(renderRow)}
        {virtual && bottomPad > 0 && (
          <div className="docs-vspacer" style={{ height: bottomPad }} />
        )}
        {total === 0 && (
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
