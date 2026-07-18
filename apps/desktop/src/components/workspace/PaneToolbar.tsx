import { useStore } from "../../store";
import type { PaneId } from "../../workspace";
import { isResourceView, selectCanGoBack, selectCanGoForward } from "../../workspace";
import { IconButton, Menu, MenuItem, MenuSeparator } from "../ui";

export default function PaneToolbar({ paneId }: { paneId: PaneId }) {
  const workspace = useStore((state) => state.workspace);
  const pane = workspace.panes[paneId];
  const tab = workspace.tabs[pane.activeTabId];
  const back = useStore((state) => state.workspaceGoBack);
  const forward = useStore((state) => state.workspaceGoForward);
  const toggleMode = useStore((state) => state.toggleTabSourceMode);
  const split = useStore((state) => state.splitWorkspacePane);
  const close = useStore((state) => state.closeWorkspaceTab);
  const closePane = useStore((state) => state.closeWorkspacePane);
  const linkTabs = useStore((state) => state.linkWorkspaceTabs);
  const unlinkTab = useStore((state) => state.unlinkWorkspaceTab);
  const moveToNewWindow = useStore((state) => state.moveWorkspaceTabToNewWindow);
  const linkCandidates = Object.values(workspace.tabs).filter((candidate) => candidate.id !== tab.id);

  return (
    <div className="workspace-pane-toolbar">
      <div className="workspace-pane-navigation">
        <IconButton label="Navigate back" icon="back" tooltip="Back (⌘⌥←)" disabled={!selectCanGoBack(workspace, tab.id)} onClick={async () => { await back(tab.id); }} />
        <IconButton label="Navigate forward" icon="forward" tooltip="Forward (⌘⌥→)" disabled={!selectCanGoForward(workspace, tab.id)} onClick={async () => { await forward(tab.id); }} />
      </div>
      <div className="workspace-pane-title" title={tab.title}>{tab.title}</div>
      <div className="workspace-pane-actions">
        <Menu
          align="end"
          trigger={<IconButton label={tab.linkGroupId ? "Linked tab options" : "Link tab"} icon="link" pressed={!!tab.linkGroupId} tooltip={tab.linkGroupId ? "Linked tab" : "Link with another tab"} />}
        >
          {tab.linkGroupId ? <MenuItem icon="link" onSelect={() => unlinkTab(tab.id)}>Unlink tab</MenuItem> : null}
          {tab.linkGroupId ? <MenuSeparator /> : null}
          {linkCandidates.map((candidate) => (
            <MenuItem
              key={candidate.id}
              icon="link"
              checked={!!tab.linkGroupId && candidate.linkGroupId === tab.linkGroupId}
              onSelect={async () => { await linkTabs(tab.id, candidate.id); }}
            >
              Link with {candidate.title}
            </MenuItem>
          ))}
          {linkCandidates.length === 0 ? <MenuItem disabled>No other open tabs</MenuItem> : null}
        </Menu>
        {tab.view.type === "note" ? (
          <IconButton
            label={tab.view.mode === "source" ? "Switch to rich editor" : "Switch to source editor"}
            icon={tab.view.mode === "source" ? "edit" : "code"}
            pressed={tab.view.mode === "source"}
            tooltip={tab.view.mode === "source" ? "Rich editor (⌘E)" : "Source editor (⌘E)"}
            onClick={async () => { await toggleMode(tab.id); }}
          />
        ) : null}
        <Menu align="end" trigger={<IconButton label="Pane options" icon="moreHorizontal" tooltip={false} />}>
          <MenuItem icon="splitRight" onSelect={async () => { await split(paneId, { direction: "row" }); }}>Split right</MenuItem>
          <MenuItem icon="splitDown" onSelect={async () => { await split(paneId, { direction: "column" }); }}>Split down</MenuItem>
          <MenuItem disabled={!isResourceView(tab.view)} onSelect={async () => { await moveToNewWindow(tab.id); }}>Move tab to new window</MenuItem>
          <MenuSeparator />
          <MenuItem icon="close" onSelect={async () => { await close(tab.id); }}>Close tab</MenuItem>
          <MenuItem destructive onSelect={async () => { await closePane(paneId); }}>Close pane</MenuItem>
        </Menu>
      </div>
    </div>
  );
}
