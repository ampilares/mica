import { useEffect, useState } from "react";
import { api, FileNode, TagCount } from "../api";
import { useStore } from "../store";
import { resourcePath, resourceViewForPath } from "../workspace";
import { Icon, IconButton } from "./ui";

export default function Sidebar() {
  const vault = useStore((s) => s.vault);
  const tree = useStore((s) => s.tree);
  const refreshTree = useStore((s) => s.refreshTree);
  const openWorkspaceResource = useStore((s) => s.openWorkspaceResource);
  const setSearchOpen = useStore((s) => s.setSearchOpen);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [tagsOpen, setTagsOpen] = useState(false);
  const sidebar = useStore((s) => s.workspace.sidebars.left);
  const setSidebar = useStore((s) => s.setWorkspaceSidebar);

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
    await openWorkspaceResource(resourceViewForPath(file.path));
  };

  const createDatabase = async () => {
    const title = prompt("Database title", "Tasks");
    if (!title) return;
    const file = await api.dbCreate(title);
    await refreshTree();
    await openWorkspaceResource(resourceViewForPath(file.path));
  };

  const createCanvas = async () => {
    const title = prompt("Canvas title", "System Map");
    if (!title) return;
    const file = await api.canvasCreate(title);
    await refreshTree();
    await openWorkspaceResource(resourceViewForPath(file.path));
  };

  if (!sidebar.open) return null;

  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => setSidebar("left", { width: Math.max(190, Math.min(420, next.clientX - 42)) });
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  };

  return (
    <div className="sidebar" style={{ width: sidebar.width, flexBasis: sidebar.width }}>
      <div className="sidebar-header">
        <div>
          <span className="sidebar-eyebrow">Vault</span>
          <span className="vault-name" title={vault?.root}>{vault?.name}</span>
        </div>
        <IconButton className="icon-button" label="Quick switcher" tooltip="Quick switcher (Ctrl+P)" icon="search" onClick={() => useStore.getState().setQuickSwitcherOpen(true)} />
      </div>
      <div className="sidebar-actions">
        <button title="New note" onClick={createNote}><Icon name="note" size={14} /> Note</button>
        <button title="New database" onClick={createDatabase}><Icon name="database" size={14} /> Database</button>
        <button title="New canvas" onClick={createCanvas}><Icon name="canvas" size={14} /> Canvas</button>
      </div>
      <div className="sidebar-label"><span>Files</span><IconButton label="Search files" icon="search" onClick={() => setSearchOpen(true)} /></div>
      <div className="file-tree" role="tree" aria-label="Vault files">
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
      <div
        className="sidebar-resizer"
        role="separator"
        aria-label="Resize file sidebar"
        aria-orientation="vertical"
        aria-valuemin={190}
        aria-valuemax={420}
        aria-valuenow={Math.round(sidebar.width)}
        tabIndex={0}
        onPointerDown={beginResize}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const step = event.shiftKey ? 40 : 10;
          setSidebar("left", { width: Math.max(190, Math.min(420, sidebar.width + (event.key === "ArrowRight" ? step : -step))) });
        }}
      />
    </div>
  );
}

function TreeNode({ node, depth }: { node: FileNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const activeResourcePath = useStore((s) => {
    const pane = s.workspace.panes[s.workspace.focusedPaneId];
    return pane ? resourcePath(s.workspace.tabs[pane.activeTabId].view) : undefined;
  });
  const refreshTree = useStore((s) => s.refreshTree);
  const renameResource = useStore((s) => s.renameWorkspaceResource);
  const markMissing = useStore((s) => s.markWorkspaceResourceMissing);
  const openWorkspaceResource = useStore((s) => s.openWorkspaceResource);
  const [menuOpen, setMenuOpen] = useState(false);

  const moveTreeFocus = (current: HTMLElement, key: string) => {
    const tree = current.closest('[role="tree"]');
    const items = tree ? Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]')) : [];
    const index = items.indexOf(current);
    const target = key === "Home"
      ? items[0]
      : key === "End"
        ? items[items.length - 1]
        : items[index + (key === "ArrowUp" ? -1 : 1)];
    target?.focus();
  };

  if (node.is_dir) {
    return (
      <div>
        <div
          className="tree-item dir"
          style={{ paddingLeft: depth * 14 + 8 }}
          role="treeitem"
          aria-expanded={expanded}
          aria-level={depth + 1}
          tabIndex={0}
          onClick={() => setExpanded(!expanded)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") setExpanded(!expanded);
            else if (event.key === "ArrowRight") {
              if (!expanded) setExpanded(true);
              else (event.currentTarget.parentElement?.querySelector('[role="group"] [role="treeitem"]') as HTMLElement | null)?.focus();
            } else if (event.key === "ArrowLeft") {
              if (expanded) setExpanded(false);
              else {
                const parentGroup = event.currentTarget.parentElement?.parentElement;
                const parentItem = parentGroup?.parentElement?.querySelector<HTMLElement>(':scope > [role="treeitem"]');
                parentItem?.focus();
              }
            } else if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
              moveTreeFocus(event.currentTarget, event.key);
            } else return;
            event.preventDefault();
          }}
        >
          <span className="chevron">{expanded ? "▾" : "▸"}</span> {node.name}
        </div>
        {expanded && (
          <div role="group">
            {node.children?.map((c) => <TreeNode key={c.path} node={c} depth={depth + 1} />)}
          </div>
        )}
      </div>
    );
  }

  const view = resourceViewForPath(node.path);
  const kind = node.kind ?? view.type;
  const icon = kind === "note" ? "note" : kind === "database" ? "database" : kind === "canvas" ? "canvas" : "file";

  const onOpen = (event?: React.MouseEvent) => {
    if (kind === "note" || kind === "database" || kind === "canvas") {
      const modified = !!event && (event.metaKey || event.ctrlKey || event.button === 1);
      openWorkspaceResource(view, modified
        ? { newTab: true, activate: event?.shiftKey }
        : undefined);
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
      renameResource(node.path, to);
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
      await markMissing(node.path, "File was moved to trash");
      await refreshTree();
    } catch (e) {
      alert(`Delete failed: ${JSON.stringify(e)}`);
    }
  };

  return (
    <div
      className={`tree-item file ${activeResourcePath === node.path ? "active" : ""}`}
      style={{ paddingLeft: depth * 14 + 8 }}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={activeResourcePath === node.path}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      tabIndex={0}
      onClick={(event) => onOpen(event)}
      onAuxClick={(event) => {
        if (event.button === 1) onOpen(event);
      }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-mica-path", node.path);
        e.dataTransfer.effectAllowed = "link";
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        } else if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
          event.preventDefault();
          const row = event.currentTarget;
          setMenuOpen(true);
          requestAnimationFrame(() => row.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
        } else if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          moveTreeFocus(event.currentTarget, event.key);
        }
      }}
    >
      <span className="file-icon"><Icon name={icon} size={14} /></span> {node.name}
      {menuOpen && (
        <div className="context-menu" role="menu" aria-label={`Actions for ${node.name}`} onMouseLeave={() => setMenuOpen(false)}>
          <button role="menuitem" onClick={(e) => { e.stopPropagation(); onRename(); }}>Rename</button>
          <button
            role="menuitem"
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
          <button role="menuitem" onClick={(e) => { e.stopPropagation(); onDelete(); }}>Delete</button>
          <button
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
              api.vaultReveal(node.path).catch(() => {});
            }}
          >
            Reveal in Explorer
          </button>
          <button
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
              api.vaultOpenExternal(node.path).catch(() => {});
            }}
          >
            Open in external editor
          </button>
          <button
            role="menuitem"
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
