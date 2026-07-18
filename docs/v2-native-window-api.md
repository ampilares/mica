# V2 native window API contract

The Tauri backend exposes one command for frontend workspace-window
orchestration:

```ts
invoke<WorkspaceWindowCreateResponse>("workspace_window_create", {
  request: {
    windowId?: string;
    startupQuery?: string;
  },
});
```

The response is `{ windowId: string, label: string, created: boolean }`.

- A supplied `windowId` is a persisted frontend identity. It must be 1–64
  ASCII letters, digits, `-`, or `_`. Calling the command again with the same
  ID focuses the existing native window and returns `created: false`.
- If `windowId` is omitted, the backend allocates an unused ID and returns it.
  The frontend must persist the returned value if that window should be
  restored in a later workspace snapshot.
- The native Tauri label is always `mica-workspace-${windowId}`. Dynamic labels
  are included in the default capability scope.
- The created page always receives `micaWindowId=${windowId}` in
  `window.location.search`. `startupQuery`, when supplied, is appended after
  this reserved parameter. It may omit the leading `?`, is limited to 4 KiB,
  and may not override `micaWindowId`.
- New windows use the same 1280×800 initial and 800×500 minimum dimensions as
  the configured main window.

Workspace snapshots are stored as one schema-v2 collection:

```json
{
  "schemaVersion": 2,
  "windows": [{ "windowId": "main", "snapshot": { "schemaVersion": 2 } }]
}
```

`workspace_snapshot_read` and `workspace_snapshot_write` accept an optional
`windowId` argument (default `main`) and address only that entry. Writes run as
one locked read/merge/atomic-replace transaction, so one native window cannot
overwrite another window's entry. `workspace_snapshot_window_ids` lists the
descriptors main should recreate after opening a vault. A legacy bare v2
snapshot is read as `main` and migrates on the next successful write.

Secondary windows call `vault_current`, restore their own snapshot entry, and
persist with their URL-provided `micaWindowId`. Persisted non-main descriptors
are recreated idempotently by main; an existing label is focused rather than
duplicated.

The vault is process-wide. Only the main window exposes the **Close vault**
command, preventing a detached window from clearing the backend vault while
peer windows are still mounted. Closing a detached native window retains its
descriptor intentionally so the workspace can be restored on the next launch.

## Tab transfer protocol

Resource tabs use the bounded `micaTabTransfer` startup query. The JSON-safe
schema-v1 envelope contains a random transfer ID, source window/pane IDs, and a
validated `WorkspaceTab`. Link membership is removed because link groups are
window-local invariants.

The source flushes the note session and registers for
`mica:workspace-tab-transfer-ack` before creating the destination. The target
attaches to the current vault, restores its local tree, inserts and persists
the tab, then acknowledges the matching transfer ID. Only an accepted
acknowledgement permits the source to run its normal guarded close. Creation
errors, rejected acknowledgements, timeouts, or later save failures leave the
source tab in place.

The Rust layer owns native-window creation, identity, focus, capability scope,
and atomic collection merging. The frontend owns each window-local tree and
the acknowledged transfer protocol.
