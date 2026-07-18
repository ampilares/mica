import {
  CreateWorkspaceOptions,
  DEFAULT_SPLIT_RATIO,
  MAX_HISTORY_ENTRIES,
  MAX_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  NavigationEntry,
  LinkGroupId,
  PaneId,
  ResourceView,
  SplitId,
  TabId,
  ViewLocation,
  WorkspaceNode,
  WorkspacePane,
  WorkspaceSnapshot,
  WorkspaceState,
  WorkspaceTab,
  WorkspaceView,
  WORKSPACE_SCHEMA_VERSION,
  defaultSidebars,
  isResourceView,
  resourcePath,
  titleForView,
} from "./model";

function cloneState(state: WorkspaceState): WorkspaceState {
  return {
    ...state,
    root: structuredClone(state.root),
    panes: structuredClone(state.panes),
    tabs: structuredClone(state.tabs),
    sidebars: structuredClone(state.sidebars),
    closedTabs: structuredClone(state.closedTabs),
  };
}

function allocateId<T extends string>(state: WorkspaceState, prefix: string): T {
  const used = new Set<string>([
    ...Object.keys(state.panes),
    ...Object.keys(state.tabs),
    ...collectSplitIds(state.root),
  ]);
  let id: string;
  do {
    id = `${prefix}_${state.nextId}`;
    state.nextId += 1;
  } while (used.has(id));
  return id as T;
}

function collectSplitIds(node: WorkspaceNode): SplitId[] {
  return node.type === "pane"
    ? []
    : [node.id, ...collectSplitIds(node.first), ...collectSplitIds(node.second)];
}

function makeTab(
  state: WorkspaceState,
  view: WorkspaceView = { type: "empty" },
  options: { title?: string; pinned?: boolean } = {},
): WorkspaceTab {
  const empty = view.type === "empty";
  return {
    id: allocateId<TabId>(state, "tab"),
    view: structuredClone(view),
    title: options.title ?? titleForView(view),
    pinned: options.pinned ?? false,
    history: empty ? [] : [{ view: structuredClone(view) }],
    historyIndex: empty ? -1 : 0,
  };
}

function touchPane(pane: WorkspacePane, tabId: TabId): void {
  pane.activeTabId = tabId;
  pane.recentTabIds = [tabId, ...pane.recentTabIds.filter((id) => id !== tabId)];
}

function emptyTab(state: WorkspaceState): WorkspaceTab {
  const tab = makeTab(state);
  state.tabs[tab.id] = tab;
  return tab;
}

function keepPinnedOrdering(state: WorkspaceState, pane: WorkspacePane): void {
  pane.tabIds = [
    ...pane.tabIds.filter((id) => state.tabs[id]?.pinned),
    ...pane.tabIds.filter((id) => !state.tabs[id]?.pinned),
  ];
}

function linkedTabs(state: WorkspaceState, source: WorkspaceTab): WorkspaceTab[] {
  if (!source.linkGroupId) return [];
  return Object.values(state.tabs).filter((tab) =>
    tab.id !== source.id && tab.linkGroupId === source.linkGroupId
  );
}

function sameViewIdentity(left: WorkspaceView, right: WorkspaceView): boolean {
  const leftPath = resourcePath(left);
  const rightPath = resourcePath(right);
  if (leftPath || rightPath) return leftPath === rightPath && left.type === right.type;
  if (left.type === "graph" && right.type === "graph") return left.centerPath === right.centerPath;
  return left.type === right.type;
}

function appendNavigation(
  tab: WorkspaceTab,
  view: WorkspaceView,
  location?: ViewLocation,
  title?: string,
): void {
  const entry: NavigationEntry = {
    view: structuredClone(view),
    ...(location ? { location: structuredClone(location) } : {}),
  };
  const history = tab.history.slice(0, tab.historyIndex + 1);
  history.push(entry);
  tab.history = history.slice(-MAX_HISTORY_ENTRIES);
  tab.historyIndex = tab.history.length - 1;
  tab.view = structuredClone(view);
  tab.title = title ?? titleForView(view);
}

function synchronizeLinkedView(
  state: WorkspaceState,
  sourceTabId: TabId,
  strategy: "navigate" | "replace",
): void {
  const source = requireTab(state, sourceTabId);
  for (const peer of linkedTabs(state, source)) {
    const current = peer.historyIndex >= 0 ? peer.history[peer.historyIndex] : undefined;
    const location = sameViewIdentity(peer.view, source.view) ? current?.location : undefined;
    if (strategy === "replace") {
      peer.view = structuredClone(source.view);
      if (peer.historyIndex >= 0) {
        peer.history[peer.historyIndex] = {
          view: structuredClone(source.view),
          ...(location ? { location: structuredClone(location) } : {}),
        };
      } else {
        appendNavigation(peer, source.view, location);
      }
    } else if (JSON.stringify(peer.view) !== JSON.stringify(source.view)) {
      appendNavigation(peer, source.view, location);
    }
  }
}

