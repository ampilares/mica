import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useStore, kindOfPath, titleOfPath } from "./store";
import { VaultEvent } from "./api";
import Onboarding from "./components/Onboarding";
import Sidebar from "./components/Sidebar";
import Tabs from "./components/Tabs";
import NoteEditor from "./components/NoteEditor";
import SourceEditor from "./components/SourceEditor";
import DatabaseView from "./components/DatabaseView";
import CanvasView from "./components/CanvasView";
import QuickSwitcher from "./components/QuickSwitcher";
import SearchPanel from "./components/SearchPanel";
import ConflictDialog from "./components/ConflictDialog";
import StatusBar from "./components/StatusBar";
import CommandPalette from "./components/CommandPalette";
import RightPanel from "./components/RightPanel";
import DataExplainer from "./components/DataExplainer";
import SettingsDialog from "./components/SettingsDialog";
import GraphPanel from "./components/GraphPanel";
import ActivityRail from "./components/ActivityRail";
import { docEvents } from "./docEvents";
import { useSettings, applySettings } from "./settings";

export default function App() {
  const vault = useStore((s) => s.vault);
  const tabs = useStore((s) => s.tabs);
  const activePath = useStore((s) => s.activePath);
  const refreshTree = useStore((s) => s.refreshTree);
  const setQuickSwitcherOpen = useStore((s) => s.setQuickSwitcherOpen);
  const setSearchOpen = useStore((s) => s.setSearchOpen);
  const sourceMode = useStore((s) => s.sourceMode);

  // Apply appearance settings (theme, fonts) whenever they change.
  const settings = useSettings();
  useEffect(() => {
    applySettings(settings);
    if (settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applySettings(useSettings.getState());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [settings]);

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "p") {
        e.preventDefault();
        setQuickSwitcherOpen(true);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (mod && e.key === "k") {
        e.preventDefault();
        useStore.getState().setCommandPaletteOpen(true);
      } else if (mod && e.key === "\\") {
        e.preventDefault();
        useStore.getState().setRightPanelOpen(!useStore.getState().rightPanelOpen);
      } else if (mod && e.key === "g") {
        e.preventDefault();
        useStore.getState().setGraphOpen(!useStore.getState().graphOpen);
      } else if (mod && e.key === ",") {
        e.preventDefault();
        useStore.getState().setSettingsOpen(true);
      } else if (mod && e.key === "e") {
        const s = useStore.getState();
        if (s.activePath && kindOfPath(s.activePath) === "note") {
          e.preventDefault();
          s.toggleSourceMode(s.activePath);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setQuickSwitcherOpen, setSearchOpen]);

  // Vault file events from the Rust watcher.
  useEffect(() => {
    if (!vault) return;
    const un = listen<VaultEvent[]>("vault:events", (event) => {
      refreshTree();
      for (const ev of event.payload) {
        docEvents.emit(ev);
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, [vault, refreshTree]);

  if (!vault) {
    return <Onboarding />;
  }

  return (
    <div className="app">
      <ActivityRail />
      <Sidebar />
      <div className="main">
        <Tabs />
        <div className="content">
          {tabs.map((tab) => {
            const kind = kindOfPath(tab.path);
            const active = tab.path === activePath;
            return (
              <div key={tab.path} className="doc-pane" style={{ display: active ? "flex" : "none" }}>
                {kind === "note" &&
                  (sourceMode[tab.path] ? (
                    <SourceEditor key="src" path={tab.path} active={active} />
                  ) : (
                    <NoteEditor key="rich" path={tab.path} active={active} />
                  ))}
                {kind === "database" && <DatabaseView path={tab.path} embed={false} />}
                {kind === "canvas" && <CanvasView path={tab.path} active={active} />}
                {kind === "other" && (
                  <div className="placeholder">
                    <p>{titleOfPath(tab.path)}</p>
                    <p className="muted">This file type opens in an external app.</p>
                  </div>
                )}
              </div>
            );
          })}
          {tabs.length === 0 && (
            <div className="placeholder empty-workspace">
              <div className="empty-mark">M</div>
              <h2>Your workspace is ready</h2>
              <p className="muted">Open a file from the sidebar or start with a quick action.</p>
              <div className="empty-actions">
                <button onClick={() => setQuickSwitcherOpen(true)}>Open a file <kbd>Ctrl P</kbd></button>
                <button onClick={() => useStore.getState().setCommandPaletteOpen(true)}>Run a command <kbd>Ctrl K</kbd></button>
              </div>
            </div>
          )}
        </div>
        <StatusBar />
      </div>
      <RightPanel />
      <QuickSwitcher />
      <SearchPanel />
      <CommandPalette />
      <ConflictDialog />
      <DataExplainer />
      <SettingsDialog />
      <GraphPanel />
    </div>
  );
}
