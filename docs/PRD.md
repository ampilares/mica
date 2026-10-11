# Product Requirements Document: Mica v2 — AFFiNE experience, files-first

**Version:** 2.0 (supersedes PRD 0.1, preserved in git history)
**Date:** 2026-07-20
**Status:** Approved for implementation
**Reference implementation studied:** `references/AFFiNE` (source checkout)

---

## 1. Executive summary

Mica v1 shipped an Obsidian-shaped shell (activity rail, file tree, tabs,
source/rich toggle) over a Rust files-first core. **Mica v2 replaces the entire
UI/UX with AFFiNE's product model** — doc-centric navigation, dual-mode
Page/Edgeless documents, journals, collections, tags, favorites, and trash —
while keeping Mica's non-negotiable differentiator:

> Every canonical record is an ordinary file in a folder the user owns.
> Notes are Markdown, databases are deterministic JSON, canvases are
> uncompressed draw.io XML. Everything else is a rebuildable cache.

AFFiNE persists workspaces as Yjs CRDT binaries inside SQLite/IndexedDB. Mica
v2 reproduces AFFiNE's UX **without that database**: each AFFiNE concept is
mapped onto a file-native representation (§6). Where AFFiNE relies on
DB-backed infrastructure (doc metadata queries, trash, collections), Mica
builds equivalent components on the Rust core (search index, vault config,
`.trash/` folder).

## 2. What changes from v1

| Area | v1 (Obsidian-shaped) | v2 (AFFiNE-shaped) |
|---|---|---|
| Navigation | Activity rail + file tree + tabs | Sidebar: Quick search, All docs, Journals, Collections, Tags, Favorites, Organize (folders), Trash |
| Primary object | File in a tree | Doc (title-first); folders demoted to "Organize" section |
| Note vs canvas | Separate file types opened separately | Every doc has **Page** and **Edgeless** modes, toggled in the header |
| Home | Last-opened tabs | **All docs** list page with sort/filters/grouping |
| Daily notes | none | **Journals** with date navigation and calendar panel |
| Delete | Permanent delete | **Trash** with restore / delete-forever |
| Metadata | Frontmatter only, invisible | **Doc info panel** editing frontmatter properties |
| Right panel | Backlinks/outline mixed | AFFiNE panels: Outline (TOC), Info, Journal calendar; bi-directional links section at doc bottom |
| Organization | Folders only | Favorites, Collections (saved queries + manual), Tags pages, plus folders |
| Visual language | Obsidian-ish dark grey | AFFiNE visual language: white/quiet surfaces, rounded 8px cards, subtle borders, accent `#1E96EB`, Inter-style type |

The Rust core (vault, markdown, db, drawio, search, watch crates) is retained
and extended — this is a frontend product rewrite plus targeted backend
additions, not a core rewrite.

## 3. Goals / non-goals

### Goals
1. Feature and UX parity with AFFiNE's local (non-cloud) experience wherever a
   file-native mapping exists: docs list, journals, dual-mode docs, block
   editor with slash menu, databases (table/kanban), edgeless whiteboard,
   frames + presentation, favorites, collections, tags, trash, doc properties,
   outline, backlinks, quick search, split-free tabbed windowing, settings.
2. Preserve every v1 file guarantee: deterministic serialization, atomic
   writes, external-edit detection and conflict UI, index rebuildability,
   Git-friendly diffs, vault portability.
3. A vault created by v1 (or a plain folder of `.md`) opens in v2 with no
   migration.

### Non-goals (v2)
- Real-time multi-user collaboration, cloud sync, accounts (AFFiNE Cloud).
- AI copilot features.
- Mobile apps.
- BlockSuite code reuse — AFFiNE's editor stack is inseparable from Yjs; Mica
  keeps its Tiptap-based editor and custom canvas, restyled and extended to
  match AFFiNE behavior.
- Full mind-map/pen/template parity on canvas (post-v2; basic shapes, sticky,
  connectors, frames, text, embeds ship in v2).

## 4. Product model (AFFiNE parity map)

| AFFiNE concept | Mica v2 file-native mapping |
|---|---|
| Workspace | Vault folder |
| Doc (page mode) | `*.md` with YAML frontmatter |
| Doc (edgeless mode) | Sidecar `<name>.canvas.drawio` next to the `.md`; the page body appears on canvas as a linked note element |
| Standalone whiteboard | `.drawio` file (still supported, opens directly in edgeless) |
| Database block | `.database.json` + fenced embed in notes (unchanged) |
| Journals | `journals/YYYY-MM-DD.md`, frontmatter `journal: YYYY-MM-DD` |
| Favorites | `favorites` array in `.workspace/config.json` |
| Collections | `collections` array in `.workspace/config.json` (name + rules + manual doc list) |
| Tags | `#tag` + frontmatter tags (indexed by mica-search); tag colors in config |
| Trash | `.trash/` folder inside vault; restore = move back; 30-day auto-note in UI, purge on demand |
| Doc properties | Frontmatter keys (shown/edited in Info panel) |
| Doc history | Git/file-based (out of app scope in v2) |
| Quick search | `quick_switch` + `search_query` commands, AFFiNE-style cmd+K modal |

## 5. Functional requirements

P0 unless noted. IDs continue the v1 scheme; v1 requirements not listed here
remain in force (file safety, determinism, watcher, conflicts, search).

### 5.1 App shell & navigation
- FR2-NAV-001 Sidebar with sections: workspace header, Quick search trigger,
  All docs, Journals, Collections, Tags, Favorites, Organize (file tree),
  Trash, Settings gear, and a persistent **New doc** button.
