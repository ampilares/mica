import { create } from "zustand";
import { api, DocMeta, FileTree, VaultInfo, FileKind } from "./api";

/**
 * Tabs hold either a real vault file (notes, databases, canvases) or a
 * virtual page from the AFFiNE-style shell. Virtual pages use `mica://`
 * pseudo-paths so the existing path-keyed tab plumbing works unchanged:
 *   mica://all-docs   mica://trash   mica://tags
 *   mica://tag/<tag>  mica://collection/<id>
 */
export type TabKind = FileKind | "page";

export interface OpenTab {
  path: string;
  kind: TabKind;
  title: string;
}

export type DocMode = "page" | "edgeless";
export type RightPanelTab = "outline" | "info" | "calendar" | "frames" | "history";

export interface ConflictState {
  path: string;
  /** What the editor currently holds (unsaved). */
  myContent: string;
}

/**
 * A split-view pane holds its own tab strip and active document (spec §3.2).
 * The store keeps `panes` (1 or 2) as the source of truth and mirrors the
 * ACTIVE pane's `tabs`/`activePath` onto the top-level fields below so the
 * long-standing public selectors (used across the app and by the e2e
 * `window.__mica` harness) keep working unchanged against the active pane.
 */
export interface Pane {
  tabs: OpenTab[];
  activePath: string | null;
}

interface AppStore {
  vault: VaultInfo | null;
  tree: FileTree | null;
  docs: DocMeta[];
  /** Panes: `[left]` or `[left, right]`. Additive; the fields below mirror. */
  panes: Pane[];
  activePane: 0 | 1;
  /** Left pane width fraction (0.25–0.75), persisted to localStorage. */
  splitRatio: number;
  /** Read-only peek preview target (spec §3.3); null = closed. */
  peekPath: string | null;
  /** Mirror of the active pane's tabs (kept in sync by every mutation). */
  tabs: OpenTab[];
  /** Mirror of the active pane's activePath. */
  activePath: string | null;
  conflict: ConflictState | null;
  quickSearchOpen: boolean;
  commandPaletteOpen: boolean;
  sidebarCollapsed: boolean;
  rightPanelTab: RightPanelTab | null;
  dataExplainerOpen: boolean;
  saveStatus: "idle" | "saving" | "saved" | "error";
  /** Per-note raw Markdown source mode (FR-NOTE-009). */
  sourceMode: Record<string, boolean>;
  /** Per-doc Page/Edgeless mode (FR2-DOC-001). */
  docMode: Record<string, DocMode>;
  settingsOpen: boolean;
  graphOpen: boolean;
  toast: { message: string; action?: { label: string; run: () => void } } | null;

  setVault: (v: VaultInfo | null) => void;
  refreshTree: () => Promise<void>;
  refreshDocs: () => Promise<void>;
  openTab: (tab: OpenTab) => void;
  openPage: (page: "all-docs" | "trash" | "tags") => void;
  openDoc: (path: string) => void;
  closeTab: (path: string) => void;
  setActive: (path: string | null) => void;
  renameTab: (from: string, to: string) => void;
  /** Open `path` in the right pane (creating the split if needed). */
  splitWith: (path: string) => void;
  /** Collapse to a single pane, keeping the active pane's contents. */
  unsplit: () => void;
  setActivePane: (i: 0 | 1) => void;
  setSplitRatio: (r: number) => void;
  /** Move an open tab from the other pane into `targetPane` (drag-to-move). */
  moveTabToPane: (path: string, targetPane: 0 | 1) => void;
  setPeek: (path: string | null) => void;
  setConflict: (c: ConflictState | null) => void;
  setQuickSearchOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setRightPanelTab: (tab: RightPanelTab | null) => void;
  setDataExplainerOpen: (open: boolean) => void;
  setSaveStatus: (s: AppStore["saveStatus"]) => void;
  toggleSourceMode: (path: string) => void;
  setDocMode: (path: string, mode: DocMode) => Promise<void>;
  setSettingsOpen: (open: boolean) => void;
  setGraphOpen: (open: boolean) => void;
  showToast: (toast: AppStore["toast"]) => void;
}

const PAGE_TITLES: Record<string, string> = {
  "mica://all-docs": "All docs",
  "mica://trash": "Trash",
  "mica://tags": "Tags",
};

const SPLIT_RATIO_KEY = "mica:splitRatio";

function loadSplitRatio(): number {
  try {
    const v = Number(localStorage.getItem(SPLIT_RATIO_KEY));
    if (Number.isFinite(v) && v >= 0.25 && v <= 0.75) return v;
  } catch {
    // localStorage unavailable
  }
  return 0.5;
}

