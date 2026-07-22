# Mica v2 Technical Specifications — AFFiNE experience, files-first

**Version:** 2.0 (supersedes spec 1.x, preserved in git history)
**Companion docs:** [PRD.md](PRD.md), [implementation.md](implementation.md),
[vault-format.md](vault-format.md)

v1 specifications (git history of this file) remain authoritative for: vault
layout & atomic writes, markdown frontmatter grammar, `.database.json`
schema and ops, `.drawio` scene model and ops, search index, and the
watcher/conflict protocol. This document specifies only what v2 adds or
changes. The v1 architecture decisions (Tiptap editor, custom SVG canvas,
SQLite FTS5 index, Tauri 2, single-file databases) all stand.

---

## 1. File-format additions

### 1.1 Doc frontmatter (new keys)

```yaml
---
id: note_01JZ...          # unchanged
title: Project Plan       # unchanged
created: ...              # unchanged
updated: ...              # unchanged
tags: [project]           # unchanged
journal: 2026-07-20       # NEW — present only on journal docs (ISO date)
primary_mode: page        # NEW — "page" | "edgeless"; which mode opens first
properties:               # NEW — user-defined doc properties (Info panel)
  Status: In progress     # scalar values: string | number | boolean
  Due: 2026-08-01
schema_version: 1
---
```

Rules:
- All new keys optional; absence means: not a journal, `page` mode, no
  custom properties.
- `properties` values are scalars only (string/number/bool). Dates are ISO
  strings; the Info panel renders by inferred type.
- Unknown frontmatter keys continue to round-trip untouched.

### 1.2 Edgeless sidecar canvas

A doc `notes/foo.md` gets edgeless data in `notes/foo.canvas.drawio`
(uncompressed draw.io XML, same schema as standalone canvases).

- Created lazily on first switch to Edgeless.
- Contains one `note_link` cell pointing at `foo.md` (`data-workspace-type=
  "note-link"`) placed at origin — this is the "page content card".
- Rename/move/trash/restore/duplicate of the `.md` always applies the same
  operation to an existing sidecar (Rust side, single command).
- `*.canvas.drawio` files are hidden from All docs, quick search, and the
  Organize tree (they are reachable through their doc); they remain plain
  files on disk and open in draw.io.
- A standalone `.drawio` file is unchanged: it is a whiteboard-only doc.

### 1.3 Trash

- Location: `<vault>/.trash/<original-relative-path>`; collision on move
  appends ` (2)`, ` (3)` before the extension.
- A metadata sidecar `<vault>/.trash/.meta.json` records
  `{ "<trash-rel-path>": { "original": "<rel path>", "deleted": "<RFC3339>" } }`
  written with the deterministic JSON serializer.
- `.trash/` is excluded from vault tree, watcher events, and the search
  index (same mechanism as `.workspace/`).
- Restore moves the file (and its `.canvas.drawio` sidecar, which is trashed
  alongside it) back to `original`, auto-renaming on collision, and deletes
  its meta entry.

### 1.4 Workspace metadata in `.workspace/config.json`

Stored via the existing `extra` flatten on `VaultConfig` (deterministic
serializer, unknown keys preserved). New well-known keys:

```json
{
  "favorites": ["notes/project-plan.md", "databases/tasks.database.json"],
  "collections": [
    {
      "id": "col_01...",
      "name": "Active projects",
      "docs": ["notes/project-plan.md"],
      "rules": [ { "kind": "tag", "value": "project" },
                 { "kind": "title_contains", "value": "plan" } ]
    }
  ],
  "tag_colors": { "project": "blue" },
  "journal_template": "templates/journal.md"
}
```

- `favorites`: ordered list of vault-relative paths.
- Collection matches = union of `docs` plus docs matching **all** rules.
- Paths are repaired on rename events (frontend updates config); stale paths
  are ignored at render time and pruned on next write.

## 2. Backend additions (Rust)

### 2.1 `docs_list` command