- FR2-NAV-002 Main area renders one of: All-docs page, Journals page, Tag
  page, Collection page, Trash page, or a doc (Page/Edgeless).
- FR2-NAV-003 Tabs across the top (desktop-app parity); middle-click/x closes.
- FR2-NAV-004 Quick search modal (Ctrl/Cmd+K): docs by title, full-text
  results, "create new doc" action, recent docs when query empty.
- FR2-NAV-005 Sidebar collapsible (Ctrl/Cmd+/); widths persist.

### 5.2 All docs
- FR2-ALL-001 List view with columns: icon+title, tags, created, updated.
- FR2-ALL-002 Sort by updated/created/title asc/desc; group by none/date.
- FR2-ALL-003 Filters: kind (doc/whiteboard/database), tag, favorites-only.
- FR2-ALL-004 Row actions: open, favorite toggle, move to trash, reveal in
  explorer.
- FR2-ALL-005 (P1) Multi-select with bulk trash/favorite.

### 5.3 Dual-mode docs
- FR2-DOC-001 Doc header shows editable title, Page/Edgeless switch,
  favorite star, Info toggle, more-menu (reveal, open external, source mode,
  duplicate, move to trash, export).
- FR2-DOC-002 Switching to Edgeless creates/opens the sidecar canvas; the page
  body renders as a note card element linked to the `.md`.
- FR2-DOC-003 Page mode = block editor with slash menu, markdown shortcuts,
  wiki links, drag handles, inline formatting toolbar (v1 editor retained,
  restyled to AFFiNE).
- FR2-DOC-004 Standalone `.drawio` files open directly in Edgeless with the
  same toolbar; `.database.json` open as full-page databases.
- FR2-DOC-005 Bi-directional links section at the bottom of page mode listing
  backlinks with snippets.

### 5.4 Journals
- FR2-JRN-001 "Journals" opens today's journal doc, creating
  `journals/YYYY-MM-DD.md` on first visit.
- FR2-JRN-002 Header date navigation (prev/next/today) on journal docs.
- FR2-JRN-003 Right-panel calendar: month grid, dot on days with journals,
  click to open/create.
- FR2-JRN-004 Journal template (P1): new journals copy `templates/journal.md`
  if present.

### 5.5 Collections, tags, favorites
- FR2-COL-001 Create/rename/delete collections; a collection = manual doc
  list plus optional rules (tag equals, title contains).
- FR2-COL-002 Collection page shows matching docs in the all-docs list UI.
- FR2-TAG-001 Tags page lists tags with counts; tag page lists tagged docs.
- FR2-TAG-002 (P1) Tag colors, editable in UI, persisted in config.
- FR2-FAV-001 Favorite from doc header, all-docs row, or sidebar context
  menu; favorites section in sidebar lists them.

### 5.6 Trash
- FR2-TRS-001 "Move to trash" relocates the file (and sidecar canvas) to
  `.trash/` preserving relative path; watcher/index treat it as deleted.
- FR2-TRS-002 Trash page lists items with original path and deleted time;
  restore moves back (auto-renaming on collision); delete-forever removes.
- FR2-TRS-003 Empty-trash action with confirmation.

### 5.7 Doc info (properties)
- FR2-NFO-001 Info panel shows created/updated, tags editor, and custom
  frontmatter properties (text/number/checkbox/date) with add/rename/delete.
- FR2-NFO-002 Property edits round-trip through frontmatter without
  disturbing note body or unknown keys.

### 5.8 Edgeless
- FR2-EDG-001 AFFiNE-style bottom-center toolbar: select, hand, note/sticky,
  shape (rect/ellipse/diamond), connector, text, frame; zoom controls
  bottom-left (fit, %, +/-).
- FR2-EDG-002 Frames panel in right sidebar; presentation mode steps through
  frames (P1).
- FR2-EDG-003 Drag docs/databases from sidebar or link via toolbar to place
  linked cards on canvas.

### 5.9 Settings
- FR2-SET-001 AFFiNE-style settings dialog with sections: Appearance (theme,
  fonts), Editor (default mode, page width), Workspace (name, dirs, naming),
  Shortcuts, About.

## 6. Non-functional requirements

All v1 NFRs stand (startup <2 s warm for 5k notes, search <150 ms, atomic
writes, rebuildable index, offline-only). Additional:

- NFR2-001 All-docs page renders 10k docs virtualized without jank.
- NFR2-002 Mode switch (Page↔Edgeless) < 200 ms for typical docs.
- NFR2-003 Trash/restore operations are plain `rename` ops — atomic on same
  volume, never copy-delete when rename is possible.
- NFR2-004 Config-stored metadata (favorites/collections) is written through
  the existing deterministic config serializer; unknown keys preserved.

## 7. Release criteria

v2 beta ships when: shell+sidebar, all-docs, journals, trash, favorites,
tags, collections, dual-mode docs, info panel, outline, backlinks section,
quick search, and settings all function against a v1 vault with zero
migration; `cargo test` and frontend typecheck/build pass; manual QA confirms
no data-loss in trash/restore, mode-switch, and external-edit flows.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Edgeless sidecar drifts from its `.md` (rename/move) | Rename/move ops always pair the sidecar; watcher matches by name |
| Config-file metadata (favorites/collections) conflicts under file sync | Config writes are last-writer-wins, low-value data; documented |
| AFFiNE look-alike without BlockSuite falls short of feel | Parity targets behavior, not pixel cloning; iterate on styling |
| Trash folder synced by Git surprises users | `.trash/` documented; suggested `.gitignore` entry offered in UI |
