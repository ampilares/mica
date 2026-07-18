import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../../../store";
import { createWorkspace, selectActiveTab, withCanvasLocation } from "../../../workspace";
import ViewHost from "../ViewHost";

vi.mock("../../NoteEditor", () => ({
  default: ({ path }: { path: string }) => <div className="editor-scroll">Rich note: {path}</div>,
}));
vi.mock("../../SourceEditor", () => ({
  default: ({ path }: { path: string }) => <div className="source-editor-host">Source note: {path}</div>,
}));
vi.mock("../../DatabaseView", () => ({
  default: ({ path }: { path: string }) => <div className="db-table-wrap">Database: {path}</div>,
}));
vi.mock("../../CanvasView", () => ({
  default: ({
    path,
    location,
    onLocationChange,
  }: {
    path: string;
    location?: { viewport: { x: number; y: number; zoom: number }; selectedIds: string[] };
    onLocationChange: (viewport: { x: number; y: number; zoom: number }, selectedIds: string[]) => void;
  }) => (
    <button onClick={() => onLocationChange({ x: 40, y: 60, zoom: 1.5 }, ["shape-2"])}>
      Canvas: {path}; x={location?.viewport.x ?? "none"}; selected={location?.selectedIds.join(",") ?? "none"}
    </button>
  ),
}));
vi.mock("../../GraphPanel", () => ({
  GraphWorkspaceView: () => <div>Graph</div>,
}));

function ActiveViewHost() {
  const workspace = useStore((state) => state.workspace);
  const pane = workspace.panes[workspace.focusedPaneId];
  const tab = workspace.tabs[pane.activeTabId];
  return <ViewHost paneId={pane.id} tabId={tab.id} view={tab.view} active />;
}

describe("ViewHost history locations", () => {
  beforeEach(() => useStore.getState().replaceWorkspace(createWorkspace()));

  it("captures and restores a database scroll container across history", async () => {
    const workspace = createWorkspace({ view: { type: "database", path: "Projects.database.json" } });
    useStore.getState().replaceWorkspace(workspace);
    render(<ActiveViewHost />);

    const container = screen.getByText(/Database:/);
    Object.defineProperty(container, "scrollTop", { configurable: true, writable: true, value: 175 });
    Object.defineProperty(container, "scrollLeft", { configurable: true, writable: true, value: 25 });
    fireEvent.scroll(container);

    const tabId = selectActiveTab(useStore.getState().workspace)!.id;
    expect(useStore.getState().workspace.tabs[tabId].history[0].location).toEqual({
      scroll: { "database-table": { top: 175, left: 25 } },
    });

    useStore.getState().navigateWorkspaceTab(tabId, { type: "note", path: "Other.md", mode: "rich" });
    useStore.getState().workspaceGoBack(tabId);
    await waitFor(() => {
      expect(screen.getByText(/Database:/).scrollTop).toBe(175);
      expect(screen.getByText(/Database:/).scrollLeft).toBe(25);
    });
  });

  it("feeds a canvas checkpoint back into the restored history entry", async () => {
    const workspace = createWorkspace({ view: { type: "canvas", path: "Board.drawio" } });
    const tabId = selectActiveTab(workspace)!.id;
    useStore.getState().replaceWorkspace(workspace);
    useStore.getState().updateCurrentWorkspaceHistoryLocation(
      tabId,
      withCanvasLocation(undefined, { x: 10, y: 20, zoom: 1.2 }, ["shape-1"]),
    );
    render(<ActiveViewHost />);

    expect(screen.getByRole("button").textContent).toContain("x=10; selected=shape-1");
    fireEvent.click(screen.getByRole("button"));
    expect(useStore.getState().workspace.tabs[tabId].history[0].location).toEqual(
      withCanvasLocation(undefined, { x: 40, y: 60, zoom: 1.5 }, ["shape-2"]),
    );

    useStore.getState().navigateWorkspaceTab(tabId, { type: "note", path: "Other.md", mode: "rich" });
    useStore.getState().workspaceGoBack(tabId);
    await waitFor(() => expect(screen.getByRole("button").textContent).toContain("x=40; selected=shape-2"));
  });
});
