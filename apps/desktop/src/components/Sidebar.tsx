import { useEffect, useState } from "react";
import { api, FileNode } from "../api";
import { useStore, kindOfPath, titleOfPath, journalPath } from "../store";
import { useWorkspaceMeta } from "../workspaceMeta";
import TemplatePicker from "./TemplatePicker";

/** AFFiNE-style app sidebar (FR2-NAV-001): quick search, All docs, Journals,
 * Collections, Tags, Favorites, Organize (file tree), Trash. */
export default function Sidebar() {
  const vault = useStore((s) => s.vault);
  const tree = useStore((s) => s.tree);
  const docs = useStore((s) => s.docs);
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const refreshTree = useStore((s) => s.refreshTree);
  const refreshDocs = useStore((s) => s.refreshDocs);
  const openPage = useStore((s) => s.openPage);
  const openDoc = useStore((s) => s.openDoc);
  const openTab = useStore((s) => s.openTab);
  const activePath = useStore((s) => s.activePath);
  const meta = useWorkspaceMeta();

  const [favoritesOpen, setFavoritesOpen] = useState(true);
  const [collectionsOpen, setCollectionsOpen] = useState(true);
  const [organizeOpen, setOrganizeOpen] = useState(true);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  // FR21-TPL: template picker modal — "template" lists templates, "ask" also
  // offers blank page/edgeless rows.
  const [pickerMode, setPickerMode] = useState<null | "template" | "ask">(null);

  useEffect(() => {
    refreshTree();
    refreshDocs();
    meta.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.root]);

  if (collapsed) return null;

  const openJournalToday = async () => {
    const today = journalPath(new Date());
    try {
      const file = await api.journalEnsure(today.slice(9, 19));
      openDoc(file.path);
      refreshDocs();
    } catch {
      /* surfaced via conflict/other dialogs elsewhere */
    }
  };

  const createDoc = async (kind: "note" | "database" | "canvas") => {
    setNewMenuOpen(false);
    const label =
      kind === "note" ? "New doc" : kind === "database" ? "New database" : "New whiteboard";
    const title = prompt(`${label} title`, "Untitled");
    if (!title) return;
    const file =
      kind === "note"
        ? await api.noteCreate(title)
        : kind === "database"
          ? await api.dbCreate(title)
          : await api.canvasCreate(title);
    await refreshTree();
    refreshDocs();
    openDoc(file.path);
  };

  // FR21-TPL: honor the `default_new_doc` workspace config for the plain
  // "＋ New doc" button — page (default), edgeless, ask, or a named template.
  const newDocDefault = async () => {
    let def = "page";
    try {
      const cfg = await api.configGet();
      if (typeof cfg.default_new_doc === "string" && cfg.default_new_doc) {
        def = cfg.default_new_doc;
      }
    } catch {
      /* fall back to a blank page */
    }
    if (def === "ask") {
      setPickerMode("ask");
      return;
    }
    if (def === "edgeless") {
      const title = prompt("New doc title", "Untitled");
      if (!title) return;
      const file = await api.noteCreate(title);
      await refreshTree();
      refreshDocs();
      openDoc(file.path);
      await useStore.getState().setDocMode(file.path, "edgeless");
      return;
    }
    if (def.startsWith("template:")) {
      const tpl = def.slice("template:".length);
      const title = prompt("New doc title", "Untitled");
      if (!title) return;
      const file = await api.templateInstantiate(tpl, title);
      await refreshTree();
      refreshDocs();
      openDoc(file.path);
      return;
    }
    // "page" (default): blank note.
    await createDoc("note");
  };

  const tagCounts = new Map<string, number>();
  for (const d of docs) {
    for (const t of d.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }

  return (
    <div className="sidebar">
      <div className="sidebar-workspace">
        <div className="workspace-avatar">{(vault?.name ?? "M")[0]?.toUpperCase()}</div>
        <span className="workspace-name" title={vault?.root}>
          {vault?.name}
        </span>
        <button
          className="icon-button"
          title="Settings (Ctrl+,)"
          onClick={() => useStore.getState().setSettingsOpen(true)}
        >
          ⚙
        </button>
      </div>

      <div className="sidebar-nav">
        <button
          className="nav-item"
          onClick={() => useStore.getState().setQuickSearchOpen(true)}
        >
          <span className="nav-icon">⌕</span> Quick search
          <kbd className="nav-kbd">Ctrl K</kbd>
        </button>
        <button
          className={`nav-item ${activePath === "mica://all-docs" ? "active" : ""}`}
          onClick={() => openPage("all-docs")}
        >
          <span className="nav-icon">🏠</span> All docs
        </button>
        <button className="nav-item" onClick={() => void openJournalToday()}>
          <span className="nav-icon">📅</span> Journals
        </button>
        <button
          className={`nav-item ${activePath === "mica://tags" ? "active" : ""}`}
          onClick={() => openPage("tags")}
        >
          <span className="nav-icon">#</span> Tags
          <span className="nav-count">{tagCounts.size || ""}</span>
        </button>
      </div>

      <div className="sidebar-scroll">
        {/* Favorites */}
        <SectionHeader
          label="Favorites"
          open={favoritesOpen}
          onToggle={() => setFavoritesOpen(!favoritesOpen)}
        />
        {favoritesOpen && (
          <div className="sidebar-section-body">
            {meta.favorites.length === 0 && (
              <p className="muted small pad-left">Star docs to pin them here</p>
            )}
            {meta.favorites.map((path) => (
              <button
                key={path}
                className={`nav-item sub ${activePath === path ? "active" : ""}`}
                title={path}
                onClick={() => openDoc(path)}
              >
                <span className="nav-icon">{iconOf(kindOfPath(path))}</span>
                <span className="nav-label">{titleOfPath(path)}</span>
              </button>
            ))}
          </div>
        )}

        {/* Collections */}
        <SectionHeader
          label="Collections"
          open={collectionsOpen}
          onToggle={() => setCollectionsOpen(!collectionsOpen)}
          onAdd={async () => {
            const name = prompt("Collection name", "New collection");
            if (!name) return;
            const col = await meta.addCollection(name);
            openTab({
              path: `mica://collection/${col.id}`,
              kind: "page",
              title: col.name,
            });
          }}
        />
        {collectionsOpen && (
          <div className="sidebar-section-body">
            {meta.collections.length === 0 && (
              <p className="muted small pad-left">Group docs into collections</p>
            )}
            {meta.collections.map((col) => (
              <button
                key={col.id}
                className={`nav-item sub ${
                  activePath === `mica://collection/${col.id}` ? "active" : ""
                }`}
                onClick={() =>
                  openTab({
                    path: `mica://collection/${col.id}`,
                    kind: "page",
                    title: col.name,
                  })
                }
              >
                <span className="nav-icon">🗂</span>
                <span className="nav-label">{col.name}</span>
              </button>
            ))}
          </div>
        )}

        {/* Organize: the real file tree — files stay first-class (§2). */}
        <SectionHeader
          label="Organize"
          open={organizeOpen}
          onToggle={() => setOrganizeOpen(!organizeOpen)}
        />
        {organizeOpen && (
          <div className="file-tree">
            {tree?.roots
              .filter((n) => !n.path.endsWith(".canvas.drawio"))
              .map((node) => <TreeNode key={node.path} node={node} depth={0} />)}
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <button
          className={`nav-item ${activePath === "mica://trash" ? "active" : ""}`}
          onClick={() => openPage("trash")}
        >
          <span className="nav-icon">🗑</span> Trash
        </button>
        <div className="new-doc-row">
          <button className="new-doc-button" onClick={() => void newDocDefault()}>
            ＋ New doc
          </button>
          <button
            className="new-doc-more"
            title="More"
            onClick={() => setNewMenuOpen(!newMenuOpen)}
          >
            ▾
          </button>
          {newMenuOpen && (
            <div className="context-menu up" onMouseLeave={() => setNewMenuOpen(false)}>
              <button onClick={() => void createDoc("note")}>New doc</button>
              <button onClick={() => void createDoc("canvas")}>New whiteboard</button>
              <button onClick={() => void createDoc("database")}>New database</button>
              <button
                onClick={() => {
                  setNewMenuOpen(false);
                  setPickerMode("template");
                }}
              >
                From template…
              </button>
            </div>
          )}
        </div>
      </div>

      <TemplatePicker
        open={pickerMode !== null}
        mode={pickerMode ?? "template"}
        onClose={() => setPickerMode(null)}
      />
    </div>
  );
}

