import { create } from "zustand";
import { persist } from "zustand/middleware";

/** App-level preferences (FR-SET). Vault-level settings live in
 * `.workspace/config.json` and are edited through `config_get`/`config_set`. */
export interface AppSettings {
  theme: "dark" | "light" | "system";
  uiFont: string;
  editorFont: string;
  editorFontSize: number;
  accentColor: string;
  /** Autosave debounce in milliseconds. */
  autosaveDelay: number;

  set: (patch: Partial<Omit<AppSettings, "set">>) => void;
}

export const DEFAULT_UI_FONT = `"Segoe UI", system-ui, -apple-system, sans-serif`;
export const DEFAULT_EDITOR_FONT = "";

export const useSettings = create<AppSettings>()(
  persist(
    (set) => ({
      theme: "system",
      uiFont: "",
      editorFont: "",
      editorFontSize: 14,
      accentColor: "#1e96eb",
      autosaveDelay: 1000,
      set: (patch) => set(patch),
    }),
    { name: "mica-settings" },
  ),
);

/** Push the current settings into the DOM (theme attribute + CSS variables). */
export function applySettings(s: AppSettings) {
  const root = document.documentElement;
  const theme =
    s.theme === "system"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : s.theme;
  root.dataset.theme = theme;
  root.style.setProperty("--ui-font", s.uiFont || DEFAULT_UI_FONT);
  root.style.setProperty(
    "--editor-font",
    s.editorFont || "var(--ui-font)",
  );
  root.style.setProperty("--editor-size", `${s.editorFontSize}px`);
  root.style.setProperty("--accent", s.accentColor || "#1e96eb");
  root.style.setProperty("--accent-soft", `${s.accentColor || "#1e96eb"}24`);
  root.style.setProperty("--mark-bg", `${s.accentColor || "#1e96eb"}40`);
}