function cleanupSingletonLinkGroups(state: WorkspaceState): void {
  const groups = new Map<LinkGroupId, WorkspaceTab[]>();
  for (const tab of Object.values(state.tabs)) {
    if (!tab.linkGroupId) continue;
    groups.set(tab.linkGroupId, [...(groups.get(tab.linkGroupId) ?? []), tab]);
  }
  for (const members of groups.values()) {
    if (members.length === 1) delete members[0].linkGroupId;
  }
}

function paneCount(node: WorkspaceNode): number {
  return node.type === "pane" ? 1 : paneCount(node.first) + paneCount(node.second);
}

function replacePaneNode(
  node: WorkspaceNode,
  paneId: PaneId,
  replacement: WorkspaceNode,
): WorkspaceNode {
  if (node.type === "pane") return node.paneId === paneId ? replacement : node;
  return {
    ...node,
    first: replacePaneNode(node.first, paneId, replacement),
    second: replacePaneNode(node.second, paneId, replacement),
  };
}

function removePaneNode(node: WorkspaceNode, paneId: PaneId): WorkspaceNode | null {
  if (node.type === "pane") return node.paneId === paneId ? null : node;
  const first = removePaneNode(node.first, paneId);
  const second = removePaneNode(node.second, paneId);
  if (!first) return second;
  if (!second) return first;
  return { ...node, first, second };
}

function firstPaneId(node: WorkspaceNode): PaneId {
  return node.type === "pane" ? node.paneId : firstPaneId(node.first);
}

function finalize(state: WorkspaceState): WorkspaceState {
  assertWorkspaceInvariants(state);
  return state;
}

export function createWorkspace(options: CreateWorkspaceOptions = {}): WorkspaceState {
  const state: WorkspaceState = {
    root: { type: "pane", paneId: "" },
    focusedPaneId: "",
    panes: {},
    tabs: {},
    sidebars: defaultSidebars(options.sidebars),
    closedTabs: [],
    nextId: 1,
  };
  const paneId = allocateId<PaneId>(state, "pane");
  const tab = makeTab(state, options.view, { title: options.title });
  state.tabs[tab.id] = tab;
  state.panes[paneId] = {
    id: paneId,
    tabIds: [tab.id],
    activeTabId: tab.id,
    recentTabIds: [tab.id],
    stackedTabs: false,
  };
  state.root = { type: "pane", paneId };
  state.focusedPaneId = paneId;
  return finalize(state);
}

export function createTab(
  state: WorkspaceState,
  paneId: PaneId = state.focusedPaneId,
  view: WorkspaceView = { type: "empty" },
  options: { title?: string; pinned?: boolean; activate?: boolean; index?: number } = {},
): WorkspaceState {
  const next = cloneState(state);
  const pane = requirePane(next, paneId);
  const tab = makeTab(next, view, options);
  next.tabs[tab.id] = tab;
  const defaultIndex = tab.pinned
    ? pane.tabIds.findIndex((id) => !next.tabs[id].pinned)
    : pane.tabIds.length;
  const index = Math.max(0, Math.min(options.index ?? (defaultIndex < 0 ? pane.tabIds.length : defaultIndex), pane.tabIds.length));
  pane.tabIds.splice(index, 0, tab.id);
  pane.recentTabIds.push(tab.id);
  if (options.activate ?? true) touchPane(pane, tab.id);
  next.focusedPaneId = paneId;
  keepPinnedOrdering(next, pane);
  return finalize(next);
}

export interface OpenResourceOptions {
  paneId?: PaneId;
  title?: string;
  /** Always create a tab instead of navigating the current unpinned tab. */
  newTab?: boolean;
  /** Only meaningful with newTab. */
  activate?: boolean;
}

export function openResource(
  state: WorkspaceState,
  view: ResourceView,
  options: OpenResourceOptions = {},
): WorkspaceState {
  const paneId = options.paneId ?? state.focusedPaneId;
  const pane = requirePane(state, paneId);
  const existing = pane.tabIds.find((id) => resourcePath(state.tabs[id].view) === view.path);
  if (!options.newTab && existing) return activateTab(state, paneId, existing);
  if (options.newTab || state.tabs[pane.activeTabId].pinned) {
    return createTab(state, paneId, view, {
      title: options.title,
      activate: options.activate ?? !options.newTab,
    });
  }
  return navigateTab(state, pane.activeTabId, view, undefined, options.title);
}

export function activatePane(state: WorkspaceState, paneId: PaneId): WorkspaceState {
  requirePane(state, paneId);
  if (state.focusedPaneId === paneId) return state;
  return finalize({ ...state, focusedPaneId: paneId });
}

