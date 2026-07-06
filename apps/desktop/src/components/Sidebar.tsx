import { useEffect, useState } from "react";
import { api, FileNode, TagCount } from "../api";
import { useStore, kindOfPath, titleOfPath } from "../store";

export default function Sidebar() {
  const vault = useStore((s) => s.vault);
  const tree = useStore((s) => s.tree);
  const refreshTree = useStore((s) => s.refreshTree);
  const openTab = useStore((s) => s.openTab);
  const setSearchOpen = useStore((s) => s.setSearchOpen);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [tagsOpen, setTagsOpen] = useState(false);

  useEffect(() => {
    refreshTree();
  }, [refreshTree]);

  useEffect(() => {
    if (tagsOpen) {
      api.tagsList().then(setTags).catch(() => setTags([]));
    }
  }, [tagsOpen, tree]);

  const createNote = async () => {
    const title = prompt("Note title", "Untitled");
    if (!title) return;
    const file = await api.noteCreate(title);
    await refreshTree();
    openTab({ path: file.path, kind: "note", title: titleOfPath(file.path) });
  };

  const createDatabase = async () => {
    const title = prompt("Database title", "Tasks");
    if (!title) return;
    const file = await api.dbCreate(title);
    await refreshTree();
    openTab({ path: file.path, kind: "database", title: titleOfPath(file.path) });
  };

  const createCanvas = async () => {
    const title = prompt("Canvas title", "System Map");
    if (!title) return;
    const file = await api.canvasCreate(title);
    await refreshTree();
    openTab({ path: file.path, kind: "canvas", title: titleOfPath(file.path) });
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="vault-name" title={vault?.root}>
          {vault?.name}
        </span>
      </div>
      <div className="sidebar-actions">
        <button title="New note" onClick={createNote}>
          + Note
        </button>
        <button title="New database" onClick={createDatabase}>
          + DB
        </button>
        <button title="New canvas" onClick={createCanvas}>
          + Canvas
        </button>
        <button title="Search (Ctrl+Shift+F)" onClick={() => setSearchOpen(true)}>
          🔍
        </button>
      </div>
      <div className="file-tree">
        {tree?.roots.map((node) => <TreeNode key={node.path} node={node} depth={0} />)}
      </div>
      <div className="sidebar-section">
        <button className="section-toggle" onClick={() => setTagsOpen(!tagsOpen)}>
          {tagsOpen ? "▾" : "▸"} Tags
        </button>
        {tagsOpen && (
          <div className="tag-list">
            {tags.map((t) => (
              <button
                key={t.tag}
                className="tag"
                onClick={() => {
                  useStore.getState().setSearchOpen(true);
                  // Search panel picks up the initial query via a custom event.
                  window.dispatchEvent(
                    new CustomEvent("mica:search", { detail: t.tag }),
                  );
                }}
              >
                #{t.tag} <span className="muted">{t.count}</span>
              </button>
            ))}
            {tags.length === 0 && <p className="muted small">No tags yet</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function TreeNode({ node, depth }: { node: FileNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const openTab = useStore((s) => s.openTab);
  const activePath = useStore((s) => s.activePath);
  const refreshTree = useStore((s) => s.refreshTree);
  const closeTab = useStore((s) => s.closeTab);
  const renameTab = useStore((s) => s.renameTab);
  const [menuOpen, setMenuOpen] = useState(false);

  if (node.is_dir) {
    return (
      <div>
        <div
          className="tree-item dir"
          style={{ paddingLeft: depth * 14 + 8 }}
          onClick={() => setExpanded(!expanded)}
        >
          <span className="chevron">{expanded ? "▾" : "▸"}</span> {node.name}
        </div>
        {expanded &&
          node.children?.map((c) => <TreeNode key={c.path} node={c} depth={depth + 1} />)}
      </div>
    );
  }

  const kind = node.kind ?? kindOfPath(node.path);
  const icon =
    kind === "note" ? "📄" : kind === "database" ? "🗃️" : kind === "canvas" ? "🗺️" : "📎";

  const onOpen = () => {
    if (kind === "note" || kind === "database" || kind === "canvas") {
      openTab({ path: node.path, kind, title: titleOfPath(node.path) });
    } else {
      api.vaultOpenExternal(node.path).catch(() => {});
    }
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
      await refreshTree();
    } catch (e) {
      alert(`Rename failed: ${JSON.stringify(e)}`);
    }
  };

  const onDelete = async () => {
    setMenuOpen(false);
    if (!confirm(`Move "${node.name}" to trash?`)) return;
    try {
      await api.noteDelete(node.path);
      closeTab(node.path);
      await refreshTree();
    } catch (e) {
      alert(`Delete failed: ${JSON.stringify(e)}`);
    }
  };

  return (
    <div
      className={`tree-item file ${activePath === node.path ? "active" : ""}`}
      style={{ paddingLeft: depth * 14 + 8 }}
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
      <span className="file-icon">{icon}</span> {node.name}
      {menuOpen && (
        <div className="context-menu" onMouseLeave={() => setMenuOpen(false)}>
          <button onClick={(e) => { e.stopPropagation(); onRename(); }}>Rename</button>
          <button
            onClick={async (e) => {
              e.stopPropagation();
              setMenuOpen(false);
              try {
                await api.noteDuplicate(node.path);
                await refreshTree();
              } catch (err) {
                alert(`Duplicate failed: ${JSON.stringify(err)}`);
              }
            }}
          >
            Duplicate
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }}>Delete</button>
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
