import { describe, expect, it, vi } from "vitest";
import {
  createTab,
  createWorkspace,
  findMissingWorkspaceResources,
  markResourceMissing,
  navigateTab,
  selectActiveTab,
} from "..";

describe("restored workspace resource validation", () => {
  it("reports unavailable unique resources without blocking valid ones", async () => {
    let workspace = createWorkspace({ view: { type: "note", path: "good.md", mode: "rich" } });
    workspace = createTab(workspace, workspace.focusedPaneId, { type: "database", path: "missing.database.json" });
    workspace = createTab(workspace, workspace.focusedPaneId, { type: "note", path: "good.md", mode: "source" });
    const probe = vi.fn(async (view: { path: string }) => {
      if (view.path.startsWith("missing")) throw new Error("Not found");
    });

    await expect(findMissingWorkspaceResources(workspace, probe)).resolves.toEqual([
      { path: "missing.database.json", reason: "Not found" },
    ]);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("validates resources retained only in navigation history", async () => {
    let workspace = createWorkspace({
      view: { type: "note", path: "history-only.md", mode: "rich" },
    });
    const tabId = selectActiveTab(workspace)!.id;
    workspace = navigateTab(
      workspace,
      tabId,
      { type: "note", path: "current.md", mode: "rich" },
    );
    const probe = vi.fn(async (view: { path: string }) => {
      if (view.path === "history-only.md") throw new Error("History target was deleted");
    });

    await expect(findMissingWorkspaceResources(workspace, probe)).resolves.toEqual([
      { path: "history-only.md", reason: "History target was deleted" },
    ]);
    expect(probe.mock.calls.map(([view]) => view.path).sort()).toEqual([
      "current.md",
      "history-only.md",
    ]);
  });

  it("probes missing originals and deduplicates them across live views and history", async () => {
    let workspace = createWorkspace({
      view: { type: "note", path: "shared.md", mode: "rich" },
    });
    const firstTabId = selectActiveTab(workspace)!.id;
    workspace = navigateTab(
      workspace,
      firstTabId,
      { type: "note", path: "other.md", mode: "rich" },
    );
    workspace = createTab(
      workspace,
      workspace.focusedPaneId,
      { type: "note", path: "shared.md", mode: "source" },
    );
    workspace = markResourceMissing(workspace, "shared.md", "Already missing");
    const probe = vi.fn(async (view: { path: string }) => {
      if (view.path === "shared.md") throw "unavailable";
    });

    await expect(findMissingWorkspaceResources(workspace, probe)).resolves.toEqual([
      { path: "shared.md", reason: "File is unavailable" },
    ]);
    expect(probe.mock.calls.filter(([view]) => view.path === "shared.md")).toHaveLength(1);
    expect(probe.mock.calls.map(([view]) => view.path).sort()).toEqual(["other.md", "shared.md"]);
  });
});
