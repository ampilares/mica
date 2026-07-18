import { useEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { useStore } from "../store";
import {
  DEFAULT_WORKSPACE_WINDOW_ID,
  deleteWorkspacePreset,
  flushWorkspacePersistence,
  listWorkspacePresets,
  loadWorkspacePreset,
  parseWorkspaceWindowStartup,
  resourcePath,
  resourceViewForPath,
  saveWorkspacePreset,
  selectAllPaneIds,
  titleForPath,
} from "../workspace";
import { resetDocumentSessions } from "../documents";

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void | Promise<void>;
}

export default function CommandPalette() {
  const workspaceWindowId = parseWorkspaceWindowStartup(window.location.search).windowId
    ?? DEFAULT_WORKSPACE_WINDOW_ID;
  const isOpen = useStore((s) => s.commandPaletteOpen);
  const setOpen = useStore((s) => s.setCommandPaletteOpen);
  const refreshTree = useStore((s) => s.refreshTree);
  const openResource = useStore((s) => s.openWorkspaceResource);
  const activeTab = useStore((s) => {
    const pane = s.workspace.panes[s.workspace.focusedPaneId];
    return pane ? s.workspace.tabs[pane.activeTabId] : undefined;
  });
  const activeResourcePath = activeTab ? resourcePath(activeTab.view) : undefined;
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelected(0);
      setStatus(null);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const commands: Command[] = [
    {
      id: "new-tab",
      label: "New tab",
      hint: "Ctrl+T",
      run: () => {
        const state = useStore.getState();
        state.createWorkspaceTab(state.workspace.focusedPaneId);
      },
    },
    {
      id: "split-right",
      label: "Split pane right",
      hint: "Ctrl+\\",
      run: () => {
        const state = useStore.getState();
        state.splitWorkspacePane(state.workspace.focusedPaneId, { direction: "row" });
      },
    },
    {
      id: "split-down",
      label: "Split pane down",
      run: () => {
        const state = useStore.getState();
        state.splitWorkspacePane(state.workspace.focusedPaneId, { direction: "column" });
      },
    },
    {
      id: "focus-next-pane",
      label: "Focus next pane",
      hint: "Ctrl+Alt+Shift+→",
      run: () => focusRelativePane(1),
    },
    {
      id: "focus-previous-pane",
      label: "Focus previous pane",
      hint: "Ctrl+Alt+Shift+←",
      run: () => focusRelativePane(-1),
    },
    {
      id: "new-note",
      label: "New note",
      run: async () => {
        const title = prompt("Note title", "Untitled");
        if (!title) return;
        const file = await api.noteCreate(title);
        await refreshTree();
        await openResource(resourceViewForPath(file.path));
      },
    },
    {
      id: "new-database",
      label: "New database",
      run: async () => {
        const title = prompt("Database title", "Tasks");
        if (!title) return;
        const file = await api.dbCreate(title);
        await refreshTree();
        await openResource(resourceViewForPath(file.path));
      },
    },
    {
      id: "new-canvas",
      label: "New canvas",
      run: async () => {
        const title = prompt("Canvas title", "Untitled");
        if (!title) return;
        const file = await api.canvasCreate(title);
        await refreshTree();
        await openResource(resourceViewForPath(file.path));
      },
    },
    {
      id: "search",
      label: "Search in vault",
      hint: "Ctrl+Shift+F",
      run: () => useStore.getState().setSearchOpen(true),
    },
    {
      id: "quick-switch",
      label: "Go to file…",
      hint: "Ctrl+P",
      run: () => useStore.getState().setQuickSwitcherOpen(true),
    },
    {
      id: "toggle-right",
      label: "Toggle right panel",
      hint: "outline · backlinks",
      run: () => useStore.getState().setRightPanelOpen(!useStore.getState().rightPanelOpen),
    },
    ...(activeTab?.view.type === "note"
      ? [
          {
            id: "toggle-source",
            label: "Toggle Markdown source mode",
            hint: "Ctrl+E",
            run: () => useStore.getState().toggleTabSourceMode(activeTab.id),
          },
        ]
      : []),
    {
      id: "backup",
      label: "Back up vault",
      hint: "snapshot to .workspace/backups",
      run: async () => {
        const r = await api.vaultBackup();
        setStatus(`Backed up ${r.files} files to backups/${r.folder}`);
      },
    },
    {
      id: "import-canvas",
      label: "Import canvas…",
      hint: ".canvas · .excalidraw · .drawio",
      run: async () => {
        const src = await open({
          multiple: false,
          filters: [{ name: "Canvas", extensions: ["canvas", "excalidraw", "drawio", "xml"] }],
        });
        if (typeof src !== "string") return;
        const file = await api.canvasImport(src);
        await refreshTree();
        await openResource(resourceViewForPath(file.path));
      },
    },
    {
      id: "import-folder",
      label: "Import Markdown folder…",
      hint: "copies files into the vault",
      run: async () => {
        const src = await open({ directory: true, multiple: false });
        if (typeof src !== "string") return;
        const count = await api.vaultImportFolder(src);
        await refreshTree();
        setStatus(`Imported ${count} files`);
      },
    },
    ...(activeResourcePath
      ? [
          {
            id: "export-current",
            label: `Export "${titleForPath(activeResourcePath)}"…`,
            run: async () => {
              const dest = await open({ directory: true, multiple: false, title: "Export destination" });
              if (typeof dest !== "string") return;
              await api.vaultExport([activeResourcePath], dest);
              setStatus("Exported.");
            },
          },
          {
            id: "duplicate-current",
            label: `Duplicate "${titleForPath(activeResourcePath)}"`,
            run: async () => {
              const file = await api.noteDuplicate(activeResourcePath);
              await refreshTree();
              await openResource(resourceViewForPath(file.path));
            },
          },
          {
            id: "reveal-current",
            label: "Reveal current file in Explorer",
            run: () => api.vaultReveal(activeResourcePath),
          },
          {
            id: "open-external",
            label: "Open current file in external editor",
            run: () => api.vaultOpenExternal(activeResourcePath),
          },
          {
            id: "copy-path",
            label: "Copy relative path",
            run: () => navigator.clipboard.writeText(activeResourcePath),
          },
        ]
      : []),
    {
      id: "rebuild-index",
      label: "Rebuild search index",
      run: async () => {
        const n = await api.indexRebuild();
        setStatus(`Re-indexed ${n} files`);
      },
    },
    {
      id: "graph",
      label: "Open graph view",
      hint: "Ctrl+G",
      run: () => {
        const state = useStore.getState();
        const pane = state.workspace.panes[state.workspace.focusedPaneId];
        const tab = state.workspace.tabs[pane.activeTabId];
        state.createWorkspaceTab(pane.id, { type: "graph", centerPath: resourcePath(tab.view) });
      },
    },
    {
      id: "save-workspace-preset",
      label: "Save workspace preset…",
      run: async () => {
        const name = prompt("Preset name", "Focus layout");
        if (!name) return;
        await saveWorkspacePreset(name, useStore.getState().workspace);
        setStatus(`Saved workspace preset “${name}”`);
      },
    },
    {
      id: "load-workspace-preset",
      label: "Load workspace preset…",
      run: async () => {
        const names = await listWorkspacePresets();
        if (names.length === 0) {
          setStatus("No workspace presets saved");
          return;
        }
        const name = prompt(`Preset to load:\n${names.join("\n")}`, names[0]);
        if (!name) return;
        const workspace = await loadWorkspacePreset(name);
        if (!workspace) throw new Error(`Workspace preset “${name}” was not found`);
        const restored = await useStore.getState().restoreWorkspaceLayout(workspace);
        if (!restored) throw new Error("Unsaved documents prevented the workspace from changing");
        setStatus(`Loaded workspace preset “${name}”`);
      },
    },
    {
      id: "delete-workspace-preset",
      label: "Delete workspace preset…",
      run: async () => {
        const names = await listWorkspacePresets();
        if (names.length === 0) {
          setStatus("No workspace presets saved");
          return;
        }
        const name = prompt(`Preset to delete:\n${names.join("\n")}`, names[0]);
        if (!name || !confirm(`Delete workspace preset “${name}”?`)) return;
        const deleted = await deleteWorkspacePreset(name);
        setStatus(deleted ? `Deleted workspace preset “${name}”` : `Preset “${name}” was not found`);
      },
    },
    {
      id: "settings",
      label: "Settings",
      hint: "Ctrl+,",
      run: () => useStore.getState().setSettingsOpen(true),
    },
    {
      id: "where-data",
      label: "Where is my data?",
      run: () => useStore.getState().setDataExplainerOpen(true),
    },
    ...(workspaceWindowId === DEFAULT_WORKSPACE_WINDOW_ID
      ? [{
          id: "close-vault",
          label: "Close vault",
          run: async () => {
            await flushWorkspacePersistence();
            const documents = await resetDocumentSessions();
            const failure = documents.find((result) => !result.ok || result.dirty);
            if (failure) throw new Error(`Could not save ${failure.path}; vault remains open`);
            await api.vaultClose();
            useStore.getState().setVault(null);
          },
        }]
      : []),
  ];

  const filtered = commands.filter((c) =>
    c.label.toLowerCase().includes(query.toLowerCase()),
  );
  const sel = Math.min(selected, Math.max(0, filtered.length - 1));

  const runCommand = async (cmd: Command) => {
    try {
      await cmd.run();
      // Commands that show status keep the palette open briefly.
      if (!["backup", "rebuild-index", "import-folder", "export-current", "save-workspace-preset", "load-workspace-preset", "delete-workspace-preset"].includes(cmd.id)) {
        setOpen(false);
      }
    } catch (e) {
      setStatus(`Failed: ${JSON.stringify(e)}`);
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          placeholder="Run a command…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected(Math.min(sel + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected(Math.max(sel - 1, 0));
            } else if (e.key === "Enter" && filtered[sel]) {
              void runCommand(filtered[sel]);
            }
          }}
        />
        <div className="palette-results">
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              className={`palette-item row ${i === sel ? "selected" : ""}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => void runCommand(cmd)}
            >
              <span>{cmd.label}</span>
              {cmd.hint && <span className="muted small">{cmd.hint}</span>}
            </button>
          ))}
          {filtered.length === 0 && <p className="muted small pad">No commands</p>}
        </div>
        {status && <div className="palette-status">{status}</div>}
      </div>
    </div>
  );
}

function focusRelativePane(delta: number) {
  const state = useStore.getState();
  const paneIds = selectAllPaneIds(state.workspace);
  if (paneIds.length < 2) return;
  const index = paneIds.indexOf(state.workspace.focusedPaneId);
  state.activateWorkspacePane(paneIds[(index + delta + paneIds.length) % paneIds.length]);
}
