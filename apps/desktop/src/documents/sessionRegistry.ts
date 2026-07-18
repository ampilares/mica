import { api, isApiError, VaultEvent } from "../api";
import { docEvents } from "../docEvents";

export type DocumentSaveState = "idle" | "saving" | "saved" | "error";

export interface DocumentSaveError {
  kind: "conflict" | "io" | "load";
  message: string;
  cause?: unknown;
}

export interface DocumentSnapshot {
  path: string;
  content: string;
  version: string;
  revision: number;
  loaded: boolean;
  dirty: boolean;
  saveState: DocumentSaveState;
  saveError: DocumentSaveError | null;
  deleted: boolean;
}

export interface DocumentChange {
  snapshot: DocumentSnapshot;
  /** Identifies the view which originated a content change. */
  origin?: string;
}

export interface DocumentFlushResult {
  path: string;
  ok: boolean;
  dirty: boolean;
  error: DocumentSaveError | null;
}

export interface DocumentFlushBarrier {
  ok: boolean;
  results: DocumentFlushResult[];
  failures: DocumentFlushResult[];
}

type Listener = (change: DocumentChange) => void;
type RegistryListener = (change: DocumentChange) => void;

interface Session extends DocumentSnapshot {
  listeners: Set<Listener>;
  loadPromise: Promise<void> | null;
  savePromise: Promise<DocumentFlushResult> | null;
  autosaveTimer: ReturnType<typeof setTimeout> | null;
}

const sessions = new Map<string, Session>();
const registryListeners = new Set<RegistryListener>();

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unable to save document";
}

function snapshotOf(session: Session): DocumentSnapshot {
  return {
    path: session.path,
    content: session.content,
    version: session.version,
    revision: session.revision,
    loaded: session.loaded,
    dirty: session.dirty,
    saveState: session.saveState,
    saveError: session.saveError,
    deleted: session.deleted,
  };
}

function emit(session: Session, origin?: string): void {
  const change = { snapshot: snapshotOf(session), origin };
  for (const listener of session.listeners) listener(change);
  for (const listener of registryListeners) listener(change);
}

function sessionFor(path: string): Session {
  let session = sessions.get(path);
  if (!session) {
    session = {
      path,
      content: "",
      version: "",
      revision: 0,
      loaded: false,
      dirty: false,
      saveState: "idle",
      saveError: null,
      deleted: false,
      listeners: new Set(),
      loadPromise: null,
      savePromise: null,
      autosaveTimer: null,
    };
    sessions.set(path, session);
  }
  return session;
}

async function load(session: Session, force = false): Promise<void> {
  if (session.loaded && !force) return;
  if (session.loadPromise) return session.loadPromise;
  session.loadPromise = api.noteLoad(session.path)
    .then((file) => {
      // A late initial load must never replace content typed by another view.
      if (force && session.dirty) {
        session.saveState = "error";
        session.saveError = { kind: "conflict", message: "Document changed while reloading" };
        emit(session);
        return;
      }
      if (!session.dirty) session.content = file.content;
      session.version = file.version;
      session.revision += 1;
      session.loaded = true;
      session.deleted = false;
      session.saveError = null;
      session.saveState = "idle";
      emit(session);
    })
    .catch((error: unknown) => {
      session.saveError = { kind: "load", message: messageOf(error), cause: error };
      session.saveState = "error";
      emit(session);
      throw error;
    })
    .finally(() => {
      session.loadPromise = null;
    });
  return session.loadPromise;
}

/** Loads (once) and returns the canonical session snapshot for a path. */
export async function openDocument(path: string): Promise<DocumentSnapshot> {
  const session = sessionFor(path);
  await load(session);
  return snapshotOf(session);
}

/** Subscribe to canonical content and save-state changes for one path. */
export function subscribeDocument(path: string, listener: Listener): () => void {
  const session = sessionFor(path);
  session.listeners.add(listener);
  listener({ snapshot: snapshotOf(session) });
  return () => session.listeners.delete(listener);
}

