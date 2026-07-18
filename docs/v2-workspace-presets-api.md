# Mica v2 Workspace Presets API

Named workspace presets are stored separately from the automatic last-session
snapshot. All commands operate on the currently open vault.

## Storage and validation

- Automatic snapshot: `.workspace/ui/workspace-v2.json`
- Named presets: `.workspace/ui/presets/preset-<hex-encoded-name>.json`
- A name must contain 1–80 ASCII bytes, begin and end with a letter or digit,
  and contain only letters, digits, spaces, `-`, or `_`.
- The lowercase hexadecimal filename encoding is reversible and collision-free,
  including on case-insensitive filesystems. Callers never provide filenames.
- Preset files contain a validated schema-v2 `WorkspaceSnapshot` JSON object,
  not a wrapper and not document content.
- Reads and writes have a 5 MiB limit. Writes use Mica's atomic write pipeline.
  Storage paths are confined beneath the open vault and reject symlink or
  junction redirection.

## Tauri commands

### `workspace_preset_list`

Payload: `{}`

Returns: `string[]`, sorted by preset name.

### `workspace_preset_read`

Payload:

```json
{ "name": "Research layout" }
```

Returns the `WorkspaceSnapshot` JSON object, or `null` if the named preset does
not exist.

### `workspace_preset_write`

Payload:

```json
{
  "name": "Research layout",
  "snapshot": {
    "schemaVersion": 2,
    "window": {},
    "panes": {},
    "tabs": {},
    "sidebars": {},
    "closedTabs": [],
    "nextId": 1
  }
}
```

`snapshot` must be the complete current schema-v2 `WorkspaceSnapshot`; the
abbreviated object above illustrates the payload shape only. The command
creates or atomically replaces the named preset and returns `null` (`()`).

### `workspace_preset_delete`

Payload:

```json
{ "name": "Research layout" }
```

Returns `true` when a file was deleted and `false` when the preset did not
exist. Deletion durably syncs the presets directory on Unix.

Invalid names, unsafe storage, invalid/future snapshots, and oversized data are
returned through Mica's standard `ApiError` response.
