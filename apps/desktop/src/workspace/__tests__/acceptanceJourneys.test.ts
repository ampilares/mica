import { describe, expect, it } from "vitest";
import {
  activatePane,
  activateTab,
  closeTab,
  closeTabsToRight,
  createTab,
  createWorkspace,
  goBack,
  linkTabs,
  markResourceMissing,
  navigateTab,
  pinTab,
  renameResource,
  reorderTab,
  reopenClosedTab,
  resizeSplit,
  restoreWorkspace,
  serializeWorkspace,
  setPaneStackedTabs,
  splitPane,
  updateCurrentHistoryLocation,
  workspaceInvariantErrors,
  type WorkspaceState,
} from "..";

const note = (path: string) => ({ type: "note" as const, path, mode: "rich" as const });
const restart = (workspace: WorkspaceState) => restoreWorkspace(
  JSON.parse(JSON.stringify(serializeWorkspace(workspace, "2026-07-13T00:00:00Z"))),
);

describe("v2 acceptance journeys at the domain and persistence boundary", () => {
  it("Journey A restores research beside writing, ratio, pin, history, and focus", () => {
    let workspace = createWorkspace({ view: note("writing.md"), title: "Writing" });
    const writingPaneId = workspace.focusedPaneId;
    const writingTabId = workspace.panes[writingPaneId].activeTabId;
    workspace = splitPane(workspace, writingPaneId, {
      direction: "row",
      duplicate: true,
      ratio: 0.58,
    });
    const referencePaneId = workspace.focusedPaneId;
    const referenceTabId = workspace.panes[referencePaneId].activeTabId;
    workspace = navigateTab(workspace, referenceTabId, note("reference.md"));
    workspace = pinTab(workspace, referenceTabId, true);
    if (workspace.root.type !== "split") throw new Error("Expected research split");
    workspace = resizeSplit(workspace, workspace.root.id, 0.61);
    workspace = navigateTab(workspace, writingTabId, note("linked-draft.md"), { scrollTop: 240 });
    workspace = goBack(workspace, writingTabId);
    workspace = activatePane(workspace, writingPaneId);

    const restored = restart(workspace);
    expect(Object.keys(restored.panes)).toHaveLength(2);
    expect(restored.root.type === "split" && restored.root.ratio).toBe(0.61);
    expect(restored.tabs[referenceTabId]).toMatchObject({ pinned: true, view: note("reference.md") });
    expect(restored.tabs[writingTabId].view).toEqual(note("writing.md"));
    expect(restored.tabs[writingTabId].history).toHaveLength(2);
    expect(restored.focusedPaneId).toBe(writingPaneId);
    expect(workspaceInvariantErrors(restored)).toEqual([]);
  });

  it("Journey B organizes mixed tabs, preserves view state on move, and reopens MRU", () => {
    let workspace = createWorkspace({ view: note("one.md") });
    const paneId = workspace.focusedPaneId;
    const views = [
      { type: "database" as const, path: "one.database.json" },
      { type: "canvas" as const, path: "one.drawio" },
      note("two.md"),
      { type: "database" as const, path: "two.database.json" },
      { type: "canvas" as const, path: "two.drawio" },
    ];
    for (const view of views) workspace = createTab(workspace, paneId, view);
    const sixIds = [...workspace.panes[paneId].tabIds];
    const canvasOneId = sixIds[2];
    workspace = updateCurrentHistoryLocation(workspace, canvasOneId, {
      canvas: { viewport: { x: 20, y: 40, scale: 1.25 }, selectedIds: ["node-1"] },
    });
    workspace = reorderTab(workspace, paneId, sixIds[5], 1);
    const anchorId = canvasOneId;
    workspace = closeTabsToRight(workspace, paneId, anchorId);
    workspace = splitPane(workspace, paneId, { direction: "column", tabId: canvasOneId });
    const canvasPaneId = workspace.focusedPaneId;
    expect(workspace.tabs[canvasOneId].history[0].location).toMatchObject({
      canvas: { selectedIds: ["node-1"] },
    });

    const remainingOriginal = workspace.panes[paneId].tabIds;
    const first = remainingOriginal[0];
    const last = remainingOriginal[remainingOriginal.length - 1];
    workspace = activateTab(workspace, paneId, first);
    workspace = activateTab(workspace, paneId, last);
    workspace = closeTab(workspace, last);
    expect(workspace.panes[paneId].activeTabId).toBe(first);
    workspace = reopenClosedTab(workspace);
    expect(workspace.panes[paneId].activeTabId).toBe(last);
    expect(workspace.panes[canvasPaneId].tabIds).toContain(canvasOneId);
    expect(workspaceInvariantErrors(restart(workspace))).toEqual([]);
  });

  it("Journey C persists stacked and linked tab command outcomes plus reopen state", () => {
    let workspace = createWorkspace();
    const firstPaneId = workspace.focusedPaneId;
    const firstTabId = workspace.panes[firstPaneId].activeTabId;
    workspace = navigateTab(workspace, firstTabId, note("keyboard.md"));
    workspace = splitPane(workspace, firstPaneId, { direction: "row", duplicate: true });
    const secondPaneId = workspace.focusedPaneId;
    const secondTabId = workspace.panes[secondPaneId].activeTabId;
    workspace = linkTabs(workspace, firstTabId, secondTabId);
    workspace = setPaneStackedTabs(workspace, secondPaneId, true);
    workspace = navigateTab(workspace, firstTabId, note("synchronized.md"));
    workspace = pinTab(workspace, secondTabId, true);

    let restored = restart(workspace);
    expect(restored.panes[secondPaneId].stackedTabs).toBe(true);
    expect(restored.tabs[firstTabId].linkGroupId).toBeTruthy();
    expect(restored.tabs[secondTabId].linkGroupId).toBe(restored.tabs[firstTabId].linkGroupId);
    expect(restored.tabs[firstTabId].view).toEqual(note("synchronized.md"));
    expect(restored.tabs[secondTabId].view).toEqual(note("synchronized.md"));
    expect(restored.tabs[secondTabId].pinned).toBe(true);

    restored = createTab(restored, firstPaneId, note("temporary.md"));
    const temporaryId = restored.panes[firstPaneId].activeTabId;
    restored = closeTab(restored, temporaryId);
    expect(restored.closedTabs[0].tab.id).toBe(temporaryId);
    restored = reopenClosedTab(restored);
    expect(restored.tabs[temporaryId].view).toEqual(note("temporary.md"));
    expect(workspaceInvariantErrors(restored)).toEqual([]);
  });

  it("Journey D restores renamed, deleted, and unsupported resources without blocking valid tabs", () => {
    let workspace = createWorkspace({ view: note("old.md") });
    const historyTabId = workspace.panes[workspace.focusedPaneId].activeTabId;
    workspace = navigateTab(workspace, historyTabId, note("current.md"));
    workspace = renameResource(workspace, "old.md", "renamed.md");
    workspace = goBack(workspace, historyTabId);
    workspace = markResourceMissing(workspace, "renamed.md", "Deleted from vault");
    workspace = createTab(workspace, workspace.focusedPaneId, {
      type: "database",
      path: "healthy.database.json",
    });
    workspace = createTab(workspace, workspace.focusedPaneId, {
      type: "missing",
      original: { type: "canvas", path: "legacy.drawio" },
      reason: "Unsupported resource version",
    });

    let restored = restart(workspace);
    expect(restored.tabs[historyTabId].view).toMatchObject({
      type: "missing",
      original: { path: "renamed.md" },
      reason: "Deleted from vault",
    });
    expect(Object.values(restored.tabs).some((tab) =>
      tab.view.type === "database" && tab.view.path === "healthy.database.json"
    )).toBe(true);
    expect(Object.values(restored.tabs).some((tab) =>
      tab.view.type === "missing" && tab.view.reason === "Unsupported resource version"
    )).toBe(true);
    restored = createTab(restored, restored.focusedPaneId, note("still-editable.md"));
    expect(workspaceInvariantErrors(restored)).toEqual([]);
  });
});