export function activateTab(state: WorkspaceState, paneId: PaneId, tabId: TabId): WorkspaceState {
  const next = cloneState(state);
  const pane = requirePane(next, paneId);
  if (!pane.tabIds.includes(tabId)) throw new Error(`Tab ${tabId} does not belong to pane ${paneId}`);
  touchPane(pane, tabId);
  next.focusedPaneId = paneId;
  return finalize(next);
}

export function navigateTab(
  state: WorkspaceState,
  tabId: TabId,
  view: WorkspaceView,
  location?: ViewLocation,
  title?: string,
): WorkspaceState {
  const next = cloneState(state);
  const tab = requireTab(next, tabId);
  appendNavigation(tab, view, location, title);
  synchronizeLinkedView(next, tabId, "navigate");
  return finalize(next);
}

/** Updates the view state of the entry currently displayed by a tab.
 *
 * This is deliberately separate from navigation: views can continuously
 * checkpoint scroll/selection state without creating history entries or
 * truncating the forward branch.
 */
export function updateCurrentHistoryLocation(
  state: WorkspaceState,
  tabId: TabId,
  location: ViewLocation | undefined,
): WorkspaceState {
  const tab = requireTab(state, tabId);
  if (tab.historyIndex < 0) return state;
  const current = tab.history[tab.historyIndex];
  if (locationsEqual(current.location, location)) return state;
  const next = cloneState(state);
  const changed = requireTab(next, tabId);
  const entry = changed.history[changed.historyIndex];
  if (location === undefined) delete entry.location;
  else entry.location = structuredClone(location);
  return finalize(next);
}

export function goBack(state: WorkspaceState, tabId: TabId): WorkspaceState {
  return moveHistory(state, tabId, -1);
}

export function goForward(state: WorkspaceState, tabId: TabId): WorkspaceState {
  return moveHistory(state, tabId, 1);
}

function moveHistory(state: WorkspaceState, tabId: TabId, delta: number): WorkspaceState {
  const tab = requireTab(state, tabId);
  const index = tab.historyIndex + delta;
  if (index < 0 || index >= tab.history.length) return state;
  const next = cloneState(state);
  const changed = requireTab(next, tabId);
  changed.historyIndex = index;
  changed.view = structuredClone(changed.history[index].view);
  changed.title = titleForView(changed.view);
  synchronizeLinkedView(next, tabId, "navigate");
  return finalize(next);
}

export function replaceTabView(
  state: WorkspaceState,
  tabId: TabId,
  view: WorkspaceView,
): WorkspaceState {
  const tab = requireTab(state, tabId);
  if (JSON.stringify(tab.view) === JSON.stringify(view)) return state;
  const next = cloneState(state);
  const changed = requireTab(next, tabId);
  changed.view = structuredClone(view);
  if (changed.historyIndex >= 0) {
    const location = changed.history[changed.historyIndex]?.location;
    changed.history[changed.historyIndex] = {
      view: structuredClone(view),
      ...(location ? { location: structuredClone(location) } : {}),
    };
  } else {
    appendNavigation(changed, view);
  }
  synchronizeLinkedView(next, tabId, "replace");
  return finalize(next);
}

export function linkTabs(state: WorkspaceState, sourceTabId: TabId, targetTabId: TabId): WorkspaceState {
  if (sourceTabId === targetTabId) return state;
  const source = requireTab(state, sourceTabId);
  const target = requireTab(state, targetTabId);
  if (source.linkGroupId && source.linkGroupId === target.linkGroupId) return state;
  const next = cloneState(state);
  const changedSource = requireTab(next, sourceTabId);
  const changedTarget = requireTab(next, targetTabId);
  const sourceGroup = changedSource.linkGroupId;
  const targetGroup = changedTarget.linkGroupId;
  const groupId = sourceGroup ?? targetGroup ?? allocateId<LinkGroupId>(next, "link");
  if (targetGroup && targetGroup !== groupId) {
    for (const tab of Object.values(next.tabs)) {
      if (tab.linkGroupId === targetGroup) tab.linkGroupId = groupId;
    }
  }
  changedSource.linkGroupId = groupId;
  changedTarget.linkGroupId = groupId;
  synchronizeLinkedView(next, sourceTabId, "navigate");
  return finalize(next);
}

export function unlinkTab(state: WorkspaceState, tabId: TabId): WorkspaceState {
  const tab = requireTab(state, tabId);
  if (!tab.linkGroupId) return state;
  const next = cloneState(state);
  delete requireTab(next, tabId).linkGroupId;
  cleanupSingletonLinkGroups(next);
  return finalize(next);
}

export function pinTab(state: WorkspaceState, tabId: TabId, pinned = true): WorkspaceState {
  if (requireTab(state, tabId).pinned === pinned) return state;
  const next = cloneState(state);
  requireTab(next, tabId).pinned = pinned;
  const pane = paneContainingTab(next, tabId);
  keepPinnedOrdering(next, pane);
  return finalize(next);
}

