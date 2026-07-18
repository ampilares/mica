import { beforeEach, describe, expect, it, vi } from "vitest";

const documentsMock = vi.hoisted(() => ({
  flushDocumentsForPaths: vi.fn(),
  getDocumentSnapshot: vi.fn(),
}));
const tauriMock = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(async () => () => undefined),
  emitTo: vi.fn(),
}));

vi.mock("../documents", () => documentsMock);
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriMock.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: tauriMock.listen,
  emitTo: tauriMock.emitTo,
}));

import { useStore } from "../store";
import { createWorkspace, selectActiveTab, splitPane } from "../workspace";

const success = (paths: string[]) => ({
  ok: true,
  results: paths.map((path) => ({ path, ok: true, dirty: false, error: null })),
  failures: [],
});

describe("workspace document durability guards", () => {
  beforeEach(() => {
    documentsMock.flushDocumentsForPaths.mockReset();
    documentsMock.getDocumentSnapshot.mockReset();
    tauriMock.invoke.mockReset();
    tauriMock.listen.mockClear();
    documentsMock.flushDocumentsForPaths.mockImplementation(async (paths: string[]) => success(paths));
    useStore.getState().replaceWorkspace(createWorkspace());
    useStore.getState().setConflict(null);
    useStore.getState().setSaveStatus("idle");
  });

  it("keeps the editor mounted until a close barrier succeeds", async () => {
    const workspace = createWorkspace({ view: { type: "note", path: "Draft.md", mode: "rich" } });
    const tabId = selectActiveTab(workspace)!.id;
    useStore.getState().replaceWorkspace(workspace);
    let release!: (value: ReturnType<typeof success>) => void;
    documentsMock.flushDocumentsForPaths.mockReturnValueOnce(
      new Promise((resolve) => { release = resolve; }),
    );

    const closing = useStore.getState().closeWorkspaceTab(tabId);
    expect(useStore.getState().workspace.tabs[tabId]).toBeDefined();
    expect(documentsMock.flushDocumentsForPaths).toHaveBeenCalledWith(["Draft.md"]);

    release(success(["Draft.md"]));
    await expect(closing).resolves.toBe(true);
    expect(useStore.getState().workspace.tabs[tabId]).toBeUndefined();
  });

  it("cancels navigation and surfaces a conflict when flushing fails", async () => {
    const workspace = createWorkspace({ view: { type: "note", path: "Draft.md", mode: "rich" } });
    const tabId = selectActiveTab(workspace)!.id;
    useStore.getState().replaceWorkspace(workspace);
    const error = { kind: "conflict" as const, message: "newer file" };
    documentsMock.flushDocumentsForPaths.mockResolvedValueOnce({
      ok: false,
      results: [{ path: "Draft.md", ok: false, dirty: true, error }],
      failures: [{ path: "Draft.md", ok: false, dirty: true, error }],
    });
    documentsMock.getDocumentSnapshot.mockReturnValue({
      path: "Draft.md", content: "unsaved", saveError: error,
    });

    await expect(useStore.getState().navigateWorkspaceTab(
      tabId,
      { type: "note", path: "Other.md", mode: "rich" },
    )).resolves.toBe(false);
    expect(useStore.getState().workspace.tabs[tabId].view).toEqual({
      type: "note", path: "Draft.md", mode: "rich",
    });
    expect(useStore.getState().saveStatus).toBe("error");
    expect(useStore.getState().conflict).toEqual({ path: "Draft.md", myContent: "unsaved" });
  });

  it("guards reparenting and source-mode editor replacement", async () => {
    const initial = createWorkspace({ view: { type: "note", path: "Draft.md", mode: "rich" } });
    const originalPaneId = initial.focusedPaneId;
    const tabId = selectActiveTab(initial)!.id;
    const workspace = splitPane(initial, originalPaneId, { direction: "row", duplicate: true });
    useStore.getState().replaceWorkspace(workspace);
    const targetPaneId = Object.keys(workspace.panes).find((id) => id !== originalPaneId)!;

    await useStore.getState().moveWorkspaceTab(tabId, targetPaneId);
    expect(documentsMock.flushDocumentsForPaths).toHaveBeenLastCalledWith(["Draft.md"]);

    await useStore.getState().toggleTabSourceMode(tabId);
    expect(documentsMock.flushDocumentsForPaths).toHaveBeenLastCalledWith(["Draft.md"]);
    expect(useStore.getState().workspace.tabs[tabId].view).toMatchObject({ mode: "source" });
  });

  it("flushes every affected note session before linking changes peer views", async () => {
    const workspace = createWorkspace({ view: { type: "note", path: "Draft.md", mode: "rich" } });
    useStore.getState().replaceWorkspace(workspace);
    const sourceId = selectActiveTab(workspace)!.id;
    useStore.getState().createWorkspaceTab(workspace.focusedPaneId, {
      type: "note", path: "Peer.md", mode: "rich",
    });
    const peerId = useStore.getState().workspace.panes[workspace.focusedPaneId].activeTabId;

    await expect(useStore.getState().linkWorkspaceTabs(sourceId, peerId)).resolves.toBe(true);
    expect(documentsMock.flushDocumentsForPaths).toHaveBeenLastCalledWith(["Peer.md"]);
    expect(useStore.getState().workspace.tabs[peerId].view).toEqual({
      type: "note", path: "Draft.md", mode: "rich",
    });

    await useStore.getState().navigateWorkspaceTab(sourceId, {
      type: "note", path: "Next.md", mode: "rich",
    });
    expect(documentsMock.flushDocumentsForPaths).toHaveBeenLastCalledWith(["Draft.md"]);
    expect(useStore.getState().workspace.tabs[peerId].view).toMatchObject({ path: "Next.md" });
  });

  it("commits non-note closes synchronously without invoking the registry", () => {
    const workspace = createWorkspace({ view: { type: "database", path: "Tasks.database.json" } });
    const tabId = selectActiveTab(workspace)!.id;
    useStore.getState().replaceWorkspace(workspace);

    const result = useStore.getState().closeWorkspaceTab(tabId);
    expect(useStore.getState().workspace.tabs[tabId]).toBeUndefined();
    expect(documentsMock.flushDocumentsForPaths).not.toHaveBeenCalled();
    return expect(result).resolves.toBe(true);
  });

  it("keeps the source tab when native window creation fails after the save barrier", async () => {
    const workspace = createWorkspace({
      view: { type: "note", path: "Draft.md", mode: "rich" },
    });
    const tabId = selectActiveTab(workspace)!.id;
    useStore.getState().replaceWorkspace(workspace);
    tauriMock.invoke.mockRejectedValueOnce(new Error("window unavailable"));

    await expect(useStore.getState().moveWorkspaceTabToNewWindow(tabId)).resolves.toBe(false);

    expect(documentsMock.flushDocumentsForPaths).toHaveBeenCalledWith(["Draft.md"]);
    expect(tauriMock.listen).toHaveBeenCalledTimes(1);
    expect(useStore.getState().workspace.tabs[tabId]).toBeDefined();
  });
});
