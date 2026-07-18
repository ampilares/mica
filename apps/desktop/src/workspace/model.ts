export type PaneId = string;
export type TabId = string;
export type SplitId = string;
export type LinkGroupId = string;

export const WORKSPACE_SCHEMA_VERSION = 2 as const;
export const MIN_SPLIT_RATIO = 0.15;
export const MAX_SPLIT_RATIO = 0.85;
export const DEFAULT_SPLIT_RATIO = 0.5;
export const MAX_HISTORY_ENTRIES = 100;

export type NoteMode = "rich" | "source";

export type ResourceView =
  | { type: "note"; path: string; mode: NoteMode }
  | { type: "database"; path: string }
  | { type: "canvas"; path: string };

export type WorkspaceView =
  | { type: "empty" }
  | ResourceView
  | { type: "graph"; centerPath?: string }
  | { type: "missing"; original: ResourceView; reason: string };

/** JSON-safe view-specific state. Document content must never be stored here. */
export type ViewLocation = Record<string, unknown>;

export interface NavigationEntry {
  view: WorkspaceView;
  location?: ViewLocation;
}

export interface WorkspaceTab {
  id: TabId;
  view: WorkspaceView;
  title: string;
  pinned: boolean;
  history: NavigationEntry[];
  /** -1 is valid only for an empty tab with no history. */
  historyIndex: number;
  /** Tabs in the same group mirror resource navigation, but retain locations. */
  linkGroupId?: LinkGroupId;
}

export interface WorkspacePane {
  id: PaneId;
  tabIds: TabId[];
  activeTabId: TabId;
  /** Most recently active first. Always contains the same IDs as tabIds. */
  recentTabIds: TabId[];
  /** Compress this pane's tab headers into an equal-width stacked layout. */
  stackedTabs: boolean;
}

export type WorkspaceNode =
  | { type: "pane"; paneId: PaneId }
  | {
      type: "split";
      id: SplitId;
      direction: "row" | "column";
      ratio: number;
      first: WorkspaceNode;
      second: WorkspaceNode;
    };

export interface SidebarSnapshot {
  open: boolean;
  width: number;
  panel: string;
}

export interface WorkspaceSidebars {
  left: SidebarSnapshot;
  right: SidebarSnapshot;
}

export interface ClosedTabRecord {
  tab: WorkspaceTab;
  paneId: PaneId;
  index: number;
}

export interface WorkspaceState {
  root: WorkspaceNode;
  focusedPaneId: PaneId;
  panes: Record<PaneId, WorkspacePane>;
  tabs: Record<TabId, WorkspaceTab>;
  sidebars: WorkspaceSidebars;
  closedTabs: ClosedTabRecord[];
  /** Persisted monotonic counter used by deterministic ID allocation. */
  nextId: number;
}

export interface WorkspaceSnapshot {
  schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  savedAt?: string;
  window: {
    root: WorkspaceNode;
    focusedPaneId: PaneId;
  };
  panes: Record<PaneId, WorkspacePane>;
  tabs: Record<TabId, WorkspaceTab>;
  sidebars: WorkspaceSidebars;
  closedTabs?: ClosedTabRecord[];
  nextId: number;
}

export interface CreateWorkspaceOptions {
  view?: WorkspaceView;
  title?: string;
  sidebars?: Partial<{
    left: Partial<SidebarSnapshot>;
    right: Partial<SidebarSnapshot>;
  }>;
}

export function defaultSidebars(
  overrides: CreateWorkspaceOptions["sidebars"] = {},
): WorkspaceSidebars {
  return {
    left: { open: true, width: 260, panel: "files", ...overrides.left },
    right: { open: true, width: 262, panel: "outline", ...overrides.right },
  };
}

export function titleForView(view: WorkspaceView): string {
  if (view.type === "empty") return "New tab";
  if (view.type === "graph") return "Graph";
  const resource = view.type === "missing" ? view.original : view;
  return titleForPath(resource.path);
}

export function titleForPath(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name
    .replace(/\.database\.json$/, "")
    .replace(/\.drawio$/, "")
    .replace(/\.md$/, "");
}

/** Canonical path-to-view mapping shared by all resource openers. */
export function resourceViewForPath(path: string, noteMode: NoteMode = "rich"): ResourceView {
  if (path.endsWith(".database.json")) return { type: "database", path };
  if (path.endsWith(".drawio")) return { type: "canvas", path };
  return { type: "note", path, mode: noteMode };
}

export function resourcePath(view: WorkspaceView): string | undefined {
  if (view.type === "note" || view.type === "database" || view.type === "canvas") {
    return view.path;
  }
  if (view.type === "missing") return view.original.path;
  return undefined;
}

export function isResourceView(view: WorkspaceView): view is ResourceView {
  return view.type === "note" || view.type === "database" || view.type === "canvas";
}
