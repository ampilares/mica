import { describe, expect, it } from "vitest";
import {
  restoreWorkspace,
  serializeWorkspace,
  workspaceInvariantErrors,
  type WorkspaceSnapshot,
} from "..";

describe("legacy schema-v2 snapshot compatibility", () => {
  it("defaults every optional P1 field and round-trips canonically", () => {
    // This fixture intentionally predates stacked tabs, linked tabs, and the
    // closed-tab stack while retaining schemaVersion 2.
    const legacyFixture = {
      schemaVersion: 2,
      savedAt: "2026-07-13T00:00:00Z",
      window: {
        root: { type: "pane", paneId: "pane_1" },
        focusedPaneId: "pane_1",
      },
      panes: {
        pane_1: {
          id: "pane_1",
          tabIds: ["tab_2"],
          activeTabId: "tab_2",
          recentTabIds: ["tab_2"],
        },
      },
      tabs: {
        tab_2: {
          id: "tab_2",
          view: { type: "note", path: "legacy.md", mode: "rich" },
          title: "legacy",
          pinned: false,
          history: [{ view: { type: "note", path: "legacy.md", mode: "rich" } }],
          historyIndex: 0,
        },
      },
      sidebars: {
        left: { open: true, width: 260, panel: "files" },
        right: { open: false, width: 262, panel: "outline" },
      },
      nextId: 3,
    };

    const restored = restoreWorkspace(legacyFixture as unknown as WorkspaceSnapshot);
    expect(restored.panes.pane_1.stackedTabs).toBe(false);
    expect(restored.tabs.tab_2.linkGroupId).toBeUndefined();
    expect(restored.closedTabs).toEqual([]);
    expect(workspaceInvariantErrors(restored)).toEqual([]);

    const canonical = serializeWorkspace(restored, legacyFixture.savedAt);
    expect(canonical.panes.pane_1.stackedTabs).toBe(false);
    expect("linkGroupId" in canonical.tabs.tab_2).toBe(false);
    expect(canonical.closedTabs).toEqual([]);
    expect(restoreWorkspace(canonical)).toEqual(restored);
  });
});
