import { useCallback, useEffect, useRef } from "react";
import { api } from "../../api";
import { useStore } from "../../store";
import {
  canvasLocation,
  databaseLocation,
  graphLocation,
  scrollPosition,
  textSelection,
  withCanvasLocation,
  withDatabaseLocation,
  withGraphLocation,
  withScrollPosition,
  withTextSelection,
  type CanvasViewport,
  type PaneId,
  type ScrollPosition,
  type ScrollLocationTarget,
  type TextSelectionPosition,
  type TextSelectionTarget,
  type TabId,
  type WorkspaceView,
  titleForPath,
} from "../../workspace";
import CanvasView from "../CanvasView";
import DatabaseView from "../DatabaseView";
import { GraphWorkspaceView } from "../GraphPanel";
import NoteEditor from "../NoteEditor";
import SourceEditor from "../SourceEditor";
import { Icon } from "../ui";

export default function ViewHost({
  paneId,
  tabId,
  view,
  active,
}: {
  paneId: PaneId;
  tabId: TabId;
  view: WorkspaceView;
  active: boolean;
}) {
  const hostRef = useRef<HTMLElement>(null);
  const historyIndex = useStore((state) => state.workspace.tabs[tabId]?.historyIndex ?? -1);
  const location = useStore((state) => {
    const tab = state.workspace.tabs[tabId];
    return tab && tab.historyIndex >= 0 ? tab.history[tab.historyIndex]?.location : undefined;
  });
  const updateLocation = useStore((state) => state.updateCurrentWorkspaceHistoryLocation);
  const pendingScrollRef = useRef<{
    historyIndex: number;
    positions: Partial<Record<ScrollLocationTarget, ScrollPosition>>;
  } | null>(null);
  const scrollTimerRef = useRef<number | null>(null);

  const flushScrollCheckpoint = useCallback(() => {
    const pending = pendingScrollRef.current;
    pendingScrollRef.current = null;
    if (!pending) return;
    const state = useStore.getState().workspace;
    const tab = state.tabs[tabId];
    // Never let a delayed checkpoint overwrite the entry reached by a fast
    // back/forward action. The leading write still preserves the scroll burst.
    if (!tab || tab.historyIndex !== pending.historyIndex) return;
    let nextLocation = tab.history[tab.historyIndex]?.location;
    for (const [target, position] of Object.entries(pending.positions)) {
      if (position) {
        nextLocation = withScrollPosition(
          nextLocation,
          target as ScrollLocationTarget,
          position,
        );
      }
    }
    updateLocation(tabId, nextLocation);
  }, [tabId, updateLocation]);

  useEffect(() => () => {
    if (scrollTimerRef.current !== null) window.clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = null;
    flushScrollCheckpoint();
  }, [flushScrollCheckpoint]);

  useEffect(() => {
    if (!active) return;
    const host = hostRef.current;
    if (!host) return;

    const restore = () => {
      let pending = false;
      for (const target of SCROLL_TARGETS) {
        const position = scrollPosition(location, target);
        if (!position) continue;
        const element = scrollElement(host, target);
        if (!element) {
          pending = true;
          continue;
        }
        element.scrollTop = position.top;
        element.scrollLeft = position.left;
      }
      return !pending;
    };

    if (restore()) return;
    const observer = new MutationObserver(() => {
      if (restore()) observer.disconnect();
    });
    observer.observe(host, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [active, historyIndex, location, view.type]);

  const checkpointScroll = (event: React.UIEvent<HTMLElement>) => {
    if (!active || !(event.target instanceof HTMLElement)) return;
    const target = scrollTarget(event.target, hostRef.current);
    if (!target) return;
    const tab = useStore.getState().workspace.tabs[tabId];
    if (!tab || tab.historyIndex < 0) return;
    const pending = pendingScrollRef.current?.historyIndex === tab.historyIndex
      ? pendingScrollRef.current
      : { historyIndex: tab.historyIndex, positions: {} };
    pending.positions[target] = { top: event.target.scrollTop, left: event.target.scrollLeft };
    pendingScrollRef.current = pending;
    // Leading + trailing throttle: long scrolls remain durable without cloning
    // the full workspace for every native scroll event.
    if (scrollTimerRef.current === null) {
      flushScrollCheckpoint();
      scrollTimerRef.current = window.setTimeout(() => {
        scrollTimerRef.current = null;
        flushScrollCheckpoint();
      }, 120);
    }
  };

  const checkpointCanvas = (viewport: CanvasViewport, selectedIds: string[]) => {
    const state = useStore.getState().workspace;
    const tab = state.tabs[tabId];
    const current = tab?.historyIndex >= 0 ? tab.history[tab.historyIndex]?.location : undefined;
    updateLocation(tabId, withCanvasLocation(current, viewport, selectedIds));
  };

  const checkpointTextSelection = (
    target: TextSelectionTarget,
    selection: TextSelectionPosition,
  ) => {
    const state = useStore.getState().workspace;
    const tab = state.tabs[tabId];
    const current = tab?.historyIndex >= 0 ? tab.history[tab.historyIndex]?.location : undefined;
    updateLocation(tabId, withTextSelection(current, target, selection));
  };

  const checkpointGraph = (graph: { centerPath: string | null; wholeVault: boolean }) => {
    const state = useStore.getState().workspace;
    const tab = state.tabs[tabId];
    const current = tab?.historyIndex >= 0 ? tab.history[tab.historyIndex]?.location : undefined;
    updateLocation(tabId, withGraphLocation(current, graph));
  };

  const checkpointDatabase = (viewId: string) => {
    const state = useStore.getState().workspace;
    const tab = state.tabs[tabId];
    const current = tab?.historyIndex >= 0 ? tab.history[tab.historyIndex]?.location : undefined;
    updateLocation(tabId, withDatabaseLocation(current, { viewId }));
  };

  return (
    <section
      ref={hostRef}
      id={`workspace-tabpanel-${tabId}`}
      className={`workspace-view ${active ? "active" : ""}`}
      role="tabpanel"
      aria-labelledby={`workspace-tab-${tabId}`}
      hidden={!active}
      onScrollCapture={checkpointScroll}
    >
      {view.type === "note" && (view.mode === "source"
        ? (
          <SourceEditor
            path={view.path}
            tabId={tabId}
            active={active}
            selection={textSelection(location, "source")}
            onSelectionChange={(selection) => checkpointTextSelection("source", selection)}
          />
        )
        : (
          <NoteEditor
            path={view.path}
            tabId={tabId}
            active={active}
            selection={textSelection(location, "rich")}
            onSelectionChange={(selection) => checkpointTextSelection("rich", selection)}
          />
        ))}
      {view.type === "database" && (
        <DatabaseView
          path={view.path}
          embed={false}
          initialView={databaseLocation(location)?.viewId}
          onViewChange={checkpointDatabase}
        />
      )}
      {view.type === "canvas" && (
        <CanvasView
          path={view.path}
          active={active}
          location={canvasLocation(location)}
          onLocationChange={checkpointCanvas}
        />
      )}
      {view.type === "graph" && (
        <GraphWorkspaceView
          centerPath={view.centerPath}
          active={active}
          location={graphLocation(location)}
          onLocationChange={checkpointGraph}
        />
      )}
      {view.type === "missing" && <MissingView tabId={tabId} view={view} />}
      {view.type === "empty" && <EmptyView paneId={paneId} tabId={tabId} />}
    </section>
  );
}

const SCROLL_TARGETS: ScrollLocationTarget[] = [
  "host",
  "note",
  "source",
  "database-table",
  "database-kanban",
];

const SCROLL_SELECTORS: Exclude<ScrollLocationTarget, "host">[] = [
  "note",
  "source",
  "database-table",
  "database-kanban",
];

const selectorForScrollTarget: Record<Exclude<ScrollLocationTarget, "host">, string> = {
  note: ".editor-scroll",
  source: ".source-editor-host",
  "database-table": ".db-table-wrap",
  "database-kanban": ".kanban",
};

function scrollTarget(element: HTMLElement, host: HTMLElement | null): ScrollLocationTarget | undefined {
  if (!host || !host.contains(element)) return undefined;
  if (element === host) return "host";
  return SCROLL_SELECTORS.find((target) => element.matches(selectorForScrollTarget[target]));
}

function scrollElement(host: HTMLElement, target: ScrollLocationTarget): HTMLElement | null {
  if (target === "host") return host;
  return host.querySelector<HTMLElement>(selectorForScrollTarget[target]);
}

function EmptyView({ paneId, tabId }: { paneId: PaneId; tabId: TabId }) {
  const navigate = useStore((state) => state.navigateWorkspaceTab);
  const setQuickSwitcherOpen = useStore((state) => state.setQuickSwitcherOpen);
  const createNote = async () => {
    const title = prompt("Note title", "Untitled");
    if (!title) return;
    const file = await api.noteCreate(title);
    await useStore.getState().refreshTree();
    navigate(tabId, { type: "note", path: file.path, mode: "rich" }, undefined, titleForPath(file.path));
  };
  return (
    <div className="workspace-empty-view">
      <div className="workspace-empty-icon"><Icon name="app" size={24} /></div>
      <h2>New tab</h2>
      <p>Open something in this pane or start a new note.</p>
      <div className="workspace-empty-actions">
        <button onClick={() => setQuickSwitcherOpen(true)}>Open a file <kbd>⌘P</kbd></button>
        <button onClick={() => void createNote()}>Create new note <kbd>⌘N</kbd></button>
      </div>
      <span className="muted small">Pane {paneId.replace("pane_", "")}</span>
    </div>
  );
}

function MissingView({ tabId, view }: { tabId: TabId; view: Extract<WorkspaceView, { type: "missing" }> }) {
  const navigate = useStore((state) => state.navigateWorkspaceTab);
  const retry = async () => {
    try {
      if (view.original.type === "note") await api.noteLoad(view.original.path);
      else if (view.original.type === "database") await api.dbLoad(view.original.path);
      else await api.canvasLoad(view.original.path);
      navigate(tabId, view.original);
    } catch {
      // The missing state remains visible and recoverable.
    }
  };
  return (
    <div className="workspace-missing-view">
      <Icon name="warning" size={30} />
      <h2>File unavailable</h2>
      <p>{view.original.path}</p>
      <p className="muted">{view.reason}</p>
      <button onClick={() => void retry()}>Try again</button>
    </div>
  );
}
