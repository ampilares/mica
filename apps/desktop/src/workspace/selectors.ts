import { NavigationEntry, PaneId, TabId, WorkspaceNode, WorkspacePane, WorkspaceState, WorkspaceTab, WorkspaceView, resourcePath } from "./model";

export const selectFocusedPane = (state: WorkspaceState): WorkspacePane => state.panes[state.focusedPaneId];

export const selectPane = (state: WorkspaceState, paneId: PaneId): WorkspacePane | undefined => state.panes[paneId];

export const selectTabsByPane = (state: WorkspaceState, paneId: PaneId): WorkspaceTab[] =>
  (state.panes[paneId]?.tabIds ?? []).map((id) => state.tabs[id]).filter(Boolean);

export const selectActiveTab = (state: WorkspaceState, paneId: PaneId = state.focusedPaneId): WorkspaceTab | undefined => {
  const pane = state.panes[paneId];
  return pane ? state.tabs[pane.activeTabId] : undefined;
};

export const selectActiveView = (state: WorkspaceState, paneId?: PaneId): WorkspaceView | undefined =>
  selectActiveTab(state, paneId)?.view;

export const selectActivePath = (state: WorkspaceState, paneId?: PaneId): string | undefined => {
  const view = selectActiveView(state, paneId);
  return view ? resourcePath(view) : undefined;
};

export const selectTab = (state: WorkspaceState, tabId: TabId): WorkspaceTab | undefined => state.tabs[tabId];

export const selectCurrentNavigationEntry = (
  state: WorkspaceState,
  tabId: TabId,
): NavigationEntry | undefined => {
  const tab = state.tabs[tabId];
  return tab && tab.historyIndex >= 0 ? tab.history[tab.historyIndex] : undefined;
};

export const selectPaneForTab = (state: WorkspaceState, tabId: TabId): WorkspacePane | undefined =>
  Object.values(state.panes).find((pane) => pane.tabIds.includes(tabId));

export const selectViewsOfResource = (state: WorkspaceState, path: string): WorkspaceTab[] =>
  Object.values(state.tabs).filter((tab) => resourcePath(tab.view) === path);

export const selectCanGoBack = (state: WorkspaceState, tabId: TabId): boolean =>
  (state.tabs[tabId]?.historyIndex ?? -1) > 0;

export const selectCanGoForward = (state: WorkspaceState, tabId: TabId): boolean => {
  const tab = state.tabs[tabId];
  return !!tab && tab.historyIndex >= 0 && tab.historyIndex < tab.history.length - 1;
};

export function selectPaneIds(node: WorkspaceNode): PaneId[] {
  return node.type === "pane"
    ? [node.paneId]
    : [...selectPaneIds(node.first), ...selectPaneIds(node.second)];
}

export const selectAllPaneIds = (state: WorkspaceState): PaneId[] => selectPaneIds(state.root);
