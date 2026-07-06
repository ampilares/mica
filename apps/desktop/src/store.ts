import { create } from "zustand";
import { api, FileTree, VaultInfo, FileKind } from "./api";

export interface OpenTab {
  path: string;
  kind: FileKind;
  title: string;
}

export interface ConflictState {
  path: string;
  /** What the editor currently holds (unsaved). */
  myContent: string;
}

interface AppStore {
  vault: VaultInfo | null;
  tree: FileTree | null;
  tabs: OpenTab[];
  activePath: string | null;
  conflict: ConflictState | null;
  quickSwitcherOpen: boolean;
  searchOpen: boolean;
  commandPaletteOpen: boolean;
  rightPanelOpen: boolean;
  dataExplainerOpen: boolean;
  saveStatus: "idle" | "saving" | "saved" | "error";

  setVault: (v: VaultInfo | null) => void;
  refreshTree: () => Promise<void>;
  openTab: (tab: OpenTab) => void;
  closeTab: (path: string) => void;
  setActive: (path: string | null) => void;
  renameTab: (from: string, to: string) => void;
  setConflict: (c: ConflictState | null) => void;
  setQuickSwitcherOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setRightPanelOpen: (open: boolean) => void;
  setDataExplainerOpen: (open: boolean) => void;
  setSaveStatus: (s: AppStore["saveStatus"]) => void;
}

export const useStore = create<AppStore>((set, get) => ({
  vault: null,
  tree: null,
  tabs: [],
  activePath: null,
  conflict: null,
  quickSwitcherOpen: false,
  searchOpen: false,
  commandPaletteOpen: false,
  rightPanelOpen: true,
  dataExplainerOpen: false,
  saveStatus: "idle",

  setVault: (vault) => set({ vault, tabs: [], activePath: null, tree: null }),

  refreshTree: async () => {
    try {
      const tree = await api.vaultTree();
      set({ tree });
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
        t.path === from ? { ...t, path: to, title: to.split("/").pop() ?? to } : t,
      ),
      activePath: activePath === from ? to : activePath,
    });
  },

  setConflict: (conflict) => set({ conflict }),
  setQuickSwitcherOpen: (quickSwitcherOpen) => set({ quickSwitcherOpen }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setRightPanelOpen: (rightPanelOpen) => set({ rightPanelOpen }),
  setDataExplainerOpen: (dataExplainerOpen) => set({ dataExplainerOpen }),
  setSaveStatus: (saveStatus) => set({ saveStatus }),
}));

export function kindOfPath(path: string): FileKind {
  if (path.endsWith(".database.json")) return "database";
  if (path.endsWith(".drawio")) return "canvas";
  if (path.endsWith(".md")) return "note";
  return "other";
}

export function titleOfPath(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name
    .replace(/\.database\.json$/, "")
    .replace(/\.drawio$/, "")
    .replace(/\.md$/, "");
}
