// Typed wrappers around the Tauri command surface (spec §6).
import { invoke } from "@tauri-apps/api/core";

export interface ApiError {
  code: string;
  message: string;
  path?: string;
}

export function isApiError(e: unknown): e is ApiError {
  return typeof e === "object" && e !== null && "code" in e && "message" in e;
}

export interface VaultInfo {
  root: string;
  name: string;
}

export type FileKind = "note" | "database" | "canvas" | "asset" | "other";

export interface FileNode {
  path: string;
  name: string;
  is_dir: boolean;
  kind?: FileKind;
  children?: FileNode[];
}

export interface FileTree {
  roots: FileNode[];
}

export interface LoadedFile {
  path: string;
  content: string;
  version: string;
}

export interface SaveOutcome {
  version: string;
}

export interface SearchHit {
  path: string;
  title: string;
  snippet: string;
  score: number;
}

export interface QuickSwitchHit {
  path: string;
  title: string;
  kind: FileKind;
}

export interface BacklinkHit {
  source: string;
  source_title: string;
  target: string;
}

export interface TagCount {
  tag: string;
  count: number;
}

export type VaultEvent =
  | { type: "created"; path: string }
  | { type: "modified"; path: string }
  | { type: "deleted"; path: string }
  | { type: "renamed"; from: string; to: string };

// ---- database types (mirror mica-db) ----

export type PropertyType =
  | "title"
  | "text"
  | "number"
  | "checkbox"
  | "select"
  | "multi_select"
  | "date"
  | "url"
  | "file"
  | "note_link";

export interface SelectOption {
  id: string;
  name: string;
  color?: string;
}

export interface Property {
  id: string;
  name: string;
  type: PropertyType;
  required?: boolean;
  options?: SelectOption[];
}

export interface DbView {
  id: string;
  name: string;
  type: "table" | "kanban";
  group_by?: string;
  sorts?: { property: string; descending?: boolean }[];
  filters?: { property: string; operator: string; value?: unknown }[];
  hidden_properties?: string[];
  column_order?: string[];
  column_widths?: Record<string, number>;
  group_order?: Record<string, string[]>;
}

export interface Cell {
  type: PropertyType;
  value: unknown;
}

export interface DbRow {
  id: string;
  created: string;
  updated: string;
  cells: Record<string, Cell>;
}

export interface Database {
  schema_version: number;
  id: string;
  title: string;
  created: string;
  updated: string;
  properties: Property[];
  views: DbView[];
  rows: DbRow[];
}

export type DbOp =
  | { op: "row_create"; cells?: Record<string, unknown> }
  | { op: "row_update"; row_id: string; cells: Record<string, unknown> }
  | { op: "row_delete"; row_id: string }
  | { op: "property_add"; name: string; prop_type: PropertyType }
  | { op: "property_rename"; property_id: string; name: string }
  | { op: "property_delete"; property_id: string }
  | { op: "select_option_add"; property_id: string; name: string; color?: string }
  | { op: "view_update"; view: DbView }
  | { op: "kanban_move"; view_id: string; row_id: string; to_group: string; index: number }
  | { op: "title_set"; title: string };

export interface QueryResult {
  total: number;
  rows: DbRow[];
  groups?: { group: string; row_ids: string[] }[];
}

// ---- canvas types (mirror mica-drawio) ----

export type CellKind =
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "text"
  | "sticky"
  | "connector"
  | "frame"
  | "note_link"
  | "database_link"
  | "unknown";

export interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SceneCell {
  id: string;
  kind: CellKind;
  label: string;
  geometry?: Geometry;
  parent?: string;
  source?: string;
  target?: string;
  style?: string;
  href?: string;
  view?: string;
}

export interface Scene {
  id: string;
  name: string;
  cells: SceneCell[];
}

export type CanvasOp =
  | { op: "add_cell"; cell: SceneCell }
  | { op: "update_cell"; cell: SceneCell }
  | { op: "remove_cell"; id: string }
  | { op: "rename_scene"; name: string };

// ---- commands ----

export const api = {
  ping: () => invoke<string>("ping"),

  vaultCreate: (path: string) => invoke<VaultInfo>("vault_create", { path }),
  vaultOpen: (path: string) => invoke<VaultInfo>("vault_open", { path }),
  vaultClose: () => invoke<void>("vault_close"),
  vaultTree: () => invoke<FileTree>("vault_tree"),
  vaultReveal: (path: string) => invoke<void>("vault_reveal", { path }),
  vaultOpenExternal: (path: string) => invoke<void>("vault_open_external", { path }),

  noteCreate: (title: string, dir?: string) =>
    invoke<LoadedFile>("note_create", { title, dir }),
  noteLoad: (path: string) => invoke<LoadedFile>("note_load", { path }),
  noteSave: (path: string, content: string, baseVersion?: string) =>
    invoke<SaveOutcome>("note_save", { path, content, baseVersion }),
  noteRename: (path: string, newPath: string) =>
    invoke<string>("note_rename", { path, newPath }),
  noteDelete: (path: string) => invoke<void>("note_delete", { path }),

  conflictResolve: (
    path: string,
    resolution: "keep_mine" | "take_theirs" | "keep_both",
    myContent: string,
  ) =>
    invoke<{ path: string; content: string; version: string }>("conflict_resolve", {
      path,
      resolution,
      myContent,
    }),

  dbCreate: (title: string, dir?: string) => invoke<LoadedFile>("db_create", { title, dir }),
  dbLoad: (path: string) => invoke<LoadedFile>("db_load", { path }),
  dbApply: (path: string, ops: DbOp[], baseVersion: string) =>
    invoke<{ content: string; version: string }>("db_apply", { path, ops, baseVersion }),
  dbQuery: (path: string, viewId: string, offset = 0, limit = 0) =>
    invoke<QueryResult>("db_query", { path, viewId, offset, limit }),

  canvasCreate: (title: string, dir?: string) =>
    invoke<LoadedFile>("canvas_create", { title, dir }),
  canvasLoad: (path: string) => invoke<LoadedFile>("canvas_load", { path }),
  canvasApply: (path: string, ops: CanvasOp[], baseVersion: string) =>
    invoke<{ content: string; version: string }>("canvas_apply", { path, ops, baseVersion }),

  searchQuery: (query: string, limit?: number) =>
    invoke<SearchHit[]>("search_query", { query, limit }),
  quickSwitch: (query: string, limit?: number) =>
    invoke<QuickSwitchHit[]>("quick_switch", { query, limit }),
  backlinks: (path: string) => invoke<BacklinkHit[]>("links_backlinks", { path }),
  tagsList: () => invoke<TagCount[]>("tags_list"),
  resolveWiki: (name: string) => invoke<string | null>("resolve_wiki", { name }),
  indexRebuild: () => invoke<number>("index_rebuild"),
};
