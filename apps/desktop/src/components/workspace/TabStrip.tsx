import { memo, useRef, useState } from "react";
import { useStore } from "../../store";
import type { PaneId, TabId, WorkspaceTab, WorkspaceView } from "../../workspace";
import { Icon, IconButton, Menu, MenuItem, MenuLabel, MenuSeparator } from "../ui";
import { isResourceView, resourcePath } from "../../workspace";
import { useDocumentSnapshot } from "../../documents";

function TabStrip({ paneId }: { paneId: PaneId }) {
  const pane = useStore((state) => state.workspace.panes[paneId]);
  const tabMap = useStore((state) => state.workspace.tabs);
  const tabs = pane.tabIds.map((id) => tabMap[id]);
  const activate = useStore((state) => state.activateWorkspaceTab);
  const createTab = useStore((state) => state.createWorkspaceTab);
  const moveTab = useStore((state) => state.moveWorkspaceTab);
  const reorderTab = useStore((state) => state.reorderWorkspaceTab);
  const panes = useStore((state) => state.workspace.panes);
  const tabRefs = useRef(new Map<TabId, HTMLButtonElement>());

  const activateRelative = (tabId: TabId, target: number | "first" | "last") => {
    const index = pane.tabIds.indexOf(tabId);
    const next = target === "first"
      ? pane.tabIds[0]
      : target === "last"
        ? pane.tabIds[pane.tabIds.length - 1]
        : pane.tabIds[(index + target + pane.tabIds.length) % pane.tabIds.length];
    activate(paneId, next);
    tabRefs.current.get(next)?.focus();
  };

  return (
    <div
      className="workspace-tab-strip"
      role="tablist"
      aria-label="Open tabs"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("application/x-mica-tab")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={async (event) => {
        const tabId = event.dataTransfer.getData("application/x-mica-tab");
        if (tabId) {
          event.preventDefault();
          await moveTab(tabId, paneId, pane.tabIds.length);
        }
      }}
    >
      <div className="workspace-tab-scroll">
        {tabs.map((tab, index) => (
          <WorkspaceTabButton
            key={tab.id}
            tab={tab}
            paneId={paneId}
            active={tab.id === pane.activeTabId}
            setRef={(node) => node ? tabRefs.current.set(tab.id, node) : tabRefs.current.delete(tab.id)}
            onActivate={() => activate(paneId, tab.id)}
            onMoveFocus={(delta) => activateRelative(tab.id, delta)}
            onDropTab={(dragged) => moveTab(dragged, paneId, index)}
            onReorder={(target) => reorderTab(paneId, tab.id, target)}
            index={index}
            tabCount={tabs.length}
            paneIds={Object.keys(panes)}
            onMoveToPane={async (targetPaneId) => {
              if (await moveTab(tab.id, targetPaneId)) {
                requestAnimationFrame(() => document.getElementById(`workspace-tab-${tab.id}`)?.focus());
              }
            }}
          />
        ))}
      </div>
      <IconButton
        className="workspace-new-tab"
        label="New tab"
        icon="plus"
        tooltip="New tab (⌘T)"
        onClick={() => createTab(paneId)}
      />
      <PaneTabsMenu paneId={paneId} tabs={tabs} activeTabId={pane.activeTabId} />
    </div>
  );
}

export default memo(TabStrip);

