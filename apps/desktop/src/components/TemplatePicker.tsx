import { useEffect, useRef, useState } from "react";
import "./TemplatePicker.css";
import { api } from "../api";
import { useStore } from "../store";

interface TemplateItem {
  path: string;
  title: string;
}

interface Row {
  id: string;
  icon: string;
  label: string;
  hint?: string;
  group: string;
  run: () => void | Promise<void>;
}

/** Shared new-doc-from-template picker (FR21-TPL). Used by the sidebar new-doc
 * menu and the "ask" default. In "ask" mode it also offers blank page/edgeless. */
export default function TemplatePicker({
  open,
  mode = "template",
  onClose,
}: {
  open: boolean;
  mode?: "template" | "ask";
  onClose: () => void;
}) {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    api.templateList().then(setTemplates).catch(() => setTemplates([]));
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  if (!open) return null;

  const refresh = async () => {
    await useStore.getState().refreshTree();
    useStore.getState().refreshDocs();
  };

  const openAndClose = (path: string) => {
    useStore.getState().openDoc(path);
    onClose();
  };

  const createBlank = async (edgeless: boolean) => {
    const title = prompt("New doc title", "Untitled");
    if (!title) return;
    const file = await api.noteCreate(title);
    await refresh();
    openAndClose(file.path);
    if (edgeless) await useStore.getState().setDocMode(file.path, "edgeless");
  };

  const instantiate = async (tpl: TemplateItem) => {
    const title = prompt(`New doc from "${tpl.title}"`, "Untitled");
    if (!title) return;
    const file = await api.templateInstantiate(tpl.path, title);
    await refresh();
    openAndClose(file.path);
  };

  const rows: Row[] = [];
  if (mode === "ask") {
    rows.push({
      id: "blank-page",
      icon: "📄",
      label: "Blank page",
      group: "Blank",
      run: () => createBlank(false),
    });
    rows.push({
      id: "blank-edgeless",
      icon: "🖼",
      label: "Blank edgeless",
      group: "Blank",
      run: () => createBlank(true),
    });
  }
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
      run: () => instantiate(tpl),
    });
  }

  const sel = Math.min(selected, Math.max(0, rows.length - 1));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal template-picker" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="tp-input"
          placeholder="Search templates…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") {
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
        <div className="tp-results">
          {rows.map((row, i) => (
            <div key={row.id}>
              {row.group !== rows[i - 1]?.group && (
                <div className="tp-group-label">{row.group}</div>
              )}
              <button
                className={`tp-item ${i === sel ? "selected" : ""}`}
                onMouseEnter={() => setSelected(i)}
                onClick={() => void row.run()}
              >
                <span className="tp-icon">{row.icon}</span>
                <span className="tp-main">
                  <span className="tp-label">{row.label}</span>
                  {row.hint && <span className="tp-hint">{row.hint}</span>}
                </span>
              </button>
            </div>
          ))}
          {rows.length === 0 && (
            <p className="tp-empty">No templates. Add .md files under templates/.</p>
          )}
        </div>
        <div className="tp-footer">↑↓ navigate · ↵ create · esc close</div>
      </div>
    </div>
  );
}
