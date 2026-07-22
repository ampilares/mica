import { useEffect, useRef, useState } from "react";
import { api, QuickSwitchHit, SearchHit } from "../api";
import { useStore, titleOfPath } from "../store";
import { iconOf } from "./Sidebar";

interface Row {
  id: string;
  icon: string;
  label: string;
  hint?: string;
  snippet?: string;
  group?: string;
  run: () => void | Promise<void>;
}

/** AFFiNE-style quick search modal (FR2-NAV-004): title matches, full-text
 * results, recents, and creation actions in one Cmd+K surface. */
export default function QuickSearch() {
  const isOpen = useStore((s) => s.quickSearchOpen);
  const setOpen = useStore((s) => s.setQuickSearchOpen);
  const docs = useStore((s) => s.docs);
  const openDoc = useStore((s) => s.openDoc);
  const refreshTree = useStore((s) => s.refreshTree);
  const refreshDocs = useStore((s) => s.refreshDocs);
  const [query, setQuery] = useState("");
  const [titleHits, setTitleHits] = useState<QuickSwitchHit[]>([]);
  const [textHits, setTextHits] = useState<SearchHit[]>([]);
  const [selected, setSelected] = useState(0);
  // FR21-TPL: switch the modal into a template-pick surface.
  const [mode, setMode] = useState<"search" | "templates">("search");
  const [templates, setTemplates] = useState<{ path: string; title: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setTitleHits([]);
      setTextHits([]);
      setSelected(0);
      setMode("search");
      setTemplates([]);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || mode !== "search") return;
    if (query.trim() === "") {
      setTitleHits([]);
      setTextHits([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      try {
        const [titles, texts] = await Promise.all([
          api.quickSwitch(query, 8),
          api.searchQuery(query, 8),
        ]);
        if (!cancelled) {
          setTitleHits(titles);
          // Skip full-text rows already shown as title hits.
          const seen = new Set(titles.map((h) => h.path));
          setTextHits(texts.filter((h) => !seen.has(h.path)));
          setSelected(0);
        }
      } catch {
        /* index unavailable */
      }
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query, isOpen, mode]);

  if (!isOpen) return null;

  const openAndClose = (path: string) => {
    openDoc(path);
    setOpen(false);
  };

  // FR21-TPL: enter the template-pick surface, loading available templates.
  const enterTemplates = async () => {
    try {
      setTemplates(await api.templateList());
    } catch {
      setTemplates([]);
    }
    setMode("templates");
    setSelected(0);
  };

  const createFromTemplate = async (tpl: { path: string; title: string }) => {
    const title = prompt(`New doc from "${tpl.title}"`, "Untitled");
    if (!title) return;
    const file = await api.templateInstantiate(tpl.path, title);
    await refreshTree();
    refreshDocs();
    openAndClose(file.path);
  };

  const rows: Row[] = [];
  if (mode === "templates") {
    const q = query.trim().toLowerCase();
    for (const tpl of templates.filter(
      (t) => t.title.toLowerCase().includes(q) || t.path.toLowerCase().includes(q),
    )) {
      rows.push({
        id: `tpl:${tpl.path}`,
        icon: "🧩",
        label: tpl.title,
        hint: tpl.path,
        group: "Templates",
        run: () => createFromTemplate(tpl),
      });
    }
  } else if (query.trim() === "") {
    // Action group (FR21-TPL): create-from-template, above recents.
    rows.push({
      id: "new-from-template",
      icon: "🧩",
      label: "New doc from template…",
      group: "Create",
      run: () => void enterTemplates(),
    });
    // Recents: most recently updated docs.
    for (const d of docs.slice(0, 8)) {
      rows.push({
        id: `recent:${d.path}`,
        icon: iconOf(d.kind),
        label: d.title || titleOfPath(d.path),
        hint: d.path,
        group: "Recent",
        run: () => openAndClose(d.path),
      });
    }
  } else {
    for (const h of titleHits) {
      rows.push({
        id: `title:${h.path}`,
        icon: iconOf(h.kind),
        label: h.title || titleOfPath(h.path),
        hint: h.path,
        run: () => openAndClose(h.path),
      });
    }
    for (const h of textHits) {
      rows.push({
        id: `text:${h.path}`,
        icon: iconOf("note"),
        label: h.title || titleOfPath(h.path),
        hint: h.path,
        snippet: h.snippet,
        run: () => openAndClose(h.path),
      });
    }
    rows.push({
      id: "create",
      icon: "＋",
      label: `New "${query.trim()}" doc`,
      run: async () => {
        const file = await api.noteCreate(query.trim());
        await refreshTree();
        refreshDocs();
        openAndClose(file.path);
      },
    });
    rows.push({
      id: "new-from-template",
      icon: "🧩",
      label: "New doc from template…",
      run: () => void enterTemplates(),
    });
  }

  const sel = Math.min(selected, Math.max(0, rows.length - 1));

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal quick-search" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          placeholder={
            mode === "templates" ? "Search templates…" : "Search docs, or type to create…"
          }
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (mode === "templates") setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              if (mode === "templates") {
                setMode("search");
                setSelected(0);
              } else setOpen(false);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected(Math.min(sel + 1, rows.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected(Math.max(sel - 1, 0));
            } else if (e.key === "Enter" && rows[sel]) {
              void rows[sel].run();
            }
          }}
        />
        <div className="palette-results">
          {rows.map((row, i) => (
            <div key={row.id}>
              {row.group && row.group !== rows[i - 1]?.group && (
                <div className="palette-group-label">{row.group}</div>
              )}
              <button
                className={`palette-item ${i === sel ? "selected" : ""}`}
                onMouseEnter={() => setSelected(i)}
                onClick={() => void row.run()}
              >
                <span className="palette-icon">{row.icon}</span>
                <span className="palette-main">
                  <span className="palette-label">{row.label}</span>
                  {row.snippet && (
                    <span
                      className="palette-snippet"
                      // Snippet HTML comes from our own FTS5 <mark> highlighter.
                      dangerouslySetInnerHTML={{ __html: row.snippet }}
                    />
                  )}
                </span>
                {row.hint && <span className="muted small">{row.hint}</span>}
              </button>
            </div>
          ))}
          {rows.length === 0 && mode === "templates" && (
            <p className="muted small pad">No templates. Add .md files under templates/.</p>
          )}
          {rows.length === 0 && mode === "search" && (
            <p className="muted small pad">Type to search your docs</p>
          )}
        </div>
        <div className="quick-search-footer">
          <span className="muted small">↑↓ navigate · ↵ open · esc close</span>
          <button
            className="chip"
            onClick={() => {
              setOpen(false);
              useStore.getState().setCommandPaletteOpen(true);
            }}
          >
            Commands ⌘⇧P
          </button>
        </div>
      </div>
    </div>
  );
}
