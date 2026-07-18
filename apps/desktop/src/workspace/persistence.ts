import { api, isApiError } from "../api";
import { createWorkspace, restoreWorkspace, serializeWorkspace } from "./operations";
import type { WorkspaceState } from "./model";
import { DEFAULT_WORKSPACE_WINDOW_ID } from "./nativeWindows";

/**
 * Restore the open vault's last workspace. Missing, corrupt, and unsupported
 * snapshots intentionally fall back to a valid one-pane workspace so UI state
 * can never prevent access to canonical vault content.
 */
export async function loadWorkspace(
  windowId = DEFAULT_WORKSPACE_WINDOW_ID,
): Promise<WorkspaceState> {
  try {
    const snapshot = await api.workspaceSnapshotRead(windowId);
    return snapshot ? restoreWorkspace(snapshot) : createWorkspace();
  } catch (error) {
    if (isApiError(error)) {
      console.warn(`Workspace restore skipped (${error.code}): ${error.message}`);
    } else {
      console.warn("Workspace restore skipped", error);
    }
    return createWorkspace();
  }
}

export async function saveWorkspace(
  state: WorkspaceState,
  windowId = DEFAULT_WORKSPACE_WINDOW_ID,
): Promise<void> {
  await api.workspaceSnapshotWrite(
    serializeWorkspace(state, new Date().toISOString()),
    windowId,
  );
}

export interface WorkspacePersister {
  schedule(): void;
  flush(): Promise<void>;
  cancel(): void;
}

/** A small debouncer that can also be flushed during vault/window transitions. */
export function createWorkspacePersister(
  getState: () => WorkspaceState,
  delay = 350,
  persist: (state: WorkspaceState) => Promise<void> = saveWorkspace,
  isCurrent: () => boolean = () => true,
): WorkspacePersister {
  let timer: number | undefined;
  let saving: Promise<void> | null = null;
  let requested = 0;
  let persisted = 0;
  let cancelled = false;

  const drain = () => {
    timer = undefined;
    if (saving) return saving;

    const request = (async () => {
      while (!cancelled && isCurrent() && persisted < requested) {
        const revision = requested;
        await persist(getState());
        persisted = revision;
      }
    })()
      .finally(() => {
        if (saving === request) saving = null;
      });
    saving = request;
    return request;
  };

  return {
    schedule() {
      if (cancelled || !isCurrent()) return;
      requested += 1;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void drain().catch((error) => console.warn("Workspace snapshot save failed", error));
      }, delay);
    },
    async flush() {
      if (cancelled || !isCurrent()) return;
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
      await drain();
    },
    cancel() {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    },
  };
}

interface ActiveWorkspacePersistence {
  vaultRoot: string;
  persister: WorkspacePersister;
}

let activePersistence: ActiveWorkspacePersistence | null = null;

/** Register the persister whose vault is currently attached to the backend. */
export function registerWorkspacePersister(
  vaultRoot: string,
  persister: WorkspacePersister,
): () => void {
  const registration = { vaultRoot, persister };
  activePersistence = registration;
  return () => {
    if (activePersistence === registration) activePersistence = null;
  };
}

/**
 * Save all pending workspace changes before an operation changes which vault
 * the backend API addresses. Callers must await this before close/open/create.
 */
export async function flushWorkspacePersistence(): Promise<void> {
  await activePersistence?.persister.flush();
}

export function activeWorkspaceVaultRoot(): string | null {
  return activePersistence?.vaultRoot ?? null;
}