export function reorderTab(state: WorkspaceState, paneId: PaneId, tabId: TabId, index: number): WorkspaceState {
  const next = cloneState(state);
  const pane = requirePane(next, paneId);
  const from = pane.tabIds.indexOf(tabId);
  if (from < 0) throw new Error(`Tab ${tabId} does not belong to pane ${paneId}`);
  const tab = requireTab(next, tabId);
  const without = pane.tabIds.filter((id) => id !== tabId);
  const pinnedCount = without.filter((id) => next.tabs[id].pinned).length;
  const min = tab.pinned ? 0 : pinnedCount;
  const max = tab.pinned ? pinnedCount : without.length;
  without.splice(Math.max(min, Math.min(index, max)), 0, tabId);
  pane.tabIds = without;
  return finalize(next);
}

export function moveTab(
  state: WorkspaceState,
  tabId: TabId,
  targetPaneId: PaneId,
  index?: number,
): WorkspaceState {
  const source = paneContainingTab(state, tabId);
  if (source.id === targetPaneId) return reorderTab(state, targetPaneId, tabId, index ?? source.tabIds.length - 1);
  const next = cloneState(state);
  const sourcePane = requirePane(next, source.id);
  const target = requirePane(next, targetPaneId);
  sourcePane.tabIds = sourcePane.tabIds.filter((id) => id !== tabId);
  sourcePane.recentTabIds = sourcePane.recentTabIds.filter((id) => id !== tabId);
  if (sourcePane.tabIds.length === 0) {
    const empty = emptyTab(next);
    sourcePane.tabIds = [empty.id];
    sourcePane.recentTabIds = [empty.id];
  }
  if (sourcePane.activeTabId === tabId) sourcePane.activeTabId = sourcePane.recentTabIds[0] ?? sourcePane.tabIds[0];
  target.tabIds.splice(Math.max(0, Math.min(index ?? target.tabIds.length, target.tabIds.length)), 0, tabId);
  target.recentTabIds = [tabId, ...target.recentTabIds.filter((id) => id !== tabId)];
  touchPane(target, tabId);
  keepPinnedOrdering(next, target);
  next.focusedPaneId = targetPaneId;
  return finalize(next);
}

/**
 * Moves a tab to an edge of a pane and turns that edge into a new split.
 * Keeping this as one workspace operation makes cross-pane drops atomic from
 * the UI's point of view while reusing the normal move/split invariants.
 */
export function dockTab(
  state: WorkspaceState,
  tabId: TabId,
  targetPaneId: PaneId,
  edge: "left" | "right" | "up" | "down",
): WorkspaceState {
  requirePane(state, targetPaneId);
  requireTab(state, tabId);
  const source = paneContainingTab(state, tabId);
  const staged = source.id === targetPaneId
    ? state
    : moveTab(state, tabId, targetPaneId);
  return splitPane(staged, targetPaneId, {
    direction: edge === "left" || edge === "right" ? "row" : "column",
    tabId,
    before: edge === "left" || edge === "up",
  });
}

export function closeTab(state: WorkspaceState, tabId: TabId): WorkspaceState {
  const pane = paneContainingTab(state, tabId);
  if (pane.tabIds.length === 1 && state.tabs[tabId].view.type === "empty" && paneCount(state.root) > 1) {
    return closePane(state, pane.id);
  }
  const next = cloneState(state);
  const changedPane = requirePane(next, pane.id);
  const index = changedPane.tabIds.indexOf(tabId);
  next.closedTabs.unshift({ tab: structuredClone(requireTab(next, tabId)), paneId: pane.id, index });
  next.closedTabs = next.closedTabs.slice(0, 20);
  changedPane.tabIds.splice(index, 1);
  changedPane.recentTabIds = changedPane.recentTabIds.filter((id) => id !== tabId);
  delete next.tabs[tabId];
  cleanupSingletonLinkGroups(next);
  if (changedPane.tabIds.length === 0) {
    const empty = emptyTab(next);
    changedPane.tabIds = [empty.id];
    changedPane.recentTabIds = [empty.id];
    changedPane.activeTabId = empty.id;
  } else if (changedPane.activeTabId === tabId) {
    changedPane.activeTabId = changedPane.recentTabIds[0]
      ?? changedPane.tabIds[Math.min(index, changedPane.tabIds.length - 1)];
    touchPane(changedPane, changedPane.activeTabId);
  }
  return finalize(next);
}

