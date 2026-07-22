import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  useStore,
  kindOfPath,
  titleOfPath,
  sidecarOf,
  journalDateOf,
  Pane as StorePane,
} from "./store";
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
import PeekModal from "./components/PeekModal";
import { TAB_DND_MIME } from "./components/Tabs";
import { docEvents } from "./docEvents";
import { useSettings, applySettings } from "./settings";
import { useWorkspaceMeta } from "./workspaceMeta";
import "./components/SplitLayout.css";

export default function App() {
  const vault = useStore((s) => s.vault);
  const panes = useStore((s) => s.panes);
  const activePane = useStore((s) => s.activePane);
  const splitRatio = useStore((s) => s.splitRatio);
  const peekPath = useStore((s) => s.peekPath);
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
      } else if (mod && e.key === "\\") {
        // Toggle split of the current document: split it into a second pane,
        // or collapse back to a single pane if already split.
        e.preventDefault();
        if (s.panes.length > 1) {
          s.unsplit();
        } else if (s.activePath) {
          s.splitWith(s.activePath);
        }
      } else if (e.key === "Escape" && s.peekPath) {
        e.preventDefault();
        s.setPeek(null);
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

  // Global peek affordance (spec §3.3): Shift+click any element carrying a
  // `data-peek-path` opens a read-only preview. Capture phase so it wins
  // before the element's own click handler (e.g. a tab's setActive).
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!e.shiftKey || e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      const el = target?.closest?.("[data-peek-path]") as HTMLElement | null;
      const path = el?.getAttribute("data-peek-path");
      if (path) {
        e.preventDefault();
        e.stopPropagation();
        useStore.getState().setPeek(path);
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
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

  const split = panes.length > 1;

  return (
    <div className={`app ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar />
      <div className="main">
        {split ? (
          <div className="panes-split">
            <PaneColumn index={0} pane={panes[0]} active={activePane === 0} flex={splitRatio} />
            <Divider />
            <PaneColumn index={1} pane={panes[1]} active={activePane === 1} flex={1 - splitRatio} />
          </div>
        ) : (
          <>
            <Tabs paneIndex={0} />
            <div className="content">
              {panes[0].tabs.map((tab) => (
                <DocContent
                  key={tab.path}
                  path={tab.path}
                  active={tab.path === panes[0].activePath}
                />
              ))}
              {panes[0].tabs.length === 0 && <EmptyState />}
            </div>
          </>
        )}
      </div>
      <RightSidebar />
      {peekPath && <PeekModal key={peekPath} path={peekPath} />}
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

/** One split pane: its own tab strip + content column. */
function PaneColumn({
  index,
  pane,
  active,
  flex,
}: {
  index: 0 | 1;
  pane: StorePane;
  active: boolean;
  flex: number;
}) {
  const setActivePane = useStore((s) => s.setActivePane);
  const moveTabToPane = useStore((s) => s.moveTabToPane);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`pane-column ${active ? "active" : "inactive"}`}
      style={{ flexGrow: flex, flexBasis: 0, minWidth: 0 }}
      onMouseDownCapture={() => setActivePane(index)}
    >
      <Tabs paneIndex={index} />
      <div
        className={`content ${dragOver ? "drop-target" : ""}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(TAB_DND_MIME)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (!dragOver) setDragOver(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
        }}
        onDrop={(e) => {
          const path = e.dataTransfer.getData(TAB_DND_MIME);
          setDragOver(false);
          if (path) {
            e.preventDefault();
            moveTabToPane(path, index);
          }
        }}
      >
        {pane.tabs.map((tab) => (
          <DocContent
            key={tab.path}
            path={tab.path}
            active={tab.path === pane.activePath}
          />
        ))}
        {pane.tabs.length === 0 && <EmptyState />}
      </div>
    </div>
  );
}

/** Draggable vertical divider between the two panes (25%–75%). */
function Divider() {
  const setSplitRatio = useStore((s) => s.setSplitRatio);
  const dragging = useRef(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragging.current = true;
    const container = (e.currentTarget.parentElement as HTMLElement) ?? null;
    const onMove = (ev: PointerEvent) => {
      if (!dragging.current || !container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;
      setSplitRatio((ev.clientX - rect.left) / rect.width);
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      className="pane-divider"
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize"
      onPointerDown={onPointerDown}
    />
  );
}

function DocContent({ path, active }: { path: string; active: boolean }) {
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
