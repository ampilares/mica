import { useStore } from "../store";
import type { TabId } from "../workspace";

/** Rich ⇄ source mode switch shown in the note header (FR-NOTE-009). */
export default function ModeToggle({ tabId, source }: { tabId: TabId; source: boolean }) {
  const toggle = useStore((s) => s.toggleTabSourceMode);
  return (
    <div className="mode-toggle" title="Toggle Markdown source mode (Ctrl+E)">
      <button className={!source ? "active" : ""} onClick={() => { if (source) void toggle(tabId); }}>
        Rich
      </button>
      <button className={source ? "active" : ""} onClick={() => { if (!source) void toggle(tabId); }}>
        Source
      </button>
    </div>
  );
}
