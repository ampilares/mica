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

  useEffect(() => {
    if (open) {
      api
        .configGet()
        .then(setConfig)
        .catch(() => setConfig(null));
      setSaveError(null);
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
      <div className="modal settings" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h3>Settings</h3>
          <button className="small" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>

        <section>
          <h4>Appearance</h4>
          <label className="settings-row">
            <span>Theme</span>
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
            <span>Interface font</span>
            <input
              placeholder="System default"
              value={settings.uiFont}
              onChange={(e) => settings.set({ uiFont: e.target.value })}
            />
          </label>
          <label className="settings-row">
            <span>Editor font</span>
            <input
              placeholder="Same as interface"
              value={settings.editorFont}
              onChange={(e) => settings.set({ editorFont: e.target.value })}
            />
          </label>
          <label className="settings-row">
            <span>Editor font size</span>
            <input
              type="number"
              min={11}
              max={24}
              value={settings.editorFontSize}
              onChange={(e) => settings.set({ editorFontSize: Number(e.target.value) || 14 })}
            />
          </label>
        </section>

        <section>
          <h4>Editing</h4>
          <label className="settings-row">
            <span>Autosave delay (ms)</span>
            <input
              type="number"
              min={250}
              max={10000}
              step={250}
              value={settings.autosaveDelay}
              onChange={(e) => settings.set({ autosaveDelay: Number(e.target.value) || 1000 })}
            />
          </label>
        </section>

        <section>
          <h4>Vault</h4>
          {config ? (
            <>
              <label className="settings-row">
                <span>Vault name</span>
                <input
                  value={config.name}
                  onChange={(e) => setConfig({ ...config, name: e.target.value })}
                  onBlur={(e) => void patchConfig({ name: e.target.value })}
                />
              </label>
              <label className="settings-row">
                <span>Attachments folder</span>
                <input
                  value={config.assets_dir}
                  onChange={(e) => setConfig({ ...config, assets_dir: e.target.value })}
                  onBlur={(e) => void patchConfig({ assets_dir: e.target.value.replace(/^\/+|\/+$/g, "") || "assets" })}
                />
              </label>
              <label className="settings-row">
                <span>New notes folder</span>
                <input
                  value={config.notes_dir}
                  onChange={(e) => setConfig({ ...config, notes_dir: e.target.value })}
                  onBlur={(e) => void patchConfig({ notes_dir: e.target.value.replace(/^\/+|\/+$/g, "") || "notes" })}
                />
              </label>
              <label className="settings-row">
                <span>New note file names</span>
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
        </section>
      </div>
    </div>
  );
}
