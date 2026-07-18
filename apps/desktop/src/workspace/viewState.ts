import type { ViewLocation } from "./model";

export type ScrollLocationTarget =
  | "host"
  | "note"
  | "source"
  | "database-table"
  | "database-kanban";

export interface ScrollPosition {
  top: number;
  left: number;
}

export type TextSelectionTarget = "rich" | "source";

export interface TextSelectionPosition {
  anchor: number;
  head: number;
}

export type TextSelectionViewLocation = ViewLocation & {
  selection?: Partial<Record<TextSelectionTarget, TextSelectionPosition>>;
};

export type ScrollViewLocation = ViewLocation & {
  scroll?: Partial<Record<ScrollLocationTarget, ScrollPosition>>;
};

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export type CanvasViewLocation = ViewLocation & {
  canvas: {
    viewport: CanvasViewport;
    selectedIds: string[];
  };
};

export interface GraphViewState {
  centerPath: string | null;
  wholeVault: boolean;
}

export type GraphViewLocation = ViewLocation & { graph: GraphViewState };

export interface DatabaseViewState { viewId: string }
export type DatabaseViewLocation = ViewLocation & { database: DatabaseViewState };

const DEFAULT_CANVAS_VIEWPORT: CanvasViewport = { x: -100, y: -100, zoom: 1 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function scrollPosition(
  location: ViewLocation | undefined,
  target: ScrollLocationTarget,
): ScrollPosition | undefined {
  if (!isRecord(location?.scroll)) return undefined;
  const candidate = location.scroll[target];
  if (!isRecord(candidate)) return undefined;
  return {
    top: Math.max(0, finite(candidate.top, 0)),
    left: Math.max(0, finite(candidate.left, 0)),
  };
}

export function withScrollPosition(
  location: ViewLocation | undefined,
  target: ScrollLocationTarget,
  position: ScrollPosition,
): ScrollViewLocation {
  const priorScroll = isRecord(location?.scroll) ? location.scroll : {};
  return {
    ...(location ?? {}),
    scroll: {
      ...priorScroll,
      [target]: {
        top: Math.max(0, finite(position.top, 0)),
        left: Math.max(0, finite(position.left, 0)),
      },
    },
  };
}

export function textSelection(
  location: ViewLocation | undefined,
  target: TextSelectionTarget,
): TextSelectionPosition | undefined {
  if (!isRecord(location?.selection)) return undefined;
  const candidate = location.selection[target];
  if (!isRecord(candidate)) return undefined;
  return {
    anchor: Math.max(0, Math.trunc(finite(candidate.anchor, 0))),
    head: Math.max(0, Math.trunc(finite(candidate.head, 0))),
  };
}

export function withTextSelection(
  location: ViewLocation | undefined,
  target: TextSelectionTarget,
  selection: TextSelectionPosition,
): TextSelectionViewLocation {
  const prior = isRecord(location?.selection) ? location.selection : {};
  return {
    ...(location ?? {}),
    selection: {
      ...prior,
      [target]: {
        anchor: Math.max(0, Math.trunc(finite(selection.anchor, 0))),
        head: Math.max(0, Math.trunc(finite(selection.head, 0))),
      },
    },
  };
}

export function canvasLocation(
  location: ViewLocation | undefined,
): CanvasViewLocation["canvas"] | undefined {
  if (!isRecord(location?.canvas) || !isRecord(location.canvas.viewport)) return undefined;
  const viewport = location.canvas.viewport;
  const selectedIds = Array.isArray(location.canvas.selectedIds)
    ? location.canvas.selectedIds.filter((id): id is string => typeof id === "string")
    : [];
  return {
    viewport: {
      x: finite(viewport.x, DEFAULT_CANVAS_VIEWPORT.x),
      y: finite(viewport.y, DEFAULT_CANVAS_VIEWPORT.y),
      zoom: Math.min(4, Math.max(0.1, finite(viewport.zoom, DEFAULT_CANVAS_VIEWPORT.zoom))),
    },
    selectedIds: [...new Set(selectedIds)],
  };
}

export function withCanvasLocation(
  location: ViewLocation | undefined,
  viewport: CanvasViewport,
  selectedIds: Iterable<string>,
): CanvasViewLocation {
  return {
    ...(location ?? {}),
    canvas: {
      viewport: {
        x: finite(viewport.x, DEFAULT_CANVAS_VIEWPORT.x),
        y: finite(viewport.y, DEFAULT_CANVAS_VIEWPORT.y),
        zoom: Math.min(4, Math.max(0.1, finite(viewport.zoom, DEFAULT_CANVAS_VIEWPORT.zoom))),
      },
      selectedIds: [...new Set(selectedIds)].sort(),
    },
  };
}

export function graphLocation(location: ViewLocation | undefined): GraphViewState | undefined {
  if (!isRecord(location?.graph)) return undefined;
  const center = location.graph.centerPath;
  return {
    centerPath: typeof center === "string" ? center : null,
    wholeVault: location.graph.wholeVault === true,
  };
}

export function withGraphLocation(
  location: ViewLocation | undefined,
  graph: GraphViewState,
): GraphViewLocation {
  return {
    ...(location ?? {}),
    graph: {
      centerPath: graph.centerPath,
      wholeVault: graph.wholeVault,
    },
  };
}

export function databaseLocation(location: ViewLocation | undefined): DatabaseViewState | undefined {
  if (!isRecord(location?.database) || typeof location.database.viewId !== "string") return undefined;
  return { viewId: location.database.viewId };
}

export function withDatabaseLocation(
  location: ViewLocation | undefined,
  database: DatabaseViewState,
): DatabaseViewLocation {
  return { ...(location ?? {}), database: { viewId: database.viewId } };
}
