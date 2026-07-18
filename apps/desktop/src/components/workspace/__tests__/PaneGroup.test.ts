import { describe, expect, it } from "vitest";
import { resourceViewForPath } from "../PaneGroup";

describe("sidebar resource docking", () => {
  it("maps supported vault resources to workspace views", () => {
    expect(resourceViewForPath("notes/Today.md")).toEqual({
      type: "note",
      path: "notes/Today.md",
      mode: "rich",
    });
    expect(resourceViewForPath("data/Tasks.database.json")).toEqual({
      type: "database",
      path: "data/Tasks.database.json",
    });
    expect(resourceViewForPath("canvases/Map.drawio")).toEqual({
      type: "canvas",
      path: "canvases/Map.drawio",
    });
    expect(resourceViewForPath("assets/photo.png")).toBeNull();
  });
});
