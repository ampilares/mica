import {
  MAX_HISTORY_ENTRIES,
  type NavigationEntry,
  type ResourceView,
  type WorkspaceState,
  type WorkspaceTab,
  type WorkspaceView,
} from "./model";
import { assertWorkspaceInvariants } from "./operations";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";

export const WORKSPACE_WINDOW_ID_QUERY_KEY = "micaWindowId";
export const WORKSPACE_TAB_TRANSFER_QUERY_KEY = "micaTabTransfer";
export const MAX_WORKSPACE_WINDOW_ID_LENGTH = 64;
export const MAX_WORKSPACE_STARTUP_QUERY_BYTES = 4 * 1024;
export const MAX_WORKSPACE_BOOTSTRAP_SEARCH_BYTES =
  MAX_WORKSPACE_STARTUP_QUERY_BYTES +
  WORKSPACE_WINDOW_ID_QUERY_KEY.length +
  MAX_WORKSPACE_WINDOW_ID_LENGTH +
  2; // `micaWindowId=<id>&`
export const WORKSPACE_TAB_TRANSFER_SCHEMA_VERSION = 1 as const;
export const WORKSPACE_TAB_TRANSFER_ACK_EVENT = "mica:workspace-tab-transfer-ack";
export const DEFAULT_WORKSPACE_WINDOW_ID = "main";
export const WORKSPACE_WINDOW_LABEL_PREFIX = "mica-workspace-";

const MAX_TRANSFER_ID_LENGTH = 128;
const MAX_PANE_ID_LENGTH = 128;
const MAX_TAB_ID_LENGTH = 128;
const MAX_TITLE_LENGTH = 512;
const MAX_RESOURCE_PATH_LENGTH = 4 * 1024;
const MAX_JSON_DEPTH = 16;
const MAX_JSON_NODES = 2_000;
const FORBIDDEN_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export interface WorkspaceWindowCreateRequest {
  windowId?: string;
  startupQuery?: string;
}

export interface WorkspaceWindowCreateResponse {
  windowId: string;
  label: string;
  created: boolean;
}

export type TransferableWorkspaceTab = WorkspaceTab & { view: ResourceView };

export interface WorkspaceTabTransferPayload {
  schemaVersion: typeof WORKSPACE_TAB_TRANSFER_SCHEMA_VERSION;
  transferId: string;
  sourceWindowId: string;
  sourcePaneId: string;
  tab: TransferableWorkspaceTab;
}

export interface WorkspaceTabTransferAck {
  schemaVersion: typeof WORKSPACE_TAB_TRANSFER_SCHEMA_VERSION;
  transferId: string;
  accepted: boolean;
  targetWindowId: string;
}

export interface WorkspaceWindowStartup {
  windowId?: string;
  tabTransfer?: WorkspaceTabTransferPayload;
  issues: Array<"invalid_window_id" | "invalid_tab_transfer" | "startup_query_too_large">;
}

export function isWorkspaceWindowId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_WORKSPACE_WINDOW_ID_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

export function currentWorkspaceWindowId(search = window.location.search): string {
  return parseWorkspaceWindowStartup(search).windowId ?? DEFAULT_WORKSPACE_WINDOW_ID;
}

export function workspaceWindowLabel(windowId: string): string {
  if (!isWorkspaceWindowId(windowId)) throw new TypeError("Invalid workspace window ID");
  return windowId === DEFAULT_WORKSPACE_WINDOW_ID
    ? DEFAULT_WORKSPACE_WINDOW_ID
    : `${WORKSPACE_WINDOW_LABEL_PREFIX}${windowId}`;
}