/** Recompute the mirrored active-pane fields for a `set()` partial. */
function mirror(panes: Pane[], activePane: number) {
  const i = Math.min(Math.max(activePane, 0), panes.length - 1) as 0 | 1;
  const pane = panes[i];
  return { panes, activePane: i, tabs: pane.tabs, activePath: pane.activePath };
}

/** When split, drop a pane that has become empty and collapse to one pane. */
function collapseIfEmpty(
  panes: Pane[],
  activePane: number,
): { panes: Pane[]; activePane: 0 | 1 } {
  if (panes.length === 2) {
    if (panes[1].tabs.length === 0) return { panes: [panes[0]], activePane: 0 };
    if (panes[0].tabs.length === 0) return { panes: [panes[1]], activePane: 0 };
  }
  return {
    panes,
    activePane: Math.min(Math.max(activePane, 0), panes.length - 1) as 0 | 1,
  };
}

export const useStore = create<AppStore>((set, get) => ({
  vault: null,
  tree: null,
  docs: [],
  panes: [{ tabs: [], activePath: null }],
  activePane: 0,
  splitRatio: loadSplitRatio(),
  peekPath: null,
  tabs: [],
  activePath: null,
  conflict: null,
  quickSearchOpen: false,
  commandPaletteOpen: false,
  sidebarCollapsed: false,
  rightPanelTab: null,
  dataExplainerOpen: false,
  saveStatus: "idle",
  sourceMode: {},
  docMode: {},
  settingsOpen: false,
  graphOpen: false,
  toast: null,

  setVault: (vault) =>
    set({
      vault,
      panes: [{ tabs: [], activePath: null }],
      activePane: 0,
      peekPath: null,
      tabs: [],
      activePath: null,
      tree: null,
      docs: [],
      docMode: {},
    }),

  refreshTree: async () => {
    try {
      const tree = await api.vaultTree();
      set({ tree });
    } catch {
      // vault closed
    }
  },

  refreshDocs: async () => {
    try {
      const docs = await api.docsList();
      set({ docs });
    } catch {
      // vault closed
    }
  },

  openTab: (tab) =>
    set((s) => {
      const i = s.activePane;
      const pane = s.panes[i];
      const has = pane.tabs.some((t) => t.path === tab.path);
      const tabs = has ? pane.tabs : [...pane.tabs, tab];
      const panes = s.panes.map((p, idx) =>
        idx === i ? { tabs, activePath: tab.path } : p,
      );
      return mirror(panes, i);
    }),

  openPage: (page) => {
    const path = `mica://${page}`;
    get().openTab({ path, kind: "page", title: PAGE_TITLES[path] ?? page });
  },

  openDoc: (path) => {
    get().openTab({ path, kind: kindOfPath(path), title: titleOfPath(path) });
  },

  closeTab: (path) =>
    set((s) => {
      // Close from the pane that holds it — prefer the active pane so a
      // per-strip close button targets its own pane even when the same doc
      // is open in both. Closing the last tab of a pane collapses the split.
      const target = s.panes[s.activePane].tabs.some((t) => t.path === path)
        ? s.activePane
        : s.panes.findIndex((p) => p.tabs.some((t) => t.path === path));
      if (target < 0) return s;
      const pane = s.panes[target];
      const next = pane.tabs.filter((t) => t.path !== path);
      let activePath = pane.activePath;
      if (activePath === path) {
        const idx = pane.tabs.findIndex((t) => t.path === path);
        activePath = next[Math.min(idx, next.length - 1)]?.path ?? null;
      }
      const updated = s.panes.map((p, idx) =>
        idx === target ? { tabs: next, activePath } : p,
      );
      const { panes, activePane } = collapseIfEmpty(updated, s.activePane);
      return mirror(panes, activePane);
    }),

  setActive: (path) =>
    set((s) => {
      const i = s.activePane;
      const panes = s.panes.map((p, idx) =>
        idx === i ? { ...p, activePath: path } : p,
      );
      return mirror(panes, i);
    }),

  renameTab: (from, to) =>
    set((s) => {
      const panes = s.panes.map((p) => ({
        tabs: p.tabs.map((t) =>
          t.path === from ? { ...t, path: to, title: titleOfPath(to) } : t,
        ),
        activePath: p.activePath === from ? to : p.activePath,
      }));
      return mirror(panes, s.activePane);
    }),

  splitWith: (path) =>
    set((s) => {
      const tab: OpenTab = {
        path,
        kind: kindOfPath(path),
        title: titleOfPath(path),
      };
      if (s.panes.length === 1) {
        return mirror([s.panes[0], { tabs: [tab], activePath: path }], 1);
      }
      const right = s.panes[1];
      const has = right.tabs.some((t) => t.path === path);
      const tabs = has ? right.tabs : [...right.tabs, tab];
      return mirror([s.panes[0], { tabs, activePath: path }], 1);
    }),

  unsplit: () =>
    set((s) => {
      if (s.panes.length === 1) return s;
      return mirror([s.panes[s.activePane]], 0);
    }),

  setActivePane: (i) => set((s) => mirror(s.panes, i)),

  setSplitRatio: (r) => {
    const clamped = Math.max(0.25, Math.min(0.75, r));
    try {
      localStorage.setItem(SPLIT_RATIO_KEY, String(clamped));
    } catch {
      // localStorage unavailable
    }
    set({ splitRatio: clamped });
  },

  moveTabToPane: (path, targetPane) =>
    set((s) => {
      if (s.panes.length < 2) return s; // only meaningful when split
      const source = targetPane === 0 ? 1 : 0;
      const src = s.panes[source];
      const tab = src.tabs.find((t) => t.path === path);
      if (!tab) return s; // not in the source pane; ignore
      const srcTabs = src.tabs.filter((t) => t.path !== path);
      let srcActive = src.activePath;
      if (srcActive === path) {
        const idx = src.tabs.findIndex((t) => t.path === path);
        srcActive = srcTabs[Math.min(idx, srcTabs.length - 1)]?.path ?? null;
      }
      const tgt = s.panes[targetPane];
      const has = tgt.tabs.some((t) => t.path === path);
      const tgtTabs = has ? tgt.tabs : [...tgt.tabs, tab];
      const panes: Pane[] = [];
      panes[source] = { tabs: srcTabs, activePath: srcActive };
      panes[targetPane] = { tabs: tgtTabs, activePath: path };
      const collapsed = collapseIfEmpty(panes, targetPane);
      return mirror(collapsed.panes, collapsed.activePane);
    }),

  setPeek: (peekPath) => set({ peekPath }),

  setConflict: (conflict) => set({ conflict }),
  setQuickSearchOpen: (quickSearchOpen) => set({ quickSearchOpen }),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),
  setDataExplainerOpen: (dataExplainerOpen) => set({ dataExplainerOpen }),
  setSaveStatus: (saveStatus) => set({ saveStatus }),
  toggleSourceMode: (path) =>
    set((s) => ({ sourceMode: { ...s.sourceMode, [path]: !s.sourceMode[path] } })),

  setDocMode: async (path, mode) => {
    if (mode === "edgeless" && path.endsWith(".md")) {
      // Create the sidecar canvas on first switch (spec §4.1).
      await api.canvasSidecarEnsure(path);
    }
    set((s) => ({ docMode: { ...s.docMode, [path]: mode } }));
  },

  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setGraphOpen: (graphOpen) => set({ graphOpen }),
  showToast: (toast) => {
    set({ toast });
    if (toast) {
      window.setTimeout(() => {
        if (get().toast === toast) set({ toast: null });
      }, 6000);
    }
  },
}));

export function kindOfPath(path: string): TabKind {
  if (path.startsWith("mica://")) return "page";
  if (path.endsWith(".database.json")) return "database";
  if (path.endsWith(".drawio")) return "canvas";
  if (path.endsWith(".md")) return "note";
  return "other";
}

export function titleOfPath(path: string): string {
  if (path.startsWith("mica://")) return PAGE_TITLES[path] ?? path.slice(7);
  const name = path.split("/").pop() ?? path;
  return name
    .replace(/\.database\.json$/, "")
    .replace(/\.canvas\.drawio$/, "")
    .replace(/\.drawio$/, "")
    .replace(/\.md$/, "");
}

/** Sidecar canvas path for a `.md` doc (spec §1.2). */
export function sidecarOf(path: string): string | null {
  return path.endsWith(".md") ? path.slice(0, -3) + ".canvas.drawio" : null;
}

/** Today's journal doc path (spec §4.2). */
export function journalPath(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `journals/${y}-${m}-${d}.md`;
}

export function journalDateOf(path: string): string | null {
  const m = /^journals\/(\d{4}-\d{2}-\d{2})\.md$/.exec(path);
  return m ? m[1] : null;
}
