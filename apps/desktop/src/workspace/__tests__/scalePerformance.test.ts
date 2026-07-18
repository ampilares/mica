import { describe, expect, it } from "vitest";
import {
  createTab,
  createWorkspace,
  restoreWorkspace,
  serializeWorkspace,
  splitPane,
  workspaceInvariantErrors,
} from "..";

describe("workspace scale acceptance", () => {
  it("constructs and round-trips 50 tabs across 8 panes within a CI-safe budget", () => {
    const started = performance.now();
    let workspace = createWorkspace({
      view: { type: "note", path: "notes/scale-0.md", mode: "rich" },
    });

    for (let pane = 1; pane < 8; pane += 1) {
      workspace = splitPane(workspace, workspace.focusedPaneId, {
        direction: pane % 2 === 0 ? "row" : "column",
        duplicate: true,
        ratio: 0.45 + (pane % 3) * 0.05,
      });
    }

    const paneIds = Object.keys(workspace.panes);
    for (let tab = 8; tab < 50; tab += 1) {
      workspace = createTab(
        workspace,
        paneIds[tab % paneIds.length],
        { type: "note", path: `notes/scale-${tab}.md`, mode: tab % 2 ? "source" : "rich" },
        { activate: tab % 4 === 0 },
      );
    }

    const snapshot = serializeWorkspace(workspace, "2026-07-13T00:00:00Z");
    const restored = restoreWorkspace(JSON.parse(JSON.stringify(snapshot)));
    const elapsed = performance.now() - started;

    expect(Object.keys(restored.tabs)).toHaveLength(50);
    expect(Object.keys(restored.panes)).toHaveLength(8);
    expect(workspaceInvariantErrors(restored)).toEqual([]);
    expect(restored).toEqual(workspace);
    // This includes construction and repeated immutable operations, making it
    // deliberately more generous than the PRD's 150 ms restore-only target.
    expect(elapsed).toBeLessThan(3_000);
  });
});
