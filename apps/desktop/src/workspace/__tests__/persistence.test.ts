import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeWorkspaceVaultRoot,
  createWorkspace,
  createWorkspacePersister,
  flushWorkspacePersistence,
  registerWorkspacePersister,
} from "..";
import type { WorkspaceState } from "..";

afterEach(() => {
  vi.useRealTimers();
});

describe("workspace persistence lifecycle", () => {
  it("debounces changes and persists the latest state", async () => {
    vi.useFakeTimers();
    let state = createWorkspace();
    let written: WorkspaceState | undefined;
    const persist = vi.fn(async (next: WorkspaceState) => { written = next; });
    const persister = createWorkspacePersister(() => state, 350, persist);

    persister.schedule();
    state = createWorkspace({ view: { type: "note", path: "latest.md", mode: "rich" } });
    persister.schedule();
    await vi.advanceTimersByTimeAsync(350);

    expect(persist).toHaveBeenCalledTimes(1);
    expect(Object.values(written!.tabs)[0].view).toMatchObject({
      type: "note",
      path: "latest.md",
    });
  });

  it("flushes a pending debounce before a vault transition", async () => {
    vi.useFakeTimers();
    const persist = vi.fn(async () => undefined);
    const persister = createWorkspacePersister(createWorkspace, 350, persist);
    const unregister = registerWorkspacePersister("/vault-a", persister);

    persister.schedule();
    await flushWorkspacePersistence();

    expect(persist).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    unregister();
  });

  it("serializes a newer revision behind an in-flight atomic write", async () => {
    vi.useFakeTimers();
    let releaseFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const persist = vi.fn()
      .mockImplementationOnce(() => firstWrite)
      .mockResolvedValueOnce(undefined);
    const persister = createWorkspacePersister(createWorkspace, 10, persist);

    persister.schedule();
    await vi.advanceTimersByTimeAsync(10);
    persister.schedule();
    await vi.advanceTimersByTimeAsync(10);
    expect(persist).toHaveBeenCalledTimes(1);

    releaseFirst();
    await persister.flush();
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("drops stale scheduled work after another vault becomes current", async () => {
    vi.useFakeTimers();
    let currentRoot = "/vault-a";
    const persist = vi.fn(async () => undefined);
    const persister = createWorkspacePersister(
      createWorkspace,
      350,
      persist,
      () => currentRoot === "/vault-a",
    );

    persister.schedule();
    currentRoot = "/vault-b";
    await vi.advanceTimersByTimeAsync(350);
    await persister.flush();

    expect(persist).not.toHaveBeenCalled();
  });

  it("does not let an old registration clear a replacement vault", () => {
    const first = createWorkspacePersister(createWorkspace);
    const second = createWorkspacePersister(createWorkspace);
    const unregisterFirst = registerWorkspacePersister("/vault-a", first);
    const unregisterSecond = registerWorkspacePersister("/vault-b", second);

    unregisterFirst();
    expect(activeWorkspaceVaultRoot()).toBe("/vault-b");
    unregisterSecond();
    expect(activeWorkspaceVaultRoot()).toBeNull();
  });
});
