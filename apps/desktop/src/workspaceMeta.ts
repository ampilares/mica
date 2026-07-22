import { create } from "zustand";
import { api, VaultConfig } from "./api";

/**
 * Workspace-level metadata (spec §1.4) stored in `.workspace/config.json`
 * through the VaultConfig `extra` keys: favorites, collections, tag_colors,
 * journal_template. Reads/writes go through config_get/config_set so the
 * deterministic serializer and unknown-key preservation apply.
 */

export interface CollectionRule {
  kind: "tag" | "title_contains";
  value: string;
}

export interface Collection {
  id: string;
  name: string;
  docs: string[];
  rules: CollectionRule[];
}

interface WorkspaceMeta {
  loaded: boolean;
  favorites: string[];
  collections: Collection[];
  tagColors: Record<string, string>;
  journalTemplate: string | null;

  load: () => Promise<void>;
  toggleFavorite: (path: string) => Promise<void>;
  isFavorite: (path: string) => boolean;
  addCollection: (name: string) => Promise<Collection>;
  updateCollection: (col: Collection) => Promise<void>;
  removeCollection: (id: string) => Promise<void>;
  setTagColor: (tag: string, color: string) => Promise<void>;
  /** Repair stored paths after a file rename. */
  repairPaths: (from: string, to: string) => Promise<void>;
  /** Drop stored references to a deleted/trashed path. */
  dropPath: (path: string) => Promise<void>;
}

function readMeta(config: VaultConfig): Pick<
  WorkspaceMeta,
  "favorites" | "collections" | "tagColors" | "journalTemplate"
> {
  const favorites = Array.isArray(config.favorites)
    ? (config.favorites as unknown[]).filter((f): f is string => typeof f === "string")
    : [];
  const collections = Array.isArray(config.collections)
    ? (config.collections as unknown[]).filter(
        (c): c is Collection =>
          typeof c === "object" && c !== null && "id" in c && "name" in c,
      ).map((c) => ({
        ...c,
        docs: Array.isArray(c.docs) ? c.docs : [],
        rules: Array.isArray(c.rules) ? c.rules : [],
      }))
    : [];
  const tagColors =
    typeof config.tag_colors === "object" && config.tag_colors !== null
      ? (config.tag_colors as Record<string, string>)
      : {};
  const journalTemplate =
    typeof config.journal_template === "string" ? config.journal_template : null;
  return { favorites, collections, tagColors, journalTemplate };
}

async function persist(
  patch: Partial<{
    favorites: string[];
    collections: Collection[];
    tag_colors: Record<string, string>;
  }>,
) {
  // Read-modify-write on the live config so other keys are never clobbered.
  const config = await api.configGet();
  await api.configSet({ ...config, ...patch });
}

export const useWorkspaceMeta = create<WorkspaceMeta>((set, get) => ({
  loaded: false,
  favorites: [],
  collections: [],
  tagColors: {},
  journalTemplate: null,

  load: async () => {
    try {
      const config = await api.configGet();
      set({ ...readMeta(config), loaded: true });
    } catch {
      // vault closed
    }
  },

  isFavorite: (path) => get().favorites.includes(path),

  toggleFavorite: async (path) => {
    const current = get().favorites;
    const favorites = current.includes(path)
      ? current.filter((p) => p !== path)
      : [...current, path];
    set({ favorites });
    await persist({ favorites });
  },

  addCollection: async (name) => {
    const col: Collection = {
      id: `col_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      name,
      docs: [],
      rules: [],
    };
    const collections = [...get().collections, col];
    set({ collections });
    await persist({ collections });
    return col;
  },

  updateCollection: async (col) => {
    const collections = get().collections.map((c) => (c.id === col.id ? col : c));
    set({ collections });
    await persist({ collections });
  },

  removeCollection: async (id) => {
    const collections = get().collections.filter((c) => c.id !== id);
    set({ collections });
    await persist({ collections });
  },

  setTagColor: async (tag, color) => {
    const tagColors = { ...get().tagColors, [tag]: color };
    set({ tagColors });
    await persist({ tag_colors: tagColors });
  },

  repairPaths: async (from, to) => {
    const { favorites, collections } = get();
    if (
      !favorites.includes(from) &&
      !collections.some((c) => c.docs.includes(from))
    ) {
      return;
    }
    const nextFavorites = favorites.map((p) => (p === from ? to : p));
    const nextCollections = collections.map((c) => ({
      ...c,
      docs: c.docs.map((p) => (p === from ? to : p)),
    }));
    set({ favorites: nextFavorites, collections: nextCollections });
    await persist({ favorites: nextFavorites, collections: nextCollections });
  },

  dropPath: async (path) => {
    const { favorites, collections } = get();
    if (
      !favorites.includes(path) &&
      !collections.some((c) => c.docs.includes(path))
    ) {
      return;
    }
    const nextFavorites = favorites.filter((p) => p !== path);
    const nextCollections = collections.map((c) => ({
      ...c,
      docs: c.docs.filter((p) => p !== path),
    }));
    set({ favorites: nextFavorites, collections: nextCollections });
    await persist({ favorites: nextFavorites, collections: nextCollections });
  },
}));

/** Docs matched by a collection: manual list ∪ docs matching all rules. */
export function collectionMatches(
  col: Collection,
  docs: { path: string; title: string; tags: string[] }[],
): Set<string> {
  const out = new Set(col.docs);
  if (col.rules.length > 0) {
    for (const doc of docs) {
      const ok = col.rules.every((r) =>
        r.kind === "tag"
          ? doc.tags.includes(r.value)
          : doc.title.toLowerCase().includes(r.value.toLowerCase()),
      );
      if (ok) out.add(doc.path);
    }
  }
  return out;
}

export const TAG_COLORS = [
  "blue",
  "green",
  "orange",
  "red",
  "purple",
  "teal",
  "pink",
  "gray",
] as const;

export function tagColorValue(name: string | undefined): string {
  switch (name) {
    case "green":
      return "#3f9c60";
    case "orange":
      return "#e08c2c";
    case "red":
      return "#d4564e";
    case "purple":
      return "#8b5cf6";
    case "teal":
      return "#2aa1a8";
    case "pink":
      return "#d55f9c";
    case "gray":
      return "#8e8d91";
    case "blue":
    default:
      return "#1e96eb";
  }
}
