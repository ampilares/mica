import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useStore, kindOfPath, titleOfPath } from "./store";
import { VaultEvent } from "./api";
import Onboarding from "./components/Onboarding";
import Sidebar from "./components/Sidebar";
import Tabs from "./components/Tabs";
import NoteEditor from "./components/NoteEditor";
import DatabaseView from "./components/DatabaseView";
import CanvasView from "./components/CanvasView";
import QuickSwitcher from "./components/QuickSwitcher";
import SearchPanel from "./components/SearchPanel";
import ConflictDialog from "./components/ConflictDialog";
import StatusBar from "./components/StatusBar";
import CommandPalette from "./components/CommandPalette";
import RightPanel from "./components/RightPanel";
import DataExplainer from "./components/DataExplainer";
import { docEvents } from "./docEvents";

export default function App() {
  const vault = useStore((s) => s.vault);
  const tabs = useStore((s) => s.tabs);
  const activePath = useStore((s) => s.activePath);
  const refreshTree = useStore((s) => s.refreshTree);
  const setQuickSwitcherOpen = useStore((s) => s.setQuickSwitcherOpen);
  const setSearchOpen = useStore((s) => s.setSearchOpen);

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
      <Sidebar />
      <div className="main">
        <Tabs />
        <div className="content">
          {tabs.map((tab) => {
            const kind = kindOfPath(tab.path);
            const active = tab.path === activePath;
            return (
              <div key={tab.path} className="doc-pane" style={{ display: active ? "flex" : "none" }}>
                {kind === "note" && <NoteEditor path={tab.path} active={active} />}
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
            <div className="placeholder">
              <h2>Mica</h2>
              <p className="muted">
                Create a note from the sidebar, or press Ctrl+P to open something.
              </p>
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
    </div>
  );
}
