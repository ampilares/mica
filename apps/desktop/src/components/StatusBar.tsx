import { useStore } from "../store";
import { resourcePath } from "../workspace";

export default function StatusBar() {
  const saveStatus = useStore((s) => s.saveStatus);
  const activeResourcePath = useStore((s) => {
    const pane = s.workspace.panes[s.workspace.focusedPaneId];
    return pane ? resourcePath(s.workspace.tabs[pane.activeTabId].view) : undefined;
  });

  const label =
    saveStatus === "saving"
      ? "Saving…"
      : saveStatus === "saved"
        ? "Saved"
        : saveStatus === "error"
          ? "Save failed"
          : "";

  return (
    <div className="status-bar">
      <span className="muted">{activeResourcePath ?? ""}</span>
      <span className={`save-status ${saveStatus}`}>{label}</span>
    </div>
  );
}