export function normalizeWorkspaceWindowCreateRequest(
  request: WorkspaceWindowCreateRequest,
): WorkspaceWindowCreateRequest {
  if (request.windowId !== undefined && !isWorkspaceWindowId(request.windowId)) {
    throw new TypeError(
      `windowId must be 1-${MAX_WORKSPACE_WINDOW_ID_LENGTH} ASCII letters, digits, '-' or '_'`,
    );
  }

  let startupQuery = request.startupQuery?.replace(/^\?/, "");
  if (startupQuery === "") startupQuery = undefined;
  if (startupQuery !== undefined) {
    if (utf8Length(startupQuery) > MAX_WORKSPACE_STARTUP_QUERY_BYTES) {
      throw new TypeError(
        `startupQuery must not exceed ${MAX_WORKSPACE_STARTUP_QUERY_BYTES} UTF-8 bytes`,
      );
    }
    if (/\p{Cc}/u.test(startupQuery) || startupQuery.includes("#")) {
      throw new TypeError("startupQuery must not contain control characters or a fragment");
    }
    if (new URLSearchParams(startupQuery).has(WORKSPACE_WINDOW_ID_QUERY_KEY)) {
      throw new TypeError(
        `startupQuery must not override the reserved ${WORKSPACE_WINDOW_ID_QUERY_KEY} parameter`,
      );
    }
  }

  return { windowId: request.windowId, startupQuery };
}

export function isResourceViewShape(value: unknown): value is ResourceView {
  if (!isRecord(value) || !isResourcePath(value.path)) return false;
  if (value.type === "note") return value.mode === "rich" || value.mode === "source";
  return value.type === "database" || value.type === "canvas";
}

export function isWorkspaceTabShape(value: unknown): value is WorkspaceTab {
  if (!isRecord(value)) return false;
  if (!isBoundedId(value.id, MAX_TAB_ID_LENGTH)) return false;
  if (typeof value.title !== "string" || value.title.length > MAX_TITLE_LENGTH) return false;
  if (typeof value.pinned !== "boolean" || !isWorkspaceViewShape(value.view)) return false;
  if (!Array.isArray(value.history) || value.history.length > MAX_HISTORY_ENTRIES) return false;
  if (!value.history.every(isNavigationEntryShape)) return false;
  if (typeof value.historyIndex !== "number" || !Number.isInteger(value.historyIndex)) {
    return false;
  }
  if (value.history.length === 0) {
    return value.historyIndex === -1 && value.view.type === "empty";
  }
  return value.historyIndex >= 0 && value.historyIndex < value.history.length;
}

export function isWorkspaceTabTransferPayload(
  value: unknown,
): value is WorkspaceTabTransferPayload {
  return (
    isRecord(value) &&
    isJsonSafe(value) &&
    value.schemaVersion === WORKSPACE_TAB_TRANSFER_SCHEMA_VERSION &&
    isBoundedId(value.transferId, MAX_TRANSFER_ID_LENGTH) &&
    isWorkspaceWindowId(value.sourceWindowId) &&
    isBoundedId(value.sourcePaneId, MAX_PANE_ID_LENGTH) &&
    isWorkspaceTabShape(value.tab) &&
    isResourceViewShape(value.tab.view)
  );
}

export function createWorkspaceTabTransferPayload(
  tab: WorkspaceTab,
  sourcePaneId: string,
  sourceWindowId = currentWorkspaceWindowId(),
  transferId = createTransferId(),
): WorkspaceTabTransferPayload {
  if (!isResourceViewShape(tab.view)) {
    throw new TypeError("Only resource-backed tabs can move to a native window");
  }
  const transferable = structuredClone(tab) as TransferableWorkspaceTab;
  // Link groups are window-local invariants. A transferred singleton starts
  // unlinked and can be explicitly linked inside its destination window.
  delete transferable.linkGroupId;
  const payload: WorkspaceTabTransferPayload = {
    schemaVersion: WORKSPACE_TAB_TRANSFER_SCHEMA_VERSION,
    transferId,
    sourceWindowId,
    sourcePaneId,
    tab: transferable,
  };
  if (!isWorkspaceTabTransferPayload(payload)) {
    throw new TypeError("Invalid workspace tab transfer payload");
  }
  return payload;
}

