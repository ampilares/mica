import { useEffect, useState } from "react";
import "./SettingsDialog.css";
import { api, VaultConfig } from "../api";
import { useStore } from "../store";
import { useSettings } from "../settings";

type Section = "appearance" | "editor" | "workspace" | "shortcuts" | "about";

const NAV: { id: Section; icon: string; label: string }[] = [
  { id: "appearance", icon: "◐", label: "Appearance" },
  { id: "editor", icon: "✎", label: "Editor" },
  { id: "workspace", icon: "▱", label: "Workspace" },
  { id: "shortcuts", icon: "⌘", label: "Shortcuts" },
  { id: "about", icon: "ⓘ", label: "About" },
];

// Keyboard map mirrors the handlers wired up in App.tsx (FR2-SET-001).
const SHORTCUTS: [string, string][] = [
  ["Quick search", "Ctrl / Cmd + K  ·  Ctrl / Cmd + P"],
  ["Command palette", "Ctrl / Cmd + Shift + P"],
  ["New doc", "Ctrl / Cmd + N"],
  ["New whiteboard", "Ctrl / Cmd + Alt + N"],
  ["Toggle sidebar", "Ctrl / Cmd + /"],
  ["Toggle right panel", "Ctrl / Cmd + ."],
  ["Markdown source mode", "Ctrl / Cmd + E"],
  ["Settings", "Ctrl / Cmd + ,"],
  ["Previous / next journal day", "Alt + ← / →"],
];

