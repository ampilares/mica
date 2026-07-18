import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  workspacePresetList: vi.fn(),
  workspacePresetRead: vi.fn(),
  workspacePresetWrite: vi.fn(),
  workspacePresetDelete: vi.fn(),
}));

vi.mock("../../api", () => ({ api: apiMock }));

import {
  createWorkspace,
  deleteWorkspacePreset,
  listWorkspacePresets,
  loadWorkspacePreset,
  saveWorkspacePreset,
  serializeWorkspace,
  validateWorkspacePresetName,
} from "..";

describe("workspace presets", () => {
  beforeEach(() => vi.clearAllMocks());

  it("validates names consistently with the backend", () => {
    expect(validateWorkspacePresetName("Research layout 2")).toBe("Research layout 2");
    for (const name of ["", " leading", "trailing ", "../escape", "emoji 🚀", "x".repeat(81)]) {
      expect(() => validateWorkspacePresetName(name)).toThrow(/Preset names/);
    }
  });

  it("lists, saves, restores, and deletes snapshots through the preset API", async () => {
    const workspace = createWorkspace({ view: { type: "note", path: "Today.md", mode: "rich" } });
    apiMock.workspacePresetList.mockResolvedValue(["Focus", "Research"]);
    apiMock.workspacePresetRead.mockResolvedValue(serializeWorkspace(workspace));
    apiMock.workspacePresetWrite.mockResolvedValue(undefined);
    apiMock.workspacePresetDelete.mockResolvedValue(true);

    await expect(listWorkspacePresets()).resolves.toEqual(["Focus", "Research"]);
    await saveWorkspacePreset("Focus", workspace);
    expect(apiMock.workspacePresetWrite).toHaveBeenCalledWith(
      "Focus",
      expect.objectContaining({ schemaVersion: 2, savedAt: expect.any(String) }),
    );
    await expect(loadWorkspacePreset("Focus")).resolves.toEqual(workspace);
    await expect(deleteWorkspacePreset("Focus")).resolves.toBe(true);
  });
});
