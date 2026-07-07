import { useEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { useStore, titleOfPath } from "../store";

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void | Promise<void>;
}

export default function CommandPalette() {
  const isOpen = useStore((s) => s.commandPaletteOpen);
  const setOpen = useStore((s) => s.setCommandPaletteOpen);
  const refreshTree = useStore((s) => s.refreshTree);
  const openTab = useStore((s) => s.openTab);
  const activePath = useStore((s) => s.activePath);
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
      id: "new-note",
      label: "New note",
      run: async () => {
        const title = prompt("Note title", "Untitled");
        if (!title) return;
        const file = await api.noteCreate(title);
        await refreshTree();
        openTab({ path: file.path, kind: "note", title: titleOfPath(file.path) });
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
        openTab({ path: file.path, kind: "database", title: titleOfPath(file.path) });
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
        openTab({ path: file.path, kind: "canvas", title: titleOfPath(file.path) });
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
    ...(activePath?.endsWith(".md")
      ? [
          {
            id: "toggle-source",
            label: "Toggle Markdown source mode",
            hint: "Ctrl+E",
            run: () => useStore.getState().toggleSourceMode(activePath),
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
        openTab({ path: file.path, kind: "canvas", title: titleOfPath(file.path) });
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
    ...(activePath
      ? [
          {
            id: "export-current",
            label: `Export "${titleOfPath(activePath)}"…`,
            run: async () => {
              const dest = await open({ directory: true, multiple: false, title: "Export destination" });
              if (typeof dest !== "string") return;
              await api.vaultExport([activePath], dest);
              setStatus("Exported.");
            },
          },
          {
            id: "duplicate-current",
            label: `Duplicate "${titleOfPath(activePath)}"`,
            run: async () => {
              const file = await api.noteDuplicate(activePath);
              await refreshTree();
              openTab({
                path: file.path,
                kind: activePath.endsWith(".md")
                  ? "note"
                  : activePath.endsWith(".drawio")
                    ? "canvas"
                    : "database",
                title: titleOfPath(file.path),
              });
            },
          },
          {
            id: "reveal-current",
            label: "Reveal current file in Explorer",
            run: () => api.vaultReveal(activePath),
          },
          {
            id: "open-external",
            label: "Open current file in external editor",
            run: () => api.vaultOpenExternal(activePath),
          },
          {
            id: "copy-path",
            label: "Copy relative path",
            run: () => navigator.clipboard.writeText(activePath),
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
      run: () => useStore.getState().setGraphOpen(true),
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
    {
      id: "close-vault",
      label: "Close vault",
      run: async () => {
        await api.vaultClose();
        useStore.getState().setVault(null);
      },
    },
  ];

  const filtered = commands.filter((c) =>
    c.label.toLowerCase().includes(query.toLowerCase()),
  );
  const sel = Math.min(selected, Math.max(0, filtered.length - 1));

  const runCommand = async (cmd: Command) => {
    try {
      await cmd.run();
      // Commands that show status keep the palette open briefly.
      if (!["backup", "rebuild-index", "import-folder", "export-current"].includes(cmd.id)) {
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
