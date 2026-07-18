import { describe, expect, it } from "vitest";
import {
  activateTab,
  assertWorkspaceInvariants,
  closePane,
  closeTab,
  createTab,
  createWorkspace,
  deleteResource,
  dockTab,
  goBack,
  goForward,
  linkTabs,
  moveTab,
  navigateTab,
  openResource,
  pinTab,
  renameResource,
  replaceTabView,
  reopenClosedTab,
  resizeSplit,
  restoreWorkspace,
  selectActivePath,
  selectActiveTab,
  selectAllPaneIds,
  selectCanGoForward,
  selectViewsOfResource,
  serializeWorkspace,
  setPaneStackedTabs,
  splitPane,
  updateCurrentHistoryLocation,
  unlinkTab,
  workspaceInvariantErrors,
} from "..";

const note = (path: string) => ({ type: "note" as const, path, mode: "rich" as const });

describe("workspace domain operations", () => {
  it("creates deterministic, valid default workspaces", () => {
    const first = createWorkspace();
    const second = createWorkspace();
    expect(first).toEqual(second);
    expect(first.focusedPaneId).toBe("pane_1");
    expect(selectActiveTab(first)?.id).toBe("tab_2");
    expect(workspaceInvariantErrors(first)).toEqual([]);
  });

  it("navigates an unpinned tab but protects a pinned tab", () => {
    let state = createWorkspace({ view: note("one.md") });
    const firstId = selectActiveTab(state)!.id;
    state = openResource(state, note("two.md"));
    expect(selectActiveTab(state)?.id).toBe(firstId);
    expect(selectActivePath(state)).toBe("two.md");

    state = pinTab(state, firstId);
    state = openResource(state, note("three.md"));
    expect(selectActiveTab(state)?.id).not.toBe(firstId);
    expect(state.panes[state.focusedPaneId].tabIds[0]).toBe(firstId);
    expect(selectActivePath(state)).toBe("three.md");
  });

  it("uses pane-local MRU when the active tab closes", () => {
    let state = createWorkspace({ view: note("one.md") });
    const one = selectActiveTab(state)!.id;
    state = createTab(state, state.focusedPaneId, note("two.md"));
    const two = selectActiveTab(state)!.id;
    state = createTab(state, state.focusedPaneId, note("three.md"));
    const three = selectActiveTab(state)!.id;
    state = activateTab(state, state.focusedPaneId, one);
    state = activateTab(state, state.focusedPaneId, three);
    state = closeTab(state, three);
    expect(selectActiveTab(state)?.id).toBe(one);
    expect(state.tabs[two]).toBeDefined();
    assertWorkspaceInvariants(state);
  });

  it("leaves an empty tab when the final non-empty tab closes", () => {
    const initial = createWorkspace({ view: note("one.md") });
    const state = closeTab(initial, selectActiveTab(initial)!.id);
    expect(selectActiveTab(state)?.view).toEqual({ type: "empty" });
    expect(Object.keys(state.panes)).toHaveLength(1);
    assertWorkspaceInvariants(state);
  });

  it("reopens the latest closed tab at its original pane position", () => {
    let state = createWorkspace({ view: note("one.md") });
    const paneId = state.focusedPaneId;
    state = createTab(state, paneId, note("two.md"));
    const twoId = selectActiveTab(state)!.id;
    state = createTab(state, paneId, note("three.md"));
    const threeId = selectActiveTab(state)!.id;

    state = closeTab(state, twoId);
    expect(state.closedTabs[0].tab.id).toBe(twoId);
    state = reopenClosedTab(state);

    expect(state.panes[paneId].tabIds).toEqual([
      expect.any(String),
      twoId,
      threeId,
    ]);
    expect(state.panes[paneId].activeTabId).toBe(twoId);
    expect(state.focusedPaneId).toBe(paneId);
    expect(state.closedTabs).toHaveLength(0);
    assertWorkspaceInvariants(state);
  });

  it("falls back to the focused pane and safely skips colliding closed records", () => {
    let state = createWorkspace({ view: note("one.md") });
    const originalPane = state.focusedPaneId;
    state = splitPane(state, originalPane, { direction: "row", duplicate: true });
    const focusedPane = state.focusedPaneId;
    const originalTab = state.panes[originalPane].activeTabId;
    state = closeTab(state, originalTab);
    state = { ...state, closedTabs: [
      { ...state.closedTabs[0], tab: structuredClone(state.tabs[state.panes[focusedPane].activeTabId]) },
      state.closedTabs[0],
    ] };
    // Simulate the original pane disappearing after the tab was recorded.
    const snapshot = structuredClone(state);
    for (const tabId of snapshot.panes[originalPane].tabIds) delete snapshot.tabs[tabId];
    delete snapshot.panes[originalPane];
    snapshot.root = { type: "pane", paneId: focusedPane };
    snapshot.focusedPaneId = focusedPane;

    const reopened = reopenClosedTab(snapshot);
    expect(reopened.panes[focusedPane].activeTabId).toBe(originalTab);
    expect(reopened.closedTabs).toHaveLength(0);
    assertWorkspaceInvariants(reopened);
  });

  it("records pane closure so its active tab can reopen in the remaining pane", () => {
    let state = createWorkspace({ view: note("one.md") });
    const remainingPane = state.focusedPaneId;
    state = splitPane(state, remainingPane, { direction: "row", duplicate: true });
    const closingPane = state.focusedPaneId;
    const closingTab = state.panes[closingPane].activeTabId;

    state = closePane(state, closingPane);
    expect(state.closedTabs[0]).toMatchObject({ paneId: closingPane, tab: { id: closingTab } });
    state = reopenClosedTab(state);

    expect(state.focusedPaneId).toBe(remainingPane);
    expect(state.panes[remainingPane].activeTabId).toBe(closingTab);
    assertWorkspaceInvariants(state);
  });

  it("persists a pane-local stacked-tabs preference", () => {
    let state = createWorkspace();
    state = setPaneStackedTabs(state, state.focusedPaneId, true);
    expect(state.panes[state.focusedPaneId].stackedTabs).toBe(true);
    expect(restoreWorkspace(serializeWorkspace(state))).toEqual(state);

    const legacySnapshot = serializeWorkspace(state) as ReturnType<typeof serializeWorkspace> & {
      panes: Record<string, Omit<(typeof state.panes)[string], "stackedTabs">>;
    };
    delete (legacySnapshot.panes[state.focusedPaneId] as Partial<(typeof state.panes)[string]>).stackedTabs;
    expect(restoreWorkspace(legacySnapshot).panes[state.focusedPaneId].stackedTabs).toBe(false);
  });

  it("splits, moves tabs, clamps resize, and collapses an empty pane", () => {
    let state = createWorkspace({ view: note("one.md") });
    const originalPane = state.focusedPaneId;
    const movedId = selectActiveTab(state)!.id;
    state = splitPane(state, originalPane, { direction: "row" });
    const newPane = state.focusedPaneId;
    expect(selectAllPaneIds(state)).toEqual([originalPane, newPane]);
    expect(state.panes[newPane].activeTabId).toBe(movedId);
    expect(state.panes[originalPane].tabIds).toHaveLength(1);
    expect(state.tabs[state.panes[originalPane].activeTabId].view.type).toBe("empty");

    const splitId = state.root.type === "split" ? state.root.id : "";
    const panesBeforeResize = state.panes;
    const tabsBeforeResize = state.tabs;
    state = resizeSplit(state, splitId, 2);
    expect(state.root.type === "split" && state.root.ratio).toBe(0.85);
    expect(state.panes).toBe(panesBeforeResize);
    expect(state.tabs).toBe(tabsBeforeResize);

    state = moveTab(state, movedId, originalPane);
    const newPaneEmpty = state.panes[newPane].activeTabId;
    state = closeTab(state, newPaneEmpty);
    expect(selectAllPaneIds(state)).toEqual([originalPane]);
    assertWorkspaceInvariants(state);
  });

  it("maintains branching back and forward history", () => {
    let state = createWorkspace({ view: note("one.md") });
    const tabId = selectActiveTab(state)!.id;
    state = navigateTab(state, tabId, note("two.md"), { scrollTop: 40 });
    state = navigateTab(state, tabId, note("three.md"));
    state = goBack(state, tabId);
    expect(selectActivePath(state)).toBe("two.md");
    expect(selectCanGoForward(state, tabId)).toBe(true);
    state = navigateTab(state, tabId, note("branch.md"));
    expect(selectCanGoForward(state, tabId)).toBe(false);
    expect(goForward(state, tabId)).toBe(state);
    state = goBack(state, tabId);
    expect(selectActivePath(state)).toBe("two.md");
  });

  it("synchronizes linked navigation while preserving peer-local locations", () => {
    let state = createWorkspace({ view: note("one.md") });
    const paneId = state.focusedPaneId;
    const sourceId = selectActiveTab(state)!.id;
    state = createTab(state, paneId, note("two.md"));
    const peerId = selectActiveTab(state)!.id;
    state = linkTabs(state, sourceId, peerId);

    const groupId = state.tabs[sourceId].linkGroupId;
    expect(groupId).toBeTruthy();
    expect(state.tabs[peerId].linkGroupId).toBe(groupId);
    expect(state.tabs[peerId].view).toEqual(note("one.md"));

    state = updateCurrentHistoryLocation(state, sourceId, { scroll: { note: { top: 10 } } });
    state = updateCurrentHistoryLocation(state, peerId, { scroll: { note: { top: 90 } } });
    state = replaceTabView(state, sourceId, { type: "note", path: "one.md", mode: "source" });
    expect(state.tabs[peerId].view).toEqual({ type: "note", path: "one.md", mode: "source" });
    expect(state.tabs[sourceId].history[state.tabs[sourceId].historyIndex].location)
      .toEqual({ scroll: { note: { top: 10 } } });
    expect(state.tabs[peerId].history[state.tabs[peerId].historyIndex].location)
      .toEqual({ scroll: { note: { top: 90 } } });

    const peerHistoryBefore = state.tabs[peerId].history.length;
    state = navigateTab(state, sourceId, note("three.md"));
    expect(state.tabs[peerId].view).toEqual(note("three.md"));
    expect(state.tabs[peerId].history).toHaveLength(peerHistoryBefore + 1);
    expect(state.tabs[peerId].history[state.tabs[peerId].historyIndex].location).toBeUndefined();

    state = goBack(state, sourceId);
    expect(state.tabs[sourceId].view).toMatchObject({ path: "one.md", mode: "source" });
    expect(state.tabs[peerId].view).toMatchObject({ path: "one.md", mode: "source" });
    expect(restoreWorkspace(serializeWorkspace(state))).toEqual(state);
    assertWorkspaceInvariants(state);
  });

  it("merges and cleans up link groups without affecting tab ownership", () => {
    let state = createWorkspace({ view: note("one.md") });
    const paneId = state.focusedPaneId;
    const first = selectActiveTab(state)!.id;
    state = createTab(state, paneId, note("two.md"));
    const second = selectActiveTab(state)!.id;
    state = createTab(state, paneId, note("three.md"));
    const third = selectActiveTab(state)!.id;
    state = linkTabs(state, first, second);
    state = linkTabs(state, third, second);
    expect(new Set([first, second, third].map((id) => state.tabs[id].linkGroupId)).size).toBe(1);

    state = unlinkTab(state, first);
    expect(state.tabs[first].linkGroupId).toBeUndefined();
    expect(state.tabs[second].linkGroupId).toBe(state.tabs[third].linkGroupId);
    state = unlinkTab(state, second);
    expect(state.tabs[second].linkGroupId).toBeUndefined();
    expect(state.tabs[third].linkGroupId).toBeUndefined();
    expect(state.panes[paneId].tabIds).toEqual(expect.arrayContaining([first, second, third]));
    assertWorkspaceInvariants(state);
  });

  it("keeps link membership when moving and cleans singleton groups on close", () => {
    let state = createWorkspace({ view: note("one.md") });
    const originalPane = state.focusedPaneId;
    const first = selectActiveTab(state)!.id;
    state = createTab(state, originalPane, note("two.md"));
    const second = selectActiveTab(state)!.id;
    state = linkTabs(state, first, second);
    const groupId = state.tabs[first].linkGroupId;

    state = splitPane(state, originalPane, { direction: "row", tabId: second });
    expect(state.tabs[first].linkGroupId).toBe(groupId);
    expect(state.tabs[second].linkGroupId).toBe(groupId);
    state = closeTab(state, second);
    expect(state.tabs[first].linkGroupId).toBeUndefined();
    expect(state.closedTabs[0].tab.linkGroupId).toBe(groupId);
    assertWorkspaceInvariants(state);
  });

  it("rejoins a reopened tab to its link group's current resource", () => {
    let state = createWorkspace({ view: note("one.md") });
    const first = selectActiveTab(state)!.id;
    state = createTab(state, state.focusedPaneId, note("two.md"));
    const second = selectActiveTab(state)!.id;
    state = createTab(state, state.focusedPaneId, note("three.md"));
    const third = selectActiveTab(state)!.id;
    state = linkTabs(state, first, second);
    state = linkTabs(state, first, third);
    const groupId = state.tabs[first].linkGroupId;

    state = closeTab(state, third);
    state = navigateTab(state, first, note("current.md"));
    state = reopenClosedTab(state);

    expect(state.tabs[third].linkGroupId).toBe(groupId);
    expect(state.tabs[third].view).toEqual(note("current.md"));
    expect(state.tabs[third].history[state.tabs[third].historyIndex].view).toEqual(note("current.md"));
    assertWorkspaceInvariants(state);
  });

  it("rejects restored link groups with divergent views", () => {
    let state = createWorkspace({ view: note("one.md") });
    const first = selectActiveTab(state)!.id;
    state = createTab(state, state.focusedPaneId, note("two.md"));
    const second = selectActiveTab(state)!.id;
    state = linkTabs(state, first, second);
    const snapshot = serializeWorkspace(state);
    snapshot.tabs[second].view = note("diverged.md");
    expect(() => restoreWorkspace(snapshot)).toThrow(/divergent resource views/);
  });

  it("checkpoints locations without adding history and restores the target entry", () => {
    let state = createWorkspace({ view: note("one.md") });
    const tabId = selectActiveTab(state)!.id;
    state = updateCurrentHistoryLocation(state, tabId, { scroll: { note: { top: 120, left: 0 } } });
    expect(state.tabs[tabId].history).toHaveLength(1);

    state = navigateTab(state, tabId, note("two.md"));
    state = updateCurrentHistoryLocation(state, tabId, {
      scroll: { note: { top: 480, left: 0 } },
    });
    state = goBack(state, tabId);
    expect(state.tabs[tabId].history[state.tabs[tabId].historyIndex].location)
      .toEqual({ scroll: { note: { top: 120, left: 0 } } });

    state = goForward(state, tabId);
    expect(state.tabs[tabId].history[state.tabs[tabId].historyIndex].location)
      .toEqual({ scroll: { note: { top: 480, left: 0 } } });

    state = goBack(state, tabId);
    state = navigateTab(state, tabId, note("branch.md"));
    expect(state.tabs[tabId].history.map((entry) => entry.view)).toEqual([
      note("one.md"),
      note("branch.md"),
    ]);
    expect(state.tabs[tabId].history[0].location)
      .toEqual({ scroll: { note: { top: 120, left: 0 } } });
  });

  it("docks tabs on all pane edges without breaking ownership invariants", () => {
    const edges = ["left", "right", "up", "down"] as const;
    for (const edge of edges) {
      let state = createWorkspace({ view: note("one.md") });
      const targetPane = state.focusedPaneId;
      state = createTab(state, targetPane, note("two.md"));
      const tabId = selectActiveTab(state)!.id;
      state = dockTab(state, tabId, targetPane, edge);

      expect(Object.keys(state.panes)).toHaveLength(2);
      expect(state.root.type).toBe("split");
      if (state.root.type === "split") {
        expect(state.root.direction).toBe(edge === "left" || edge === "right" ? "row" : "column");
        const dockedNode = edge === "left" || edge === "up" ? state.root.first : state.root.second;
        expect(dockedNode.type === "pane" && state.panes[dockedNode.paneId].tabIds).toContain(tabId);
      }
      assertWorkspaceInvariants(state);
    }
  });

  it("propagates rename and deletion through live views and history", () => {
    let state = createWorkspace({ view: note("old.md") });
    const tabId = selectActiveTab(state)!.id;
    state = navigateTab(state, tabId, note("other.md"));
    state = renameResource(state, "old.md", "folder/new.md");
    expect(state.tabs[tabId].history[0].view).toMatchObject({ path: "folder/new.md" });
    state = goBack(state, tabId);
    expect(selectViewsOfResource(state, "folder/new.md")).toHaveLength(1);
    state = deleteResource(state, "folder/new.md", "Deleted from vault");
    expect(selectActiveTab(state)?.view).toMatchObject({
      type: "missing",
      original: { path: "folder/new.md" },
      reason: "Deleted from vault",
    });
  });

  it("round-trips a valid versioned snapshot without changing identity", () => {
    let state = createWorkspace({ view: note("one.md") });
    state = splitPane(state, state.focusedPaneId, { direction: "column", duplicate: true });
    const snapshot = serializeWorkspace(state, "2026-07-13T00:00:00Z");
    expect(snapshot.schemaVersion).toBe(2);
    expect(restoreWorkspace(snapshot)).toEqual(state);
  });

  it("rejects absolute and traversal paths during workspace restore", () => {
    const state = createWorkspace({ view: note("safe.md") });
    const snapshot = serializeWorkspace(state);
    const tabId = Object.keys(snapshot.tabs)[0];
    snapshot.tabs[tabId].view = note("../../outside.md");
    expect(() => restoreWorkspace(snapshot)).toThrow(/Unsafe workspace resource path/);
    snapshot.tabs[tabId].view = note("/absolute.md");
    expect(() => restoreWorkspace(snapshot)).toThrow(/Unsafe workspace resource path/);
  });
});