/** Insert an acknowledged startup transfer into the focused destination pane. */
export function insertWorkspaceTabTransfer(
  state: WorkspaceState,
  payload: WorkspaceTabTransferPayload,
): WorkspaceState {
  if (!isWorkspaceTabTransferPayload(payload)) {
    throw new TypeError("Invalid workspace tab transfer payload");
  }
  const next = structuredClone(state);
  const pane = next.panes[next.focusedPaneId];
  if (!pane) throw new Error("Destination workspace has no focused pane");

  if (pane.tabIds.length === 1) {
    const placeholderId = pane.tabIds[0];
    const placeholder = next.tabs[placeholderId];
    if (placeholder?.view.type === "empty" && !placeholder.pinned) {
      delete next.tabs[placeholderId];
      pane.tabIds = [];
      pane.recentTabIds = [];
    }
  }

  const transferred = structuredClone(payload.tab);
  delete transferred.linkGroupId;
  const splitIds = collectSplitIds(next.root);
  let tabId = transferred.id;
  let suffix = 1;
  while (next.tabs[tabId] || next.panes[tabId] || splitIds.has(tabId)) {
    tabId = `transfer_${payload.transferId}_${suffix}`;
    suffix += 1;
  }
  transferred.id = tabId;
  next.tabs[tabId] = transferred;
  const pinnedCount = pane.tabIds.filter((id) => next.tabs[id]?.pinned).length;
  pane.tabIds.splice(transferred.pinned ? pinnedCount : pane.tabIds.length, 0, tabId);
  pane.activeTabId = tabId;
  pane.recentTabIds = [tabId, ...pane.recentTabIds.filter((id) => id !== tabId)];
  assertWorkspaceInvariants(next);
  return next;
}

export interface WorkspaceTabTransferRuntime {
  subscribe(listener: (ack: WorkspaceTabTransferAck) => void): Promise<UnlistenFn>;
  createWindow(request: WorkspaceWindowCreateRequest): Promise<WorkspaceWindowCreateResponse>;
  timeoutMs?: number;
}

const defaultAckSubscription: WorkspaceTabTransferRuntime["subscribe"] = async (listener) =>
  listen<WorkspaceTabTransferAck>(WORKSPACE_TAB_TRANSFER_ACK_EVENT, (event) => {
    listener(event.payload);
  });

/**
 * Register acknowledgement before creating the target window. A timeout,
 * rejected acknowledgement, or create failure returns false and never asks
 * the caller to remove its source tab.
 */
export async function requestWorkspaceTabTransfer(
  payload: WorkspaceTabTransferPayload,
  runtime: Omit<WorkspaceTabTransferRuntime, "subscribe"> & {
    subscribe?: WorkspaceTabTransferRuntime["subscribe"];
  },
): Promise<boolean> {
  const query = encodeWorkspaceTabTransferQuery(payload);
  let resolveAck!: (accepted: boolean) => void;
  const acknowledgement = new Promise<boolean>((resolve) => {
    resolveAck = resolve;
  });
  const unsubscribe = await (runtime.subscribe ?? defaultAckSubscription)((ack) => {
    if (
      isWorkspaceTabTransferAck(ack) &&
      ack.transferId === payload.transferId &&
      isWorkspaceWindowId(ack.targetWindowId)
    ) {
      resolveAck(ack.accepted);
    }
  });
  let timeout: number | undefined;
  try {
    try {
      await runtime.createWindow({ startupQuery: query });
    } catch {
      return false;
    }
    const expired = new Promise<false>((resolve) => {
      timeout = window.setTimeout(() => resolve(false), runtime.timeoutMs ?? 5_000);
    });
    return await Promise.race([acknowledgement, expired]);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
    unsubscribe();
  }
}

export async function acknowledgeWorkspaceTabTransfer(
  payload: WorkspaceTabTransferPayload,
  accepted: boolean,
  targetWindowId = currentWorkspaceWindowId(),
  emit: typeof emitTo = emitTo,
): Promise<void> {
  await emit(
    workspaceWindowLabel(payload.sourceWindowId),
    WORKSPACE_TAB_TRANSFER_ACK_EVENT,
    {
      schemaVersion: WORKSPACE_TAB_TRANSFER_SCHEMA_VERSION,
      transferId: payload.transferId,
      accepted,
      targetWindowId,
    } satisfies WorkspaceTabTransferAck,
  );
}

/** Encode a validated transfer envelope as a backend-compatible startup query. */
export function encodeWorkspaceTabTransferQuery(payload: WorkspaceTabTransferPayload): string {
  if (!isWorkspaceTabTransferPayload(payload)) {
    throw new TypeError("Invalid workspace tab transfer payload");
  }
  const query = new URLSearchParams({
    [WORKSPACE_TAB_TRANSFER_QUERY_KEY]: JSON.stringify(payload),
  }).toString();
  if (utf8Length(query) > MAX_WORKSPACE_STARTUP_QUERY_BYTES) {
    throw new TypeError(
      `Encoded tab transfer query exceeds ${MAX_WORKSPACE_STARTUP_QUERY_BYTES} UTF-8 bytes`,
    );
  }
  return query;
}

