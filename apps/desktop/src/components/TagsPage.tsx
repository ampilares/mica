import { useMemo } from "react";
import { useStore } from "../store";
import { useWorkspaceMeta, TAG_COLORS, tagColorValue } from "../workspaceMeta";
import AllDocsPage from "./AllDocsPage";

/** Tags index page (FR2-TAG-001): every tag with count and color picker. */
export default function TagsPage() {
  const docs = useStore((s) => s.docs);
  const openTab = useStore((s) => s.openTab);
  const meta = useWorkspaceMeta();

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of docs) for (const t of d.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [docs]);

  return (
    <div className="page docs-page">
      <div className="page-header">
        <h1>Tags</h1>
      </div>
      <div className="tags-grid">
        {tags.map(([tag, count]) => (
          <div key={tag} className="tag-card">
            <button
              className="tag-card-main"
              onClick={() =>
                openTab({ path: `mica://tag/${tag}`, kind: "page", title: `#${tag}` })
              }
            >
              <span className="tag-dot" style={{ background: tagColorValue(meta.tagColors[tag]) }} />
              <span className="tag-name">#{tag}</span>
              <span className="muted small">{count} docs</span>
            </button>
            <select
              className="tag-color-picker"
              title="Tag color"
              value={meta.tagColors[tag] ?? "blue"}
              onChange={(e) => void meta.setTagColor(tag, e.target.value)}
            >
              {TAG_COLORS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        ))}
        {tags.length === 0 && (
          <div className="placeholder">
            <p className="muted">
              No tags yet. Add <code>#tags</code> in a doc or tags in frontmatter.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** A single tag's docs, reusing the All-docs list UI. */
export function TagPage({ tag }: { tag: string }) {
  const docs = useStore((s) => s.docs);
  const tagged = useMemo(() => docs.filter((d) => d.tags.includes(tag)), [docs, tag]);
  return <AllDocsPage docsOverride={tagged} heading={`#${tag}`} />;
}
