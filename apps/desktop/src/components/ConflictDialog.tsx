import { useState } from "react";
import { api, isApiError } from "../api";
import { useStore } from "../store";

/**
 * Shown when a save hit a newer on-disk version, or an external edit arrived
 * while the editor held unsaved changes (spec §8.2).
 */
export default function ConflictDialog() {
  const conflict = useStore((s) => s.conflict);
  const setConflict = useStore((s) => s.setConflict);
  const refreshTree = useStore((s) => s.refreshTree);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!conflict) return null;

  const resolve = async (resolution: "keep_mine" | "take_theirs" | "keep_both") => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await api.conflictResolve(
        conflict.path,
        resolution,
        conflict.myContent,
      );
      window.dispatchEvent(
        new CustomEvent("mica:conflict-resolved", {
          detail: outcome,
        }),
      );
      if (resolution === "keep_both") {
        // The original editor should now show the on-disk (theirs) version;
        // my content lives on in the conflict copy that we open in a new tab.
        const theirs = await api.noteLoad(conflict.path);
        window.dispatchEvent(
          new CustomEvent("mica:conflict-resolved", { detail: theirs }),
        );
        useStore
          .getState()
          .openTab({ path: outcome.path, kind: "note", title: outcome.path });
        await refreshTree();
      }
      setConflict(null);
    } catch (e) {
      setError(isApiError(e) ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal conflict">
        <h3>File changed on disk</h3>
        <p className="muted">
          <code>{conflict.path}</code> was modified outside the editor while you
          had unsaved changes. Choose how to resolve:
        </p>
        <div className="conflict-actions">
          <button disabled={busy} onClick={() => resolve("keep_mine")}>
            Keep mine
            <span className="muted small">backs up the disk version first</span>
          </button>
          <button disabled={busy} onClick={() => resolve("take_theirs")}>
            Take theirs
            <span className="muted small">discards my unsaved edits</span>
          </button>
          <button disabled={busy} onClick={() => resolve("keep_both")}>
            Keep both
            <span className="muted small">saves mine as a conflict copy</span>
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
