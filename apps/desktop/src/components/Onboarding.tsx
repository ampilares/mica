import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, isApiError } from "../api";
import { useStore } from "../store";
import { useSettings } from "../settings";

export default function Onboarding() {
  const setVault = useStore((s) => s.setVault);
  const refreshTree = useStore((s) => s.refreshTree);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settings = useSettings();
  const dark = settings.theme === "system"
    ? !window.matchMedia("(prefers-color-scheme: light)").matches
    : settings.theme === "dark";

  const pickAnd = async (action: "create" | "open") => {
    setError(null);
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir !== "string") return;
    setBusy(true);
    try {
      const info =
        action === "create" ? await api.vaultCreate(dir) : await api.vaultOpen(dir);
      setVault(info);
      await refreshTree();
    } catch (e) {
      setError(isApiError(e) ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboarding">
      <button className="onboarding-theme" onClick={() => settings.set({ theme: dark ? "light" : "dark" })}>
        {dark ? "☀ Light" : "☾ Dark"}
      </button>
      <div className="onboarding-card">
        <div className="empty-mark onboarding-mark">M</div>
        <h1>Mica</h1>
        <p className="muted">
          A local-first workspace. Your notes are Markdown files, your databases
          are JSON, your canvases are draw.io files — all in a folder you own.
        </p>
        <div className="onboarding-actions">
          <button className="primary" disabled={busy} onClick={() => pickAnd("create")}>
            Create vault
          </button>
          <button disabled={busy} onClick={() => pickAnd("open")}>
            Open folder as vault
          </button>
        </div>
        {busy && <p className="muted">Opening vault…</p>}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