```rust
#[derive(Serialize)]
struct DocMeta {
  path: String,             // vault-relative
  title: String,
  kind: FileKind,           // note | database | canvas
  created: Option<String>,  // frontmatter created, else fs ctime (RFC3339)
  updated: String,          // frontmatter updated, else fs mtime
  tags: Vec<String>,
  journal: Option<String>,  // ISO date if journal doc
  has_canvas: bool,         // sidecar exists
}
docs_list() -> Vec<DocMeta>
```

Implementation: walk the vault tree (excluding `.workspace/`, `.trash/`,
`*.canvas.drawio`); for `.md` read frontmatter via mica-markdown (cheap
header-only parse); tags come from frontmatter plus inline `#tags` via the
index where available. Databases/canvases report their internal title.
Target: <150 ms for 5k docs.

### 2.2 Trash commands

```rust
trash_move(path: String) -> ()             // moves file + sidecar into .trash
trash_list() -> Vec<TrashEntry>            // { trash_path, original, deleted, title, kind }
trash_restore(trash_path: String) -> String    // returns restored path
trash_purge(trash_path: Option<String>) -> u32 // one entry or empty-all; returns count
```

Semantics: rename-based moves (atomic on-volume); index entries for trashed
paths removed; watcher self-write filter covers the moves. `note_delete`
remains for permanent deletes but the UI routes deletion through trash.

### 2.3 Doc/sidecar pairing

`note_rename`, `note_duplicate`, `trash_move`, `trash_restore` gain sidecar
awareness: if `<stem>.canvas.drawio` exists beside the `.md`, the same
operation applies to it. New command:

```rust
canvas_sidecar_ensure(path: String) -> LoadedFile
// creates <stem>.canvas.drawio with a note_link cell for the doc if missing
```

### 2.4 Frontmatter property commands

```rust
note_meta_get(path: String) -> Value           // frontmatter as JSON object
note_meta_set(path: String, patch: Value, base_version: String)
  -> SaveOutcome  // merge-patch frontmatter, body untouched, null deletes key
```

Implemented in mica-markdown: parse, apply patch to the mapping (preserving
key order, appending new keys), reserialize deterministically. `updated` is
refreshed on every meta write.

### 2.5 Tree/index exclusions

`.trash/` and `*.canvas.drawio` are excluded from `vault_tree`,
`quick_switch`/`search_query` results, and `docs_list`. The watcher still
reports sidecar modifications (edgeless view refresh) but never `.trash/`
events.

## 3. Frontend architecture

### 3.1 View model

The Zustand store replaces the path-only tab model with a **view** union.
Tabs are retained; each tab holds a view:

```ts
type View =
  | { kind: "all-docs" }
  | { kind: "journals" }              // resolves to today's journal doc
  | { kind: "trash" }
  | { kind: "tags" }                  // tags index page
  | { kind: "tag"; tag: string }
  | { kind: "collection"; id: string }
  | { kind: "doc"; path: string; mode: "page" | "edgeless" };
interface Tab { id: string; view: View; title: string }
```

A doc tab's mode toggles in place; the sidecar is ensured on first switch to
edgeless. Standalone `.drawio` docs are always `mode: "edgeless"`;
`.database.json` docs always `mode: "page"`.

### 3.2 Component map

```
src/
  App.tsx                    shell: sidebar + tab strip + view router + modals
  store.ts                   tabs/views, workspace meta cache
  workspaceMeta.ts           config.extra helpers (favorites, collections, tag colors)
  api.ts                     + docsList, trash*, noteMeta*, canvasSidecarEnsure
  components/
    Sidebar.tsx              AFFiNE sidebar (sections, tree under Organize)
    DocHeader.tsx            title, mode switch, star, info, more-menu
    AllDocsPage.tsx          virtualized list, sort/filter/group
    TrashPage.tsx
    TagsPage.tsx             tags index + single-tag doc list
    CollectionPage.tsx       collection view + rules editor dialog
    JournalCalendar.tsx      right-panel month grid
    InfoPanel.tsx            doc properties editor (frontmatter)
    OutlinePanel.tsx         TOC from editor headings
    BacklinksSection.tsx     bottom-of-doc bi-directional links
    QuickSearch.tsx          AFFiNE cmd+K modal (replaces QuickSwitcher + SearchPanel)
    NoteEditor / SourceEditor / DatabaseView / CanvasView   retained, restyled
    SettingsDialog.tsx       AFFiNE-style sectioned settings
    ConflictDialog / CsvImportDialog / Onboarding           retained
```

