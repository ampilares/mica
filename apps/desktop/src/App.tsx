import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useStore } from "./store";
import { api, VaultEvent } from "./api";
import Onboarding from "./components/Onboarding";
import Sidebar from "./components/Sidebar";
import QuickSwitcher from "./components/QuickSwitcher";
import SearchPanel from "./components/SearchPanel";
import ConflictDialog from "./components/ConflictDialog";
import StatusBar from "./components/StatusBar";
import CommandPalette from "./components/CommandPalette";
import RightPanel from "./components/RightPanel";
import DataExplainer from "./components/DataExplainer";
import SettingsDialog from "./components/SettingsDialog";
import GraphPanel from "./components/GraphPanel";
import ActivityRail from "./components/ActivityRail";
import { docEvents } from "./docEvents";
import { useSettings, applySettings } from "./settings";
import { flushAllDocuments } from "./documents";
import { WorkspaceRoot } from "./components/workspace";
import WorkspaceErrorBoundary from "./components/workspace/WorkspaceErrorBoundary";
import {
  createWorkspacePersister,
  acknowledgeWorkspaceTabTransfer,
  DEFAULT_WORKSPACE_WINDOW_ID,
  flushWorkspacePersistence,
  findMissingWorkspaceResources,
  loadWorkspace,
  insertWorkspaceTabTransfer,
  isWorkspaceWindowId,
  parseWorkspaceWindowStartup,
  registerWorkspacePersister,
  resourcePath,
  saveWorkspace,
  selectAllPaneIds,
} from "./workspace";

