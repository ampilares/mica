import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { docEvents } from "../docEvents";
import { formatDate } from "./AllDocsPage";

type Scalar = string | number | boolean;

/** AFFiNE-style doc Info panel (FR2-NFO): created/updated, tags, and custom
 * frontmatter properties. Edits merge-patch the frontmatter only. */
export default function InfoPanel({ path }: { path: string }) {
  const refreshDocs = useStore((s) => s.refreshDocs);
  const [meta, setMeta] = useState<Record<string, unknown>>({});
  const [version, setVersion] = useState<string>("");
  const [newTag, setNewTag] = useState("");
  const [newProp, setNewProp] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [m, file] = await Promise.all([api.noteMetaGet(path), api.noteLoad(path)]);
      setMeta(m);
      setVersion(file.version);
      setError(null);
    } catch {
      setMeta({});
    }
  }, [path]);

  useEffect(() => {
    void refresh();
    const off = docEvents.on((ev) => {
      if ("path" in ev && ev.path === path) void refresh();
    });
    return off;
  }, [refresh, path]);

  const patch = async (p: Record<string, unknown>) => {
    try {
      const out = await api.noteMetaSet(path, p, version);
      setVersion(out.version);
      await refresh();
      refreshDocs();
    } catch (e) {
      setError("Save failed — the file changed on disk. Reloading.");
      await refresh();
      void e;
    }
  };

  const tags: string[] = Array.isArray(meta.tags)
    ? (meta.tags as unknown[]).filter((t): t is string => typeof t === "string")
    : [];
  const properties: Record<string, Scalar> =
    typeof meta.properties === "object" && meta.properties !== null
      ? Object.fromEntries(
          Object.entries(meta.properties as Record<string, unknown>).filter(
            (kv): kv is [string, Scalar] =>
              ["string", "number", "boolean"].includes(typeof kv[1]),
          ),
        )
      : {};

  return (
    <div className="panel-body info-panel">
      {error && <p className="info-error">{error}</p>}

      <div className="info-row">
        <span className="info-key">Created</span>
        <span>{typeof meta.created === "string" ? formatDate(meta.created) : "—"}</span>
      </div>
      <div className="info-row">
        <span className="info-key">Updated</span>
        <span>{typeof meta.updated === "string" ? formatDate(meta.updated) : "—"}</span>
      </div>
      {typeof meta.journal === "string" && (
        <div className="info-row">
          <span className="info-key">Journal</span>
          <span>{meta.journal}</span>
        </div>
      )}

      <div className="info-section">Tags</div>
      <div className="info-tags">
        {tags.map((t) => (
          <span key={t} className="doc-tag removable">
            #{t}
            <button
              className="tag-remove"
              onClick={() => void patch({ tags: tags.filter((x) => x !== t) })}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="tag-input"
          placeholder="Add tag…"
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newTag.trim()) {
              const t = newTag.trim().replace(/^#/, "");
              if (!tags.includes(t)) void patch({ tags: [...tags, t] });
              setNewTag("");
            }
          }}
        />
      </div>

      <div className="info-section">Properties</div>
      {Object.entries(properties).map(([key, value]) => (
        <PropertyRow
          key={key}
          name={key}
          value={value}
          onChange={(v) => void patch({ properties: { ...properties, [key]: v } })}
          onDelete={() => {
            const next: Record<string, Scalar | null> = { ...properties };
            delete next[key];
            void patch({
              properties: Object.keys(next).length > 0 ? next : null,
            });
          }}
        />
      ))}
      <input
        className="tag-input"
        placeholder="＋ Add property…"
        value={newProp}
        onChange={(e) => setNewProp(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && newProp.trim()) {
            const name = newProp.trim();
            if (!(name in properties)) {
              void patch({ properties: { ...properties, [name]: "" } });
            }
            setNewProp("");
          }
        }}
      />
    </div>
  );
}

function PropertyRow({
  name,
  value,
  onChange,
  onDelete,
}: {
  name: string;
  value: Scalar;
  onChange: (v: Scalar) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    if (draft === String(value)) return;
    if (typeof value === "boolean") return;
    const num = Number(draft);
    onChange(draft !== "" && !Number.isNaN(num) && typeof value === "number" ? num : draft);
  };

  return (
    <div className="info-row property">
      <span className="info-key" title={name}>
        {name}
      </span>
      {typeof value === "boolean" ? (
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      ) : (
        <input
          className="property-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
      )}
      <button className="icon-button" title="Remove property" onClick={onDelete}>
        ×
      </button>
    </div>
  );
}
