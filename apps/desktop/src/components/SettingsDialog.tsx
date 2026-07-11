import { useEffect, useState } from "react";
import { api, VaultConfig } from "../api";
import { useStore } from "../store";
import { useSettings } from "../settings";

/** App + vault settings (FR-SET-001…004). */
export default function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const settings = useSettings();

  const [config, setConfig] = useState<VaultConfig | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [section, setSection] = useState<"appearance" | "editor" | "vault">("appearance");

  useEffect(() => {
    if (open) {
      api
        .configGet()
        .then(setConfig)
        .catch(() => setConfig(null));
      setSaveError(null);
      setSection("appearance");
    }
  }, [open]);

  if (!open) return null;

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

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal settings" role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <div><span className="settings-kicker">Mica</span><h3>Settings</h3></div>
          <button className="small" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings categories">
            <span>Options</span>
            <button className={section === "appearance" ? "active" : ""} onClick={() => setSection("appearance")}>◐ <span>Appearance</span></button>
            <button className={section === "editor" ? "active" : ""} onClick={() => setSection("editor")}>✎ <span>Editor</span></button>
            <button className={section === "vault" ? "active" : ""} onClick={() => setSection("vault")}>▱ <span>Vault</span></button>
            <div className="settings-nav-note">Preferences are saved automatically.</div>
          </nav>
          <div className="settings-content">
        {section === "appearance" && <section>
          <div className="settings-section-title"><h4>Appearance</h4><p>Choose how Mica looks and feels.</p></div>
          <label className="settings-row">
            <span><strong>Color scheme</strong><small>Use a light, dark, or system-matched interface.</small></span>
            <select
              value={settings.theme}
              onChange={(e) => settings.set({ theme: e.target.value as "dark" | "light" | "system" })}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
          </label>
          <label className="settings-row">
            <span><strong>Accent color</strong><small>Used for selection, links, toggles, and focus.</small></span>
            <div className="color-control">
              <input type="color" aria-label="Accent color" value={settings.accentColor} onChange={(e) => settings.set({ accentColor: e.target.value })} />
              <input value={settings.accentColor} readOnly aria-label="Accent color hex value" />
            </div>
          </label>
          <label className="settings-row">
            <span><strong>Interface font</strong><small>Set the base font for Mica's controls.</small></span>
            <input
              placeholder="System default"
              value={settings.uiFont}
              onChange={(e) => settings.set({ uiFont: e.target.value })}
            />
          </label>
          <label className="settings-row">
            <span><strong>Editor font</strong><small>Leave blank to follow the interface font.</small></span>
            <input
              placeholder="Same as interface"
              value={settings.editorFont}
              onChange={(e) => settings.set({ editorFont: e.target.value })}
            />
          </label>
          <label className="settings-row">
            <span><strong>Editor font size</strong><small>Text size in editing and reading views.</small></span>
            <input
              type="number"
              min={11}
              max={24}
              value={settings.editorFontSize}
              onChange={(e) => settings.set({ editorFontSize: Number(e.target.value) || 14 })}
            />
          </label>
        </section>}

        {section === "editor" && <section>
          <div className="settings-section-title"><h4>Editor</h4><p>Control writing and save behavior.</p></div>
          <label className="settings-row">
            <span><strong>Autosave delay</strong><small>How long Mica waits after typing before saving.</small></span>
            <input
              type="number"
              min={250}
              max={10000}
              step={250}
              value={settings.autosaveDelay}
              onChange={(e) => settings.set({ autosaveDelay: Number(e.target.value) || 1000 })}
            />
          </label>
          <div className="settings-tip"><strong>Markdown-first.</strong> Use Ctrl+E in any note to switch between rich and source editing.</div>
        </section>}

        {section === "vault" && <section>
          <div className="settings-section-title"><h4>Vault</h4><p>Configure storage, attachments, and naming.</p></div>
          {config ? (
            <>
              <label className="settings-row">
                <span><strong>Vault name</strong><small>Shown at the top of the file explorer.</small></span>
                <input
                  value={config.name}
                  onChange={(e) => setConfig({ ...config, name: e.target.value })}
                  onBlur={(e) => void patchConfig({ name: e.target.value })}
                />
              </label>
              <label className="settings-row">
                <span><strong>Attachments folder</strong><small>Where images and linked files are stored.</small></span>
                <input
                  value={config.assets_dir}
                  onChange={(e) => setConfig({ ...config, assets_dir: e.target.value })}
                  onBlur={(e) => void patchConfig({ assets_dir: e.target.value.replace(/^\/+|\/+$/g, "") || "assets" })}
                />
              </label>
              <label className="settings-row">
                <span><strong>New notes folder</strong><small>Default location for newly created notes.</small></span>
                <input
                  value={config.notes_dir}
                  onChange={(e) => setConfig({ ...config, notes_dir: e.target.value })}
                  onBlur={(e) => void patchConfig({ notes_dir: e.target.value.replace(/^\/+|\/+$/g, "") || "notes" })}
                />
              </label>
              <label className="settings-row">
                <span><strong>New note file names</strong><small>Choose readable titles or URL-friendly slugs.</small></span>
                <select
                  value={config.naming}
                  onChange={(e) => void patchConfig({ naming: e.target.value })}
                >
                  <option value="slug">kebab-case-slug</option>
                  <option value="title">Title as typed</option>
                </select>
              </label>
              {saveError && <div className="error small">{saveError}</div>}
            </>
          ) : (
            <div className="muted small">Vault settings unavailable.</div>
          )}
        </section>}
          </div>
        </div>
      </div>
    </div>
  );
}
