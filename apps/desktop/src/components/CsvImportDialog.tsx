import { useEffect, useState } from "react";
import { api, ColumnMapping, CsvPreview, Database, PropertyType } from "../api";

const NEW_TYPES: PropertyType[] = ["text", "number", "checkbox", "select", "multi_select", "date", "url"];

/** Column-mapping UI for CSV import (FR-IMP-002). */
export default function CsvImportDialog({
  db,
  src,
  onImport,
  onClose,
}: {
  db: Database;
  src: string;
  onImport: (mapping: ColumnMapping[]) => Promise<void>;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .csvPreview(src)
      .then((p) => {
        setPreview(p);
        // Default mapping: match headers to property names, else new text prop.
        setMapping(
          p.headers.map((h) => {
            const prop = db.properties.find(
              (x) => x.name.toLowerCase() === h.trim().toLowerCase(),
            );
            if (prop) return { kind: "property", property_id: prop.id };
            return { kind: "new", name: h.trim() || "Column", prop_type: "text" };
          }),
        );
      })
      .catch((e) => setError(String((e as { message?: string })?.message ?? e)));
  }, [src, db.properties]);

  const setCol = (i: number, m: ColumnMapping) =>
    setMapping((prev) => prev.map((x, j) => (j === i ? m : x)));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings csv-import" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h3>Import CSV</h3>
          <button className="small" onClick={onClose}>
            ✕
          </button>
        </div>
        {error && <div className="error small">{error}</div>}
        {!preview && !error && <div className="muted pad">Reading file…</div>}
        {preview && (
          <>
            <p className="muted small">
              {preview.total_rows} rows · map each column to a property:
            </p>
            {preview.headers.map((h, i) => {
              const m = mapping[i] ?? { kind: "skip" };
              return (
                <div key={i} className="settings-row">
                  <span title={preview.sample.map((r) => r[i]).join(" · ")}>
                    {h || `Column ${i + 1}`}
                  </span>
                  <span className="csv-map-controls">
                    <select
                      value={
                        m.kind === "skip"
                          ? "__skip__"
                          : m.kind === "new"
                            ? "__new__"
                            : m.property_id
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "__skip__") setCol(i, { kind: "skip" });
                        else if (v === "__new__")
                          setCol(i, { kind: "new", name: h.trim() || "Column", prop_type: "text" });
                        else setCol(i, { kind: "property", property_id: v });
                      }}
                    >
                      <option value="__skip__">Skip</option>
                      <option value="__new__">New property…</option>
                      {db.properties.map((p) => (
                        <option key={p.id} value={p.id}>
                          → {p.name}
                        </option>
                      ))}
                    </select>
                    {m.kind === "new" && (
                      <select
                        value={m.prop_type}
                        onChange={(e) =>
                          setCol(i, { ...m, prop_type: e.target.value as PropertyType })
                        }
                      >
                        {NEW_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t.replace("_", " ")}
                          </option>
                        ))}
                      </select>
                    )}
                  </span>
                </div>
              );
            })}
            <div className="dialog-actions">
              <button onClick={onClose}>Cancel</button>
              <button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onImport(mapping);
                    onClose();
                  } catch (e) {
                    setError(String((e as { message?: string })?.message ?? e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Importing…" : `Import ${preview.total_rows} rows`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
