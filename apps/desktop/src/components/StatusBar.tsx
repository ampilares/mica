import { useStore } from "../store";

export default function StatusBar() {
  const saveStatus = useStore((s) => s.saveStatus);
  const activePath = useStore((s) => s.activePath);

  const label =
    saveStatus === "saving"
      ? "Saving…"
      : saveStatus === "saved"
        ? "Saved"
        : saveStatus === "error"
          ? "Save failed"
          : "";

  return (
    <div className="status-bar">
      <span className="muted">{activePath ?? ""}</span>
      <span className={`save-status ${saveStatus}`}>{label}</span>
    </div>
  );
}
