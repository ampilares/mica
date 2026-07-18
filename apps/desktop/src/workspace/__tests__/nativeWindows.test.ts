import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspace } from "../operations";
import type { WorkspaceTabTransferPayload } from "../nativeWindows";
import {
  decodeWorkspaceTabTransferPayload,
  encodeWorkspaceTabTransferQuery,
  createWorkspaceTabTransferPayload,
  insertWorkspaceTabTransfer,
  isResourceViewShape,
  isWorkspaceTabShape,
  normalizeWorkspaceWindowCreateRequest,
  parseWorkspaceWindowStartup,
  requestWorkspaceTabTransfer,
  WORKSPACE_TAB_TRANSFER_QUERY_KEY,
} from "../nativeWindows";

afterEach(() => vi.useRealTimers());

function transferPayload(): WorkspaceTabTransferPayload {
  return {
    schemaVersion: 1,
    transferId: "transfer-9",
    sourceWindowId: "window-1",
    sourcePaneId: "pane-1",
    tab: {
      id: "tab-3",
      view: { type: "note", path: "Projects/Mica.md", mode: "rich" },
      title: "Mica",
      pinned: false,
      history: [
        {
          view: { type: "note", path: "Projects/Mica.md", mode: "rich" },
          location: { scrollTop: 240, selection: { anchor: 4, head: 8 } },
        },
      ],
      historyIndex: 0,
    },
  };
}

