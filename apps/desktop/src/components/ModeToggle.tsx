import { useStore } from "../store";

/** Rich ⇄ source mode switch shown in the note header (FR-NOTE-009). */
export default function ModeToggle({ path }: { path: string }) {
  const sourceMode = useStore((s) => s.sourceMode[path] ?? false);
  const toggle = useStore((s) => s.toggleSourceMode);
  return (
    <div className="mode-toggle" title="Toggle Markdown source mode (Ctrl+E)">
      <button className={!sourceMode ? "active" : ""} onClick={() => sourceMode && toggle(path)}>
        Rich
      </button>
      <button className={sourceMode ? "active" : ""} onClick={() => !sourceMode && toggle(path)}>
        Source
      </button>
    </div>
  );
}
