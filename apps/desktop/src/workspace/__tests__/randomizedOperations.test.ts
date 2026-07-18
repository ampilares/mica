import { describe, expect, it } from "vitest";
import {
  activatePane,
  activateTab,
  closePane,
  closeTab,
  createTab,
  createWorkspace,
  dockTab,
  goBack,
  goForward,
  markResourceMissing,
  moveTab,
  navigateTab,
  openResource,
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
  type PaneId,
  type ResourceView,
  type SplitId,
  type TabId,
  type WorkspaceNode,
  type WorkspaceState,
} from "..";

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function splitIds(node: WorkspaceNode, result: SplitId[] = []): SplitId[] {
  if (node.type === "split") {
    result.push(node.id);
    splitIds(node.first, result);
    splitIds(node.second, result);
  }
  return result;
}

function pick<T>(random: () => number, values: T[]): T {
  return values[Math.floor(random() * values.length)];
}

function resource(sequence: number, step: number, variant = 0): ResourceView {
  const id = `${sequence}-${step}-${variant}`;
  switch ((step + variant) % 3) {
    case 0: return { type: "note", path: `notes/n-${id}.md`, mode: variant % 2 ? "source" : "rich" };
    case 1: return { type: "database", path: `databases/d-${id}.database.json` };
    default: return { type: "canvas", path: `canvases/c-${id}.drawio` };
  }
}

function runRandomOperation(
  workspace: WorkspaceState,
  random: () => number,
  sequence: number,
  step: number,
): WorkspaceState {
  const paneIds = Object.keys(workspace.panes) as PaneId[];
  const tabIds = Object.keys(workspace.tabs) as TabId[];
  const paneId = pick(random, paneIds);
  const pane = workspace.panes[paneId];
  const tabId = pick(random, pane.tabIds);
  const operation = Math.floor(random() * 19);

  switch (operation) {
    case 0:
      return tabIds.length < 36
        ? createTab(workspace, paneId, resource(sequence, step), { activate: random() > 0.25 })
        : workspace;
    case 1:
      return openResource(workspace, resource(sequence, step), {
        paneId,
        newTab: random() > 0.55,
        activate: random() > 0.2,
      });
    case 2:
      return activatePane(workspace, paneId);
    case 3:
      return activateTab(workspace, paneId, tabId);
    case 4:
      return navigateTab(workspace, tabId, resource(sequence, step, 1), { scrollTop: step });
    case 5:
      return pinTab(workspace, tabId, random() > 0.5);
    case 6:
      return reorderTab(workspace, paneId, tabId, Math.floor(random() * (pane.tabIds.length + 2)) - 1);
    case 7: {
      const target = pick(random, paneIds);
      return moveTab(workspace, tabId, target, Math.floor(random() * (workspace.panes[target].tabIds.length + 1)));
    }
    case 8:
      return paneIds.length < 8 ? dockTab(workspace, tabId, pick(random, paneIds), pick(random, ["left", "right", "up", "down"] as const)) : workspace;
    case 9:
      return closeTab(workspace, tabId);
    case 10:
      return reopenClosedTab(workspace);
    case 11:
      return paneIds.length < 8
        ? splitPane(workspace, paneId, {
            direction: random() > 0.5 ? "row" : "column",
            tabId,
            duplicate: random() > 0.6,
            before: random() > 0.5,
            ratio: random(),
          })
        : workspace;
    case 12: {
      const ids = splitIds(workspace.root);
      return ids.length ? resizeSplit(workspace, pick(random, ids), random() * 1.4 - 0.2) : workspace;
    }
    case 13:
      return goBack(workspace, tabId);
    case 14:
      return goForward(workspace, tabId);
    case 15:
      return updateCurrentHistoryLocation(workspace, tabId, { scrollTop: step, sequence });
    case 16:
      return setPaneStackedTabs(workspace, paneId, random() > 0.5);
    case 17: {
      const view = workspace.tabs[tabId].view;
      const path = view.type === "missing" ? view.original.path : "path" in view ? view.path : undefined;
      if (!path) return workspace;
      if (random() > 0.5) return markResourceMissing(workspace, path, "Randomized missing resource");
      const renamed = path.replace(/([^/]+)$/, `renamed-${sequence}-${step}-$1`);
      return renameResource(workspace, path, renamed);
    }
    default:
      return paneIds.length > 1 && random() > 0.45
        ? closePane(workspace, paneId)
        : restoreWorkspace(serializeWorkspace(workspace));
  }
}

describe("randomized workspace operation sequences", () => {
  it("preserves every workspace invariant after every deterministic mutation", () => {
    const sequenceCount = 32;
    const stepsPerSequence = 180;

    for (let sequence = 1; sequence <= sequenceCount; sequence += 1) {
      const random = seededRandom(0x5eed0000 + sequence);
      let workspace = createWorkspace({ view: resource(sequence, 0) });
      for (let step = 1; step <= stepsPerSequence; step += 1) {
        workspace = runRandomOperation(workspace, random, sequence, step);
        expect(
          workspaceInvariantErrors(workspace),
          `seed ${0x5eed0000 + sequence}, sequence ${sequence}, step ${step}`,
        ).toEqual([]);
      }
    }
  });
});