function WorkspaceTabButton({
  tab,
  paneId,
  active,
  setRef,
  onActivate,
  onMoveFocus,
  onDropTab,
  onReorder,
  index,
  tabCount,
  paneIds,
  onMoveToPane,
}: {
  tab: WorkspaceTab;
  paneId: PaneId;
  active: boolean;
  setRef: (node: HTMLButtonElement | null) => void;
  onActivate: () => void;
  onMoveFocus: (target: number | "first" | "last") => void;
  onDropTab: (tabId: TabId) => Promise<boolean>;
  onReorder: (index: number) => void;
  index: number;
  tabCount: number;
  paneIds: PaneId[];
  onMoveToPane: (paneId: PaneId) => Promise<void>;
}) {
  const close = useStore((state) => state.closeWorkspaceTab);
  const pin = useStore((state) => state.pinWorkspaceTab);
  const split = useStore((state) => state.splitWorkspacePane);
  const closeOthers = useStore((state) => state.closeWorkspaceOtherTabs);
  const closeRight = useStore((state) => state.closeWorkspaceTabsToRight);
  const closeAll = useStore((state) => state.closeWorkspaceAllTabs);
  const reopenClosed = useStore((state) => state.reopenLastClosedWorkspaceTab);
  const tabMap = useStore((state) => state.workspace.tabs);
  const linkTabs = useStore((state) => state.linkWorkspaceTabs);
  const unlinkTab = useStore((state) => state.unlinkWorkspaceTab);
  const moveToNewWindow = useStore((state) => state.moveWorkspaceTabToNewWindow);
  const [menuOpen, setMenuOpen] = useState(false);
  const icon = iconForView(tab.view);
  const docSnapshot = useDocumentSnapshot(tab.view.type === "note" ? resourcePath(tab.view) : undefined);

  return (
    <div
      className={`workspace-tab ${active ? "active" : ""} ${tab.pinned ? "pinned" : ""}`}
      draggable
      data-tab-id={tab.id}
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-mica-tab", tab.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("application/x-mica-tab")) event.preventDefault();
      }}
      onDrop={async (event) => {
        const dragged = event.dataTransfer.getData("application/x-mica-tab");
        if (dragged) {
          event.preventDefault();
          event.stopPropagation();
          await onDropTab(dragged);
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onActivate();
        setMenuOpen(true);
      }}
    >
      <button
        ref={setRef}
        type="button"
        id={`workspace-tab-${tab.id}`}
        className="workspace-tab-target"
        role="tab"
        aria-selected={active}
        aria-controls={`workspace-tabpanel-${tab.id}`}
        tabIndex={active ? 0 : -1}
        title={tab.title}
        onClick={onActivate}
        onDoubleClick={() => pin(tab.id, !tab.pinned)}
        onAuxClick={(event) => {
          if (event.button === 1) void close(tab.id);
        }}
        onKeyDown={(event) => {
          const reorderModifier = (event.metaKey || event.ctrlKey) && event.shiftKey;
          const paneModifier = event.altKey && event.shiftKey;
          if (reorderModifier && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
            event.preventDefault();
            onReorder(index + (event.key === "ArrowLeft" ? -1 : 1));
            requestAnimationFrame(() => document.getElementById(`workspace-tab-${tab.id}`)?.focus());
            return;
          }
          if (paneModifier && (event.key === "ArrowLeft" || event.key === "ArrowRight") && paneIds.length > 1) {
            event.preventDefault();
            const current = paneIds.indexOf(paneId);
            const delta = event.key === "ArrowLeft" ? -1 : 1;
            onMoveToPane(paneIds[(current + delta + paneIds.length) % paneIds.length]);
            return;
          }
          if (event.key === "ArrowRight") onMoveFocus(1);
          else if (event.key === "ArrowLeft") onMoveFocus(-1);
          else if (event.key === "Home") onMoveFocus("first");
          else if (event.key === "End") onMoveFocus("last");
          else return;
          event.preventDefault();
        }}
      >
        <Icon name={icon} size={15} />
        <span className="workspace-tab-title">{tab.title}</span>
        {tab.linkGroupId ? <Icon className="workspace-tab-link" name="link" size={12} title="Linked tab" /> : null}
        {docSnapshot?.saveError ? <Icon className="workspace-tab-error" name="warning" size={12} title="Save failed" /> : null}
        {!docSnapshot?.saveError && docSnapshot?.dirty ? <span className="workspace-tab-dirty" title="Unsaved changes" aria-label="Unsaved changes" /> : null}
        {tab.pinned ? <Icon className="workspace-tab-pin" name="pin" size={12} /> : null}
      </button>
      <button
        type="button"
        className="workspace-tab-close"
        aria-label={`Close ${tab.title}`}
        title={`Close ${tab.title}`}
        onClick={async (event) => {
          event.stopPropagation();
          await close(tab.id);
        }}
      >
        <Icon name="close" size={13} />
      </button>
      <Menu
        className="workspace-tab-menu"
        align="end"
        open={menuOpen}
        onOpenChange={setMenuOpen}
        trigger={<IconButton label={`Actions for ${tab.title}`} icon="moreHorizontal" tooltip={false} />}
      >
        <MenuItem icon={tab.pinned ? "pinOff" : "pin"} onSelect={() => pin(tab.id, !tab.pinned)}>
          {tab.pinned ? "Unpin" : "Pin"}
        </MenuItem>
        <MenuSeparator />
        <MenuItem disabled={index === 0} shortcut="⌘⇧←" onSelect={() => onReorder(index - 1)}>Move tab left</MenuItem>
        <MenuItem disabled={index === tabCount - 1} shortcut="⌘⇧→" onSelect={() => onReorder(index + 1)}>Move tab right</MenuItem>
        {paneIds.length > 1 ? <MenuLabel>Move to pane</MenuLabel> : null}
        {paneIds.filter((id) => id !== paneId).map((id) => (
          <MenuItem key={id} onSelect={() => onMoveToPane(id)}>
            Pane {paneIds.indexOf(id) + 1}
          </MenuItem>
        ))}
        <MenuItem
          disabled={!isResourceView(tab.view)}
          onSelect={async () => { await moveToNewWindow(tab.id); }}
        >
          Move to new window
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon="splitRight" onSelect={() => split(paneId, { direction: "row", tabId: tab.id, before: true })}>Split left</MenuItem>
        <MenuItem icon="splitRight" onSelect={() => split(paneId, { direction: "row", tabId: tab.id })}>Split right</MenuItem>
        <MenuItem icon="splitDown" onSelect={() => split(paneId, { direction: "column", tabId: tab.id, before: true })}>Split up</MenuItem>
        <MenuItem icon="splitDown" onSelect={() => split(paneId, { direction: "column", tabId: tab.id })}>Split down</MenuItem>
        <MenuSeparator />
        {tab.linkGroupId ? (
          <MenuItem icon="link" onSelect={() => unlinkTab(tab.id)}>Unlink tab</MenuItem>
        ) : null}
        <MenuLabel>Link with tab</MenuLabel>
        {Object.values(tabMap).filter((candidate) => candidate.id !== tab.id).map((candidate) => (
          <MenuItem
            key={candidate.id}
            icon="link"
            checked={!!tab.linkGroupId && candidate.linkGroupId === tab.linkGroupId}
            onSelect={() => linkTabs(tab.id, candidate.id)}
          >
            {candidate.title}
          </MenuItem>
        ))}
        {Object.keys(tabMap).length === 1 ? <MenuItem disabled>No other open tabs</MenuItem> : null}
        <MenuSeparator />
        <MenuItem
          disabled={useStore.getState().workspace.closedTabs.length === 0}
          shortcut="⌘⇧T"
          onSelect={reopenClosed}
        >Reopen closed tab</MenuItem>
        <MenuSeparator />
        <MenuItem icon="close" onSelect={() => close(tab.id)}>Close</MenuItem>
        <MenuItem onSelect={() => closeOthers(paneId, tab.id)}>Close others</MenuItem>
        <MenuItem onSelect={() => closeRight(paneId, tab.id)}>Close tabs to the right</MenuItem>
        <MenuItem onSelect={() => closeAll(paneId)}>Close all</MenuItem>
      </Menu>
    </div>
  );
}

