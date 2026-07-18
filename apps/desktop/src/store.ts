import { create } from "zustand";
import type { StoreApi } from "zustand";
import { api, FileTree, VaultInfo } from "./api";
import {
  flushDocumentsForPaths,
  getDocumentSnapshot,
} from "./documents";
import {
  OpenResourceOptions,
  PaneId,
  ResourceView,
  SidebarSnapshot,
  SplitId,
  SplitPaneOptions,
  TabId,
  ViewLocation,
  WorkspaceState,
  WorkspaceView,
  activatePane,
  activateTab,
  assertWorkspaceInvariants,
  closeAllTabs,
  closeOtherTabs,
  closePane,
  closeTab as closeWorkspaceTabOperation,
  closeTabsToRight,
  createTab,
  createWorkspace,
  createWorkspaceTabTransferPayload,
  dockTab,
  goBack,
  goForward,
  isResourceView,
  markResourceMissing,
  linkTabs,
  moveTab,
  navigateTab,
  openResource,
  pinTab,
  renameResource,
  replaceTabView,
  reorderTab,
  reopenClosedTab,
  resizeSplit,
  requestWorkspaceTabTransfer,
  selectPaneForTab,
  setPaneStackedTabs,
  splitPane,
  updateCurrentHistoryLocation,
  unlinkTab,
} from "./workspace";

export interface ConflictState {
  path: string;
  /** What the editor currently holds (unsaved). */
  myContent: string;
}

export interface AppStore {
  vault: VaultInfo | null;
  tree: FileTree | null;
  workspace: WorkspaceState;
  conflict: ConflictState | null;
  quickSwitcherOpen: boolean;
  searchOpen: boolean;
  commandPaletteOpen: boolean;
  rightPanelOpen: boolean;
  dataExplainerOpen: boolean;
  saveStatus: "idle" | "saving" | "saved" | "error";
  settingsOpen: boolean;
  graphOpen: boolean;

  setVault: (v: VaultInfo | null) => void;
  refreshTree: () => Promise<void>;

  replaceWorkspace: (workspace: WorkspaceState) => void;
  restoreWorkspaceLayout: (workspace: WorkspaceState) => Promise<boolean>;
  createWorkspaceTab: (
    paneId?: PaneId,
    view?: WorkspaceView,
    options?: { title?: string; pinned?: boolean; activate?: boolean; index?: number },
  ) => void;
  openWorkspaceResource: (view: ResourceView, options?: OpenResourceOptions) => Promise<boolean>;
  activateWorkspacePane: (paneId: PaneId) => void;
  activateWorkspaceTab: (paneId: PaneId, tabId: TabId) => void;
  navigateWorkspaceTab: (
    tabId: TabId,
    view: WorkspaceView,
    location?: ViewLocation,
    title?: string,
  ) => Promise<boolean>;
  updateCurrentWorkspaceHistoryLocation: (tabId: TabId, location?: ViewLocation) => void;
  pinWorkspaceTab: (tabId: TabId, pinned?: boolean) => void;
  reorderWorkspaceTab: (paneId: PaneId, tabId: TabId, index: number) => void;
  moveWorkspaceTab: (tabId: TabId, targetPaneId: PaneId, index?: number) => Promise<boolean>;
  dockWorkspaceTab: (tabId: TabId, targetPaneId: PaneId, edge: "left" | "right" | "up" | "down") => Promise<boolean>;
  closeWorkspaceTab: (tabId: TabId) => Promise<boolean>;
  moveWorkspaceTabToNewWindow: (tabId: TabId) => Promise<boolean>;
  closeWorkspaceOtherTabs: (paneId: PaneId, keepTabId: TabId) => Promise<boolean>;
  closeWorkspaceTabsToRight: (paneId: PaneId, tabId: TabId) => Promise<boolean>;
  closeWorkspaceAllTabs: (paneId: PaneId) => Promise<boolean>;
  closeWorkspacePane: (paneId: PaneId) => Promise<boolean>;
  reopenLastClosedWorkspaceTab: () => boolean;
  setWorkspacePaneStackedTabs: (paneId: PaneId, stacked: boolean) => void;
  linkWorkspaceTabs: (sourceTabId: TabId, targetTabId: TabId) => Promise<boolean>;
  unlinkWorkspaceTab: (tabId: TabId) => void;
  splitWorkspacePane: (paneId: PaneId, options: SplitPaneOptions) => Promise<boolean>;
  resizeWorkspaceSplit: (splitId: SplitId, ratio: number) => void;
  workspaceGoBack: (tabId: TabId) => Promise<boolean>;
  workspaceGoForward: (tabId: TabId) => Promise<boolean>;
  renameWorkspaceResource: (from: string, to: string) => void;
  markWorkspaceResourceMissing: (path: string, reason?: string) => Promise<boolean>;
  setWorkspaceSidebar: (
    side: "left" | "right",
    update: Partial<SidebarSnapshot>,
  ) => void;
  toggleTabSourceMode: (tabId: TabId) => Promise<boolean>;