/** Reopens the most recently closed valid tab without creating another closed-tab record. */
export function reopenClosedTab(state: WorkspaceState): WorkspaceState {
  if (state.closedTabs.length === 0) return state;
  const next = cloneState(state);
  let record = next.closedTabs.shift();
  // Corrupt/stale records must not trap the shortcut in a retry loop. Skip
  // colliding IDs and continue through the bounded stack in this one call.
  while (record && next.tabs[record.tab.id]) record = next.closedTabs.shift();
  if (!record) return finalize(next);

  const pane = next.panes[record.paneId] ?? next.panes[next.focusedPaneId];
  if (!pane) return finalize(next);

  // A pane is never allowed to be empty, so closing its last real tab creates
  // a placeholder. Replace that placeholder when reopening rather than
  // surprising the user with a second, useless tab.
  if (pane.tabIds.length === 1) {
    const placeholderId = pane.tabIds[0];
    const placeholder = next.tabs[placeholderId];
    if (placeholder?.view.type === "empty" && !placeholder.pinned) {
      delete next.tabs[placeholderId];
      pane.tabIds = [];
      pane.recentTabIds = [];
    }
  }

  next.tabs[record.tab.id] = structuredClone(record.tab);
  const reopeningGroupId = record.tab.linkGroupId;
  if (reopeningGroupId) {
    const linkedPeer = Object.values(next.tabs).find((tab) =>
      tab.id !== record.tab.id && tab.linkGroupId === reopeningGroupId
    );
    if (!linkedPeer) {
      delete next.tabs[record.tab.id].linkGroupId;
    } else {
      const reopened = next.tabs[record.tab.id];
      const current = reopened.historyIndex >= 0 ? reopened.history[reopened.historyIndex] : undefined;
      const location = sameViewIdentity(reopened.view, linkedPeer.view) ? current?.location : undefined;
      if (JSON.stringify(reopened.view) !== JSON.stringify(linkedPeer.view)) {
        appendNavigation(reopened, linkedPeer.view, location);
      }
    }
  }
  const pinnedCount = pane.tabIds.filter((id) => next.tabs[id].pinned).length;
  const min = record.tab.pinned ? 0 : pinnedCount;
  const max = record.tab.pinned ? pinnedCount : pane.tabIds.length;
  const index = Math.max(min, Math.min(record.index, max));
  pane.tabIds.splice(index, 0, record.tab.id);
  const restoredTabId = record.tab.id;
  pane.recentTabIds = [restoredTabId, ...pane.recentTabIds.filter((id) => id !== restoredTabId)];
  touchPane(pane, record.tab.id);
  next.focusedPaneId = pane.id;
  return finalize(next);
}

export function setPaneStackedTabs(
  state: WorkspaceState,
  paneId: PaneId,
  stacked: boolean,
): WorkspaceState {
  const pane = requirePane(state, paneId);
  if (pane.stackedTabs === stacked) return state;
  const next = cloneState(state);
  requirePane(next, paneId).stackedTabs = stacked;
  return finalize(next);
}

export function closeOtherTabs(state: WorkspaceState, paneId: PaneId, keepTabId: TabId): WorkspaceState {
  const pane = requirePane(state, paneId);
  if (!pane.tabIds.includes(keepTabId)) throw new Error(`Tab ${keepTabId} does not belong to pane ${paneId}`);
  return closeTabSet(state, paneId, pane.tabIds.filter((id) => id !== keepTabId));
}

export function closeTabsToRight(state: WorkspaceState, paneId: PaneId, tabId: TabId): WorkspaceState {
  const pane = requirePane(state, paneId);
  const index = pane.tabIds.indexOf(tabId);
  if (index < 0) throw new Error(`Tab ${tabId} does not belong to pane ${paneId}`);
  return closeTabSet(state, paneId, pane.tabIds.slice(index + 1));
}

export function closeAllTabs(state: WorkspaceState, paneId: PaneId): WorkspaceState {
  const pane = requirePane(state, paneId);
  return closeTabSet(state, paneId, [...pane.tabIds]);
}

function closeTabSet(state: WorkspaceState, paneId: PaneId, tabIds: TabId[]): WorkspaceState {
  let next = state;
  for (const id of tabIds) {
    if (next.tabs[id] && next.panes[paneId]?.tabIds.includes(id)) next = closeTab(next, id);
  }
  return next;
}

export interface SplitPaneOptions {
  direction: "row" | "column";
  ratio?: number;
  tabId?: TabId;
  /** Duplicates the selected tab; otherwise it is moved. */
  duplicate?: boolean;
  /** Place the new pane before (left/up) rather than after (right/down). */
  before?: boolean;
}

