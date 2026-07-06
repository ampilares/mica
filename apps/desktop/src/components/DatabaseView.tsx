import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  Database,
  DbOp,
  DbRow,
  DbView,
  Property,
  PropertyType,
  isApiError,
} from "../api";
import { docEvents } from "../docEvents";
import { useStore, titleOfPath } from "../store";

interface Props {
  path: string;
  embed: boolean;
  initialView?: string;
}

const ROW_HEIGHT = 34;
const PROPERTY_TYPES: PropertyType[] = [
  "text",
  "number",
  "checkbox",
  "select",
  "multi_select",
  "date",
  "url",
];

const OPERATORS_BY_TYPE: Record<string, string[]> = {
  text: ["contains", "eq", "neq", "empty", "not_empty"],
  url: ["contains", "eq", "neq", "empty", "not_empty"],
  title: ["contains", "eq", "neq", "empty", "not_empty"],
  select: ["eq", "neq", "empty", "not_empty"],
  multi_select: ["contains", "empty", "not_empty"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte"],
  date: ["eq", "neq", "gt", "gte", "lt", "lte"],
  checkbox: ["checked", "unchecked"],
};

export default function DatabaseView({ path, embed, initialView }: Props) {
  const [db, setDb] = useState<Database | null>(null);
  const [version, setVersion] = useState<string>("");
  const [viewId, setViewId] = useState<string>(initialView ?? "table_default");
  const [orderedRows, setOrderedRows] = useState<DbRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [peekRowId, setPeekRowId] = useState<string | null>(null);
  const openTab = useStore((s) => s.openTab);
  const pathRef = useRef(path);
  pathRef.current = path;
  const viewIdRef = useRef(viewId);
  viewIdRef.current = viewId;

  const load = useCallback(async () => {
    try {
      const file = await api.dbLoad(pathRef.current);
      const parsed: Database = JSON.parse(file.content);
      setDb(parsed);
      setVersion(file.version);
      setError(null);
      await refreshRows(parsed);
    } catch (e) {
      setError(isApiError(e) ? e.message : String(e));
    }
  }, []);

  // Sorted/filtered row order comes from the core's query engine.
  const refreshRows = useCallback(async (current?: Database) => {
    try {
      const q = await api.dbQuery(pathRef.current, viewIdRef.current, 0, 0);
      setOrderedRows(q.rows);
    } catch {
      setOrderedRows(current?.rows ?? null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, path]);

  useEffect(() => {
    void refreshRows(db ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewId]);

  useEffect(() => {
    return docEvents.on((ev) => {
      if ("path" in ev && ev.path === pathRef.current) void load();
      if (ev.type === "renamed" && ev.from === pathRef.current) {
        useStore.getState().renameTab(ev.from, ev.to);
      }
    });
  }, [load]);

  const apply = useCallback(
    async (ops: DbOp[]) => {
      try {
        const result = await api.dbApply(pathRef.current, ops, version);
        const parsed: Database = JSON.parse(result.content);
        setDb(parsed);
        setVersion(result.version);
        setError(null);
        await refreshRows(parsed);
      } catch (e) {
        if (isApiError(e) && e.code === "conflict") {
          await load();
          setError("File changed on disk — reloaded. Try the edit again.");
        } else {
          setError(isApiError(e) ? e.message : String(e));
        }
      }
    },
    [version, load, refreshRows],
  );

  if (error && !db) return <div className="placeholder error">{error}</div>;
  if (!db) return <div className="placeholder muted">Loading…</div>;

  const view = db.views.find((v) => v.id === viewId) ?? db.views[0];
  const peekRow = peekRowId ? db.rows.find((r) => r.id === peekRowId) : null;

  return (
    <div className={`db-view ${embed ? "embed" : "full"}`}>
      <div className="db-toolbar">
        <span
          className="db-title"
          onDoubleClick={async () => {
            const t = prompt("Database title", db.title);
            if (t && t !== db.title) await apply([{ op: "title_set", title: t }]);
          }}
        >
          {db.title}
        </span>
        <div className="db-view-switch">
          {db.views.map((v) => (
            <button
              key={v.id}
              className={v.id === view.id ? "active" : ""}
              onClick={() => setViewId(v.id)}
            >
              {v.name}
            </button>
          ))}
        </div>
        {view.type === "table" && (
          <>
            <SortMenu db={db} view={view} apply={apply} />
            <FilterMenu db={db} view={view} apply={apply} />
          </>
        )}
        <div className="spacer" />
        {embed && (
          <button
            className="small"
            onClick={() => openTab({ path, kind: "database", title: titleOfPath(path) })}
          >
            Open full page
          </button>
        )}
        <button className="small" onClick={() => apply([{ op: "row_create", cells: {} }])}>
          + Row
        </button>
      </div>
      {error && <div className="banner warning">{error}</div>}
      <div className="db-body">
        {view.type === "table" ? (
          <TableView
            db={db}
            view={view}
            rows={orderedRows ?? db.rows}
            apply={apply}
            onPeek={setPeekRowId}
          />
        ) : (
          <KanbanView db={db} viewId={view.id} apply={apply} onPeek={setPeekRowId} />
        )}
        {peekRow && (
          <RowPeek
            db={db}
            row={peekRow}
            apply={apply}
            onClose={() => setPeekRowId(null)}
          />
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------ sort/filter UI ----

function SortMenu({
  db,
  view,
  apply,
}: {
  db: Database;
  view: DbView;
  apply: (ops: DbOp[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const sorts = view.sorts ?? [];

  const update = (next: typeof sorts) =>
    apply([{ op: "view_update", view: { ...view, sorts: next } }]);

  return (
    <div className="menu-anchor">
      <button className={`small ${sorts.length ? "accent" : ""}`} onClick={() => setOpen(!open)}>
        Sort{sorts.length ? ` (${sorts.length})` : ""}
      </button>
      {open && (
        <div className="dropdown" onMouseLeave={() => setOpen(false)}>
          {sorts.map((s, i) => (
            <div key={i} className="dropdown-row">
              <select
                value={s.property}
                onChange={(e) =>
                  update(sorts.map((x, j) => (j === i ? { ...x, property: e.target.value } : x)))
                }
              >
                {db.properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                value={s.descending ? "desc" : "asc"}
                onChange={(e) =>
                  update(
                    sorts.map((x, j) =>
                      j === i ? { ...x, descending: e.target.value === "desc" } : x,
                    ),
                  )
                }
              >
                <option value="asc">A → Z</option>
                <option value="desc">Z → A</option>
              </select>
              <button className="small" onClick={() => update(sorts.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          ))}
          <button
            className="small"
            onClick={() =>
              update([...sorts, { property: db.properties[0]?.id ?? "", descending: false }])
            }
          >
            + Add sort
          </button>
        </div>
      )}
    </div>
  );
}

function FilterMenu({
  db,
  view,
  apply,
}: {
  db: Database;
  view: DbView;
  apply: (ops: DbOp[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const filters = view.filters ?? [];

  const update = (next: typeof filters) =>
    apply([{ op: "view_update", view: { ...view, filters: next } }]);

  const typeOf = (propId: string) =>
    db.properties.find((p) => p.id === propId)?.type ?? "text";

  return (
    <div className="menu-anchor">
      <button
        className={`small ${filters.length ? "accent" : ""}`}
        onClick={() => setOpen(!open)}
      >
        Filter{filters.length ? ` (${filters.length})` : ""}
      </button>
      {open && (
        <div className="dropdown wide" onMouseLeave={() => setOpen(false)}>
          {filters.map((f, i) => {
            const ptype = typeOf(f.property);
            const ops = OPERATORS_BY_TYPE[ptype] ?? OPERATORS_BY_TYPE.text;
            const needsValue = !["empty", "not_empty", "checked", "unchecked"].includes(
              f.operator,
            );
            const prop = db.properties.find((p) => p.id === f.property);
            return (
              <div key={i} className="dropdown-row">
                <select
                  value={f.property}
                  onChange={(e) => {
                    const nt = typeOf(e.target.value);
                    update(
                      filters.map((x, j) =>
                        j === i
                          ? {
                              property: e.target.value,
                              operator: (OPERATORS_BY_TYPE[nt] ?? ["eq"])[0],
                              value: undefined,
                            }
                          : x,
                      ),
                    );
                  }}
                >
                  {db.properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <select
                  value={f.operator}
                  onChange={(e) =>
                    update(
                      filters.map((x, j) => (j === i ? { ...x, operator: e.target.value } : x)),
                    )
                  }
                >
                  {ops.map((o) => (
                    <option key={o} value={o}>
                      {o.replace("_", " ")}
                    </option>
                  ))}
                </select>
                {needsValue &&
                  (ptype === "select" ? (
                    <select
                      value={String(f.value ?? "")}
                      onChange={(e) =>
                        update(
                          filters.map((x, j) =>
                            j === i ? { ...x, value: e.target.value } : x,
                          ),
                        )
                      }
                    >
                      <option value="">—</option>
                      {(prop?.options ?? []).map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={ptype === "number" ? "number" : ptype === "date" ? "date" : "text"}
                      defaultValue={String(f.value ?? "")}
                      onBlur={(e) =>
                        update(
                          filters.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  value:
                                    ptype === "number"
                                      ? Number(e.target.value)
                                      : e.target.value,
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  ))}
                <button className="small" onClick={() => update(filters.filter((_, j) => j !== i))}>
                  ×
                </button>
              </div>
            );
          })}
          <button
            className="small"
            onClick={() =>
              update([
                ...filters,
                { property: db.properties[0]?.id ?? "", operator: "contains", value: "" },
              ])
            }
          >
            + Add filter
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------- table ----

function TableView({
  db,
  view,
  rows,
  apply,
  onPeek,
}: {
  db: Database;
  view: DbView;
  rows: DbRow[];
  apply: (ops: DbOp[]) => Promise<void>;
  onPeek: (rowId: string) => void;
}) {
  const hidden = new Set(view.hidden_properties ?? []);
  const ordered = useMemo(() => {
    const order = view.column_order ?? [];
    const props = db.properties.filter((p) => !hidden.has(p.id));
    if (order.length === 0) return props;
    return [...props].sort(
      (a, b) =>
        (order.indexOf(a.id) + 1 || 1e9) - (order.indexOf(b.id) + 1 || 1e9),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.properties, view]);

  // Windowed rendering: only rows in (and near) the viewport mount.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewportH(el.clientHeight);
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 10);
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + 10);
  const visible = rows.slice(start, end);

  const widthOf = (p: Property) => view.column_widths?.[p.id] ?? 160;

  const resizeState = useRef<{ propId: string; startX: number; startW: number } | null>(null);

  const onResizeStart = (e: React.MouseEvent, p: Property) => {
    e.preventDefault();
    e.stopPropagation();
    resizeState.current = { propId: p.id, startX: e.clientX, startW: widthOf(p) };
    const move = (ev: MouseEvent) => {
      const st = resizeState.current;
      if (!st) return;
      const w = Math.max(70, st.startW + ev.clientX - st.startX);
      const th = document.querySelector<HTMLElement>(`th[data-prop="${st.propId}"]`);
      if (th) th.style.width = th.style.minWidth = `${w}px`;
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      const st = resizeState.current;
      resizeState.current = null;
      if (!st) return;
      const w = Math.max(70, st.startW + ev.clientX - st.startX);
      void apply([
        {
          op: "view_update",
          view: { ...view, column_widths: { ...(view.column_widths ?? {}), [st.propId]: w } },
        },
      ]);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const addProperty = async () => {
    const name = prompt("Property name", "Notes");
    if (!name) return;
    const type = prompt(`Type: ${PROPERTY_TYPES.join(", ")}`, "text") as PropertyType | null;
    if (!type || !PROPERTY_TYPES.includes(type)) return;
    await apply([{ op: "property_add", name, prop_type: type }]);
  };

  return (
    <div
      className="db-table-wrap"
      ref={scrollRef}
      onScroll={(e) => setScrollTop((e.target as HTMLElement).scrollTop)}
    >
      <table className="db-table" style={{ tableLayout: "fixed" }}>
        <thead>
          <tr>
            <th className="th-peek" />
            {ordered.map((p) => (
              <th key={p.id} data-prop={p.id} style={{ width: widthOf(p), minWidth: widthOf(p) }}>
                <ColumnHeader db={db} view={view} prop={p} apply={apply} />
                <span className="col-resize" onMouseDown={(e) => onResizeStart(e, p)} />
              </th>
            ))}
            <th className="th-add">
              <button className="small" onClick={addProperty}>
                +
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {start > 0 && (
            <tr style={{ height: start * ROW_HEIGHT }}>
              <td colSpan={ordered.length + 2} />
            </tr>
          )}
          {visible.map((row) => (
            <tr key={row.id} style={{ height: ROW_HEIGHT }}>
              <td className="td-peek">
                <button className="small" title="Open row" onClick={() => onPeek(row.id)}>
                  ⤢
                </button>
              </td>
              {ordered.map((p) => (
                <td key={p.id}>
                  <CellEditor
                    row={row}
                    prop={p}
                    onChange={(value) =>
                      apply([{ op: "row_update", row_id: row.id, cells: { [p.id]: value } }])
                    }
                  />
                </td>
              ))}
              <td className="td-actions">
                <button
                  className="small danger"
                  title="Delete row"
                  onClick={() => apply([{ op: "row_delete", row_id: row.id }])}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
          {end < rows.length && (
            <tr style={{ height: (rows.length - end) * ROW_HEIGHT }}>
              <td colSpan={ordered.length + 2} />
            </tr>
          )}
          {rows.length === 0 && (
            <tr>
              <td colSpan={ordered.length + 2} className="muted pad">
                No rows match — add one or adjust filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ColumnHeader({
  db,
  view,
  prop,
  apply,
}: {
  db: Database;
  view: DbView;
  prop: Property;
  apply: (ops: DbOp[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const isTitle = prop.type === "title";

  return (
    <span className="menu-anchor col-header">
      <button className="col-name" onClick={() => setOpen(!open)}>
        {prop.name} <span className="muted small">▾</span>
      </button>
      {open && (
        <div className="dropdown" onMouseLeave={() => setOpen(false)}>
          <button
            onClick={async () => {
              setOpen(false);
              const name = prompt("Rename property", prop.name);
              if (name && name !== prop.name)
                await apply([{ op: "property_rename", property_id: prop.id, name }]);
            }}
          >
            Rename
          </button>
          {!isTitle && (
            <button
              onClick={() => {
                setOpen(false);
                void apply([
                  {
                    op: "view_update",
                    view: {
                      ...view,
                      hidden_properties: [...(view.hidden_properties ?? []), prop.id],
                    },
                  },
                ]);
              }}
            >
              Hide in view
            </button>
          )}
          {(prop.type === "select" || prop.type === "multi_select") && (
            <button
              onClick={async () => {
                setOpen(false);
                const name = prompt("New option name");
                if (name)
                  await apply([{ op: "select_option_add", property_id: prop.id, name }]);
              }}
            >
              Add option
            </button>
          )}
          {!isTitle && (
            <button
              className="danger"
              onClick={() => {
                setOpen(false);
                if (confirm(`Delete property "${prop.name}" and its data?`))
                  void apply([{ op: "property_delete", property_id: prop.id }]);
              }}
            >
              Delete property
            </button>
          )}
          {(view.hidden_properties?.length ?? 0) > 0 && (
            <button
              onClick={() => {
                setOpen(false);
                void apply([
                  { op: "view_update", view: { ...view, hidden_properties: [] } },
                ]);
              }}
            >
              Unhide all ({view.hidden_properties?.length})
            </button>
          )}
        </div>
      )}
    </span>
  );
}

// ---------------------------------------------------------- row peek ----

function RowPeek({
  db,
  row,
  apply,
  onClose,
}: {
  db: Database;
  row: DbRow;
  apply: (ops: DbOp[]) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div className="row-peek">
      <div className="row-peek-header">
        <span className="panel-title">Row</span>
        <button className="small" onClick={onClose}>
          ×
        </button>
      </div>
      {db.properties.map((p) => (
        <div key={p.id} className="row-peek-field">
          <label className="muted small">{p.name}</label>
          <CellEditor
            row={row}
            prop={p}
            onChange={(value) =>
              apply([{ op: "row_update", row_id: row.id, cells: { [p.id]: value } }])
            }
          />
        </div>
      ))}
      <button
        className="small danger"
        onClick={() => {
          onClose();
          void apply([{ op: "row_delete", row_id: row.id }]);
        }}
      >
        Delete row
      </button>
    </div>
  );
}

// ------------------------------------------------------------ cells ----

function CellEditor({
  row,
  prop,
  onChange,
}: {
  row: DbRow;
  prop: Property;
  onChange: (value: unknown) => void;
}) {
  const cell = row.cells[prop.id];
  const value = cell?.value;

  switch (prop.type) {
    case "checkbox":
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case "select":
      return (
        <select
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">—</option>
          {(prop.options ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      );
    case "multi_select": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <select
          multiple
          value={selected}
          onChange={(e) =>
            onChange(Array.from(e.target.selectedOptions).map((o) => o.value))
          }
        >
          {(prop.options ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      );
    }
    case "date":
      return (
        <input
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case "number":
      return (
        <DebouncedInput
          type="number"
          initial={value == null ? "" : String(value)}
          onCommit={(v) => onChange(v === "" ? null : Number(v))}
        />
      );
    default:
      return (
        <DebouncedInput
          type="text"
          initial={typeof value === "string" ? value : ""}
          onCommit={(v) => onChange(v === "" ? null : v)}
        />
      );
  }
}

function DebouncedInput({
  type,
  initial,
  onCommit,
}: {
  type: string;
  initial: string;
  onCommit: (v: string) => void;
}) {
  const [val, setVal] = useState(initial);
  useEffect(() => setVal(initial), [initial]);
  return (
    <input
      type={type}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => {
        if (val !== initial) onCommit(val);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

// ------------------------------------------------------------- kanban ----

function KanbanView({
  db,
  viewId,
  apply,
  onPeek,
}: {
  db: Database;
  viewId: string;
  apply: (ops: DbOp[]) => Promise<void>;
  onPeek: (rowId: string) => void;
}) {
  const view = db.views.find((v) => v.id === viewId)!;
  const groupProp = db.properties.find((p) => p.id === view.group_by);
  const titleProp = db.properties.find((p) => p.type === "title");
  const [dragId, setDragId] = useState<string | null>(null);

  const groups = useMemo(() => {
    const options = groupProp?.options ?? [];
    const buckets: { id: string; name: string; rows: DbRow[] }[] = [
      { id: "", name: "No status", rows: [] },
      ...options.map((o) => ({ id: o.id, name: o.name, rows: [] as DbRow[] })),
    ];
    for (const row of db.rows) {
      const v = row.cells[groupProp?.id ?? ""]?.value;
      const bucket = buckets.find((b) => b.id === (typeof v === "string" ? v : ""));
      (bucket ?? buckets[0]).rows.push(row);
    }
    for (const bucket of buckets) {
      const explicit = view.group_order?.[bucket.id];
      if (explicit) {
        bucket.rows.sort(
          (a, b) =>
            (explicit.indexOf(a.id) + 1 || 1e9) - (explicit.indexOf(b.id) + 1 || 1e9),
        );
      }
    }
    return buckets;
  }, [db, groupProp, view]);

  if (!groupProp) {
    return <div className="placeholder muted">This view has no group-by property.</div>;
  }

  return (
    <div className="kanban">
      {groups.map((group) => (
        <div
          key={group.id || "__none__"}
          className="kanban-col"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (dragId) {
              void apply([
                {
                  op: "kanban_move",
                  view_id: viewId,
                  row_id: dragId,
                  to_group: group.id,
                  index: group.rows.length,
                },
              ]);
              setDragId(null);
            }
          }}
        >
          <div className="kanban-col-header">
            {group.name} <span className="muted">{group.rows.length}</span>
          </div>
          {group.rows.map((row) => (
            <div
              key={row.id}
              className="kanban-card"
              draggable
              onDragStart={() => setDragId(row.id)}
              onDoubleClick={() => onPeek(row.id)}
            >
              {String(row.cells[titleProp?.id ?? ""]?.value ?? "") || (
                <span className="muted">Untitled</span>
              )}
            </div>
          ))}
          <button
            className="kanban-add small"
            onClick={() =>
              apply([
                { op: "row_create", cells: group.id ? { [groupProp.id]: group.id } : {} },
              ])
            }
          >
            + Card
          </button>
        </div>
      ))}
      <button
        className="kanban-add-col small"
        onClick={async () => {
          const name = prompt("New column name");
          if (name)
            await apply([{ op: "select_option_add", property_id: groupProp.id, name }]);
        }}
      >
        + Column
      </button>
    </div>
  );
}