/** Decode untrusted query content without throwing during application bootstrap. */
export function decodeWorkspaceTabTransferPayload(
  encodedPayload: string,
): WorkspaceTabTransferPayload | undefined {
  if (utf8Length(encodedPayload) > MAX_WORKSPACE_STARTUP_QUERY_BYTES) return undefined;
  try {
    const parsed: unknown = JSON.parse(encodedPayload);
    return isWorkspaceTabTransferPayload(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function parseWorkspaceWindowStartup(search: string): WorkspaceWindowStartup {
  const startup: WorkspaceWindowStartup = { issues: [] };
  const normalized = search.startsWith("?") ? search.slice(1) : search;
  if (utf8Length(normalized) > MAX_WORKSPACE_BOOTSTRAP_SEARCH_BYTES) {
    startup.issues.push("startup_query_too_large");
    return startup;
  }

  const query = new URLSearchParams(normalized);
  const windowIds = query.getAll(WORKSPACE_WINDOW_ID_QUERY_KEY);
  if (windowIds.length > 0) {
    if (windowIds.length === 1 && isWorkspaceWindowId(windowIds[0])) {
      startup.windowId = windowIds[0];
    } else {
      startup.issues.push("invalid_window_id");
    }
  }

  const encodedTransfers = query.getAll(WORKSPACE_TAB_TRANSFER_QUERY_KEY);
  if (encodedTransfers.length > 0) {
    const tabTransfer =
      encodedTransfers.length === 1
        ? decodeWorkspaceTabTransferPayload(encodedTransfers[0])
        : undefined;
    if (tabTransfer) startup.tabTransfer = tabTransfer;
    else startup.issues.push("invalid_tab_transfer");
  }

  return startup;
}

function isWorkspaceViewShape(value: unknown): value is WorkspaceView {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "empty") return true;
  if (isResourceViewShape(value)) return true;
  if (value.type === "graph") {
    return value.centerPath === undefined || isResourcePath(value.centerPath);
  }
  if (value.type === "missing") {
    return isResourceViewShape(value.original) && typeof value.reason === "string";
  }
  return false;
}

function isNavigationEntryShape(value: unknown): value is NavigationEntry {
  return (
    isRecord(value) &&
    isWorkspaceViewShape(value.view) &&
    (value.location === undefined || isJsonSafe(value.location))
  );
}

function isJsonSafe(value: unknown): boolean {
  let nodes = 0;
  const visit = (candidate: unknown, depth: number): boolean => {
    nodes += 1;
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) return false;
    if (
      candidate === null ||
      typeof candidate === "string" ||
      typeof candidate === "boolean"
    ) {
      return true;
    }
    if (typeof candidate === "number") return Number.isFinite(candidate);
    if (Array.isArray(candidate)) return candidate.every((item) => visit(item, depth + 1));
    if (!isRecord(candidate)) return false;
    return Object.entries(candidate).every(
      ([key, item]) => !FORBIDDEN_JSON_KEYS.has(key) && visit(item, depth + 1),
    );
  };
  return visit(value, 0);
}

function isResourcePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_RESOURCE_PATH_LENGTH &&
    !value.includes("\0")
  );
}

function isBoundedId(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function createTransferId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return `transfer-${random}`;
  return `transfer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isWorkspaceTabTransferAck(value: unknown): value is WorkspaceTabTransferAck {
  return (
    isRecord(value) &&
    value.schemaVersion === WORKSPACE_TAB_TRANSFER_SCHEMA_VERSION &&
    isBoundedId(value.transferId, MAX_TRANSFER_ID_LENGTH) &&
    typeof value.accepted === "boolean" &&
    isWorkspaceWindowId(value.targetWindowId)
  );
}

function collectSplitIds(node: WorkspaceState["root"], ids = new Set<string>()): Set<string> {
  if (node.type === "split") {
    ids.add(node.id);
    collectSplitIds(node.first, ids);
    collectSplitIds(node.second, ids);
  }
  return ids;
}