export function splitPane(state: WorkspaceState, paneId: PaneId, options: SplitPaneOptions): WorkspaceState {
  const next = cloneState(state);
  const source = requirePane(next, paneId);
  const selectedId = options.tabId ?? source.activeTabId;
  if (!source.tabIds.includes(selectedId)) throw new Error(`Tab ${selectedId} does not belong to pane ${paneId}`);
  const newPaneId = allocateId<PaneId>(next, "pane");
  let newTab: WorkspaceTab;
  if (options.duplicate) {
    const original = requireTab(next, selectedId);
    newTab = { ...structuredClone(original), id: allocateId<TabId>(next, "tab") };
    next.tabs[newTab.id] = newTab;
  } else {
    newTab = requireTab(next, selectedId);
    source.tabIds = source.tabIds.filter((id) => id !== selectedId);
    source.recentTabIds = source.recentTabIds.filter((id) => id !== selectedId);
    if (source.tabIds.length === 0) {
      const empty = emptyTab(next);
      source.tabIds = [empty.id];
      source.recentTabIds = [empty.id];
    }
    if (source.activeTabId === selectedId) source.activeTabId = source.recentTabIds[0] ?? source.tabIds[0];
  }
  next.panes[newPaneId] = {
    id: newPaneId,
    tabIds: [newTab.id],
    activeTabId: newTab.id,
    recentTabIds: [newTab.id],
    stackedTabs: source.stackedTabs,
  };
  const splitId = allocateId<SplitId>(next, "split");
  const oldNode: WorkspaceNode = { type: "pane", paneId };
  const newNode: WorkspaceNode = { type: "pane", paneId: newPaneId };
  const replacement: WorkspaceNode = {
    type: "split",
    id: splitId,
    direction: options.direction,
    ratio: clampRatio(options.ratio ?? DEFAULT_SPLIT_RATIO),
    first: options.before ? newNode : oldNode,
    second: options.before ? oldNode : newNode,
  };
  next.root = replacePaneNode(next.root, paneId, replacement);
  next.focusedPaneId = newPaneId;
  return finalize(next);
}

export function resizeSplit(state: WorkspaceState, splitId: SplitId, ratio: number): WorkspaceState {
  let found = false;
  const visit = (node: WorkspaceNode): WorkspaceNode => {
    if (node.type === "pane") return node;
    if (node.id === splitId) {
      found = true;
      return { ...node, ratio: clampRatio(ratio) };
    }
    return { ...node, first: visit(node.first), second: visit(node.second) };
  };
  const root = visit(state.root);
  if (!found) throw new Error(`Unknown split ${splitId}`);
  // Resizing changes layout geometry only. Preserve pane/tab/sidebar identity so
  // editors subscribed to those objects do not render on every pointer move.
  return finalize({ ...state, root });
}

export function collapseSplit(state: WorkspaceState, paneId: PaneId): WorkspaceState {
  return closePane(state, paneId);
}

export function closePane(state: WorkspaceState, paneId: PaneId): WorkspaceState {
  requirePane(state, paneId);
  if (paneCount(state.root) === 1) {
    let next = state;
    const ids = [...state.panes[paneId].tabIds];
    for (const id of ids) next = closeTab(next, id);
    return next;
  }
  const next = cloneState(state);
  const root = removePaneNode(next.root, paneId);
  if (!root) throw new Error("Workspace cannot have zero panes");
  const closingPane = next.panes[paneId];
  const closingOrder = [
    closingPane.activeTabId,
    ...closingPane.recentTabIds.filter((id) => id !== closingPane.activeTabId),
  ];
  const records = closingOrder.map((tabId) => ({
    tab: structuredClone(requireTab(next, tabId)),
    paneId,
    index: closingPane.tabIds.indexOf(tabId),
  }));
  next.closedTabs = [...records, ...next.closedTabs].slice(0, 20);
  for (const tabId of closingPane.tabIds) delete next.tabs[tabId];
  cleanupSingletonLinkGroups(next);
  delete next.panes[paneId];
  next.root = root;
  if (next.focusedPaneId === paneId) next.focusedPaneId = firstPaneId(root);
  return finalize(next);
}

export function renameResource(state: WorkspaceState, from: string, to: string): WorkspaceState {
  const next = cloneState(state);
  for (const tab of Object.values(next.tabs)) {
    tab.view = renameInView(tab.view, from, to);
    tab.history = tab.history.map((entry) => ({ ...entry, view: renameInView(entry.view, from, to) }));
    if (resourcePath(tab.view) === to) tab.title = titleForView(tab.view);
  }
  for (const record of next.closedTabs) {
    record.tab.view = renameInView(record.tab.view, from, to);
    record.tab.history = record.tab.history.map((entry) => ({
      ...entry,
      view: renameInView(entry.view, from, to),
    }));
    if (resourcePath(record.tab.view) === to) record.tab.title = titleForView(record.tab.view);
  }
  return finalize(next);
}

