import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { useStore, titleOfPath, kindOfPath, journalDateOf } from "../store";
import { useWorkspaceMeta } from "../workspaceMeta";

/** AFFiNE-style doc header (FR2-DOC-001): title, journal date navigation,
 * Page/Edgeless switch, favorite star, right-panel toggles, more-menu. */
export default function DocHeader({ path }: { path: string }) {
  const kind = kindOfPath(path);
  const docMode = useStore((s) => s.docMode[path] ?? "page");
  const setDocMode = useStore((s) => s.setDocMode);
  const rightPanelTab = useStore((s) => s.rightPanelTab);
  const setRightPanelTab = useStore((s) => s.setRightPanelTab);
  const sourceMode = useStore((s) => s.sourceMode[path]);
  const saveStatus = useStore((s) => s.saveStatus);
  const closeTab = useStore((s) => s.closeTab);
  const openDoc = useStore((s) => s.openDoc);
  const refreshTree = useStore((s) => s.refreshTree);
  const refreshDocs = useStore((s) => s.refreshDocs);
  const showToast = useStore((s) => s.showToast);
  const meta = useWorkspaceMeta();
  const [menuOpen, setMenuOpen] = useState(false);

  const journalDate = journalDateOf(path);
  const isNote = kind === "note";
  const favorite = meta.isFavorite(path);

  const openJournalOffset = async (days: number) => {
    if (!journalDate) return;
    const d = new Date(`${journalDate}T00:00:00`);
    d.setDate(d.getDate() + days);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
    const file = await api.journalEnsure(iso);
    openDoc(file.path);
    refreshDocs();
  };

  const trashDoc = async () => {
    setMenuOpen(false);
    const moved = await api.trashMove(path);
    closeTab(path);
    await meta.dropPath(path);
    await refreshTree();
    refreshDocs();
    showToast({
      message: `Moved "${titleOfPath(path)}" to trash`,
      action: {
        label: "Undo",
        run: () => {
          api.trashRestore(moved[0]).then(() => {
            refreshTree();
            refreshDocs();
          });
        },
      },
    });
  };

  return (
    <div className="doc-header">
      <div className="doc-header-left">
        <span className="doc-title" title={path}>
          {titleOfPath(path)}
        </span>
        {journalDate && (
          <span className="journal-nav">
            <button
              className="icon-button"
              title="Previous day (Alt+←)"
              onClick={() => void openJournalOffset(-1)}
            >
              ‹
            </button>
            <button
              className="icon-button"
              title="Next day (Alt+→)"
              onClick={() => void openJournalOffset(1)}
            >
              ›
            </button>
            <button
              className="journal-today"
              onClick={async () => {
                const now = new Date();
                const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
                  2,
                  "0",
                )}-${String(now.getDate()).padStart(2, "0")}`;
                const file = await api.journalEnsure(iso);
                openDoc(file.path);
              }}
            >
              Today
            </button>
          </span>
        )}
        <span className={`save-dot ${saveStatus}`} title={`Save status: ${saveStatus}`} />
      </div>

      <div className="doc-header-right">
        {isNote && (
          <div className="mode-switch" role="tablist" aria-label="Editor mode">
            <button
              className={docMode === "page" ? "active" : ""}
              title="Page mode"
              onClick={() => void setDocMode(path, "page")}
            >
              Page
            </button>
            <button
              className={docMode === "edgeless" ? "active" : ""}
              title="Edgeless mode"
              onClick={() => {
                setDocMode(path, "edgeless").catch((e) =>
                  alert(`Could not open edgeless mode: ${JSON.stringify(e)}`),
                );
              }}
            >
              Edgeless
            </button>
          </div>
        )}

        <button
          className={`icon-button star ${favorite ? "on" : ""}`}
          title={favorite ? "Remove from favorites" : "Add to favorites"}
          onClick={() => void meta.toggleFavorite(path)}
        >
          {favorite ? "★" : "☆"}
        </button>
        {isNote && (
          <button
            className={`icon-button ${rightPanelTab === "outline" ? "on" : ""}`}
            title="Outline"
            onClick={() => setRightPanelTab(rightPanelTab === "outline" ? null : "outline")}
          >
            ☰
          </button>
        )}
        {isNote && (
          <button
            className={`icon-button ${rightPanelTab === "info" ? "on" : ""}`}
            title="Doc info"
            onClick={() => setRightPanelTab(rightPanelTab === "info" ? null : "info")}
          >
            ⓘ
          </button>
        )}
        <button
          className={`icon-button ${rightPanelTab === "calendar" ? "on" : ""}`}
          title="Journal calendar"
          onClick={() => setRightPanelTab(rightPanelTab === "calendar" ? null : "calendar")}
        >
          📅
        </button>
        <button
          className="icon-button"
          title="More"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          ⋯
        </button>
        {menuOpen && (
          <div className="context-menu right" onMouseLeave={() => setMenuOpen(false)}>
            {isNote && (
              <button
                onClick={() => {
                  setMenuOpen(false);
                  useStore.getState().toggleSourceMode(path);
                }}
              >
                {sourceMode ? "Rich editor" : "Markdown source"} <kbd>Ctrl E</kbd>
              </button>
            )}
            {isNote && (
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setRightPanelTab("history");
                }}
              >
                History
              </button>
            )}
            {isNote && (
              <button
                onClick={async () => {
                  setMenuOpen(false);
                  const file = await api.noteLoad(path);
                  await api.noteMetaSet(
                    path,
                    { primary_mode: useStore.getState().docMode[path] ?? "page" },
                    file.version,
                  );
                }}
              >
                Set current mode as default
              </button>
            )}
            <button
              onClick={async () => {
                setMenuOpen(false);
                await api.noteDuplicate(path);
                await refreshTree();
                refreshDocs();
              }}
            >
              Duplicate
            </button>
            <button
              onClick={async () => {
                setMenuOpen(false);
                const dest = await openDialog({
                  directory: true,
                  multiple: false,
                  title: "Export destination",
                });
                if (typeof dest !== "string") return;
                await api.vaultExport([path], dest);
              }}
            >
              Export…
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                api.vaultReveal(path).catch(() => {});
              }}
            >
              Reveal in Explorer
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                api.vaultOpenExternal(path).catch(() => {});
              }}
            >
              Open in external editor
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                navigator.clipboard.writeText(path);
              }}
            >
              Copy relative path
            </button>
            <button className="danger" onClick={() => void trashDoc()}>
              Move to trash
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
