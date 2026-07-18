import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../../../store";
import { createWorkspace } from "../../../workspace";
import WorkspaceRoot from "../WorkspaceRoot";
import { resetDocumentSessions } from "../../../documents";

vi.mock("../../NoteEditor", () => ({
  default: ({ path }: { path: string }) => <div>Rich note: {path}</div>,
}));
vi.mock("../../SourceEditor", () => ({
  default: ({ path }: { path: string }) => <div>Source note: {path}</div>,
}));
vi.mock("../../DatabaseView", () => ({
  default: ({ path }: { path: string }) => <div>Database: {path}</div>,
}));
vi.mock("../../CanvasView", () => ({
  default: ({ path }: { path: string }) => <div>Canvas: {path}</div>,
}));
vi.mock("../../GraphPanel", () => ({
  GraphWorkspaceView: () => <div>Graph</div>,
}));

async function resetWorkspace() {
  await resetDocumentSessions({ discard: true });
  useStore.getState().replaceWorkspace(createWorkspace());
}

function currentPane() {
  const workspace = useStore.getState().workspace;
  return workspace.panes[workspace.focusedPaneId];
}

describe("WorkspaceRoot", () => {
  beforeEach(resetWorkspace);

  it("renders a usable empty pane and creates a new active tab", async () => {
    const user = userEvent.setup();
    render(<WorkspaceRoot />);

    expect(screen.getByRole("main", { name: "Workspace" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "New tab" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Open a file/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Create new note/ })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "New tab" }));

    const tabs = screen.getAllByRole("tab", { name: "New tab" });
    expect(tabs).toHaveLength(2);
    expect(tabs[0].getAttribute("aria-selected")).toBe("false");
    expect(tabs[0].getAttribute("tabindex")).toBe("-1");
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(tabs[1].getAttribute("tabindex")).toBe("0");
    expect(currentPane().tabIds).toHaveLength(2);
    expect(currentPane().activeTabId).toBe(currentPane().tabIds[1]);
  });

  it("implements the ARIA tab pattern and roving keyboard activation", async () => {
    const firstWorkspace = createWorkspace({
      view: { type: "note", path: "Alpha.md", mode: "rich" },
      title: "Alpha",
    });
    useStore.getState().replaceWorkspace(firstWorkspace);
    useStore.getState().createWorkspaceTab(undefined, {
      type: "note",
      path: "Beta.md",
      mode: "rich",
    }, { title: "Beta" });
    const user = userEvent.setup();
    render(<WorkspaceRoot />);

    const tablist = screen.getByRole("tablist", { name: "Open tabs" });
    const alpha = within(tablist).getByRole("tab", { name: "Alpha" });
    const beta = within(tablist).getByRole("tab", { name: "Beta" });
    expect(beta.getAttribute("aria-selected")).toBe("true");
    expect(beta.getAttribute("aria-controls")).toBe(screen.getByRole("tabpanel").id);
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(beta.id);

    beta.focus();
    await user.keyboard("{ArrowLeft}");

    expect(document.activeElement).toBe(alpha);
    expect(alpha.getAttribute("aria-selected")).toBe("true");
    expect(beta.getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tabpanel").textContent).toContain("Rich note: Alpha.md");
  });

  it("reorders and moves the focused tab with tab-local keyboard commands", async () => {
    const workspace = createWorkspace({
      view: { type: "note", path: "Alpha.md", mode: "rich" },
      title: "Alpha",
    });
    useStore.getState().replaceWorkspace(workspace);
    useStore.getState().createWorkspaceTab(workspace.focusedPaneId, {
      type: "note", path: "Beta.md", mode: "rich",
    }, { title: "Beta" });
    const user = userEvent.setup();
    render(<WorkspaceRoot />);

    const beta = screen.getByRole("tab", { name: "Beta" });
    beta.focus();
    await user.keyboard("{Meta>}{Shift>}{ArrowLeft}{/Shift}{/Meta}");
    expect(currentPane().tabIds.map((id) => useStore.getState().workspace.tabs[id].title)).toEqual(["Beta", "Alpha"]);
    expect(document.activeElement).toBe(beta);

    const alphaId = currentPane().tabIds.find((id) => useStore.getState().workspace.tabs[id].title === "Alpha")!;
    await act(async () => {
      useStore.getState().activateWorkspaceTab(workspace.focusedPaneId, alphaId);
      await useStore.getState().splitWorkspacePane(workspace.focusedPaneId, { direction: "row", tabId: alphaId });
    });
    const panesBefore = Object.values(useStore.getState().workspace.panes);
    const betaPane = panesBefore.find((pane) => pane.tabIds.some((id) => useStore.getState().workspace.tabs[id].title === "Beta"))!;
    act(() => useStore.getState().activateWorkspaceTab(betaPane.id, betaPane.tabIds.find((id) => useStore.getState().workspace.tabs[id].title === "Beta")!));
    const focusedBeta = screen.getByRole("tab", { name: "Beta" });
    focusedBeta.focus();
    await user.keyboard("{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}");
    const betaId = Object.values(useStore.getState().workspace.tabs).find((tab) => tab.title === "Beta")!.id;
    await waitFor(() => expect(useStore.getState().workspace.focusedPaneId).not.toBe(betaPane.id));
    expect(useStore.getState().workspace.panes[useStore.getState().workspace.focusedPaneId].tabIds).toContain(betaId);
  });

  it("activates and closes tabs only within their pane", async () => {
    const workspace = createWorkspace({
      view: { type: "note", path: "Alpha.md", mode: "rich" },
      title: "Alpha",
    });
    useStore.getState().replaceWorkspace(workspace);
    const paneId = workspace.focusedPaneId;
    useStore.getState().createWorkspaceTab(paneId, {
      type: "note",
      path: "Beta.md",
      mode: "rich",
    }, { title: "Beta" });
    const user = userEvent.setup();
    render(<WorkspaceRoot />);

    await user.click(screen.getByRole("tab", { name: "Alpha" }));
    expect(useStore.getState().workspace.panes[paneId].activeTabId)
      .toBe(useStore.getState().workspace.panes[paneId].tabIds[0]);

    await user.click(screen.getByRole("button", { name: "Close Alpha" }));

    await waitFor(() => expect(useStore.getState().workspace.panes[paneId].tabIds).toHaveLength(1));
    const pane = useStore.getState().workspace.panes[paneId];
    expect(pane.tabIds).toHaveLength(1);
    expect(useStore.getState().workspace.tabs[pane.activeTabId].title).toBe("Beta");
    expect(screen.queryByRole("tab", { name: "Alpha" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Beta" }).getAttribute("aria-selected")).toBe("true");
  });

  it("reopens a closed tab and toggles the pane's stacked tab layout from the menu", async () => {
    const workspace = createWorkspace({
      view: { type: "note", path: "Alpha.md", mode: "rich" },
      title: "Alpha",
    });
    useStore.getState().replaceWorkspace(workspace);
    useStore.getState().createWorkspaceTab(workspace.focusedPaneId, {
      type: "note", path: "Beta.md", mode: "rich",
    }, { title: "Beta" });
    const user = userEvent.setup();
    const { container } = render(<WorkspaceRoot />);

    await user.click(screen.getByRole("button", { name: "Close Beta" }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Beta" })).toBeNull());

    await user.click(screen.getByRole("button", { name: "Tab group options" }));
    await user.click(screen.getByRole("menuitem", { name: "Reopen closed tab" }));
    expect(screen.getByRole("tab", { name: "Beta" }).getAttribute("aria-selected")).toBe("true");

    await user.click(screen.getByRole("button", { name: "Tab group options" }));
    const stackTabs = screen.getByRole("menuitemcheckbox", { name: "Stack tabs" });
    expect(stackTabs.getAttribute("aria-checked")).toBe("false");
    await user.click(stackTabs);

    expect(useStore.getState().workspace.panes[workspace.focusedPaneId].stackedTabs).toBe(true);
    expect(container.querySelector(`[data-pane-id="${workspace.focusedPaneId}"]`)?.classList.contains("stacked-tabs")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Activate Alpha" }));
    expect(screen.getByRole("tab", { name: "Alpha" }).getAttribute("aria-selected")).toBe("true");
  });

  it("links and unlinks the active tab through the accessible toolbar menu", async () => {
    const workspace = createWorkspace({
      view: { type: "note", path: "Alpha.md", mode: "rich" },
      title: "Alpha",
    });
    useStore.getState().replaceWorkspace(workspace);
    const alphaId = workspace.panes[workspace.focusedPaneId].activeTabId;
    useStore.getState().createWorkspaceTab(workspace.focusedPaneId, {
      type: "note", path: "Beta.md", mode: "rich",
    }, { title: "Beta" });
    const betaId = useStore.getState().workspace.panes[workspace.focusedPaneId].activeTabId;
    const user = userEvent.setup();
    render(<WorkspaceRoot />);

    await user.click(screen.getByRole("button", { name: "Link tab" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Link with Alpha" }));
    await waitFor(() => expect(useStore.getState().workspace.tabs[betaId].linkGroupId).toBeTruthy());
    expect(useStore.getState().workspace.tabs[alphaId].linkGroupId)
      .toBe(useStore.getState().workspace.tabs[betaId].linkGroupId);
    expect(useStore.getState().workspace.tabs[alphaId].view).toMatchObject({ path: "Beta.md" });

    await user.click(screen.getByRole("button", { name: "Linked tab options" }));
    await user.click(screen.getByRole("menuitem", { name: "Unlink tab" }));
    expect(useStore.getState().workspace.tabs[alphaId].linkGroupId).toBeUndefined();
    expect(useStore.getState().workspace.tabs[betaId].linkGroupId).toBeUndefined();
  });

  it("shows pane navigation and toggles a note between rich and source mode", async () => {
    const workspace = createWorkspace({
      view: { type: "note", path: "Guide.md", mode: "rich" },
      title: "Guide",
    });
    useStore.getState().replaceWorkspace(workspace);
    const moveToNewWindow = vi
      .spyOn(useStore.getState(), "moveWorkspaceTabToNewWindow")
      .mockResolvedValue(false);
    const user = userEvent.setup();
    render(<WorkspaceRoot />);

    await user.click(screen.getByRole("button", { name: "Actions for Guide" }));
    await user.click(screen.getByRole("menuitem", { name: "Move to new window" }));
    expect(moveToNewWindow).toHaveBeenCalledWith(currentPane().activeTabId);
    moveToNewWindow.mockRestore();

    expect(screen.getByRole("button", { name: "Navigate back" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Navigate forward" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Rich note: Guide.md")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Switch to source editor" }));

    await waitFor(() => expect(useStore.getState().workspace.tabs[currentPane().activeTabId].view).toMatchObject({ mode: "source" }));
    const tab = useStore.getState().workspace.tabs[currentPane().activeTabId];
    expect(tab.view).toEqual({ type: "note", path: "Guide.md", mode: "source" });
    expect(screen.getByText("Source note: Guide.md")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Switch to rich editor" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("splits right from the tab-group menu and splits down through the store action", async () => {
    const user = userEvent.setup();
    render(<WorkspaceRoot />);

    await user.click(screen.getByRole("button", { name: "Tab group options" }));
    await user.click(screen.getByRole("menuitem", { name: "Split right" }));

    expect(Object.keys(useStore.getState().workspace.panes)).toHaveLength(2);
    expect(screen.getAllByRole("tablist", { name: "Open tabs" })).toHaveLength(2);
    const horizontal = screen.getByRole("separator", { name: "Resize panes horizontally" });
    expect(horizontal.getAttribute("aria-orientation")).toBe("vertical");

    const focusedPaneId = useStore.getState().workspace.focusedPaneId;
    await act(async () => { await useStore.getState().splitWorkspacePane(focusedPaneId, { direction: "column" }); });

    expect(Object.keys(useStore.getState().workspace.panes)).toHaveLength(3);
    const vertical = screen.getByRole("separator", { name: "Resize panes vertically" });
    expect(vertical.getAttribute("aria-orientation")).toBe("horizontal");
  });

  it("resizes a split with arrow keys and exposes the current ratio", async () => {
    const paneId = useStore.getState().workspace.focusedPaneId;
    await act(async () => { await useStore.getState().splitWorkspacePane(paneId, { direction: "row" }); });
    const user = userEvent.setup();
    render(<WorkspaceRoot />);
    const splitter = screen.getByRole("separator", { name: "Resize panes horizontally" });

    expect(splitter.getAttribute("aria-valuenow")).toBe("50");
    splitter.focus();
    await user.keyboard("{ArrowRight}");
    expect(splitter.getAttribute("aria-valuenow")).toBe("53");

    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(splitter.getAttribute("aria-valuenow")).toBe("43");
    expect(document.activeElement).toBe(splitter);
  });
});