describe("native workspace window startup", () => {
  it("normalizes a backend-compatible create request", () => {
    expect(
      normalizeWorkspaceWindowCreateRequest({
        windowId: "research_2026",
        startupQuery: "?restore=true",
      }),
    ).toEqual({ windowId: "research_2026", startupQuery: "restore=true" });

    expect(() =>
      normalizeWorkspaceWindowCreateRequest({ windowId: "unsafe window" }),
    ).toThrow(/windowId/);
    expect(() =>
      normalizeWorkspaceWindowCreateRequest({ startupQuery: "micaWindowId=override" }),
    ).toThrow(/reserved/);
  });

  it("round trips a resource tab transfer through URLSearchParams", () => {
    const payload = transferPayload();
    const query = encodeWorkspaceTabTransferQuery(payload);
    const encoded = new URLSearchParams(query).get(WORKSPACE_TAB_TRANSFER_QUERY_KEY);

    expect(encoded).not.toBeNull();
    expect(decodeWorkspaceTabTransferPayload(encoded!)).toEqual(payload);
    expect(parseWorkspaceWindowStartup(`?micaWindowId=window-2&${query}`)).toEqual({
      windowId: "window-2",
      tabTransfer: payload,
      issues: [],
    });
  });

  it("rejects malformed resource views and workspace tabs", () => {
    expect(isResourceViewShape({ type: "note", path: "A.md", mode: "preview" })).toBe(
      false,
    );
    expect(isResourceViewShape({ type: "graph" })).toBe(false);
    expect(
      isWorkspaceTabShape({
        ...transferPayload().tab,
        historyIndex: 99,
      }),
    ).toBe(false);
    expect(
      isWorkspaceTabShape({
        ...transferPayload().tab,
        history: [
          {
            view: transferPayload().tab.view,
            location: { unsafe: Number.POSITIVE_INFINITY },
          },
        ],
      }),
    ).toBe(false);
  });

  it("reports invalid untrusted bootstrap values instead of throwing", () => {
    expect(
      parseWorkspaceWindowStartup(
        `?micaWindowId=bad%20id&${WORKSPACE_TAB_TRANSFER_QUERY_KEY}=%7Bbad-json`,
      ),
    ).toEqual({
      issues: ["invalid_window_id", "invalid_tab_transfer"],
    });
    expect(parseWorkspaceWindowStartup("?micaWindowId=one&micaWindowId=two")).toEqual({
      issues: ["invalid_window_id"],
    });
  });

  it("allows the backend-added window ID outside the startup-query byte budget", () => {
    const search = `?micaWindowId=${"w".repeat(64)}&padding=${"x".repeat(4_000)}`;
    expect(parseWorkspaceWindowStartup(search)).toMatchObject({
      windowId: "w".repeat(64),
      issues: [],
    });
  });

  it("rejects oversized encoded transfer payloads", () => {
    const payload = transferPayload();
    payload.tab.title = "x".repeat(500);
    payload.tab.history[0].location = { text: "\u{1f680}".repeat(2_000) };
    expect(() => encodeWorkspaceTabTransferQuery(payload)).toThrow(/exceeds/);
  });

  it("only transfers resource-backed tabs", () => {
    const payload = transferPayload();
    const graphPayload = {
      ...payload,
      tab: { ...payload.tab, view: { type: "graph" as const } },
    };
    expect(() => encodeWorkspaceTabTransferQuery(graphPayload as WorkspaceTabTransferPayload)).toThrow(
      /Invalid workspace tab transfer payload/,
    );
  });

  it("inserts into an empty destination and removes window-local link metadata", () => {
    const destination = createWorkspace();
    const payload = transferPayload();
    payload.tab.linkGroupId = "link_4";
    const inserted = insertWorkspaceTabTransfer(destination, payload);
    const pane = inserted.panes[inserted.focusedPaneId];

    expect(pane.tabIds).toHaveLength(1);
    expect(inserted.tabs[pane.activeTabId]).toMatchObject({
      title: "Mica",
      view: { path: "Projects/Mica.md" },
    });
    expect(inserted.tabs[pane.activeTabId].linkGroupId).toBeUndefined();
  });

  it("registers acknowledgement before create and accepts only its transfer", async () => {
    const payload = createWorkspaceTabTransferPayload(
      transferPayload().tab,
      "pane-1",
      "main",
      "transfer-order",
    );
    const order: string[] = [];
    let listener!: (ack: {
      schemaVersion: 1;
      transferId: string;
      accepted: boolean;
      targetWindowId: string;
    }) => void;

    await expect(requestWorkspaceTabTransfer(payload, {
      subscribe: async (next) => {
        order.push("subscribe");
        listener = next;
        return () => order.push("unsubscribe");
      },
      createWindow: async () => {
        order.push("create");
        listener({
          schemaVersion: 1,
          transferId: payload.transferId,
          accepted: true,
          targetWindowId: "window-2",
        });
        return { windowId: "window-2", label: "mica-workspace-window-2", created: true };
      },
    })).resolves.toBe(true);
    expect(order).toEqual(["subscribe", "create", "unsubscribe"]);
  });

  it("keeps the transfer unacknowledged on create failure, rejection, or timeout", async () => {
    const payload = transferPayload();
    const subscribeWithoutAck = async () => () => undefined;

    await expect(requestWorkspaceTabTransfer(payload, {
      subscribe: subscribeWithoutAck,
      createWindow: async () => { throw new Error("native create failed"); },
    })).resolves.toBe(false);

    await expect(requestWorkspaceTabTransfer(payload, {
      subscribe: async (listener) => {
        queueMicrotask(() => listener({
          schemaVersion: 1,
          transferId: payload.transferId,
          accepted: false,
          targetWindowId: "window-2",
        }));
        return () => undefined;
      },
      createWindow: async () => ({
        windowId: "window-2",
        label: "mica-workspace-window-2",
        created: true,
      }),
    })).resolves.toBe(false);

    vi.useFakeTimers();
    const timedOut = requestWorkspaceTabTransfer(payload, {
      subscribe: subscribeWithoutAck,
      createWindow: async () => ({
        windowId: "window-3",
        label: "mica-workspace-window-3",
        created: true,
      }),
      timeoutMs: 50,
    });
    await vi.advanceTimersByTimeAsync(50);
    await expect(timedOut).resolves.toBe(false);
  });
});