export function markResourceMissing(state: WorkspaceState, path: string, reason = "Resource not found"): WorkspaceState {
  const next = cloneState(state);
  for (const tab of Object.values(next.tabs)) {
    tab.view = missingInView(tab.view, path, reason);
    tab.history = tab.history.map((entry) => ({ ...entry, view: missingInView(entry.view, path, reason) }));
  }
  for (const record of next.closedTabs) {
    record.tab.view = missingInView(record.tab.view, path, reason);
    record.tab.history = record.tab.history.map((entry) => ({
      ...entry,
      view: missingInView(entry.view, path, reason),
    }));
  }
  return finalize(next);
}

/** Resource deletion is represented as a recoverable missing view. */
export const deleteResource = markResourceMissing;

export function serializeWorkspace(state: WorkspaceState, savedAt?: string): WorkspaceSnapshot {
  assertWorkspaceInvariants(state);
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    ...(savedAt ? { savedAt } : {}),
    window: { root: structuredClone(state.root), focusedPaneId: state.focusedPaneId },
    panes: structuredClone(state.panes),
    tabs: structuredClone(state.tabs),
    sidebars: structuredClone(state.sidebars),
    closedTabs: structuredClone(state.closedTabs),
    nextId: state.nextId,
  };
}

export function restoreWorkspace(snapshot: WorkspaceSnapshot): WorkspaceState {
  if (snapshot.schemaVersion !== WORKSPACE_SCHEMA_VERSION) throw new Error(`Unsupported workspace schema ${snapshot.schemaVersion}`);
  const state: WorkspaceState = {
    root: structuredClone(snapshot.window.root),
    focusedPaneId: snapshot.window.focusedPaneId,
    panes: Object.fromEntries(Object.entries(structuredClone(snapshot.panes)).map(([id, pane]) => [
      id,
      { ...pane, stackedTabs: pane.stackedTabs ?? false },
    ])),
    tabs: structuredClone(snapshot.tabs),
    sidebars: structuredClone(snapshot.sidebars),
    closedTabs: structuredClone(snapshot.closedTabs ?? []),
    nextId: snapshot.nextId,
  };
  for (const tab of Object.values(state.tabs)) {
    assertSafeViewPaths(tab.view);
    for (const entry of tab.history) assertSafeViewPaths(entry.view);
  }
  for (const record of state.closedTabs) {
    assertSafeViewPaths(record.tab.view);
    for (const entry of record.tab.history) assertSafeViewPaths(entry.view);
  }
  return finalize(state);
}

function assertSafeViewPaths(view: WorkspaceView): void {
  const paths: string[] = [];
  const direct = resourcePath(view);
  if (direct) paths.push(direct);
  if (view.type === "graph" && view.centerPath) paths.push(view.centerPath);
  for (const path of paths) {
    const normalized = path.replace(/\\/g, "/");
    if (
      normalized.startsWith("/")
      || path.includes("\\")
      || /^[A-Za-z]:\//.test(normalized)
      || normalized.split("/").some((part) => part === ".." || part === "." || part === "")
      || normalized.includes("\0")
    ) {
      throw new Error(`Unsafe workspace resource path: ${path}`);
    }
  }
}

function renameInView(view: WorkspaceView, from: string, to: string): WorkspaceView {
  if (isResourceView(view) && view.path === from) return { ...view, path: to };
  if (view.type === "missing" && view.original.path === from) return { ...view, original: { ...view.original, path: to } };
  if (view.type === "graph" && view.centerPath === from) return { ...view, centerPath: to };
  return view;
}

function missingInView(view: WorkspaceView, path: string, reason: string): WorkspaceView {
  if (isResourceView(view) && view.path === path) return { type: "missing", original: view, reason };
  return view;
}

function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_SPLIT_RATIO;
  return Math.max(MIN_SPLIT_RATIO, Math.min(MAX_SPLIT_RATIO, ratio));
}

function locationsEqual(left: ViewLocation | undefined, right: ViewLocation | undefined): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

function requirePane(state: WorkspaceState, paneId: PaneId): WorkspacePane {
  const pane = state.panes[paneId];
  if (!pane) throw new Error(`Unknown pane ${paneId}`);
  return pane;
}

function requireTab(state: WorkspaceState, tabId: TabId): WorkspaceTab {
  const tab = state.tabs[tabId];
  if (!tab) throw new Error(`Unknown tab ${tabId}`);
  return tab;
}

function paneContainingTab(state: WorkspaceState, tabId: TabId): WorkspacePane {
  requireTab(state, tabId);
  const pane = Object.values(state.panes).find((candidate) => candidate.tabIds.includes(tabId));
  if (!pane) throw new Error(`Tab ${tabId} has no pane`);
  return pane;
}