/** Subscribe to dirty/save-error changes across all paths (for tabs and guards). */
export function subscribeDocuments(listener: RegistryListener): () => void {
  registryListeners.add(listener);
  return () => registryListeners.delete(listener);
}

export function getDocumentSnapshot(path: string): DocumentSnapshot | undefined {
  const session = sessions.get(path);
  return session ? snapshotOf(session) : undefined;
}

export function isDocumentDirty(path: string): boolean {
  return sessions.get(path)?.dirty ?? false;
}

export function getDocumentSaveError(path: string): DocumentSaveError | null {
  return sessions.get(path)?.saveError ?? null;
}

export function getDirtyDocumentPaths(): string[] {
  return [...sessions.values()].filter((session) => session.dirty).map((session) => session.path);
}

export function hasDirtyDocuments(): boolean {
  return [...sessions.values()].some((session) => session.dirty);
}

export function getDocumentSaveErrorPaths(): string[] {
  return [...sessions.values()]
    .filter((session) => session.saveError !== null)
    .map((session) => session.path);
}

/** Publish a complete Markdown document from a rich or source view. */
export function updateDocument(
  path: string,
  content: string,
  options: { origin?: string; autosaveDelay?: number } = {},
): void {
  const session = sessionFor(path);
  if (session.loaded && session.content === content) return;
  session.content = content;
  session.loaded = true;
  session.dirty = true;
  session.revision += 1;
  if (!session.savePromise) session.saveState = "idle";
  session.saveError = null;
  emit(session, options.origin);

  if (session.autosaveTimer) clearTimeout(session.autosaveTimer);
  if (options.autosaveDelay !== undefined) {
    session.autosaveTimer = setTimeout(() => {
      session.autosaveTimer = null;
      void flushDocument(session.path);
    }, Math.max(0, options.autosaveDelay));
  }
}

async function performFlush(session: Session): Promise<DocumentFlushResult> {
  if (session.autosaveTimer) {
    clearTimeout(session.autosaveTimer);
    session.autosaveTimer = null;
  }
  // Merely observing a tab creates an unloaded session; there is no content
  // to persist until a view has loaded or published an edit.
  if (!session.dirty) {
    return { path: session.path, ok: true, dirty: false, error: null };
  }
  if (!session.loaded) {
    try {
      await load(session);
    } catch {
      return { path: session.path, ok: false, dirty: session.dirty, error: session.saveError };
    }
  }
  const revision = session.revision;
  const content = session.content;
  session.saveState = "saving";
  session.saveError = null;
  emit(session);
  try {
    const result = await api.noteSave(session.path, content, session.version || undefined);
    session.version = result.version;
    session.deleted = false;
    if (session.revision === revision) {
      session.dirty = false;
      session.saveState = "saved";
    } else {
      // Content changed while this write was in flight. The returned version is
      // the correct base for the next serialized write.
      session.saveState = "idle";
    }
    emit(session);
  } catch (error: unknown) {
    session.saveState = "error";
    session.saveError = {
      kind: isApiError(error) && error.code === "conflict" ? "conflict" : "io",
      message: messageOf(error),
      cause: error,
    };
    emit(session);
    return { path: session.path, ok: false, dirty: true, error: session.saveError };
  }

  // A flush is a durability barrier, so include edits made during the write.
  return session.dirty ? performFlush(session) : {
    path: session.path,
    ok: true,
    dirty: false,
    error: null,
  };
}

/** Flush the latest canonical revision. Concurrent callers share one barrier. */
export async function flushDocument(path: string): Promise<DocumentFlushResult> {
  const session = sessions.get(path);
  if (!session) return { path, ok: true, dirty: false, error: null };
  if (!session.savePromise) {
    session.savePromise = performFlush(session).finally(() => {
      session.savePromise = null;
    });
  }
  return session.savePromise;
}

