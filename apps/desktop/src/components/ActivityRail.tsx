import { useStore } from "../store";
import { useSettings } from "../settings";

type IconName = "files" | "search" | "graph" | "command" | "panel" | "sun" | "moon" | "settings";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    files: <><path d="M3.5 5.5h5l1.5 2h10.5v11H3.5z"/><path d="M3.5 5.5v-2h6l1.5 2h5"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></>,
    graph: <><circle cx="6" cy="6" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="11" cy="18" r="2"/><path d="m7.8 6.3 8.2 1.4M7.2 7.7l2.7 8.5m6.8-6.5-4.5 6.7"/></>,
    command: <><path d="M9 6H6a3 3 0 1 0 3 3V3m6 3h3a3 3 0 1 1-3 3V3M9 15H6a3 3 0 1 1 3-3v9m6-6h3a3 3 0 1 0-3-3v9"/><path d="M9 9h6v6H9z"/></>,
    panel: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
    moon: <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export default function ActivityRail() {
  const rightOpen = useStore((s) => s.rightPanelOpen);
  const settings = useSettings();
  const resolvedDark = settings.theme === "system"
    ? !window.matchMedia("(prefers-color-scheme: light)").matches
    : settings.theme === "dark";
  const toggleTheme = () => settings.set({ theme: resolvedDark ? "light" : "dark" });

  return (
    <nav className="activity-rail" aria-label="Workspace tools">
      <div className="mica-mark" title="Mica">M</div>
      <button className="active" title="Files" aria-label="Files"><Icon name="files" /></button>
      <button title="Search (Ctrl+Shift+F)" aria-label="Search" onClick={() => useStore.getState().setSearchOpen(true)}><Icon name="search" /></button>
      <button title="Graph view (Ctrl+G)" aria-label="Graph view" onClick={() => useStore.getState().setGraphOpen(true)}><Icon name="graph" /></button>
      <button title="Command palette (Ctrl+K)" aria-label="Command palette" onClick={() => useStore.getState().setCommandPaletteOpen(true)}><Icon name="command" /></button>
      <div className="rail-spacer" />
      <button className={rightOpen ? "active" : ""} title="Toggle context panel (Ctrl+\\)" aria-label="Toggle context panel" onClick={() => useStore.getState().setRightPanelOpen(!rightOpen)}><Icon name="panel" /></button>
      <button title={resolvedDark ? "Use light mode" : "Use dark mode"} aria-label="Toggle color theme" onClick={toggleTheme}><Icon name={resolvedDark ? "sun" : "moon"} /></button>
      <button title="Settings (Ctrl+,)" aria-label="Settings" onClick={() => useStore.getState().setSettingsOpen(true)}><Icon name="settings" /></button>
    </nav>
  );
}