  setConflict: (c: ConflictState | null) => void;
  setQuickSwitcherOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setRightPanelOpen: (open: boolean) => void;
  setDataExplainerOpen: (open: boolean) => void;
  setSaveStatus: (s: AppStore["saveStatus"]) => void;
  setSettingsOpen: (open: boolean) => void;
  setGraphOpen: (open: boolean) => void;
}

function workspaceUpdate(workspace: WorkspaceState): Pick<AppStore, "workspace"> {
  return { workspace };
}

type WorkspaceOperation = (workspace: WorkspaceState) => WorkspaceState;

function paneByTab(workspace: WorkspaceState): Map<TabId, PaneId> {
  const result = new Map<TabId, PaneId>();
  for (const pane of Object.values(workspace.panes)) {
    for (const tabId of pane.tabIds) result.set(tabId, pane.id);
  }
  return result;
}

/** Notes whose mounted editor will be destroyed or reparented by a mutation. */
function notePathsRequiringFlush(before: WorkspaceState, after: WorkspaceState): string[] {
  const beforePanes = paneByTab(before);
  const afterPanes = paneByTab(after);
  const paths = new Set<string>();
  for (const [tabId, tab] of Object.entries(before.tabs)) {
    if (tab.view.type !== "note") continue;
    const next = after.tabs[tabId];
    const sameView = next?.view.type === "note"
      && next.view.path === tab.view.path
      && next.view.mode === tab.view.mode;
    if (!sameView || beforePanes.get(tabId) !== afterPanes.get(tabId)) paths.add(tab.view.path);
  }
  return [...paths];
}

function surfaceDocumentFailures(
  set: StoreApi<AppStore>["setState"],
  paths: string[],
): void {
  const conflictPath = paths.find((path) => getDocumentSnapshot(path)?.saveError?.kind === "conflict");
  const snapshot = conflictPath ? getDocumentSnapshot(conflictPath) : undefined;
  set({
    saveStatus: "error",
    ...(conflictPath && snapshot
      ? { conflict: { path: conflictPath, myContent: snapshot.content } }
      : {}),
  });
}

/**
 * Commit immediately when no note editor is affected; otherwise keep the old
 * tree mounted until its canonical document sessions cross a save barrier.
 */
function guardedWorkspaceMutation(
  get: StoreApi<AppStore>["getState"],
  set: StoreApi<AppStore>["setState"],
  operation: WorkspaceOperation,
): Promise<boolean> {
  const before = get().workspace;
  let proposed: WorkspaceState;
  try {
    proposed = operation(before);
  } catch (error) {
    console.error("workspace mutation failed", error);
    return Promise.resolve(false);
  }
  if (proposed === before) return Promise.resolve(true);
  const paths = notePathsRequiringFlush(before, proposed);
  if (paths.length === 0) {
    set(workspaceUpdate(proposed));
    return Promise.resolve(true);
  }
  return flushDocumentsForPaths(paths).then((barrier) => {
    if (!barrier.ok) {
      surfaceDocumentFailures(set, barrier.failures.map((failure) => failure.path));
      return false;
    }
    // If another workspace command won the race, re-evaluate against the new
    // tree instead of applying a stale precomputed snapshot.
    if (get().workspace !== before) return guardedWorkspaceMutation(get, set, operation);
    set(workspaceUpdate(proposed));
    return true;
  });
}