function SectionHeader({
  label,
  open,
  onToggle,
  onAdd,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  onAdd?: () => void;
}) {
  return (
    <div className="sidebar-section-header">
      <button className="section-toggle" onClick={onToggle}>
        <span className="chevron">{open ? "▾" : "▸"}</span> {label}
      </button>
      {onAdd && (
        <button className="icon-button" title={`New ${label.toLowerCase()}`} onClick={onAdd}>
          ＋
        </button>
      )}
    </div>
  );
}

export function iconOf(kind: string): string {
  switch (kind) {
    case "note":
      return "📄";
    case "database":
      return "🗃️";
    case "canvas":
      return "🖼";
    default:
      return "📎";
  }
}

function TreeNode({ node, depth }: { node: FileNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const openDoc = useStore((s) => s.openDoc);
  const activePath = useStore((s) => s.activePath);
  const refreshTree = useStore((s) => s.refreshTree);
  const refreshDocs = useStore((s) => s.refreshDocs);
  const closeTab = useStore((s) => s.closeTab);
  const renameTab = useStore((s) => s.renameTab);
  const showToast = useStore((s) => s.showToast);
  const meta = useWorkspaceMeta();
  const [menuOpen, setMenuOpen] = useState(false);

  if (node.is_dir) {
    return (
      <div>
        <div
          className="tree-item dir"
          style={{ paddingLeft: depth * 14 + 10 }}
          onClick={() => setExpanded(!expanded)}
        >
          <span className="chevron">{expanded ? "▾" : "▸"}</span> {node.name}
        </div>
        {expanded &&
          node.children
            ?.filter((c) => !c.path.endsWith(".canvas.drawio"))
            .map((c) => <TreeNode key={c.path} node={c} depth={depth + 1} />)}
      </div>
    );
  }

  const kind = node.kind ?? kindOfPath(node.path);
  const openable = kind === "note" || kind === "database" || kind === "canvas";

  const onOpen = () => {
    if (openable) openDoc(node.path);
    else api.vaultOpenExternal(node.path).catch(() => {});
  };

  const onRename = async () => {
    setMenuOpen(false);
    const newName = prompt("New name", node.name);
    if (!newName || newName === node.name) return;
    const dir = node.path.includes("/")
      ? node.path.slice(0, node.path.lastIndexOf("/") + 1)
      : "";
    try {
      const to = await api.noteRename(node.path, dir + newName);
      renameTab(node.path, to);
      await meta.repairPaths(node.path, to);
      await refreshTree();
      refreshDocs();
    } catch (e) {
      alert(`Rename failed: ${JSON.stringify(e)}`);
    }
  };

  const onTrash = async () => {
    setMenuOpen(false);
    try {
      const moved = await api.trashMove(node.path);
      closeTab(node.path);
      await meta.dropPath(node.path);
      await refreshTree();
      refreshDocs();
      showToast({
        message: `Moved "${titleOfPath(node.path)}" to trash`,
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
    } catch (e) {
      alert(`Trash failed: ${JSON.stringify(e)}`);
    }
  };

  return (
    <div
      className={`tree-item file ${activePath === node.path ? "active" : ""}`}
      style={{ paddingLeft: depth * 14 + 10 }}
      onClick={onOpen}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-mica-path", node.path);
        e.dataTransfer.effectAllowed = "link";
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
      <span className="file-icon">{iconOf(kind)}</span>
      <span className="nav-label">{node.name}</span>
      {menuOpen && (
        <div className="context-menu" onMouseLeave={() => setMenuOpen(false)}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
              void meta.toggleFavorite(node.path);
            }}
          >
            {meta.isFavorite(node.path) ? "Remove from favorites" : "Add to favorites"}
          </button>
          <button onClick={(e) => { e.stopPropagation(); void onRename(); }}>Rename</button>
          <button
            onClick={async (e) => {
              e.stopPropagation();
              setMenuOpen(false);
              try {
                await api.noteDuplicate(node.path);
                await refreshTree();
                refreshDocs();
              } catch (err) {
                alert(`Duplicate failed: ${JSON.stringify(err)}`);
              }
            }}
          >
            Duplicate
          </button>
          <button onClick={(e) => { e.stopPropagation(); void onTrash(); }}>
            Move to trash
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
              api.vaultReveal(node.path).catch(() => {});
            }}
          >
            Reveal in Explorer
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
              api.vaultOpenExternal(node.path).catch(() => {});
            }}
          >
            Open in external editor
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
              navigator.clipboard.writeText(node.path);
            }}
          >
            Copy relative path
          </button>
        </div>
      )}
    </div>
  );
}
