# Technical Specifications: Mica

**Project:** Mica — local-first, file-native notes workspace
**Version:** 0.1
**Date:** 2026-07-06
**Status:** Draft for review
**Source:** Derived from [PRD.md](PRD.md)

---

## 1. Overview

Mica is a local-first, file-native notes and knowledge workspace. Users write block-based notes, manage structured databases, and think on an infinite canvas — while every canonical record lives as an ordinary file in a user-owned folder (the **vault**):

| Record type | Canonical format | Extension |
|---|---|---|
| Note | Markdown + optional YAML frontmatter | `.md` |
| Database | Deterministic JSON | `.database.json` |
| Canvas | Uncompressed draw.io-compatible XML | `.drawio` |
| Asset | Original binary | native |
| Workspace config | JSON | `.workspace/config.json` |

Everything else (search index, backlink index, thumbnails, view state) is a rebuildable cache under `.workspace/` and is never the source of truth.

### 1.1 Resolved architecture decisions

These decisions resolve the PRD's open questions (§25) and lock the initial build direction (§26):

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | Editor technology | **Tiptap (ProseMirror)** — custom block UX, no BlockSuite fork | Cleanest lossless Markdown round-trip; no CRDT/Yjs impedance mismatch with file-native storage; mature ecosystem |
| D2 | MVP scope | **Full PRD MVP scope** (notes + databases + canvas), phased internally by priority | Ship the complete value proposition; build P0 notes core first, harden performance throughout |
| D3 | Block IDs | **Inline, only when needed** — `{#block_id}` appended to a block only when it is referenced/embedded | Files stay clean by default; references survive external edits and Git merges |
| D4 | Search/index backend | **SQLite + FTS5** | One embedded store for full-text search, backlinks, tags, and metadata; trivially rebuildable; meets all latency targets |
| D5 | Frontend framework | **React 18+ (TypeScript)** | Best ecosystem for Tiptap bindings, virtualized tables (TanStack), kanban DnD (dnd-kit) |
| D6 | Canvas implementation | **Custom SVG renderer** over an app-owned scene model | Scene model maps 1:1 to draw.io `mxCell` XML — no lossy converter, no third-party license constraints |
| D7 | Desktop shell | **Tauri 2.x** | Rust core + web UI, small binaries, cross-platform (macOS/Windows/Linux) |
| D8 | Database file layout | **Single-file `.database.json`** for MVP; schema designed to migrate to sharded rows | Per PRD §26.5 |
| D9 | Collaboration | **No CRDT / real-time collaboration in MVP** | File-level conflict handling only (PRD §15.1) |
| D10 | draw.io interop level | **"Opens visually"** in draw.io; full round-trip is best-effort, not guaranteed | App-specific embeds degrade to labeled placeholder shapes |
| D11 | Secondary canvas formats | **Obsidian Canvas (`.canvas`) and Excalidraw (`.excalidraw`) import/export**, post-MVP | Widens interop with both ecosystems (resolves PRD open question #6); `.drawio` remains the only canonical on-disk format |

---

## 2. Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Desktop shell | Tauri 2.x | Windowing, menus, dialogs, deep OS integration, updater (post-MVP) |
| Core logic | Rust (stable, edition 2024) | Cargo workspace of focused crates (§5) |
| Frontend | React 18+, TypeScript, Vite | Strict mode; typed IPC bindings generated from Rust |
| Block editor | Tiptap 2 / ProseMirror | Custom extensions per block type (§9) |
| Markdown engine | `pulldown-cmark` (parse) + custom deterministic serializer | CommonMark + GFM extensions; frontmatter via `serde_yaml` |
| Search & indexes | SQLite (bundled via `rusqlite`) + FTS5 | Single index DB at `.workspace/index/index.db` |
| File watching | `notify` crate + custom debouncer | Rescan fallback for unreliable platforms |
| XML | `quick-xml` | draw.io read/write |
| IDs | ULID (`ulid` crate) | Sortable, collision-safe, prefix-typed (`note_`, `db_`, `row_`, `canvas_`, `shape_`, `block_`, `prop_`) |
| Table virtualization | TanStack Table + TanStack Virtual | 10k-row target (NFR-PERF-005) |
| Kanban DnD | dnd-kit | Card drag between groups |
| State (frontend) | Zustand (or equivalent lightweight store) | Rust core is the authority; frontend state is a projection |

---

## 3. Architecture

```text
┌────────────────────────────────────────────────────────┐
│                     Tauri Shell                        │
│   windowing · menus · dialogs · OS permissions         │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│                  Frontend (React + TS)                 │
│  Tiptap editor · database views · canvas · sidebar     │
│  command palette · settings                            │
└──────────────────────────┬─────────────────────────────┘
                           │  Tauri commands (request/response)
                           │  Tauri events  (push: file changes, index updates)
┌──────────────────────────▼─────────────────────────────┐
│                     Rust Core                          │
│  vault service · parsers/serializers · record store    │
│  search/index · file watcher · conflict detector       │
│  import/export · backup                                │
└───────┬──────────────────┬───────────────────┬─────────┘
        │                  │                   │
┌───────▼───────┐  ┌───────▼────────┐  ┌───────▼─────────┐
│  File system  │  │  SQLite index  │  │ Cache/thumbnails│
│  MD/JSON/XML  │  │  (rebuildable) │  │  (rebuildable)  │
└───────────────┘  └────────────────┘  └─────────────────┘
```

**Core principles (from PRD §7):**

1. Files are the product — the app must never trap the vault.
2. Canonical data is human-inspectable; caches are disposable.
3. Offline-first: every MVP workflow works without network.
4. Git-friendly: deterministic formatting, stable IDs, minimal churn.
5. External edits are detected, never silently overwritten.

### 3.1 Data flow

**In-app edit:**

```text
User action → React UI → Tauri command → Rust core
  → in-memory document model → deterministic serializer
  → atomic write to canonical file → watcher confirms own write
  → index update → event to frontend → UI/status refresh
```

**External edit:**

```text
External tool writes file → watcher (debounced) → parser validates
  → conflict detector compares against in-memory dirty state
  → no in-app dirty state: reload model + index, push event to UI
  → conflict: emit conflict event → UI shows resolution panel
```

### 3.2 Write-ownership tracking

The core tags every write it performs (path + content hash + generation counter) so watcher events caused by its own saves are ignored, preventing echo loops. Any watcher event whose content hash differs from the last app write is treated as external.

---

## 4. Vault and File Formats

### 4.1 Vault structure

```text
MyVault/
  notes/                    # default, not enforced
    project-plan.md
    research/local-first.md
  databases/
    tasks.database.json
  canvases/
    system-map.drawio
  assets/
    images/
    files/
  templates/
  .workspace/               # rebuildable except config.json + backups
    config.json             # vault settings (schema_version, prefs)
    index/index.db          # SQLite FTS5 + metadata (disposable)
    thumbnails/             # disposable
    backups/                # snapshots (kept)
```

Rules (FR-VLT-001…005, NFR-PORT-*):

- `notes/`, `databases/`, `canvases/` are **defaults only** — users may place canonical files anywhere in the vault; the app discovers them by extension.
- A plain Markdown folder opens as a vault with **no destructive migration** (FR-VLT-003): no frontmatter injection, no renames, no moves.
- All intra-vault links are **relative paths**; no absolute paths in canonical files.
- Deleting `.workspace/` (except `config.json` and `backups/`) loses nothing; the index rebuilds from files (NFR-REL-004).
- Unknown files are listed in the file tree and never deleted or rewritten (FR-FS-004).
- Nested vault creation triggers a warning (FR-VLT-005).

### 4.2 Markdown note format

Canonical extension: `.md`. Dialect: **CommonMark + GFM** (tables, strikethrough, task lists, autolinks) + wiki links.

```markdown
---
id: note_01JZ0Q2P3M5VCB8K0HQG2YJS4P
title: Project Plan
created: 2026-07-02T09:30:00+10:00
updated: 2026-07-02T10:15:00+10:00
tags:
  - project
aliases:
  - Plan
schema_version: 1
---

# Project Plan

Normal Markdown content.

## Goals {#block_01JZ0Q4ZJGX3P0M7Y2S3JHKT2A}

- Build a local-first workspace.

```workspace-database
path: ../databases/tasks.database.json
view: table_default
```

See also [[Local-first Architecture]] and [[Project Plan#Goals]].
```

**Frontmatter rules:**

- Optional for imported/externally created files; the app never adds frontmatter to a file it hasn't otherwise modified.
- App-created notes get frontmatter with a stable ULID `id`, `title`, `created`, `updated`, `schema_version`.
- Key order is fixed: `id`, `title`, `created`, `updated`, `tags`, `aliases`, then any user keys in original order, `schema_version` last. Unknown keys are preserved verbatim.
- Timestamps: RFC 3339 with local offset.

**Block IDs (decision D3):**

- Syntax: `{#block_<ulid>}` appended to the end of the block's first line (heading, paragraph, list item).
- Inserted **only** when a block becomes the target of a reference, embed, or backlink. Never bulk-inserted.
- The editor hides the ID annotation visually; source mode shows it.
- Deleting the ID in an external editor breaks the reference gracefully (broken-link indicator, relink offer).

**Wiki links:**

- `[[Page Name]]` resolves by title → alias → filename (case-insensitive), preferring the closest path. Ambiguity shows a disambiguation menu.
- `[[Page Name#Heading]]` and `[[Page Name#^block_id]]`-style block references supported (block refs post-MVP for embedding, MVP for linking).
- Unresolved links render distinctly and offer note creation (FR-NOTE-005).

**Round-trip guarantee (FR-NOTE-008, PRD §29):**

- Every supported block type serializes to standard Markdown and re-parses to an identical model (property-tested).
- Unsupported/unknown Markdown syntax is preserved as an opaque **raw block**: rendered read-only-ish in the rich editor, byte-identical on save.
- Parse → serialize of an untouched file is byte-identical (idempotence golden tests).

**Database embed syntax (PRD §27):** fenced code block with language `workspace-database`, YAML body with `path` (relative) and `view` (view ID). Degrades to a readable code block in any other editor.

### 4.3 Database JSON format

Canonical extension: `.database.json`. Single file per database (D8). Full schema per PRD §13.3; summary:

```jsonc
{
  "schema_version": 1,
  "id": "db_<ulid>",
  "title": "Tasks",
  "created": "...", "updated": "...",
  "properties": [ { "id": "prop_<ulid|slug>", "name": "...", "type": "...", ... } ],
  "views":      [ { "id": "...", "name": "...", "type": "table|kanban", "sorts": [], "filters": [], ... } ],
  "rows":       [ { "id": "row_<ulid>", "created": "...", "updated": "...", "cells": { "<prop_id>": { "type": "...", "value": ... } } } ]
}
```

**Property types (FR-DB-005):** `title` (required, exactly one), `text`, `number`, `checkbox`, `select`, `multi_select`, `date`, `url`, `file` (relative path), `note_link` (relative path to `.md`).

**View types:** `table` (column order/width, hidden properties, sorts, filters), `kanban` (`group_by` referencing a `select` property, per-group card order, sorts, filters). Sorts/filters persist per view (FR-DB-006).

**Filter model (MVP):** flat AND list of `{ property, operator, value }`. Operators by type: `eq/neq/contains/empty/not_empty` (text/select), `eq/neq/gt/gte/lt/lte` (number/date), `checked/unchecked` (checkbox).

**Determinism rules (FR-DB-007):**

- Fixed key order per object type (as listed above); 2-space indent; UTF-8; LF; trailing newline.
- Rows sorted by insertion order (array order is canonical); view-specific ordering lives in the view object, not by reordering rows.
- Saves rewrite the file but unchanged rows serialize byte-identically, so Git diffs touch only changed lines.
- Stable ULIDs for database, properties, views, rows, and select options.

### 4.4 Canvas `.drawio` format

Canonical extension: `.drawio`, **uncompressed XML** (FR-CAN-005). Structure per PRD §13.4: `mxfile > diagram > mxGraphModel > root > mxCell*`.

**Scene model ↔ XML mapping:**

| App object | mxCell representation |
|---|---|
| Rectangle / ellipse / diamond | `vertex=1`, style `rounded=1`/`ellipse`/`rhombus` |
| Text | `vertex=1`, style `text;html=1` |
| Sticky note | `vertex=1`, style `shape=note` + fill color |
| Connector | `edge=1`, `source`/`target` cell IDs, optional waypoints |
| Frame | `vertex=1`, style `group`-like container; children parented to it |
| Note link | vertex with `data-workspace-type="note-link"`, `data-workspace-href="../notes/x.md"` |
| Database link | vertex with `data-workspace-type="database-link"`, `data-workspace-href`, `data-workspace-view` |

- App-specific data rides in `data-workspace-*` attributes so draw.io still renders a labeled shape (D10).
- Cell IDs are stable ULIDs (`shape_…`); `mxfile` carries `data-workspace-schema-version`.
- Serializer is deterministic: fixed attribute order, fixed indentation, cells ordered by z-order.
- The parser validates XML before any save; an invalid existing file is never overwritten — the app surfaces the error and keeps the prior valid version (backup) (PRD §30).
- Foreign `.drawio` files: supported shapes render; unsupported styles render as gray placeholder boxes with labels; unknown cells/attributes are preserved on save (FR-CAN-007, P1).

#### 4.4.1 Secondary canvas formats (D11, post-MVP)

`.drawio` is the only canonical format the app saves continuously. Obsidian Canvas and Excalidraw are **import/export interchange formats**: importing creates a new `.drawio`-backed canvas; exporting produces a one-shot file. Both conversions are documented-lossy — the export dialog lists what will degrade.

**Obsidian Canvas (`.canvas` JSON):**

| Obsidian Canvas | Mica scene | Notes |
|---|---|---|
| `text` node | Sticky note | Markdown body preserved as label text |
| `file` node (`.md`) | Note-link cell | Path re-resolved relative to vault |
| `file` node (image) | Image cell | |
| `link` node | Text cell with URL | |
| `group` | Frame | |
| `edge` | Connector | Endpoints, labels, colors mapped approximately |

Export caveat: Obsidian Canvas has no shape primitives — rectangles/ellipses/diamonds export as colored text cards; database-link cells export as text cards with the relative path.

**Excalidraw (`.excalidraw` JSON):**

| Excalidraw | Mica scene | Notes |
|---|---|---|
| `rectangle` / `ellipse` / `diamond` | Same shapes | Fill/stroke mapped; roughness dropped |
| `text` | Text cell | |
| `arrow` / `line` | Connector | Bindings → endpoint attachments |
| `frame` | Frame | |
| `image` | Image cell | Embedded base64 files extracted to `assets/` |
| `freedraw` | Placeholder cell | No freehand primitive in MVP scene model; import warns and preserves bounding-box placeholder |

Export caveat: sticky notes export as filled rectangles with text; note/database link cells export as labeled rectangles (`link` attribute set to the relative path).

### 4.5 Assets

- Default destination `assets/` (configurable, FR-SET-002); pasted/dragged images are copied in and referenced by relative path.
- Filenames: original name, deduplicated with numeric suffix; content-addressed naming is a post-MVP option.
- Thumbnails cached under `.workspace/thumbnails/`, keyed by content hash.

---

## 5. Rust Core: Crate Design

Cargo workspace (per PRD §18.2, adjusted):

```text
crates/
  mica-core/       # domain models, RecordId/ULID, Record types, errors, schema versions
  mica-vault/      # vault create/open/scan, file tree, path rules, atomic writes, backups
  mica-markdown/   # Markdown+frontmatter parse/serialize, block model, wiki links, embeds
  mica-db/         # database JSON model, deterministic serializer, filter/sort engine
  mica-drawio/     # scene model, mxGraph XML parse/serialize, validation
  mica-search/     # SQLite index: FTS5, links, tags, rows; rebuild pipeline
  mica-watch/      # notify-based watcher, debouncer, event classification, self-write filter
  mica-assets/     # attachment ingest, thumbnails
  mica-import/     # Markdown folder import; CSV import (P1); drawio import (P1); Obsidian Canvas + Excalidraw import (P2)
  mica-export/     # Markdown/JSON/CSV export; canvas PNG/SVG/PDF export (P1); Obsidian Canvas + Excalidraw export (P2)
  mica-tauri/      # Tauri command bindings, event bridge, app state
```

### 5.1 RecordStore abstraction (PRD §18.5)

```rust
trait RecordStore {
    fn load(&self, id: &RecordId) -> Result<Record>;
    fn load_by_path(&self, path: &VaultPath) -> Result<Record>;
    fn save(&self, record: &Record) -> Result<SaveResult>;   // atomic write
    fn delete(&self, id: &RecordId) -> Result<()>;           // moves to OS trash
    fn rename(&self, id: &RecordId, to: &VaultPath) -> Result<()>;
    fn watch(&self) -> RecordEventStream;
}
```

Record variants: `NoteRecord`, `DatabaseRecord`, `CanvasRecord`, `AssetRecord`, `WorkspaceConfigRecord`. `VaultPath` is a validated vault-relative path (rejects traversal outside the vault, normalizes separators — NFR-PORT-004).

### 5.2 Atomic writes (FR-FS-005, NFR-REL-001)

Every canonical save:

1. Serialize to bytes; verify re-parse succeeds (self-check).
2. Write to `<file>.tmp.<ulid>` in the same directory.
3. `fsync` the temp file.
4. `rename` over the target (atomic on all target platforms).
5. Record content hash for self-write filtering.

Deletes go to the OS trash, never `unlink`. Destructive migrations snapshot to `.workspace/backups/` first (NFR-REL-002).

### 5.3 Backups

`.workspace/backups/<timestamp>/` snapshots created: on explicit user command, before format migrations, and before conflict overwrites. Snapshot = copy of affected canonical files (or full vault for the manual command). Retention configurable.

---

## 6. Tauri Command API

Typed bindings generated for TypeScript (e.g. via `specta`/`tauri-specta`). Representative surface (MVP):

**Vault:** `vault_create(path)`, `vault_open(path)`, `vault_close()`, `vault_tree()`, `vault_reveal(path)`, `vault_open_external(path)`, `vault_backup()`

**Notes:** `note_create(dir, title)`, `note_load(path)`, `note_save(path, content, base_version)`, `note_rename(path, new_path)`, `note_delete(path)`, `note_duplicate(path)`

**Databases:** `db_create(dir, title)`, `db_load(path)`, `db_update_schema(path, ops)`, `db_row_create/update/delete(path, …)`, `db_view_create/update(path, view)`, `db_query(path, view_id, page)` — filtered/sorted/paged rows for virtualized rendering

**Canvas:** `canvas_create(dir, title)`, `canvas_load(path)`, `canvas_apply(path, ops, base_version)` — batched scene operations, `canvas_export(path, format)` (P1)

**Search:** `search_query(text, limit)`, `search_quick_switch(text)`, `links_backlinks(path)`, `links_outgoing(path)`, `tags_list()`, `index_rebuild()`

**Conflicts:** `conflict_resolve(path, resolution)` where resolution ∈ `keep_mine | take_theirs | keep_both`

**Events (core → frontend):** `file:changed | file:created | file:deleted | file:renamed`, `index:updated`, `conflict:detected`, `vault:scan_progress`, `save:status`

All save/apply commands carry a `base_version` (content hash the edit was based on); the core rejects saves over a newer on-disk version, converting the situation into a conflict instead of a silent overwrite.

---

## 7. Indexing and Search

Single SQLite database at `.workspace/index/index.db` (D4). **Fully rebuildable** from canonical files; a schema-version mismatch or corruption triggers automatic rebuild.

### 7.1 Schema (summary)

```sql
files(id, path, kind, title, content_hash, mtime, size, note_id)          -- all vault files
notes_fts USING fts5(title, body, tags, path UNINDEXED)                   -- full text (FR-SRCH-001)
links(source_file, target_path, target_block, kind, resolved)            -- wiki + md links → backlinks
tags(file_id, tag)                                                        -- #tags + frontmatter tags
db_rows_fts USING fts5(db_path, row_id UNINDEXED, text)                   -- row text (FR-SRCH-002, P1)
canvas_labels_fts USING fts5(canvas_path, cell_id UNINDEXED, label)       -- canvas labels (P1)
meta(key, value)                                                          -- index schema_version, vault stats
```

### 7.2 Pipelines

- **Initial scan:** parallel walk (rayon) → parse → batched inserts in one transaction per N files; progress events to UI; UI is usable while indexing completes progressively (PRD §30 "indexes progressively"). Target: 10,000 notes + 1 GB assets < 60 s (NFR-PERF-002).
- **Incremental:** watcher/save events update only affected rows. Renames re-point `links` rows by note `id` match.
- **Warm start:** on open, compare stored `(path, mtime, size, content_hash)` against disk; re-index only diffs. Target: < 2 s to interactive for 5,000 notes (NFR-PERF-001).
- **Query:** FTS5 with prefix matching for quick switcher; `snippet()` + `highlight()` for result display. Target: < 150 ms typical (NFR-PERF-003), p95 < 250 ms.

---

## 8. File Watching and Conflict Handling

### 8.1 Watcher (FR-FS-001/002)

- `notify` recursive watch on vault root; `.workspace/` internals excluded (except `config.json`).
- Debounce window ~200 ms with coalescing (create+modify → create; create+delete → drop). Bulk changes (Git checkout, sync tools) collapse into a batched rescan of affected subtrees; UI receives one aggregated event.
- Rename detection: platform events where available, else delete+create matched by frontmatter/JSON `id` (PRD §15.1.4).
- Watchdog: if event streams look unreliable (platform quirks), fall back to targeted rescans.

### 8.2 Conflict model (FR-FS-003, PRD §15.1)

Per open document, the core tracks `disk_version` (hash at load) and `dirty` state:

| Scenario | Behavior |
|---|---|
| External change, no in-app dirty state | Auto-reload model + index; subtle UI notice |
| External change + in-app dirty state | `conflict:detected` → resolution panel: **keep mine** (backup theirs to `backups/`, save mine), **take theirs** (backup mine, reload), **keep both** (save mine as `<name> (conflict <timestamp>).md`) |
| File deleted externally while open | Prompt: restore (re-save buffer), save as new, or close |
| File renamed externally | Follow rename when `id` matches; else delete/create semantics |
| Git conflict markers detected (`<<<<<<<`) | File flagged conflicted; opens in source mode with marker highlighting |

---

## 9. Editor Specification (Tiptap)

### 9.1 Block types ↔ Markdown (FR-NOTE-003)

| Block/mark | Markdown | MVP |
|---|---|---|
| Paragraph, headings 1–6 | text, `#`–`######` | P0 |
| Bold / italic / strikethrough / inline code | `**` `*` `~~` `` ` `` | P0 |
| Bullet / numbered / task list (nested) | `-`, `1.`, `- [ ]` | P0 |
| Quote, divider | `>`, `---` | P0 |
| Code block with language | fenced ``` | P0 |
| Image | `![alt](relative/path)` | P0 |
| Link | `[text](url)` | P0 |
| Wiki link | `[[Target]]`, `[[Target#Heading]]` | P0 |
| Table (GFM) | pipe table | P1 |
| Database embed | ` ```workspace-database ` fence | P0 (with DB phase) |
| Raw/unknown block | preserved verbatim | P0 |

### 9.2 Interactions (PRD §16.2)

- Slash menu (`/`) for block insertion with fuzzy filter (FR-NOTE-004).
- Markdown input shortcuts: `# `, `- `, `1. `, `> `, ` ``` `, `[] ` auto-convert as you type.
- Block drag handle + plus button in the gutter; block drag-and-drop reordering.
- Inline formatting toolbar on text selection.
- `[[` triggers note-link autocomplete; unresolved target offers "create note".
- Paste: Markdown parsed as Markdown; HTML converted best-effort; images auto-saved to assets folder.
- Autosave: debounced ~1 s after idle plus on blur/close/app-quit; save status in status bar (FR-SET-004 makes it configurable, P1).
- View modes (FR-NOTE-009, P1): rich editor ↔ Markdown source (CodeMirror) ↔ read-only preview, all backed by the same file.

### 9.3 Editor persistence path

Tiptap document ↔ core block model conversion happens in the frontend binding layer; the **Rust core owns Markdown serialization** (single serializer for saves, imports, and exports). Typing latency stays UI-local (< 16 ms frame budget, NFR-PERF-004); serialization + save happen off the input path on the debounced autosave.

Large-note strategy (50,000-word target): ProseMirror handles large docs natively; decorations (link resolution, spellcheck-adjacent features) computed lazily per viewport.

---

## 10. Database UI Specification

- **Table view (FR-DB-003):** virtualized rows (TanStack Virtual) for 10k rows (NFR-PERF-005); inline cell editing per property type; column add/remove/rename/retype, resize, hide/show, reorder; sort and filter toolbars persisting to the view.
- **Kanban view (FR-DB-004):** grouped by a `select` property; drag cards between columns (updates the select value) and within columns (updates per-group order); column add = new select option.
- **Row detail:** side-peek panel with all properties; `note_link` rows can open/create their linked note (FR-DB-010, P1).
- **Embedded in notes (FR-DB-002):** the `workspace-database` fence renders as a live interactive view; toolbar to switch views, open full-page.
- **Schema edits** are structural operations (add/rename/retype property) sent to the core, which migrates existing cells conservatively (retype keeps raw values where coercion fails, flags them).
- Mutations are optimistic in the UI; the core save confirms or rolls back.

---

## 11. Canvas Specification

### 11.1 Scene model

App-owned scene graph (mirrors §4.4 mapping): `Scene { id, name, cells: Vec<Cell> }`, `Cell = Shape | Text | Sticky | Connector | Frame | NoteLink | DatabaseLink`, each with ULID, geometry, style, optional parent (frame). Z-order = cell order.

### 11.2 Rendering & interaction (FR-CAN-002/003, PRD §16.4)

- SVG renderer inside a pan/zoom viewport (CSS transform); world↔screen coordinate mapping.
- Culling: only cells intersecting the viewport render; target smooth pan/zoom at 2,000 objects (NFR-PERF-006). If SVG hits limits, hot paths (drag previews, selection) move to a canvas overlay.
- Tools: select (click, marquee, multi-select), hand/pan, rectangle, ellipse, diamond, text, sticky note, connector (snaps to shape anchors), frame.
- Manipulation: move, resize handles, delete, duplicate; connectors stay attached to endpoints.
- Note/database drops from sidebar create link cells (FR-CAN-004); double-click opens the source record.
- Zoom 10%–400%, zoom-to-fit, zoom-to-selection.

### 11.3 Persistence

Frontend sends batched scene ops (`add/update/remove cells`) with `base_version`; core applies to the scene model, serializes deterministic XML, writes atomically. Full reload on external change (canvas conflict handling identical to notes).

---

## 12. Search & Navigation UX (FR-SRCH-*)

- **Global search** (⌘/Ctrl+Shift+F): FTS across notes (P0), DB rows and canvas labels (P1); results show title, path, highlighted snippet; Enter jumps to match.
- **Quick switcher** (⌘/Ctrl+P): fuzzy title/path/alias matching across notes, databases, canvases; recent files ranked first.
- **Command palette** (⌘/Ctrl+K): all app commands, keyboard-first.
- **Sidebar:** file tree (mirrors real folders, drag to move files), favorites, recents, tag browser (`#tag` + frontmatter tags).
- **Right panel:** outline (headings), backlinks with context snippets, outgoing links, note properties (frontmatter editor).
- **File transparency (PRD §16.5):** every record's context menu has Reveal in Finder/Explorer, Open in external editor, Copy relative path.

---

## 13. Import / Export

| Feature | Priority | Behavior |
|---|---|---|
| Import Markdown folder (FR-IMP-001) | P0 | Open-in-place (non-destructive) or copy-into-vault; links/tags indexed as-is |
| Export notes as Markdown (FR-EXP-001) | P0 | Standard Markdown; app fences included as-is; optional "strip app metadata" mode |
| Import CSV → database (FR-IMP-002) | P1 | Column-to-property-type mapping UI |
| Export database JSON/CSV (FR-EXP-002) | P1 | CSV flattens cells; JSON is the canonical file |
| Import `.drawio` (FR-IMP-003) | P1 | Supported shapes render; unknown preserved |
| Export canvas PNG/SVG/PDF (FR-EXP-003) | P1 | SVG from renderer; PNG/PDF via rasterization |
| Import/export Obsidian Canvas `.canvas` | P2 | Mapping per §4.4.1; import creates a `.drawio` canvas |
| Import/export Excalidraw `.excalidraw` | P2 | Mapping per §4.4.1; freehand degrades on import |

---

## 14. Settings (FR-SET-*, all P1)

Global settings in app config dir; per-vault overrides in `.workspace/config.json`. MVP surface: theme (light/dark/high-contrast), editor + monospace font and size, attachment folder, file-naming strategy (kebab-slug default | title-case | timestamp | template), autosave interval, reduced motion. Telemetry: **none** (NFR-SEC-002).

---

## 15. Non-Functional Requirements (verification targets)

| ID | Target | Primary mechanism |
|---|---|---|
| NFR-PERF-001 | Warm start < 2 s @ 5k notes | mtime/hash diff against persisted index |
| NFR-PERF-002 | Initial scan < 60 s @ 10k notes + 1 GB | parallel parse, batched transactions, progressive UI |
| NFR-PERF-003 | Search < 150 ms typical | FTS5, prepared statements |
| NFR-PERF-004 | No typing lag @ 50k words | UI-local editing, off-path serialization, viewport decorations |
| NFR-PERF-005 | 10k-row tables | virtualized rendering, paged `db_query` |
| NFR-PERF-006 | 2k-object canvas | viewport culling, transform-based pan/zoom |
| NFR-REL-001…005 | Data safety | atomic writes, trash-not-delete, backups, rebuildable index, schema versions |
| NFR-SEC-001…004 | Privacy | fully offline, zero telemetry, no network egress without explicit action, confirmed external-link opens |
| NFR-PORT-001…005 | Portability | formats per §4, relative paths, Unicode paths/content |

Performance is verified by benchmarks in CI against generated fixture vaults (1k / 5k / 10k notes) — see implementation plan.

---

## 16. File Format Versioning & Migrations (PRD §19)

- Every app-created file carries a schema version (`schema_version` frontmatter key / JSON field / `data-workspace-schema-version` XML attribute).
- Migrations are idempotent, snapshot to `backups/` first, previewable for bulk changes, and **lazy** — a file migrates only when the user edits it; the app never rewrites the whole vault on version bump.
- Readers accept all prior versions within a major release.

---

## 17. Security & Privacy

- No network access in MVP code paths; Tauri allowlist grants no HTTP scope.
- Tauri FS scope restricted to the opened vault + app config dir.
- External links open via OS default browser only on explicit click with visible URL (NFR-SEC-004).
- Path traversal outside the vault rejected at the `VaultPath` boundary.
- No telemetry, no crash reporting without opt-in.

---

## 18. Testing Strategy (PRD §29, §30)

| Layer | Approach |
|---|---|
| Parsers/serializers | Golden-file fixtures (committed); round-trip property tests (`proptest`): parse∘serialize = id, serialize∘parse = id; fuzzing on Markdown/JSON/XML parsers |
| Determinism | Same logical model serialized twice → byte-identical; diff-minimality tests (single edit → single-hunk diff) |
| Data safety | Crash-during-save simulation (kill between temp write and rename); invalid-input tests (bad JSON/XML never overwritten); the full PRD §30 matrix as integration tests |
| Watcher/conflicts | Integration tests driving real FS events on macOS/Windows/Linux CI; debounce/burst tests |
| Index | Rebuild-equivalence: incremental index state == from-scratch rebuild |
| Performance | Criterion benchmarks + fixture vaults; regression gates in CI |
| Frontend | Component tests (Vitest + Testing Library); Playwright/WebDriver E2E for core journeys (PRD §10) |
| Manual QA | Data-loss checklist before each release (PRD §22.9) |

---

## 19. Traceability

Every FR/NFR ID from the PRD maps to a phase and work item in [implementation.md](implementation.md). MVP release criteria are PRD §22; the implementation plan's phase exit criteria roll up to them.
