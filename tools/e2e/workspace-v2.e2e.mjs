// Workspace v2 E2E: drives the real Tauri WebView through the dev-only store
// hook, then checks both the workspace domain state and its rendered DOM.
// Requires a running dev app with WebView2 remote debugging on port 9223.

const VAULT =
  process.env.MICA_E2E_VAULT ??
  `${process.env.USERPROFILE?.replace(/\\/g, "/")}/Documents/mica-test-vault`;

const pages = await (await fetch("http://127.0.0.1:9223/json")).json();
const page = pages.find((candidate) => candidate.type === "page");
if (!page?.webSocketDebuggerUrl) {
  throw new Error("No debuggable Mica WebView found on CDP port 9223");
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let messageId = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
};

const send = (method, params) => new Promise((resolve) => {
  const id = ++messageId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});

async function evalJs(expression) {
  const response = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.result?.exceptionDetails) {
    throw new Error(JSON.stringify(response.result.exceptionDetails));
  }
  if (response.result?.result?.subtype === "error") {
    throw new Error(response.result.result.description);
  }
  return response.result?.result?.value;
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(expression, timeout = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await evalJs(expression);
    if (value) return value;
    await sleep(100);
  }
  return undefined;
}

const results = [];
function check(name, ok, detail = "") {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

try {
  // Open the fixture as the onboarding flow does. Give App's async workspace
  // restore effect time to settle before constructing a deterministic layout.
  await evalJs(`(async () => {
    const { api, useStore } = window.__mica;
    const info = await api.vaultOpen(${JSON.stringify(VAULT)});
    useStore.getState().setVault(info);
    await useStore.getState().refreshTree();
    return info.root;
  })()`);
  await sleep(800);

  const ids = await evalJs(`(() => {
    const store = window.__mica.useStore;
    let state = store.getState();
    const firstPaneId = state.workspace.focusedPaneId;
    const roadmapTabId = state.workspace.panes[firstPaneId].activeTabId;

    state.navigateWorkspaceTab(
      roadmapTabId,
      { type: "note", path: "notes/roadmap.md", mode: "rich" },
      undefined,
      "roadmap",
    );
    state = store.getState();
    state.createWorkspaceTab(
      firstPaneId,
      { type: "note", path: "notes/welcome.md", mode: "rich" },
      { title: "welcome" },
    );
    state = store.getState();
    const welcomeTabId = state.workspace.panes[firstPaneId].activeTabId;
    state.createWorkspaceTab(firstPaneId, { type: "empty" }, { title: "scratch" });
    state = store.getState();
    const scratchTabId = state.workspace.panes[firstPaneId].activeTabId;

    // Pinned tabs are ordered first but otherwise remain pane-local.
    state.pinWorkspaceTab(welcomeTabId, true);
    state.activateWorkspaceTab(firstPaneId, scratchTabId);
    state.activateWorkspaceTab(firstPaneId, roadmapTabId);

    // Duplicate the note into a new pane so the original pane retains all of
    // its tabs. Navigation and source mode below belong only to this copy.
    state.splitWorkspacePane(firstPaneId, {
      direction: "row",
      tabId: roadmapTabId,
      duplicate: true,
      ratio: 0.58,
    });
    state = store.getState();
    const secondPaneId = state.workspace.focusedPaneId;
    const duplicateTabId = state.workspace.panes[secondPaneId].activeTabId;

    state.navigateWorkspaceTab(
      duplicateTabId,
      { type: "note", path: "notes/welcome.md", mode: "rich" },
      { scrollTop: 24 },
      "welcome",
    );
    state.workspaceGoBack(duplicateTabId);
    state.workspaceGoForward(duplicateTabId);
    state.workspaceGoBack(duplicateTabId);
    state.toggleTabSourceMode(duplicateTabId);

    // A graph is a normal pane tab, rather than a modal singleton.
    state = store.getState();
    state.createWorkspaceTab(
      secondPaneId,
      { type: "graph", centerPath: "notes/roadmap.md" },
      { title: "Roadmap graph" },
    );
    state = store.getState();
    const graphTabId = state.workspace.panes[secondPaneId].activeTabId;

    state.setWorkspaceSidebar("left", { open: true, width: 284, panel: "files" });
    state.setWorkspaceSidebar("right", { open: false, width: 300, panel: "backlinks" });

    return {
      firstPaneId,
      secondPaneId,
      roadmapTabId,
      welcomeTabId,
      scratchTabId,
      duplicateTabId,
      graphTabId,
    };
  })()`);

  await waitFor(`document.querySelectorAll(".workspace-pane").length === 2`);

  const domain = await evalJs(`(() => {
    const { workspace } = window.__mica.useStore.getState();
    const memberships = Object.values(workspace.panes).flatMap((pane) => pane.tabIds);
    const duplicate = workspace.tabs[${JSON.stringify(ids.duplicateTabId)}];
    return {
      paneCount: Object.keys(workspace.panes).length,
      tabCount: Object.keys(workspace.tabs).length,
      uniqueMemberships: new Set(memberships).size === memberships.length,
      everyTabOwned: memberships.length === Object.keys(workspace.tabs).length,
      split: workspace.root.type === "split"
        ? { direction: workspace.root.direction, ratio: workspace.root.ratio }
        : null,
      firstTabs: workspace.panes[${JSON.stringify(ids.firstPaneId)}].tabIds,
      secondTabs: workspace.panes[${JSON.stringify(ids.secondPaneId)}].tabIds,
      pinned: workspace.tabs[${JSON.stringify(ids.welcomeTabId)}].pinned,
      historyLength: duplicate.history.length,
      historyIndex: duplicate.historyIndex,
      duplicateView: duplicate.view,
      graphView: workspace.tabs[${JSON.stringify(ids.graphTabId)}].view,
      sidebars: workspace.sidebars,
    };
  })()`);

  check("split creates two valid panes", domain.paneCount === 2 && domain.split?.direction === "row", JSON.stringify(domain.split));
  check("split ratio is retained", domain.split?.ratio === 0.58, String(domain.split?.ratio));
  check("every tab belongs to exactly one pane", domain.uniqueMemberships && domain.everyTabOwned, `${domain.tabCount} tabs`);
  check("tabs remain pane-local", domain.firstTabs.length === 3 && domain.secondTabs.length === 2);
  check("pin state is retained and ordered first", domain.pinned && domain.firstTabs[0] === ids.welcomeTabId);
  check("history is tab-local", domain.historyLength === 2 && domain.historyIndex === 0, `${domain.historyIndex}/${domain.historyLength}`);
  check("source mode survives history navigation", domain.duplicateView.type === "note" && domain.duplicateView.mode === "source");
  check("graph is represented as a workspace tab", domain.graphView.type === "graph" && domain.graphView.centerPath === "notes/roadmap.md");
  check("sidebar state is in the workspace domain", domain.sidebars.left.open && domain.sidebars.left.width === 284 && !domain.sidebars.right.open);

  const paneDom = await evalJs(`(() => ({
    panes: document.querySelectorAll(".workspace-pane").length,
    splitters: document.querySelectorAll('.workspace-splitter[role="separator"]').length,
    firstTabs: document.querySelector('[data-pane-id=${JSON.stringify(ids.firstPaneId)}]')?.querySelectorAll('[role="tab"]').length ?? 0,
    secondTabs: document.querySelector('[data-pane-id=${JSON.stringify(ids.secondPaneId)}]')?.querySelectorAll('[role="tab"]').length ?? 0,
    selected: document.querySelectorAll('.workspace-tab-target[aria-selected="true"]').length,
    pinned: !!document.querySelector('[data-tab-id=${JSON.stringify(ids.welcomeTabId)}].pinned .workspace-tab-pin'),
    leftWidth: document.querySelector(".sidebar")?.getBoundingClientRect().width ?? 0,
    rightVisible: !!document.querySelector(".right-panel"),
  }))()`);
  check("split pane DOM renders", paneDom.panes === 2 && paneDom.splitters === 1);
  check("each pane renders only its own tabs", paneDom.firstTabs === 3 && paneDom.secondTabs === 2, `${paneDom.firstTabs} + ${paneDom.secondTabs}`);
  check("each pane has one selected tab", paneDom.selected === 2, String(paneDom.selected));
  check("pinned tab has visible treatment", paneDom.pinned);
  check("sidebar visibility and width render", Math.abs(paneDom.leftWidth - 284) < 2 && !paneDom.rightVisible, `${paneDom.leftWidth}px`);

  // Select the copied note and make sure source mode mounts CodeMirror in the
  // correct pane without changing the original roadmap tab.
  await evalJs(`window.__mica.useStore.getState().activateWorkspaceTab(
    ${JSON.stringify(ids.secondPaneId)},
    ${JSON.stringify(ids.duplicateTabId)},
  ); "ok"`);
  const sourceText = await waitFor(`document.querySelector(
    '#workspace-tabpanel-${ids.duplicateTabId} .source-editor-host .cm-content'
  )?.textContent`);
  check("source mode renders in its tab panel", sourceText?.includes("title: Roadmap") && sourceText?.includes("[[Welcome]]"), String(sourceText ?? "").slice(0, 48));

  // Exercise close selection using the pane's MRU list. welcome is active;
  // roadmap was active immediately before it, while scratch is older.
  await evalJs(`(() => {
    const state = window.__mica.useStore.getState();
    state.activateWorkspaceTab(${JSON.stringify(ids.firstPaneId)}, ${JSON.stringify(ids.scratchTabId)});
    state.activateWorkspaceTab(${JSON.stringify(ids.firstPaneId)}, ${JSON.stringify(ids.roadmapTabId)});
    state.activateWorkspaceTab(${JSON.stringify(ids.firstPaneId)}, ${JSON.stringify(ids.welcomeTabId)});
    state.closeWorkspaceTab(${JSON.stringify(ids.welcomeTabId)});
    return "ok";
  })()`);
  await sleep(150);
  const afterClose = await evalJs(`(() => {
    const workspace = window.__mica.useStore.getState().workspace;
    const pane = workspace.panes[${JSON.stringify(ids.firstPaneId)}];
    return {
      activeTabId: pane.activeTabId,
      tabStillOpen: !!workspace.tabs[${JSON.stringify(ids.welcomeTabId)}],
      closedTabId: workspace.closedTabs[0]?.tab.id,
      closedWasPinned: workspace.closedTabs[0]?.tab.pinned,
    };
  })()`);
  check("closing active tab selects pane MRU", afterClose.activeTabId === ids.roadmapTabId, afterClose.activeTabId);
  check("closed pinned tab is removed and recoverable", !afterClose.tabStillOpen && afterClose.closedTabId === ids.welcomeTabId && afterClose.closedWasPinned);
  check("closed tab disappears from DOM", !(await evalJs(`!!document.querySelector('[data-tab-id=${JSON.stringify(ids.welcomeTabId)}]')`)));

  // Activate the graph tab and validate that it is hosted by the second pane.
  await evalJs(`window.__mica.useStore.getState().activateWorkspaceTab(
    ${JSON.stringify(ids.secondPaneId)},
    ${JSON.stringify(ids.graphTabId)},
  ); "ok"`);
  const graphRendered = await waitFor(`!!document.querySelector(
    '#workspace-tabpanel-${ids.graphTabId} .graph-workspace-view'
  )`);
  const graphNodes = await waitFor(`document.querySelectorAll(
    '#workspace-tabpanel-${ids.graphTabId} .graph-node'
  ).length`);
  check("graph tab renders in the workspace", graphRendered && graphNodes >= 2, `${graphNodes ?? 0} nodes`);

  // Round-trip the current JSON-safe state through the backend-owned snapshot
  // path. This is safe for the disposable E2E fixture and mirrors persistence.
  const snapshot = await evalJs(`(async () => {
    const { api, useStore } = window.__mica;
    const workspace = useStore.getState().workspace;
    const written = {
      schemaVersion: 2,
      savedAt: new Date().toISOString(),
      window: {
        root: structuredClone(workspace.root),
        focusedPaneId: workspace.focusedPaneId,
      },
      panes: structuredClone(workspace.panes),
      tabs: structuredClone(workspace.tabs),
      sidebars: structuredClone(workspace.sidebars),
      closedTabs: structuredClone(workspace.closedTabs),
      nextId: workspace.nextId,
    };
    await api.workspaceSnapshotWrite(written);
    const read = await api.workspaceSnapshotRead();
    return {
      schemaVersion: read?.schemaVersion,
      sameRoot: JSON.stringify(read?.window.root) === JSON.stringify(written.window.root),
      samePanes: JSON.stringify(read?.panes) === JSON.stringify(written.panes),
      sameTabs: JSON.stringify(read?.tabs) === JSON.stringify(written.tabs),
      sameSidebars: JSON.stringify(read?.sidebars) === JSON.stringify(written.sidebars),
      hasSavedAt: typeof read?.savedAt === "string",
    };
  })()`);
  check("workspace snapshot API round-trips", snapshot.schemaVersion === 2 && snapshot.sameRoot && snapshot.samePanes && snapshot.sameTabs && snapshot.sameSidebars && snapshot.hasSavedAt, JSON.stringify(snapshot));
} catch (error) {
  check("script completed", false, String(error?.message ?? error));
}

const failed = results.filter((result) => !result).length;
console.log(`\n${results.length - failed}/${results.length} workspace-v2 checks passed`);
ws.close();
process.exit(failed ? 1 : 0);