function toggleWorkspaceTabNoteMode(workspace: WorkspaceState, tabId: TabId): WorkspaceState {
  const tab = workspace.tabs[tabId];
  if (!tab || tab.view.type !== "note") return workspace;
  return replaceTabView(workspace, tabId, {
    ...tab.view,
    mode: tab.view.mode === "source" ? "rich" : "source",
  });
}

const initialWorkspace = createWorkspace();

export const useStore = create<AppStore>((set, get) => ({
  vault: null,
  tree: null,
  workspace: initialWorkspace,
  conflict: null,
  quickSwitcherOpen: false,
  searchOpen: false,
  commandPaletteOpen: false,
  rightPanelOpen: true,
  dataExplainerOpen: false,
  saveStatus: "idle",
  settingsOpen: false,
  graphOpen: false,

  setVault: (vault) => {
    const workspace = createWorkspace();
    set({
      vault,
      tree: null,
      ...workspaceUpdate(workspace),
      rightPanelOpen: workspace.sidebars.right.open,
    });
  },

  refreshTree: async () => {
    try {
      const tree = await api.vaultTree();
      set({ tree });
    } catch {
      // vault closed
    }
  },

  replaceWorkspace: (workspace) => {
    assertWorkspaceInvariants(workspace);
    set({ ...workspaceUpdate(structuredClone(workspace)), rightPanelOpen: workspace.sidebars.right.open });
  },
  restoreWorkspaceLayout: (workspace) =>
    guardedWorkspaceMutation(get, set, () => structuredClone(workspace)),
  createWorkspaceTab: (paneId, view, options) =>
    set((s) => workspaceUpdate(createTab(s.workspace, paneId, view, options))),
  openWorkspaceResource: (view, options) =>
    guardedWorkspaceMutation(get, set, (workspace) => openResource(workspace, view, options)),
  activateWorkspacePane: (paneId) =>
    set((s) => workspaceUpdate(activatePane(s.workspace, paneId))),
  activateWorkspaceTab: (paneId, tabId) =>
    set((s) => workspaceUpdate(activateTab(s.workspace, paneId, tabId))),
  navigateWorkspaceTab: (tabId, view, location, title) =>
    guardedWorkspaceMutation(get, set, (workspace) => navigateTab(workspace, tabId, view, location, title)),
  updateCurrentWorkspaceHistoryLocation: (tabId, location) =>
    set((s) => {
      const workspace = updateCurrentHistoryLocation(s.workspace, tabId, location);
      return workspace === s.workspace ? s : workspaceUpdate(workspace);
    }),
  pinWorkspaceTab: (tabId, pinned = true) =>
    set((s) => workspaceUpdate(pinTab(s.workspace, tabId, pinned))),
  reorderWorkspaceTab: (paneId, tabId, index) =>
    set((s) => workspaceUpdate(reorderTab(s.workspace, paneId, tabId, index))),
  moveWorkspaceTab: (tabId, targetPaneId, index) =>
    guardedWorkspaceMutation(get, set, (workspace) => moveTab(workspace, tabId, targetPaneId, index)),
  dockWorkspaceTab: (tabId, targetPaneId, edge) =>
    guardedWorkspaceMutation(get, set, (workspace) => dockTab(workspace, tabId, targetPaneId, edge)),
  closeWorkspaceTab: (tabId) =>
    guardedWorkspaceMutation(get, set, (workspace) => closeWorkspaceTabOperation(workspace, tabId)),
  moveWorkspaceTabToNewWindow: async (tabId) => {
    const before = get().workspace;
    const tab = before.tabs[tabId];
    const pane = tab ? selectPaneForTab(before, tabId) : undefined;
    if (!tab || !pane || !isResourceView(tab.view)) return false;

    if (tab.view.type === "note") {
      const barrier = await flushDocumentsForPaths([tab.view.path]);
      if (!barrier.ok) {
        surfaceDocumentFailures(set, barrier.failures.map((failure) => failure.path));
        return false;
      }
    }

    const current = get().workspace.tabs[tabId];
    if (!current || JSON.stringify(current.view) !== JSON.stringify(tab.view)) return false;
    try {
      const payload = createWorkspaceTabTransferPayload(current, pane.id);
      const acknowledged = await requestWorkspaceTabTransfer(payload, {
        createWindow: api.workspaceWindowCreate,
      });
      if (!acknowledged) return false;

      const afterAck = get().workspace.tabs[tabId];
      if (!afterAck || JSON.stringify(afterAck.view) !== JSON.stringify(payload.tab.view)) {
        return false;
      }
      return get().closeWorkspaceTab(tabId);
    } catch (error) {
      console.warn("Move tab to native window failed", error);
      return false;
    }
  },
  closeWorkspaceOtherTabs: (paneId, keepTabId) =>
    guardedWorkspaceMutation(get, set, (workspace) => closeOtherTabs(workspace, paneId, keepTabId)),
  closeWorkspaceTabsToRight: (paneId, tabId) =>
    guardedWorkspaceMutation(get, set, (workspace) => closeTabsToRight(workspace, paneId, tabId)),
  closeWorkspaceAllTabs: (paneId) =>
    guardedWorkspaceMutation(get, set, (workspace) => closeAllTabs(workspace, paneId)),
  closeWorkspacePane: (paneId) =>
    guardedWorkspaceMutation(get, set, (workspace) => closePane(workspace, paneId)),
  reopenLastClosedWorkspaceTab: () => {
    const before = get().workspace;
    const workspace = reopenClosedTab(before);
    if (workspace === before) return false;
    set(workspaceUpdate(workspace));
    return true;
  },
  setWorkspacePaneStackedTabs: (paneId, stacked) =>
    set((s) => workspaceUpdate(setPaneStackedTabs(s.workspace, paneId, stacked))),
  linkWorkspaceTabs: (sourceTabId, targetTabId) =>
    guardedWorkspaceMutation(get, set, (workspace) => linkTabs(workspace, sourceTabId, targetTabId)),
  unlinkWorkspaceTab: (tabId) =>
    set((s) => workspaceUpdate(unlinkTab(s.workspace, tabId))),
  splitWorkspacePane: (paneId, options) =>
    guardedWorkspaceMutation(get, set, (workspace) => splitPane(workspace, paneId, options)),
  resizeWorkspaceSplit: (splitId, ratio) =>
    set((s) => workspaceUpdate(resizeSplit(s.workspace, splitId, ratio))),
  workspaceGoBack: (tabId) =>
    guardedWorkspaceMutation(get, set, (workspace) => goBack(workspace, tabId)),
  workspaceGoForward: (tabId) =>
    guardedWorkspaceMutation(get, set, (workspace) => goForward(workspace, tabId)),
  renameWorkspaceResource: (from, to) =>
    set((s) => workspaceUpdate(renameResource(s.workspace, from, to))),
  markWorkspaceResourceMissing: (path, reason) =>
    guardedWorkspaceMutation(get, set, (workspace) => markResourceMissing(workspace, path, reason)),
  setWorkspaceSidebar: (side, update) =>
    set((s) => {
      const workspace = structuredClone(s.workspace);
      workspace.sidebars[side] = { ...workspace.sidebars[side], ...update };
      assertWorkspaceInvariants(workspace);
      return {
        ...workspaceUpdate(workspace),
        ...(side === "right" && update.open !== undefined
          ? { rightPanelOpen: update.open }
          : {}),
      };
    }),
  toggleTabSourceMode: (tabId) =>
    guardedWorkspaceMutation(get, set, (workspace) => toggleWorkspaceTabNoteMode(workspace, tabId)),

  setConflict: (conflict) => set({ conflict }),
  setQuickSwitcherOpen: (quickSwitcherOpen) => set({ quickSwitcherOpen }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setRightPanelOpen: (rightPanelOpen) =>
    set((s) => {
      const workspace = structuredClone(s.workspace);
      workspace.sidebars.right.open = rightPanelOpen;
      return { rightPanelOpen, ...workspaceUpdate(workspace) };
    }),
  setDataExplainerOpen: (dataExplainerOpen) => set({ dataExplainerOpen }),
  setSaveStatus: (saveStatus) => set({ saveStatus }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setGraphOpen: (graphOpen) => set({ graphOpen }),
}));
