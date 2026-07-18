import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("native workspace window API", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("invokes the Rust command with its documented request envelope", async () => {
    vi.mocked(invoke).mockResolvedValue({
      windowId: "window-2",
      label: "mica-workspace-window-2",
      created: true,
    });

    await expect(
      api.workspaceWindowCreate({
        windowId: "window-2",
        startupQuery: "?restore=true",
      }),
    ).resolves.toEqual({
      windowId: "window-2",
      label: "mica-workspace-window-2",
      created: true,
    });
    expect(invoke).toHaveBeenCalledWith("workspace_window_create", {
      request: { windowId: "window-2", startupQuery: "restore=true" },
    });
  });

  it("rejects an invalid request before invoking Tauri", () => {
    expect(() => api.workspaceWindowCreate({ windowId: "bad window" })).toThrow(/windowId/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("addresses snapshots by stable window ID and discovers persisted descriptors", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    await api.vaultCurrent();
    await api.workspaceSnapshotRead("window-7");
    await api.workspaceSnapshotWindowIds();

    expect(invoke).toHaveBeenNthCalledWith(1, "vault_current");
    expect(invoke).toHaveBeenNthCalledWith(2, "workspace_snapshot_read", {
      windowId: "window-7",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "workspace_snapshot_window_ids");
  });
});