function PaneTabsMenu({ paneId, tabs, activeTabId }: { paneId: PaneId; tabs: WorkspaceTab[]; activeTabId: TabId }) {
  const activate = useStore((state) => state.activateWorkspaceTab);
  const closeAll = useStore((state) => state.closeWorkspaceAllTabs);
  const split = useStore((state) => state.splitWorkspacePane);
  const closePane = useStore((state) => state.closeWorkspacePane);
  const reopenClosed = useStore((state) => state.reopenLastClosedWorkspaceTab);
  const setStacked = useStore((state) => state.setWorkspacePaneStackedTabs);
  const stacked = useStore((state) => state.workspace.panes[paneId].stackedTabs);
  const canReopen = useStore((state) => state.workspace.closedTabs.length > 0);
  return (
    <Menu
      align="end"
      trigger={<IconButton className="workspace-tabs-menu-button" label="Tab group options" icon="chevronDown" tooltip={false} />}
    >
      {tabs.map((tab) => (
        <MenuItem key={tab.id} icon={iconForView(tab.view)} checked={tab.id === activeTabId} onSelect={() => activate(paneId, tab.id)}>
          {tab.title}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem checked={stacked} onSelect={() => setStacked(paneId, !stacked)}>Stack tabs</MenuItem>
      <MenuItem disabled={!canReopen} shortcut="⌘⇧T" onSelect={reopenClosed}>Reopen closed tab</MenuItem>
      <MenuSeparator />
      <MenuItem icon="splitRight" onSelect={() => split(paneId, { direction: "row" })}>Split right</MenuItem>
      <MenuItem icon="splitDown" onSelect={() => split(paneId, { direction: "column" })}>Split down</MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={() => closeAll(paneId)}>Close all tabs</MenuItem>
      <MenuItem destructive onSelect={() => closePane(paneId)}>Close pane</MenuItem>
    </Menu>
  );
}

export function iconForView(view: WorkspaceView): "note" | "database" | "canvas" | "graph" | "warning" | "file" {
  if (view.type === "note") return "note";
  if (view.type === "database") return "database";
  if (view.type === "canvas") return "canvas";
  if (view.type === "graph") return "graph";
  if (view.type === "missing") return "warning";
  return "file";
}
