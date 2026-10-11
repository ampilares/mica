import { useMemo, useState } from "react";
import { useStore } from "../store";
import {
  Collection,
  CollectionRule,
  collectionMatches,
  useWorkspaceMeta,
} from "../workspaceMeta";
import AllDocsPage from "./AllDocsPage";

/** Collection page (FR2-COL): matched docs + rules/docs editor. */
export default function CollectionPage({ id }: { id: string }) {
  const docs = useStore((s) => s.docs);
  const closeTab = useStore((s) => s.closeTab);
  const meta = useWorkspaceMeta();
  const [editing, setEditing] = useState(false);

  const col = meta.collections.find((c) => c.id === id);

  const matched = useMemo(() => {
    if (!col) return [];
    const keep = collectionMatches(col, docs);
    return docs.filter((d) => keep.has(d.path));
  }, [col, docs]);

  if (!col) {
    return (
      <div className="page">
        <div className="placeholder">
          <p className="muted">This collection no longer exists.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="collection-page">
      <div className="collection-toolbar">
        <button className="chip" onClick={() => setEditing(true)}>
          Edit collection
        </button>
        <button
          className="chip danger"
          onClick={async () => {
            if (!confirm(`Delete collection "${col.name}"? Docs are not affected.`)) return;
            await meta.removeCollection(col.id);
            closeTab(`mica://collection/${col.id}`);
          }}
        >
          Delete collection
        </button>
      </div>
      <AllDocsPage docsOverride={matched} heading={col.name} />
      {editing && (
        <CollectionEditor
          col={col}
          onClose={() => setEditing(false)}
          onSave={async (next) => {
            await meta.updateCollection(next);
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}

function CollectionEditor({
  col,
  onClose,
  onSave,
}: {
  col: Collection;
  onClose: () => void;
  onSave: (col: Collection) => Promise<void>;
}) {
  const docs = useStore((s) => s.docs);
  const [name, setName] = useState(col.name);
  const [rules, setRules] = useState<CollectionRule[]>(col.rules);
  const [manual, setManual] = useState<string[]>(col.docs);
  const [docQuery, setDocQuery] = useState("");

  const candidates = docs.filter(
    (d) =>
      !manual.includes(d.path) &&
      (docQuery === "" || d.title.toLowerCase().includes(docQuery.toLowerCase())),
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal collection-editor" onClick={(e) => e.stopPropagation()}>
        <h2>Edit collection</h2>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="field">
          <span>
            Rules <span className="muted small">(docs matching all rules are included)</span>
          </span>
          {rules.map((rule, i) => (
            <div key={i} className="rule-row">
              <select
                value={rule.kind}
                onChange={(e) =>
                  setRules(
                    rules.map((r, j) =>
                      j === i ? { ...r, kind: e.target.value as CollectionRule["kind"] } : r,
                    ),
                  )
                }
              >
                <option value="tag">Tag is</option>
                <option value="title_contains">Title contains</option>
              </select>
              <input
                value={rule.value}
                placeholder={rule.kind === "tag" ? "tag name" : "text"}
                onChange={(e) =>
                  setRules(rules.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))
                }
              />
              <button
                className="icon-button"
                onClick={() => setRules(rules.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
          <button
            className="chip"
            onClick={() => setRules([...rules, { kind: "tag", value: "" }])}
          >
            ＋ Add rule
          </button>
        </div>

        <div className="field">
          <span>Docs added manually</span>
          {manual.map((path) => (
            <div key={path} className="rule-row">
              <span className="nav-label">{path}</span>
              <button
                className="icon-button"
                onClick={() => setManual(manual.filter((p) => p !== path))}
              >
                ×
              </button>
            </div>
          ))}
          <input
            placeholder="Search docs to add…"
            value={docQuery}
            onChange={(e) => setDocQuery(e.target.value)}
          />
          {docQuery && (
            <div className="candidate-list">
              {candidates.slice(0, 8).map((d) => (
                <button
                  key={d.path}
                  className="palette-item"
                  onClick={() => {
                    setManual([...manual, d.path]);
                    setDocQuery("");
                  }}
                >
                  {d.title} <span className="muted small">{d.path}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            onClick={() =>
              void onSave({
                ...col,
                name: name.trim() || col.name,
                rules: rules.filter((r) => r.value.trim() !== ""),
                docs: manual,
              })
            }
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