/** App + vault settings, AFFiNE two-pane layout (FR2-SET-001). */
export default function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const setDataExplainerOpen = useStore((s) => s.setDataExplainerOpen);
  const settings = useSettings();

  const [config, setConfig] = useState<VaultConfig | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("appearance");
  // FR21-TPL: templates offered by the "New doc default" select.
  const [templates, setTemplates] = useState<{ path: string; title: string }[]>([]);

  useEffect(() => {
    if (open) {
      api
        .configGet()
        .then(setConfig)
        .catch(() => setConfig(null));
      api
        .templateList()
        .then(setTemplates)
        .catch(() => setTemplates([]));
      setSaveError(null);
      setSection("appearance");
    }
  }, [open]);

  if (!open) return null;

  // Vault-level persistence via config_set (unchanged from prior dialog).
  const patchConfig = async (patch: Partial<VaultConfig>) => {
    if (!config) return;
    const next = { ...config, ...patch };
    setConfig(next);
    try {
      setConfig(await api.configSet(next));
      setSaveError(null);
    } catch (e) {
      setSaveError(String((e as { message?: string })?.message ?? e));
    }
  };

  const activeLabel = NAV.find((n) => n.id === section)?.label ?? "Settings";

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div
        className="modal settings settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <nav className="sd-nav" aria-label="Settings categories">
          <div className="sd-brand">
            <span className="sd-brand-kicker">Mica</span>
            <span className="sd-brand-title">Settings</span>
          </div>
          <div className="sd-nav-group">Options</div>
          {NAV.map((n) => (
            <button
              key={n.id}
              className={section === n.id ? "active" : ""}
              onClick={() => setSection(n.id)}
            >
              <span className="sd-nav-icon">{n.icon}</span>
              <span>{n.label}</span>
            </button>
          ))}
        </nav>

        <div className="sd-main">
          <div className="sd-main-header">
            <h3>{activeLabel}</h3>
            <button className="sd-close" aria-label="Close settings" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>

          <div className="sd-body">
            {section === "appearance" && (
              <section>
                <p className="sd-lead">Choose how Mica looks and feels.</p>
                <label className="sd-row">
                  <span className="sd-row-label">
                    <strong>Color scheme</strong>
                    <small>Use a light, dark, or system-matched interface.</small>
                  </span>
                  <select
                    value={settings.theme}
                    onChange={(e) => settings.set({ theme: e.target.value as "dark" | "light" | "system" })}
                  >
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                    <option value="system">System</option>
                  </select>
                </label>
                <label className="sd-row">
                  <span className="sd-row-label">
                    <strong>Accent color</strong>
                    <small>Used for selection, links, toggles, and focus.</small>
                  </span>
                  <div className="sd-color">
                    <input
                      type="color"
                      aria-label="Accent color"
                      value={settings.accentColor}
                      onChange={(e) => settings.set({ accentColor: e.target.value })}
                    />
                    <input type="text" value={settings.accentColor} readOnly aria-label="Accent color hex value" />
                  </div>
                </label>
                <label className="sd-row">
                  <span className="sd-row-label">
                    <strong>Interface font</strong>
                    <small>Set the base font for Mica's controls.</small>
                  </span>
                  <input
                    placeholder="System default"
                    value={settings.uiFont}
                    onChange={(e) => settings.set({ uiFont: e.target.value })}
                  />
                </label>
              </section>
            )}

            {section === "editor" && (
              <section>
                <p className="sd-lead">Control writing and save behavior.</p>
                <label className="sd-row">
                  <span className="sd-row-label">
                    <strong>Editor font</strong>
                    <small>Leave blank to follow the interface font.</small>
                  </span>
                  <input
                    placeholder="Same as interface"
                    value={settings.editorFont}
                    onChange={(e) => settings.set({ editorFont: e.target.value })}
                  />
                </label>
                <label className="sd-row">
                  <span className="sd-row-label">
                    <strong>Editor font size</strong>
                    <small>Text size in editing and reading views.</small>
                  </span>
                  <input
                    type="number"
                    min={11}
                    max={24}
                    value={settings.editorFontSize}
                    onChange={(e) => settings.set({ editorFontSize: Number(e.target.value) || 14 })}
                  />
                </label>
                <label className="sd-row">
                  <span className="sd-row-label">
                    <strong>Autosave delay</strong>
                    <small>How long Mica waits after typing before saving (ms).</small>
                  </span>
                  <input
                    type="number"
                    min={250}
                    max={10000}
                    step={250}
                    value={settings.autosaveDelay}
                    onChange={(e) => settings.set({ autosaveDelay: Number(e.target.value) || 1000 })}
                  />
                </label>
                {/* FR21-TPL: persisted in workspace config (`default_new_doc`). */}
                <label className="sd-row">
                  <span className="sd-row-label">
                    <strong>New doc default</strong>
                    <small>What the sidebar's New doc button creates.</small>
                  </span>
                  <select
                    value={config ? String(config.default_new_doc ?? "page") : "page"}
                    disabled={!config}
                    onChange={(e) => void patchConfig({ default_new_doc: e.target.value })}
                  >
                    <option value="page">Blank page</option>
                    <option value="edgeless">Blank edgeless</option>
                    <option value="ask">Ask each time</option>
                    {templates.map((t) => (
                      <option key={t.path} value={`template:${t.path}`}>
                        Template: {t.title}
                      </option>
                    ))}
                  </select>
                </label>
              </section>
            )}

            {section === "workspace" && (
              <section>
                <p className="sd-lead">Configure storage, folders, and naming.</p>
                {config ? (
                  <>
                    <label className="sd-row">
                      <span className="sd-row-label">
                        <strong>Vault name</strong>
                        <small>Shown at the top of the file explorer.</small>
                      </span>
                      <input
                        value={config.name}
                        onChange={(e) => setConfig({ ...config, name: e.target.value })}
                        onBlur={(e) => void patchConfig({ name: e.target.value })}
                      />
                    </label>
                    <label className="sd-row">
                      <span className="sd-row-label">
                        <strong>New notes folder</strong>
                        <small>Default location for newly created notes.</small>
                      </span>
                      <input
                        value={config.notes_dir}
                        onChange={(e) => setConfig({ ...config, notes_dir: e.target.value })}
                        onBlur={(e) => void patchConfig({ notes_dir: e.target.value.replace(/^\/+|\/+$/g, "") || "notes" })}
                      />
                    </label>
                    <label className="sd-row">
                      <span className="sd-row-label">
                        <strong>Databases folder</strong>
                        <small>Where table/database documents are stored.</small>
                      </span>
                      <input
                        value={config.databases_dir}
                        onChange={(e) => setConfig({ ...config, databases_dir: e.target.value })}
                        onBlur={(e) => void patchConfig({ databases_dir: e.target.value.replace(/^\/+|\/+$/g, "") || "databases" })}
                      />
                    </label>
                    <label className="sd-row">
                      <span className="sd-row-label">
                        <strong>Canvases folder</strong>
                        <small>Where whiteboard/canvas documents are stored.</small>
                      </span>
                      <input
                        value={config.canvases_dir}
                        onChange={(e) => setConfig({ ...config, canvases_dir: e.target.value })}
                        onBlur={(e) => void patchConfig({ canvases_dir: e.target.value.replace(/^\/+|\/+$/g, "") || "canvases" })}
                      />
                    </label>
                    <label className="sd-row">
                      <span className="sd-row-label">
                        <strong>Attachments folder</strong>
                        <small>Where images and linked files are stored.</small>
                      </span>
                      <input
                        value={config.assets_dir}
                        onChange={(e) => setConfig({ ...config, assets_dir: e.target.value })}
                        onBlur={(e) => void patchConfig({ assets_dir: e.target.value.replace(/^\/+|\/+$/g, "") || "assets" })}
                      />
                    </label>
                    <label className="sd-row">
                      <span className="sd-row-label">
                        <strong>New note file names</strong>
                        <small>Choose readable titles or URL-friendly slugs.</small>
                      </span>
                      <select value={config.naming} onChange={(e) => void patchConfig({ naming: e.target.value })}>
                        <option value="slug">kebab-case-slug</option>
                        <option value="title">Title as typed</option>
                      </select>
                    </label>
                    {saveError && <div className="sd-error">{saveError}</div>}
                  </>
                ) : (
                  <div className="sd-muted">Workspace settings unavailable.</div>
                )}
              </section>
            )}

            {section === "shortcuts" && (
              <section>
                <p className="sd-lead">Keyboard shortcuts (read-only).</p>
                <table className="sd-shortcuts">
                  <tbody>
                    {SHORTCUTS.map(([action, keys]) => (
                      <tr key={action}>
                        <td>{action}</td>
                        <td>
                          <span className="sd-key">{keys}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {section === "about" && (
              <section className="sd-about">
                <div className="sd-about-mark">M</div>
                <h4>Mica</h4>
                <p className="sd-about-tagline">A local-first, file-native workspace.</p>
                <p className="sd-about-note">
                  Every note, database, and canvas is a plain file on disk. See{" "}
                  <code>docs/vault-format.md</code> for the on-disk vault layout.
                </p>
                <div className="sd-about-actions">
                  <button onClick={() => setDataExplainerOpen(true)}>Where is my data?</button>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