export async function flushAllDocuments(): Promise<DocumentFlushResult[]> {
  return Promise.all([...sessions.keys()].map(flushDocument));
}

/** Durability barrier used by guarded workspace operations. */
export async function flushDocumentsForPaths(paths: Iterable<string>): Promise<DocumentFlushBarrier> {
  const results = await Promise.all([...new Set(paths)].map(flushDocument));
  const failures = results.filter((result) => !result.ok || result.dirty);
  return { ok: failures.length === 0, results, failures };
}

/** Apply the authoritative result returned by conflict resolution. */
export function replaceDocument(path: string, content: string, version: string): void {
  const session = sessionFor(path);
  if (
    session.loaded && session.content === content && session.version === version &&
    !session.dirty && !session.saveError
  ) return;
  if (session.autosaveTimer) clearTimeout(session.autosaveTimer);
  session.autosaveTimer = null;
  session.content = content;
  session.version = version;
  session.revision += 1;
  session.loaded = true;
  session.dirty = false;
  session.saveState = "saved";
  session.saveError = null;
  session.deleted = false;
  emit(session);
}

/** Recreate a deleted file from the session without losing canonical content. */
export async function restoreDocument(path: string): Promise<DocumentFlushResult> {
  const session = sessionFor(path);
  try {
    const result = await api.noteSave(path, session.content, undefined);
    replaceDocument(path, session.content, result.version);
    return { path, ok: true, dirty: false, error: null };
  } catch (error: unknown) {
    session.saveState = "error";
    session.saveError = { kind: "io", message: messageOf(error), cause: error };
    session.dirty = true;
    emit(session);
    return { path, ok: false, dirty: true, error: session.saveError };
  }
}

async function handleVaultEvent(event: VaultEvent): Promise<void> {
  if (event.type === "modified") {
    const session = sessions.get(event.path);
    if (!session) return;
    // The watcher also reports our own atomic write. The backend's versioned
    // save remains the authority for a real race while a save is in flight.
    if (session.savePromise) return;
    if (session.dirty) {
      session.saveState = "error";
      session.saveError = { kind: "conflict", message: "Document changed on disk" };
      emit(session);
    } else {
      try {
        await load(session, true);
      } catch {
        // The load error is already represented on the session.
      }
    }
  } else if (event.type === "deleted") {
    const session = sessions.get(event.path);
    if (!session) return;
    session.deleted = true;
    emit(session);
  } else if (event.type === "renamed") {
    const source = sessions.get(event.from);
    if (!source) return;
    const target = sessions.get(event.to);
    sessions.delete(event.from);
    if (target && target !== source) {
      // A dirty source is the only canonical value that must not be lost. In
      // the clean case, prefer an already-open target and merge subscribers.
      const keep = source.dirty ? source : target;
      const discard = keep === source ? target : source;
      for (const listener of discard.listeners) keep.listeners.add(listener);
      if (discard.autosaveTimer) clearTimeout(discard.autosaveTimer);
      keep.path = event.to;
      sessions.set(event.to, keep);
      emit(keep);
    } else {
      source.path = event.to;
      sessions.set(event.to, source);
      emit(source);
    }
  }
}

docEvents.on((event) => void handleVaultEvent(event));

/**
 * Flush and release sessions during a vault switch. Failed sessions are kept
 * unless the caller explicitly confirms a discard.
 */
export async function resetDocumentSessions(
  options: { discard?: boolean } = {},
): Promise<DocumentFlushResult[]> {
  const results = options.discard ? [] : await flushAllDocuments();
  const failed = new Set(results.filter((result) => !result.ok).map((result) => result.path));
  for (const [path, session] of sessions) {
    if (!options.discard && failed.has(path)) continue;
    if (session.autosaveTimer) clearTimeout(session.autosaveTimer);
    sessions.delete(path);
  }
  return results;
}
