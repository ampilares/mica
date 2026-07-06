import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  Database,
  DbOp,
  DbRow,
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

export default function DatabaseView({ path, embed, initialView }: Props) {
  const [db, setDb] = useState<Database | null>(null);
  const [version, setVersion] = useState<string>("");
  const [viewId, setViewId] = useState<string>(initialView ?? "table_default");
  const [error, setError] = useState<string | null>(null);
  const openTab = useStore((s) => s.openTab);
  const pathRef = useRef(path);
  pathRef.current = path;

  const load = useCallback(async () => {
    try {
      const file = await api.dbLoad(pathRef.current);
      setDb(JSON.parse(file.content));
      setVersion(file.version);
      setError(null);
    } catch (e) {
      setError(isApiError(e) ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, path]);

  // External changes: databases have no local dirty state (every edit saves
  // immediately), so external modifications just reload.
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
        setDb(JSON.parse(result.content));
        setVersion(result.version);
        setError(null);
      } catch (e) {
        if (isApiError(e) && e.code === "conflict") {
          // Someone else changed the file — reload and let the user retry.
          await load();
          setError("File changed on disk — reloaded. Try the edit again.");
        } else {
          setError(isApiError(e) ? e.message : String(e));
        }
      }
    },
    [version, load],
  );

  if (error && !db) return <div className="placeholder error">{error}</div>;
  if (!db) return <div className="placeholder muted">Loading…</div>;

  const view = db.views.find((v) => v.id === viewId) ?? db.views[0];

  return (
    <div className={`db-view ${embed ? "embed" : "full"}`}>
      <div className="db-toolbar">
        <span className="db-title">{db.title}</span>
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
        <div className="spacer" />
        {embed && (
          <button
            className="small"
            onClick={() =>
              openTab({ path, kind: "database", title: titleOfPath(path) })
            }
          >
            Open full page
          </button>
        )}
        <button
          className="small"
          onClick={() => apply([{ op: "row_create", cells: {} }])}
        >
          + Row
        </button>
      </div>
      {error && <div className="banner warning">{error}</div>}
      {view.type === "table" ? (
        <TableView db={db} viewId={view.id} apply={apply} />
      ) : (
        <KanbanView db={db} viewId={view.id} apply={apply} />
      )}
    </div>
  );
}

// ------------------------------------------------------------- table ----

function TableView({
  db,
  viewId,
  apply,
}: {
  db: Database;
  viewId: string;
  apply: (ops: DbOp[]) => Promise<void>;
}) {
  const view = db.views.find((v) => v.id === viewId)!;
  const hidden = new Set(view.hidden_properties ?? []);
  const props = db.properties.filter((p) => !hidden.has(p.id));

  // Apply view sorts/filters via row order from the core would need dbQuery;
  // MVP renders canonical order and delegates sort/filter to Phase-2 polish.
  const rows = db.rows;

  const addProperty = async () => {
    const name = prompt("Property name", "Notes");
    if (!name) return;
    const type = prompt(
      "Type: text, number, checkbox, select, multi_select, date, url",
      "text",
    ) as PropertyType | null;
    if (!type) return;
    await apply([{ op: "property_add", name, prop_type: type }]);
  };

  return (
    <div className="db-table-wrap">
      <table className="db-table">
        <thead>
          <tr>
            {props.map((p) => (
              <th key={p.id}>
                <span
                  onDoubleClick={async () => {
                    const name = prompt("Rename property", p.name);
                    if (name && name !== p.name)
                      await apply([
                        { op: "property_rename", property_id: p.id, name },
                      ]);
                  }}
                >
                  {p.name}
                </span>
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
          {rows.map((row) => (
            <tr key={row.id}>
              {props.map((p) => (
                <td key={p.id}>
                  <CellEditor
                    row={row}
                    prop={p}
                    onChange={(value) =>
                      apply([
                        { op: "row_update", row_id: row.id, cells: { [p.id]: value } },
                      ])
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
          {rows.length === 0 && (
            <tr>
              <td colSpan={props.length + 1} className="muted">
                No rows yet — click “+ Row”.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

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
    case "select": {
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
}: {
  db: Database;
  viewId: string;
  apply: (ops: DbOp[]) => Promise<void>;
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
    // Respect explicit per-group order.
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

  const addOption = async () => {
    const name = prompt("New column name");
    if (!name) return;
    await apply([{ op: "select_option_add", property_id: groupProp.id, name }]);
  };

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
              apply([
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
                {
                  op: "row_create",
                  cells: group.id ? { [groupProp.id]: group.id } : {},
                },
              ])
            }
          >
            + Card
          </button>
        </div>
      ))}
      <button className="kanban-add-col small" onClick={addOption}>
        + Column
      </button>
    </div>
  );
}
