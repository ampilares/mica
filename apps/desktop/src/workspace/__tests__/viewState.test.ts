import { describe, expect, it } from "vitest";
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
} from "../viewState";

describe("workspace view-state adapters", () => {
  it("composes independent scroll targets without discarding other view state", () => {
    const canvas = withCanvasLocation(undefined, { x: 30, y: -4, zoom: 1.5 }, ["b", "a"]);
    const combined = withScrollPosition(canvas, "database-table", { top: 90, left: 12 });
    const withNote = withScrollPosition(combined, "note", { top: 240, left: 0 });

    expect(scrollPosition(withNote, "database-table")).toEqual({ top: 90, left: 12 });
    expect(scrollPosition(withNote, "note")).toEqual({ top: 240, left: 0 });
    expect(canvasLocation(withNote)).toEqual({
      viewport: { x: 30, y: -4, zoom: 1.5 },
      selectedIds: ["a", "b"],
    });
  });

  it("normalizes persisted canvas viewport and selection values", () => {
    const parsed = canvasLocation({
      canvas: {
        viewport: { x: Number.NaN, y: 22, zoom: 99 },
        selectedIds: ["shape-1", 4, "shape-1", "shape-2"],
      },
    });

    expect(parsed).toEqual({
      viewport: { x: -100, y: 22, zoom: 4 },
      selectedIds: ["shape-1", "shape-2"],
    });
  });

  it("round-trips graph focus without discarding other location state", () => {
    const location = withGraphLocation(
      withScrollPosition(undefined, "host", { top: 20, left: 0 }),
      { centerPath: "notes/focus.md", wholeVault: true },
    );
    expect(graphLocation(location)).toEqual({ centerPath: "notes/focus.md", wholeVault: true });
    expect(scrollPosition(location, "host")).toEqual({ top: 20, left: 0 });
  });

  it("round-trips the selected database view", () => {
    const location = withDatabaseLocation(undefined, { viewId: "kanban_status" });
    expect(databaseLocation(location)).toEqual({ viewId: "kanban_status" });
  });

  it("keeps rich and source selections independently with other location state", () => {
    const scrolled = withScrollPosition(undefined, "note", { top: 40, left: 0 });
    const rich = withTextSelection(scrolled, "rich", { anchor: 12.8, head: 4 });
    const source = withTextSelection(rich, "source", { anchor: 20, head: 20 });
    expect(textSelection(source, "rich")).toEqual({ anchor: 12, head: 4 });
    expect(textSelection(source, "source")).toEqual({ anchor: 20, head: 20 });
    expect(scrollPosition(source, "note")).toEqual({ top: 40, left: 0 });
  });
});