Removed from v1: ActivityRail, ModeToggle, GraphPanel (graph becomes a
secondary surface, P2), RightPanel (split into Outline/Info/JournalCalendar
hosted in a right-sidebar container), SearchPanel and QuickSwitcher (merged
into QuickSearch), DataExplainer (moves into Settings → Workspace).

### 3.3 Right sidebar

One container with icon toggles (AFFiNE parity): Outline, Info, Calendar,
Frames (edgeless only). One panel visible at a time; open state and width
persist in localStorage.

### 3.4 Keyboard map (AFFiNE defaults)

| Shortcut | Action |
|---|---|
| Ctrl/Cmd+K | Quick search |
| Ctrl/Cmd+N | New doc |
| Ctrl/Cmd+Alt+N | New whiteboard (standalone edgeless doc) |
| Ctrl/Cmd+/ | Toggle sidebar |
| Ctrl/Cmd+. | Toggle right panel |
| Ctrl/Cmd+E | Toggle source mode (Mica extra) |
| Ctrl/Cmd+, | Settings |
| Alt+←/→ | Journal prev/next day (on journal docs) |

### 3.5 Visual tokens

CSS variables, light theme default (dark via `[data-theme="dark"]`):

```
--bg-app: #fbfbfc / dark #141414     --bg-panel: #ffffff / #1e1e1e
--border: #e3e2e4 / #303030          --text: #121212 / #eaeaea
--text-2: #8e8d91 / #929292          --accent: #1e96eb
--radius-card: 8px  --radius-modal: 12px
--font-ui: Inter, "Segoe UI", system-ui
--shadow-modal: 0 8px 24px rgba(0,0,0,.12)
```

Sidebar 256 px default (200–420 resizable), right panel 320 px. Doc content
max-width 820 px centered ("page width" setting: normal/full).

## 4. Behavioral specs

### 4.1 Mode switch
1. User clicks Edgeless → `canvasSidecarEnsure(path)` → CanvasView opens on
   the sidecar; the note card renders title + preview, double-click returns
   to Page mode.
2. `primary_mode` frontmatter updates (via `note_meta_set`) only when the
   user picks "Set as default mode" in the more-menu — not on every toggle.

### 4.2 Journals
- "Journals" sidebar item → today's path `journals/YYYY-MM-DD.md`; if
  missing, create with title `MMM D, YYYY`, frontmatter `journal:`, body
  from `journal_template` if configured.
- Calendar month grid computed client-side from `docs_list` journal fields.

### 4.3 All docs
- Data from `docs_list`, refreshed on `vault:events` (debounced).
- Default sort: updated desc. Filters compose (AND). Simple windowed
  rendering above 200 rows (no new dependency).

### 4.4 Trash lifecycle
- Doc header more-menu → "Move to trash" → `trash_move` → close tab, toast
  with Undo (calls `trash_restore`).
- Trash page rows: title, original path, deleted date, Restore /
  Delete-forever; header "Empty trash" behind a confirm dialog.

### 4.5 Backlinks & outline
- BacklinksSection queries `backlinks(path)` on doc open and on index
  events; renders source title + snippet; click opens doc.
- OutlinePanel walks the Tiptap doc for headings; click scrolls to heading.

### 4.6 Conflicts & watcher (unchanged, extended)
- Sidecar canvases participate in the same conflict protocol as canvases.
- Trash moves surface as `deleted` events so open tabs close cleanly.

## 5. Testing requirements

- Rust: unit tests for trash move/restore/purge (incl. collision + sidecar),
  `docs_list` metadata extraction, `note_meta_set` round-trip preserving
  body/unknown keys, sidecar-aware rename/duplicate.
- Frontend: `tsc --noEmit` clean; e2e flows updated: all-docs → open doc,
  journal create/navigate, trash/restore, mode switch, favorite toggle,
  collection rule matching.
- Golden files: journal note, doc with `properties`, sidecar canvas.
