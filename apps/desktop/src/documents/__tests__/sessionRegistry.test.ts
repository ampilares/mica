import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";

import { docEvents } from "../../docEvents";
import {
  flushAllDocuments,
  flushDocument,
  flushDocumentsForPaths,
  getDocumentSaveError,
  getDocumentSnapshot,
  getDirtyDocumentPaths,
  isDocumentDirty,
  openDocument,
  resetDocumentSessions,
  subscribeDocument,
  updateDocument,
} from "../sessionRegistry";

describe("document session registry", () => {
  const apiMock = {
    noteLoad: vi.spyOn(api, "noteLoad"),
    noteSave: vi.spyOn(api, "noteSave"),
  };
  beforeEach(async () => {
    await resetDocumentSessions({ discard: true });
    apiMock.noteLoad.mockReset();
    apiMock.noteSave.mockReset();
  });

  afterEach(async () => {
    await resetDocumentSessions({ discard: true });
  });

  it("deduplicates loads and shares canonical updates with their origin", async () => {
    let resolveLoad!: (file: { path: string; content: string; version: string }) => void;
    apiMock.noteLoad.mockReturnValue(new Promise((resolve) => { resolveLoad = resolve; }));
    const changes: Array<{ content: string; origin?: string }> = [];
    subscribeDocument("note.md", ({ snapshot, origin }) => {
      if (snapshot.loaded) changes.push({ content: snapshot.content, origin });
    });

    const first = openDocument("note.md");
    const second = openDocument("note.md");
    expect(apiMock.noteLoad).toHaveBeenCalledTimes(1);
    resolveLoad({ path: "note.md", content: "original", version: "v1" });
    await Promise.all([first, second]);

    updateDocument("note.md", "edited", { origin: "source-view" });
    expect(changes).toEqual([
      { content: "original", origin: undefined },
      { content: "edited", origin: "source-view" },
    ]);
    expect(isDocumentDirty("note.md")).toBe(true);
  });

  it("serializes an edit made during save and flushes the latest revision", async () => {
    apiMock.noteLoad.mockResolvedValue({ path: "note.md", content: "one", version: "v1" });
    let resolveFirstSave!: (file: { version: string }) => void;
    apiMock.noteSave
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirstSave = resolve; }))
      .mockResolvedValueOnce({ version: "v3" });
    await openDocument("note.md");
    updateDocument("note.md", "two");

    const barrier = flushDocument("note.md");
    await vi.waitFor(() => expect(apiMock.noteSave).toHaveBeenCalledTimes(1));
    updateDocument("note.md", "three");
    resolveFirstSave({ version: "v2" });

    await expect(barrier).resolves.toMatchObject({ ok: true, dirty: false });
    expect(apiMock.noteSave.mock.calls).toEqual([
      ["note.md", "two", "v1"],
      ["note.md", "three", "v2"],
    ]);
    expect(getDocumentSnapshot("note.md")).toMatchObject({
      content: "three",
      version: "v3",
      dirty: false,
    });
  });

  it("retains dirty content and exposes errors when a flush conflicts", async () => {
    apiMock.noteLoad.mockResolvedValue({ path: "note.md", content: "one", version: "v1" });
    apiMock.noteSave.mockRejectedValue({ code: "conflict", message: "newer file" });
    await openDocument("note.md");
    updateDocument("note.md", "mine");

    await expect(flushDocument("note.md")).resolves.toMatchObject({ ok: false, dirty: true });
    expect(getDocumentSaveError("note.md")?.kind).toBe("conflict");
    expect(getDirtyDocumentPaths()).toEqual(["note.md"]);

    await resetDocumentSessions();
    expect(getDocumentSnapshot("note.md")?.content).toBe("mine");
  });

  it("flushes all paths and re-keys dirty sessions on rename", async () => {
    apiMock.noteLoad.mockImplementation((path: string) =>
      Promise.resolve({ path, content: path, version: `v-${path}` }));
    apiMock.noteSave.mockResolvedValue({ version: "saved" });
    await Promise.all([openDocument("a.md"), openDocument("b.md")]);
    updateDocument("a.md", "dirty-a");
    updateDocument("b.md", "dirty-b");
    docEvents.emit({ type: "renamed", from: "a.md", to: "renamed.md" });

    expect(getDocumentSnapshot("a.md")).toBeUndefined();
    expect(getDocumentSnapshot("renamed.md")?.content).toBe("dirty-a");
    const results = await flushAllDocuments();
    expect(results.every((result) => result.ok)).toBe(true);
    expect(apiMock.noteSave).toHaveBeenCalledWith("renamed.md", "dirty-a", "v-a.md");
    expect(apiMock.noteSave).toHaveBeenCalledWith("b.md", "dirty-b", "v-b.md");
  });

  it("reports path-scoped durability barrier failures for guarded operations", async () => {
    apiMock.noteLoad.mockImplementation((path: string) =>
      Promise.resolve({ path, content: path, version: "v1" }));
    apiMock.noteSave.mockImplementation((path: string) =>
      path === "bad.md"
        ? Promise.reject(new Error("disk full"))
        : Promise.resolve({ version: "v2" }));
    await Promise.all([openDocument("good.md"), openDocument("bad.md")]);
    updateDocument("good.md", "good edit");
    updateDocument("bad.md", "bad edit");

    const barrier = await flushDocumentsForPaths(["good.md", "bad.md", "good.md"]);
    expect(barrier.ok).toBe(false);
    expect(barrier.results).toHaveLength(2);
    expect(barrier.failures.map((failure) => failure.path)).toEqual(["bad.md"]);
    expect(isDocumentDirty("good.md")).toBe(false);
    expect(isDocumentDirty("bad.md")).toBe(true);
  });
});
