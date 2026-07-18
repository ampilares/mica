import { memo, useState } from "react";
import { useStore } from "../../store";
import type { PaneId, ResourceView } from "../../workspace";
import PaneToolbar from "./PaneToolbar";
import TabStrip from "./TabStrip";
import ViewHost from "./ViewHost";

function PaneGroup({ paneId }: { paneId: PaneId }) {
  const pane = useStore((state) => state.workspace.panes[paneId]);
  const tabs = useStore((state) => state.workspace.tabs);
  const focused = useStore((state) => state.workspace.focusedPaneId === paneId);
  const focusPane = useStore((state) => state.activateWorkspacePane);
  const moveTab = useStore((state) => state.moveWorkspaceTab);
  const dockTab = useStore((state) => state.dockWorkspaceTab);
  const openResource = useStore((state) => state.openWorkspaceResource);
  const [draggingOver, setDraggingOver] = useState(false);

  const acceptsWorkspaceDrop = (types: readonly string[]) =>
    types.includes("application/x-mica-tab") || types.includes("application/x-mica-path");

  const openDroppedResource = async (
    path: string,
    edge?: "left" | "right" | "up" | "down",
  ) => {
    const view = resourceViewForPath(path);
    if (!view) return false;
    const opened = await openResource(view, { paneId, newTab: true, activate: true });
    if (!opened) return false;
    if (edge) {
      const tabId = useStore.getState().workspace.panes[paneId]?.activeTabId;
      if (tabId) return dockTab(tabId, paneId, edge);
    }
    return true;
  };

  return (
    <section
      className={`workspace-pane ${focused ? "focused" : ""} ${pane.stackedTabs ? "stacked-tabs" : ""} ${draggingOver ? "drag-target" : ""}`}
      data-pane-id={paneId}
      aria-label={`Pane ${paneId.replace("pane_", "")}`}
      onPointerDownCapture={() => {
        if (!focused) focusPane(paneId);
      }}
      onDragEnter={(event) => {
        if (acceptsWorkspaceDrop(event.dataTransfer.types)) setDraggingOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingOver(false);
      }}
      onDragOver={(event) => {
        if (acceptsWorkspaceDrop(event.dataTransfer.types)) event.preventDefault();
      }}
      onDrop={async (event) => {
        setDraggingOver(false);
        const tabId = event.dataTransfer.getData("application/x-mica-tab");
        const path = event.dataTransfer.getData("application/x-mica-path");
        if (tabId) {
          event.preventDefault();
          await moveTab(tabId, paneId);
        } else if (path) {
          event.preventDefault();
          await openDroppedResource(path);
        }
      }}
    >
      <TabStrip paneId={paneId} />
      <PaneToolbar paneId={paneId} />
      <div className="workspace-pane-content">
        {pane.tabIds.map((tabId) => {
          const active = tabId === pane.activeTabId;
          return (
            <div key={tabId} className={`workspace-stack-leaf ${active ? "active" : ""}`}>
              {pane.stackedTabs && !active ? (
                <button
                  type="button"
                  className="workspace-stack-tab"
                  aria-label={`Activate ${tabs[tabId].title}`}
                  title={tabs[tabId].title}
                  onClick={() => {
                    focusPane(paneId);
                    useStore.getState().activateWorkspaceTab(paneId, tabId);
                  }}
                >
                  <span>{tabs[tabId].title}</span>
                </button>
              ) : null}
              <ViewHost
                paneId={paneId}
                tabId={tabId}
                view={tabs[tabId].view}
                active={active}
              />
            </div>
          );
        })}
      </div>
      {draggingOver ? (
        <div className="workspace-drop-zones" aria-hidden="true">
          {(["left", "right", "up", "down"] as const).map((edge) => (
            <div
              key={edge}
              className={`workspace-drop-zone drop-${edge}`}
              data-drop-edge={edge}
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={async (event) => {
                const tabId = event.dataTransfer.getData("application/x-mica-tab");
                const path = event.dataTransfer.getData("application/x-mica-path");
                if (!tabId && !path) return;
                event.preventDefault();
                event.stopPropagation();
                setDraggingOver(false);
                if (tabId) await dockTab(tabId, paneId, edge);
                else await openDroppedResource(path, edge);
              }}
            />
          ))}
          <div
            className="workspace-drop-zone drop-center"
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={async (event) => {
              const tabId = event.dataTransfer.getData("application/x-mica-tab");
              const path = event.dataTransfer.getData("application/x-mica-path");
              if (!tabId && !path) return;
              event.preventDefault();
              event.stopPropagation();
              setDraggingOver(false);
              if (tabId) await moveTab(tabId, paneId);
              else await openDroppedResource(path);
            }}
          />
        </div>
      ) : null}
    </section>
  );
}

export default memo(PaneGroup);

export function resourceViewForPath(path: string): ResourceView | null {
  if (path.endsWith(".database.json")) return { type: "database", path };
  if (path.endsWith(".drawio")) return { type: "canvas", path };
  if (path.endsWith(".md")) return { type: "note", path, mode: "rich" };
  return null;
}