export default function App() {
  const isTauri = "__TAURI_INTERNALS__" in window;
  const startup = useMemo(() => parseWorkspaceWindowStartup(window.location.search), []);
  const windowId = startup.windowId ?? DEFAULT_WORKSPACE_WINDOW_ID;
  const startupTransferHandled = useRef(false);
  const vault = useStore((s) => s.vault);
  const refreshTree = useStore((s) => s.refreshTree);
  const setQuickSwitcherOpen = useStore((s) => s.setQuickSwitcherOpen);
  const setSearchOpen = useStore((s) => s.setSearchOpen);
  const [vaultDiscoveryComplete, setVaultDiscoveryComplete] = useState(!isTauri);

  // Every native webview has its own frontend store. Secondary windows attach
  // to the vault already open in the shared Rust application state.
  useEffect(() => {
    if (!isTauri) return;
    if (useStore.getState().vault) {
      setVaultDiscoveryComplete(true);
      return;
    }
    let cancelled = false;
    void api.vaultCurrent()
      .then(async (current) => {
        if (cancelled || !current) return;
        useStore.getState().setVault(current);
        await useStore.getState().refreshTree();
      })
      .catch((error) => console.warn("Could not discover the current vault", error))
      .finally(() => {
        if (!cancelled) setVaultDiscoveryComplete(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isTauri]);

  // Restore and continuously persist the workspace per vault. Snapshot errors
  // deliberately fall back to a safe one-pane workspace.
  useEffect(() => {
    if (!vault || !isTauri) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let unregister: (() => void) | undefined;
    let persister: ReturnType<typeof createWorkspacePersister> | undefined;
    void loadWorkspace(windowId).then(async (restoredWorkspace) => {
      if (cancelled) return;
      let workspace = restoredWorkspace;
      let transferAccepted = false;
      const transfer = !startupTransferHandled.current ? startup.tabTransfer : undefined;
      if (transfer) {
        startupTransferHandled.current = true;
        try {
          workspace = insertWorkspaceTabTransfer(workspace, transfer);
          transferAccepted = true;
        } catch (error) {
          console.warn("Workspace tab transfer was rejected", error);
        }
      }
      useStore.getState().replaceWorkspace(workspace);
      void findMissingWorkspaceResources(workspace).then((missing) => {
        if (cancelled || useStore.getState().vault?.root !== vault.root) return;
        for (const resource of missing) {
          useStore.getState().markWorkspaceResourceMissing(resource.path, resource.reason);
        }
      });
      const vaultRoot = vault.root;
      persister = createWorkspacePersister(
        () => useStore.getState().workspace,
        350,
        (state) => saveWorkspace(state, windowId),
        () => useStore.getState().vault?.root === vaultRoot,
      );
      unregister = registerWorkspacePersister(vaultRoot, persister);
      unsubscribe = useStore.subscribe((state, previous) => {
        if (state.workspace !== previous.workspace) persister?.schedule();
      });
      if (transfer) {
        // Persist the inserted tab before acknowledging. The source registers
        // its listener before creating this window and removes its tab only
        // after receiving an accepted acknowledgement.
        if (transferAccepted) {
          persister.schedule();
          try {
            await persister.flush();
          } catch (error) {
            transferAccepted = false;
            console.warn("Transferred tab could not be persisted", error);
          }
        }
        try {
          await acknowledgeWorkspaceTabTransfer(transfer, transferAccepted, windowId);
        } catch (error) {
          console.warn("Workspace tab transfer acknowledgement failed", error);
        }
        clearStartupTransferQuery();
      }

      if (windowId === DEFAULT_WORKSPACE_WINDOW_ID) {
        try {
          const persistedWindowIds = await api.workspaceSnapshotWindowIds();
          for (const persistedWindowId of persistedWindowIds) {
            if (
              persistedWindowId !== DEFAULT_WORKSPACE_WINDOW_ID &&
              isWorkspaceWindowId(persistedWindowId)
            ) {
              await api.workspaceWindowCreate({ windowId: persistedWindowId });
            }
          }
        } catch (error) {
          console.warn("Persisted native windows could not be restored", error);
        }
      }
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
      unregister?.();
      persister?.cancel();
    };
  }, [isTauri, startup.tabTransfer, vault?.root, windowId]);

  // Tauri lets us delay native window shutdown long enough to finish the
  // atomic workspace write. Browser lifecycle events are best-effort only.
  useEffect(() => {
    if (!vault || !isTauri) return;
    const appWindow = getCurrentWindow();
    let closing = false;
    const unlisten = appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      if (closing) return;
      closing = true;
      try {
        const documents = await flushAllDocuments();
        const failure = documents.find((result) => !result.ok || result.dirty);
        if (failure) throw new Error(`Could not save ${failure.path}`);
        await flushWorkspacePersistence();
        await appWindow.destroy();
      } catch (error) {
        console.warn("Workspace snapshot save during window close failed", error);
        // Keep the window alive so another close request can retry the save.
        closing = false;
      }
    });
    const flushBestEffort = () => void flushWorkspacePersistence().catch((error) => {
      console.warn("Workspace snapshot save during page shutdown failed", error);
    });
    window.addEventListener("pagehide", flushBestEffort);
    window.addEventListener("beforeunload", flushBestEffort);
    return () => {
      window.removeEventListener("pagehide", flushBestEffort);
      window.removeEventListener("beforeunload", flushBestEffort);
      void unlisten.then((stop) => stop());
    };
  }, [isTauri, vault?.root]);

  // Apply appearance settings (theme, fonts) whenever they change.
  const settings = useSettings();
  useEffect(() => {
    applySettings(settings);
    if (settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applySettings(useSettings.getState());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [settings]);

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "p") {
        e.preventDefault();
        setQuickSwitcherOpen(true);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (mod && e.key === "k") {
        e.preventDefault();
        useStore.getState().setCommandPaletteOpen(true);
      } else if (mod && e.shiftKey && e.key === "\\") {
        e.preventDefault();
        useStore.getState().setRightPanelOpen(!useStore.getState().rightPanelOpen);
      } else if (mod && e.key === "g") {
        e.preventDefault();
        const s = useStore.getState();
        const active = s.workspace.tabs[s.workspace.panes[s.workspace.focusedPaneId].activeTabId];
        s.createWorkspaceTab(s.workspace.focusedPaneId, {
          type: "graph",
          centerPath: active ? resourcePath(active.view) : undefined,
        });
      } else if (mod && e.key === ",") {
        e.preventDefault();
        useStore.getState().setSettingsOpen(true);
      } else if (mod && e.key === "e") {
        const s = useStore.getState();
        const pane = s.workspace.panes[s.workspace.focusedPaneId];
        const tab = pane && s.workspace.tabs[pane.activeTabId];
        if (tab?.view.type === "note") {
          e.preventDefault();
          s.toggleTabSourceMode(tab.id);
        }
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        useStore.getState().reopenLastClosedWorkspaceTab();
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        const s = useStore.getState();
        s.createWorkspaceTab(s.workspace.focusedPaneId);
      } else if (mod && e.key.toLowerCase() === "w") {
        e.preventDefault();
        const s = useStore.getState();
        const pane = s.workspace.panes[s.workspace.focusedPaneId];
        if (pane) s.closeWorkspaceTab(pane.activeTabId);
      } else if (mod && !e.shiftKey && e.key === "\\") {
        e.preventDefault();
        const s = useStore.getState();
        s.splitWorkspacePane(s.workspace.focusedPaneId, { direction: "row" });
      } else if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        const s = useStore.getState();
        const pane = s.workspace.panes[s.workspace.focusedPaneId];
        if (!pane) return;
        const index = pane.tabIds.indexOf(pane.activeTabId);
        const delta = e.shiftKey ? -1 : 1;
        const next = pane.tabIds[(index + delta + pane.tabIds.length) % pane.tabIds.length];
        s.activateWorkspaceTab(pane.id, next);
      } else if (mod && /^[1-9]$/.test(e.key)) {
        const s = useStore.getState();
        const pane = s.workspace.panes[s.workspace.focusedPaneId];
        if (!pane) return;
        const requested = Number(e.key) === 9 ? pane.tabIds.length - 1 : Number(e.key) - 1;
        const tabId = pane.tabIds[Math.min(requested, pane.tabIds.length - 1)];
        if (tabId) {
          e.preventDefault();
          s.activateWorkspaceTab(pane.id, tabId);
        }
      } else if (mod && e.altKey && e.shiftKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        const s = useStore.getState();
        const paneIds = selectAllPaneIds(s.workspace);
        if (paneIds.length > 1) {
          const current = paneIds.indexOf(s.workspace.focusedPaneId);
          const backwards = e.key === "ArrowLeft" || e.key === "ArrowUp";
          s.activateWorkspacePane(paneIds[(current + (backwards ? -1 : 1) + paneIds.length) % paneIds.length]);
        }
      } else if (mod && e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        const s = useStore.getState();
        const pane = s.workspace.panes[s.workspace.focusedPaneId];
        if (pane) {
          if (e.key === "ArrowLeft") s.workspaceGoBack(pane.activeTabId);
          else s.workspaceGoForward(pane.activeTabId);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setQuickSwitcherOpen, setSearchOpen]);

  // Vault file events from the Rust watcher.
  useEffect(() => {
    if (!vault || !isTauri) return;
    const un = listen<VaultEvent[]>("vault:events", (event) => {
      refreshTree();
      for (const ev of event.payload) {
        docEvents.emit(ev);
        if (ev.type === "renamed") {
          useStore.getState().renameWorkspaceResource(ev.from, ev.to);
        } else if (ev.type === "deleted") {
          useStore.getState().markWorkspaceResourceMissing(ev.path, "File was removed from the vault");
        }
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, [isTauri, vault, refreshTree]);

  if (!vault) {
    if (!vaultDiscoveryComplete) return <div className="onboarding" aria-label="Opening vault" />;
    return <Onboarding />;
  }

  return (
    <div className="app">
      <ActivityRail />
      <Sidebar />
      <div className="main">
        <WorkspaceErrorBoundary><WorkspaceRoot /></WorkspaceErrorBoundary>
        <StatusBar />
      </div>
      <RightPanel />
      <QuickSwitcher />
      <SearchPanel />
      <CommandPalette />
      <ConflictDialog />
      <DataExplainer />
      <SettingsDialog />
      <GraphPanel />
    </div>
  );
}

function clearStartupTransferQuery(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("micaTabTransfer")) return;
  url.searchParams.delete("micaTabTransfer");
  window.history.replaceState(window.history.state, "", url);
}
