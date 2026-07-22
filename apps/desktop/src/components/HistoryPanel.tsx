import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { docEvents } from "../docEvents";
import { diffLines, compactDiff } from "../diff";
import "./HistoryPanel.css";

interface Snapshot {
  stamp: string;
  size: number;
}

/** Version history panel (FR21-HIS-002): lists automatic snapshots newest-first
 * and diffs the selected snapshot against the current file, with restore. */
export default function HistoryPanel({ path }: { path: string }) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await api.historyList(path);
      setSnapshots(list);
      setError(null);
    } catch {
      setSnapshots([]);
    }
  }, [path]);

  // Refresh on mount + path change (FR21-HIS-002).
  useEffect(() => {
    setSelected(null);
    void refresh();
  }, [refresh]);

  return (
    <div className="panel-body history-panel">
      {error && <p className="history-error">{error}</p>}
      {snapshots.length === 0 ? (
        <p className="muted small pad">
          No snapshots yet — history is captured automatically as you edit.
        </p>
      ) : (
        <div className="history-list">
          {snapshots.map((snap) => (
            <button
              key={snap.stamp}
              className={`history-item ${selected === snap.stamp ? "active" : ""}`}
              onClick={() => setSelected(selected === snap.stamp ? null : snap.stamp)}
            >
              <span className="history-when">{formatStamp(snap.stamp)}</span>
              <span className="history-size">{(snap.size / 1024).toFixed(1)} KB</span>
            </button>
          ))}
        </div>
      )}
      {selected && (
        <SnapshotDiff
          path={path}
          stamp={selected}
          onError={setError}
          onRestored={() => {
            setSelected(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

/** Diff the selected snapshot against the current file, plus restore action. */
function SnapshotDiff({
  path,
  stamp,
  onError,
  onRestored,
}: {
  path: string;
  stamp: string;
  onError: (msg: string | null) => void;
  onRestored: () => void;
}) {
  const [diff, setDiff] = useState<ReturnType<typeof compactDiff>>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [snapshot, current] = await Promise.all([
          api.historyRead(path, stamp),
          api.noteLoad(path),
        ]);
        if (cancelled) return;
        // removed = lines only in the snapshot, added = lines only in current.
        setDiff(compactDiff(diffLines(snapshot, current.content)));
      } catch {
        if (!cancelled) setDiff([]);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [path, stamp]);

  const restore = async () => {
    if (!confirm("Restore this version? The current state is snapshotted first.")) return;
    try {
      const file = await api.noteLoad(path);
      await api.historyRestore(path, stamp, file.version);
      onError(null);
      // Tell the open editor to reload and refresh the docs list (FR21-HIS-002).
      docEvents.emit({ type: "modified", path });
      await useStore.getState().refreshDocs();
      onRestored();
    } catch {
      onError("Restore failed — the file changed on disk. Reload the doc and try again.");
    }
  };

  return (
    <>
      <div className="history-diff">
        {diff.map((line, i) => (
          <div key={i} className={`history-diff-line ${line.kind}`}>
            {line.text || " "}
          </div>
        ))}
      </div>
      <button className="history-restore" onClick={() => void restore()}>
        Restore this version
      </button>
    </>
  );
}

/** Snapshot stamp prefix is unix-ms before the first "-" (spec §3.4). */
function formatStamp(stamp: string): string {
  const ms = Number(stamp.split("-")[0]);
  if (!Number.isFinite(ms)) return stamp;
  return new Date(ms).toLocaleString();
}
