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

interface AppStore {
  vault: VaultInfo | null;
  tree: FileTree | null;
  docs: DocMeta[];
  tabs: OpenTab[];
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

export const useStore = create<AppStore>((set, get) => ({
  vault: null,
  tree: null,
  docs: [],
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
    set({ vault, tabs: [], activePath: null, tree: null, docs: [], docMode: {} }),

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

  openTab: (tab) => {
    const { tabs } = get();
    if (!tabs.find((t) => t.path === tab.path)) {
      set({ tabs: [...tabs, tab] });
    }
    set({ activePath: tab.path });
  },

  openPage: (page) => {
    const path = `mica://${page}`;
    get().openTab({ path, kind: "page", title: PAGE_TITLES[path] ?? page });
  },

  openDoc: (path) => {
    get().openTab({ path, kind: kindOfPath(path), title: titleOfPath(path) });
  },

  closeTab: (path) => {
    const { tabs, activePath } = get();
    const next = tabs.filter((t) => t.path !== path);
    let active = activePath;
    if (activePath === path) {
      const idx = tabs.findIndex((t) => t.path === path);
      active = next[Math.min(idx, next.length - 1)]?.path ?? null;
    }
    set({ tabs: next, activePath: active });
  },

  setActive: (activePath) => set({ activePath }),

  renameTab: (from, to) => {
    const { tabs, activePath } = get();
    set({
      tabs: tabs.map((t) =>
        t.path === from ? { ...t, path: to, title: titleOfPath(to) } : t,
      ),
      activePath: activePath === from ? to : activePath,
    });
  },

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
