import { useStore } from "../store";
import { useSettings } from "../settings";
import { IconButton } from "./ui";

export default function ActivityRail() {
  const rightOpen = useStore((s) => s.rightPanelOpen);
  const leftOpen = useStore((s) => s.workspace.sidebars.left.open);
  const settings = useSettings();
  const resolvedDark = settings.theme === "system"
    ? !window.matchMedia("(prefers-color-scheme: light)").matches
    : settings.theme === "dark";
  const toggleTheme = () => settings.set({ theme: resolvedDark ? "light" : "dark" });

  return (
    <nav className="activity-rail" aria-label="Workspace tools">
      <div className="mica-mark" title="Mica">M</div>
      <IconButton className={leftOpen ? "active" : ""} label="Files" icon="files" pressed={leftOpen} tooltip="Toggle file sidebar" tooltipSide="right" onClick={() => useStore.getState().setWorkspaceSidebar("left", { open: !leftOpen })} />
      <IconButton label="Search" icon="search" tooltip="Search (Ctrl+Shift+F)" tooltipSide="right" onClick={() => useStore.getState().setSearchOpen(true)} />
      <IconButton label="Graph view" icon="graph" tooltip="Graph view (Ctrl+G)" tooltipSide="right" onClick={() => {
        const state = useStore.getState();
        state.createWorkspaceTab(state.workspace.focusedPaneId, { type: "graph" });
      }} />
      <IconButton label="Command palette" icon="command" tooltip="Command palette (Ctrl+K)" tooltipSide="right" onClick={() => useStore.getState().setCommandPaletteOpen(true)} />
      <div className="rail-spacer" />
      <IconButton className={rightOpen ? "active" : ""} label="Toggle context panel" icon="panelRight" pressed={rightOpen} tooltip="Toggle context panel (Ctrl+Shift+\\)" tooltipSide="right" onClick={() => useStore.getState().setRightPanelOpen(!rightOpen)} />
      <IconButton label="Toggle color theme" icon={resolvedDark ? "sun" : "moon"} tooltip={resolvedDark ? "Use light mode" : "Use dark mode"} tooltipSide="right" onClick={toggleTheme} />
      <IconButton label="Settings" icon="settings" tooltip="Settings (Ctrl+,)" tooltipSide="right" onClick={() => useStore.getState().setSettingsOpen(true)} />
    </nav>
  );
}
