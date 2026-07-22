import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useStore, kindOfPath, titleOfPath, sidecarOf, journalDateOf } from "./store";
import { api, VaultEvent } from "./api";
import Onboarding from "./components/Onboarding";
import Sidebar from "./components/Sidebar";
import Tabs from "./components/Tabs";
import DocHeader from "./components/DocHeader";
import NoteEditor from "./components/NoteEditor";
import SourceEditor from "./components/SourceEditor";
import DatabaseView from "./components/DatabaseView";
import CanvasView from "./components/CanvasView";
import AllDocsPage from "./components/AllDocsPage";
import TrashPage from "./components/TrashPage";
import TagsPage, { TagPage } from "./components/TagsPage";
import CollectionPage from "./components/CollectionPage";
import BacklinksSection from "./components/BacklinksSection";
import QuickSearch from "./components/QuickSearch";
import ConflictDialog from "./components/ConflictDialog";
import CommandPalette from "./components/CommandPalette";
import RightSidebar from "./components/RightSidebar";
import DataExplainer from "./components/DataExplainer";
import SettingsDialog from "./components/SettingsDialog";
import GraphPanel from "./components/GraphPanel";
import { docEvents } from "./docEvents";
import { useSettings, applySettings } from "./settings";
import { useWorkspaceMeta } from "./workspaceMeta";

export default function App() {
  const vault = useStore((s) => s.vault);
  const tabs = useStore((s) => s.tabs);
  const activePath = useStore((s) => s.activePath);
  const refreshTree = useStore((s) => s.refreshTree);
  const refreshDocs = useStore((s) => s.refreshDocs);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const toast = useStore((s) => s.toast);

  // Apply appearance settings (theme, fonts) whenever they change.
  const settings = useSettings();
  useEffect(() => {
    applySettings(settings);
    if (settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applySettings(useSettings.getState());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [settings]);

  // Global keyboard shortcuts (spec §3.4).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const s = useStore.getState();
      if (mod && !e.shiftKey && (e.key === "k" || e.key === "p")) {
        e.preventDefault();
        s.setQuickSearchOpen(true);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        s.setCommandPaletteOpen(true);
      } else if (mod && e.key === "n" && !e.altKey) {
        e.preventDefault();
        void (async () => {
          const file = await api.noteCreate("Untitled");
          await s.refreshTree();
          void s.refreshDocs();
          s.openDoc(file.path);
        })();
      } else if (mod && e.altKey && e.key === "n") {
        e.preventDefault();
        void (async () => {
          const file = await api.canvasCreate("Untitled");
          await s.refreshTree();
          void s.refreshDocs();
          s.openDoc(file.path);
        })();
      } else if (mod && e.key === "/") {
        e.preventDefault();
        s.setSidebarCollapsed(!s.sidebarCollapsed);
      } else if (mod && e.key === ".") {
        e.preventDefault();
        s.setRightPanelTab(s.rightPanelTab ? null : "outline");
      } else if (mod && e.key === ",") {
        e.preventDefault();
        s.setSettingsOpen(true);
      } else if (mod && e.key === "e") {
        if (s.activePath && kindOfPath(s.activePath) === "note") {
          e.preventDefault();
          s.toggleSourceMode(s.activePath);
        }
      } else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        // Journal prev/next day on journal docs.
        const date = s.activePath ? journalDateOf(s.activePath) : null;
        if (date) {
          e.preventDefault();
          const d = new Date(`${date}T00:00:00`);
          d.setDate(d.getDate() + (e.key === "ArrowRight" ? 1 : -1));
          const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
            2,
            "0",
          )}-${String(d.getDate()).padStart(2, "0")}`;
          void api.journalEnsure(iso).then((file) => {
            s.openDoc(file.path);
            void s.refreshDocs();
          });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Vault file events from the Rust watcher.
  useEffect(() => {
    if (!vault) return;
    const un = listen<VaultEvent[]>("vault:events", (event) => {
      refreshTree();
      refreshDocs();
      for (const ev of event.payload) {
        docEvents.emit(ev);
        if (ev.type === "renamed") {
          void useWorkspaceMeta.getState().repairPaths(ev.from, ev.to);
          useStore.getState().renameTab(ev.from, ev.to);
        }
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, [vault, refreshTree, refreshDocs]);

  if (!vault) {
    return <Onboarding />;
  }

  return (
    <div className={`app ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar />
      <div className="main">
        <Tabs />
        <div className="content">
          {tabs.map((tab) => (
            <Pane key={tab.path} path={tab.path} active={tab.path === activePath} />
          ))}
          {tabs.length === 0 && <EmptyState />}
        </div>
      </div>
      <RightSidebar />
      <QuickSearch />
      <CommandPalette />
      <ConflictDialog />
      <DataExplainer />
      <SettingsDialog />
      <GraphPanel />
      {toast && (
        <div className="toast">
          <span>{toast.message}</span>
          {toast.action && (
            <button
              className="toast-action"
              onClick={() => {
                toast.action?.run();
                useStore.getState().showToast(null);
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Pane({ path, active }: { path: string; active: boolean }) {
  const sourceMode = useStore((s) => s.sourceMode[path]);
  const edgeless = useStore((s) => s.docMode[path] === "edgeless");
  const kind = kindOfPath(path);
  const style = { display: active ? "flex" : "none" } as const;

  if (kind === "page") {
    return (
      <div className="doc-pane" style={style}>
        {path === "mica://all-docs" && <AllDocsPage />}
        {path === "mica://trash" && <TrashPage />}
        {path === "mica://tags" && <TagsPage />}
        {path.startsWith("mica://tag/") && <TagPage tag={path.slice("mica://tag/".length)} />}
        {path.startsWith("mica://collection/") && (
          <CollectionPage id={path.slice("mica://collection/".length)} />
        )}
      </div>
    );
  }

  if (kind === "note") {
    const sidecar = sidecarOf(path);
    return (
      <div className="doc-pane" style={style}>
        <DocHeader path={path} />
        {edgeless && sidecar ? (
          <CanvasView path={sidecar} active={active} />
        ) : sourceMode ? (
          <SourceEditor key="src" path={path} active={active} />
        ) : (
          <NoteEditor key="rich" path={path} active={active} />
        )}
        {!edgeless && <BacklinksSection path={path} />}
      </div>
    );
  }

  if (kind === "database") {
    return (
      <div className="doc-pane" style={style}>
        <DocHeader path={path} />
        <DatabaseView path={path} embed={false} />
      </div>
    );
  }

  if (kind === "canvas") {
    return (
      <div className="doc-pane" style={style}>
        <DocHeader path={path} />
        <CanvasView path={path} active={active} />
      </div>
    );
  }

  return (
    <div className="doc-pane" style={style}>
      <div className="placeholder">
        <p>{titleOfPath(path)}</p>
        <p className="muted">This file type opens in an external app.</p>
      </div>
    </div>
  );
}

function EmptyState() {
  const openPage = useStore((s) => s.openPage);
  return (
    <div className="placeholder empty-workspace">
      <div className="empty-mark">M</div>
      <h2>Your workspace is ready</h2>
      <p className="muted">Browse all docs, open today's journal, or search.</p>
      <div className="empty-actions">
        <button onClick={() => openPage("all-docs")}>All docs</button>
        <button onClick={() => useStore.getState().setQuickSearchOpen(true)}>
          Quick search <kbd>Ctrl K</kbd>
        </button>
      </div>
    </div>
  );
}
