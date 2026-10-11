import { useCallback, useEffect, useState } from "react";
import { api, TrashEntry } from "../api";
import { useStore } from "../store";
import { formatDate } from "./AllDocsPage";
import { iconOf } from "./Sidebar";

/** Trash page (FR2-TRS): list, restore, delete forever, empty. */
export default function TrashPage() {
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const refreshTree = useStore((s) => s.refreshTree);
  const refreshDocs = useStore((s) => s.refreshDocs);
  const openDoc = useStore((s) => s.openDoc);
  const showToast = useStore((s) => s.showToast);

  const refresh = useCallback(() => {
    api.trashList().then(setEntries).catch(() => setEntries([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const restore = async (entry: TrashEntry) => {
    const restored = await api.trashRestore(entry.trash_path);
    refresh();
    await refreshTree();
    refreshDocs();
    showToast({
      message: `Restored "${entry.title}"`,
      action: { label: "Open", run: () => openDoc(restored) },
    });
  };

  const purge = async (entry: TrashEntry) => {
    if (!confirm(`Permanently delete "${entry.title}"? This cannot be undone.`)) return;
    await api.trashPurge(entry.trash_path);
    refresh();
  };

  const emptyTrash = async () => {
    if (entries.length === 0) return;
    if (!confirm(`Permanently delete all ${entries.length} items in trash?`)) return;
    await api.trashPurge();
    refresh();
  };

  return (
    <div className="page docs-page">
      <div className="page-header">
        <h1>Trash</h1>
        <div className="docs-filters">
          <button className="chip danger" onClick={() => void emptyTrash()}>
            Empty trash
          </button>
        </div>
      </div>
      <p className="muted trash-note">
        Deleted files live in <code>.trash/</code> inside your vault until restored or
        deleted forever.
      </p>
      <div className="docs-list">
        {entries.map((entry) => (
          <div key={entry.trash_path} className="docs-row static">
            <span className="docs-cell name">
              <span className="file-icon">{iconOf(entry.kind)}</span>
              <span className="docs-title">{entry.title}</span>
              <span className="muted small">{entry.original}</span>
            </span>
            <span className="docs-cell date">{formatDate(entry.deleted)}</span>
            <span className="docs-cell actions">
              <button className="chip" onClick={() => void restore(entry)}>
                Restore
              </button>
              <button className="chip danger" onClick={() => void purge(entry)}>
                Delete forever
              </button>
            </span>
          </div>
        ))}
        {entries.length === 0 && (
          <div className="placeholder">
            <p className="muted">Trash is empty.</p>
          </div>
        )}
      </div>
    </div>
  );
}