export function workspaceInvariantErrors(state: WorkspaceState): string[] {
  const errors: string[] = [];
  const treePaneIds: PaneId[] = [];
  const splitIds = new Set<string>();
  const visit = (node: WorkspaceNode) => {
    if (node.type === "pane") {
      treePaneIds.push(node.paneId);
      return;
    }
    if (splitIds.has(node.id)) errors.push(`Duplicate split ID ${node.id}`);
    splitIds.add(node.id);
    if (node.ratio < MIN_SPLIT_RATIO || node.ratio > MAX_SPLIT_RATIO || !Number.isFinite(node.ratio)) errors.push(`Invalid ratio for ${node.id}`);
    visit(node.first);
    visit(node.second);
  };
  visit(state.root);
  const uniqueTreePanes = new Set(treePaneIds);
  if (uniqueTreePanes.size !== treePaneIds.length) errors.push("A pane occurs more than once in the layout tree");
  for (const paneId of treePaneIds) if (!state.panes[paneId]) errors.push(`Tree references unknown pane ${paneId}`);
  for (const paneId of Object.keys(state.panes)) if (!uniqueTreePanes.has(paneId)) errors.push(`Pane ${paneId} is absent from tree`);
  if (!state.panes[state.focusedPaneId]) errors.push(`Focused pane ${state.focusedPaneId} does not exist`);
  const allIds = [...treePaneIds, ...splitIds, ...Object.keys(state.tabs)];
  if (new Set(allIds).size !== allIds.length) errors.push("Pane, split, and tab IDs must be globally unique");
  const owners = new Map<TabId, PaneId>();
  for (const pane of Object.values(state.panes)) {
    if (pane.id === "" || pane.id !== state.panes[pane.id]?.id) errors.push(`Invalid pane ID ${pane.id}`);
    if (pane.tabIds.length === 0) errors.push(`Pane ${pane.id} has no tabs`);
    if (!pane.tabIds.includes(pane.activeTabId)) errors.push(`Pane ${pane.id} active tab is not in pane`);
    if (new Set(pane.tabIds).size !== pane.tabIds.length) errors.push(`Pane ${pane.id} contains duplicate tabs`);
    if (new Set(pane.recentTabIds).size !== pane.recentTabIds.length || pane.recentTabIds.length !== pane.tabIds.length || pane.recentTabIds.some((id) => !pane.tabIds.includes(id))) errors.push(`Pane ${pane.id} has invalid MRU order`);
    if (typeof pane.stackedTabs !== "boolean") errors.push(`Pane ${pane.id} has invalid stacked-tabs setting`);
    let sawUnpinned = false;
    for (const tabId of pane.tabIds) {
      const tab = state.tabs[tabId];
      if (!tab) errors.push(`Pane ${pane.id} references unknown tab ${tabId}`);
      else {
        if (!tab.pinned) sawUnpinned = true;
        else if (sawUnpinned) errors.push(`Pinned tab ${tabId} follows an unpinned tab`);
      }
      if (owners.has(tabId)) errors.push(`Tab ${tabId} belongs to multiple panes`);
      owners.set(tabId, pane.id);
    }
  }
  if (state.closedTabs.length > 20) errors.push("Closed tab stack exceeds limit");
  for (const [tabId, tab] of Object.entries(state.tabs)) {
    if (!owners.has(tabId)) errors.push(`Tab ${tabId} belongs to no pane`);
    if (tab.id !== tabId) errors.push(`Tab map key does not match ID ${tabId}`);
    if (tab.historyIndex < -1 || tab.historyIndex >= tab.history.length) errors.push(`Tab ${tabId} has invalid history index`);
    if (tab.history.length > MAX_HISTORY_ENTRIES) errors.push(`Tab ${tabId} history exceeds limit`);
    if (tab.historyIndex === -1 && (tab.history.length !== 0 || tab.view.type !== "empty")) errors.push(`Tab ${tabId} has invalid empty history`);
    if (tab.linkGroupId !== undefined && (typeof tab.linkGroupId !== "string" || tab.linkGroupId.length === 0)) errors.push(`Tab ${tabId} has invalid link group`);
  }
  const linkCounts = new Map<string, WorkspaceTab[]>();
  for (const tab of Object.values(state.tabs)) {
    if (tab.linkGroupId) {
      linkCounts.set(tab.linkGroupId, [...(linkCounts.get(tab.linkGroupId) ?? []), tab]);
    }
  }
  for (const [groupId, members] of linkCounts) {
    if (members.length < 2) errors.push(`Link group ${groupId} has fewer than two tabs`);
    if (allIds.includes(groupId)) errors.push(`Link group ID ${groupId} collides with a workspace node`);
    if (new Set(members.map((tab) => JSON.stringify(tab.view))).size > 1) {
      errors.push(`Link group ${groupId} has divergent resource views`);
    }
  }
  if (!Number.isInteger(state.nextId) || state.nextId < 1) errors.push("Invalid next ID counter");
  return errors;
}

export function assertWorkspaceInvariants(state: WorkspaceState): void {
  const errors = workspaceInvariantErrors(state);
  if (errors.length) throw new Error(`Invalid workspace: ${errors.join("; ")}`);
}
