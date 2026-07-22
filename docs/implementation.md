# Implementation Plan: Mica v2 — AFFiNE experience, files-first

**Version:** 2.0 (supersedes plan 0.1, preserved in git history)
**Date:** 2026-07-20
**Sources:** [PRD.md](PRD.md), [specifications.md](specifications.md)

---

## 1. Approach

v2 is a **frontend product rewrite plus targeted Rust additions** on the
existing v1 core (vault/markdown/db/drawio/search/watch crates are kept).
Rules carried over from v1:

1. Data safety is a gate, not a phase — every new file operation (trash,
   sidecar pairing, meta patch) ships with atomic-write semantics and tests
   in the same change.
2. A phase is done when its exit criteria pass (`cargo test`, `tsc
   --noEmit`, and the listed manual checks) and the app still opens a v1
   vault unmodified.

```text
Phase R0  Backend enablers (Rust)            docs_list, trash, meta, sidecar
Phase R1  AFFiNE shell                       sidebar, view router, tabs, doc header
Phase R2  Doc-centric pages                  All docs, Trash, Tags, Collections, Favorites
Phase R3  Journals                           daily docs, calendar panel
Phase R4  Dual-mode docs                     page/edgeless toggle, sidecar canvas, edgeless toolbar
Phase R5  Doc panels                         Info (properties), Outline, Backlinks section, Quick search
Phase R6  Visual parity & polish             AFFiNE tokens/light-dark, settings dialog, keyboard map
Phase R7  Hardening                          e2e updates, perf on 5k-doc vault, docs refresh
```

R1→R2→R3 are sequential; R4 and R5 can follow R1 independently; R6 runs
throughout with a final pass.

---

## Phase R0 — Backend enablers

- `mica-vault`: `.trash/` module — move/list/restore/purge with `.meta.json`
  bookkeeping, collision renaming, sidecar pairing; exclusions in tree walk.
- `mica-markdown`: header-only frontmatter read (`meta_get`); frontmatter
  merge-patch (`meta_set`) preserving body bytes and unknown keys.
- `mica-tauri`: commands `docs_list`, `trash_move`, `trash_list`,
  `trash_restore`, `trash_purge`, `note_meta_get`, `note_meta_set`,
  `canvas_sidecar_ensure`; sidecar awareness in `note_rename`/`note_duplicate`.
- Index: remove trashed paths; ignore `.trash/` and `*.canvas.drawio`.

**Exit:** Rust unit tests for all of the above green; `docs_list` on the
5k-note bench vault < 150 ms.

## Phase R1 — AFFiNE shell

- `store.ts`: View union + tab model; localStorage persistence of layout.
- `Sidebar.tsx`: sections (Quick search, All docs, Journals, Collections,
  Tags, Favorites, Organize tree, Trash), New-doc button, settings gear,
  resizable, collapsible.
- `App.tsx`: view router; keyboard map per spec §3.4.
- `DocHeader.tsx`: title edit, mode switch UI (wired in R4), star, info
  toggle, more-menu (reveal/open-external/source/duplicate/trash/export).
- Remove ActivityRail/ModeToggle; fold RightPanel into new right-sidebar
  container shell.

**Exit:** app boots to All-docs placeholder, docs open in tabs via sidebar
tree and quick search; typecheck clean.

## Phase R2 — Doc-centric pages

- `AllDocsPage.tsx`: `docs_list` data, sort/group/filters, windowed list,
  row actions (open/star/trash/reveal).
- `TrashPage.tsx`: list/restore/purge/empty + undo toast.
- `TagsPage.tsx` + tag view; `CollectionPage.tsx` + rules editor.
- `workspaceMeta.ts`: favorites/collections/tag-colors through
  `config_get`/`config_set`; rename repair on vault events.

**Exit:** trash → restore round-trip loses nothing (manual + e2e);
collections with tag rule update live as docs change.

## Phase R3 — Journals

- Journal open/create flow, date navigation header, Alt+←/→.
- `JournalCalendar.tsx` in right sidebar; dots from `docs_list`.
- Template support via `journal_template` config key.

**Exit:** create today's journal, navigate days, calendar reflects existing
journal docs.

## Phase R4 — Dual-mode docs

- Mode toggle in DocHeader → `canvas_sidecar_ensure` → CanvasView on
  sidecar; note-card element rendering (title + preview, double-click to
  page).
- Edgeless toolbar restyle to AFFiNE bottom-center layout; zoom controls
  bottom-left; frames panel toggle.
- "Set as default mode" writes `primary_mode` via `note_meta_set`.

**Exit:** md+sidecar pair rename/trash/restore stays paired; standalone
`.drawio` still opens; mode switch < 200 ms.

## Phase R5 — Doc panels & quick search

- `InfoPanel.tsx`: created/updated, tags editor, custom properties CRUD via
  `note_meta_*`.
- `OutlinePanel.tsx`: headings TOC with scroll-to.
- `BacklinksSection.tsx` at doc bottom.
- `QuickSearch.tsx`: merged switcher+search modal, recents, create-doc
  action.

**Exit:** property edits round-trip frontmatter untouched elsewhere;
backlinks update after edits; quick search covers titles + full text.

## Phase R6 — Visual parity & polish

- `styles.css` rewrite to spec §3.5 tokens, light default + dark theme.
- Settings dialog restyle: Appearance / Editor / Workspace / Shortcuts /
  About.
- Empty states, toasts, confirm dialogs in AFFiNE style.

**Exit:** side-by-side review against AFFiNE screenshots; both themes clean.

## Phase R7 — Hardening

- Update e2e suite for new flows (all-docs, journals, trash, mode switch,
  favorites, collections).
- Perf validation on bench vault (NFR2-001/002).
- README + vault-format.md updates (trash, sidecar, config keys).

**Exit:** PRD §7 release criteria all pass.

---

## Status log

- 2026-07-20 — v2 plan adopted; execution started on branch `redesign`.
- 2026-07-20 — R0–R6 implemented: Rust enablers (docs_list, journal_ensure,
  trash, note_meta get/patch, sidecar pairing, index v3), AFFiNE shell
  (sidebar, tabs, doc header), All docs / Trash / Tags / Collections pages,
  Journals + calendar, Page/Edgeless dual-mode docs with sidecar canvases,
  Info/Outline panels, backlinks section, quick search, AFFiNE visual tokens
  (light default + dark). Verified: `cargo test` green (incl. new trash /
  meta / docs_list tests), `tsc --noEmit` clean, e2e suites green
  (backend 45/45, UI 27/27 incl. new v2 flows, phase6 22/22).
- 2026-07-22 — R7 complete: virtualized All-docs (windowed rendering above
  200 rows, 27 DOM rows for 5k docs), AFFiNE edgeless toolbar (bottom-center
  pill + bottom-left zoom cluster), frames panel + presentation mode,
  two-pane settings dialog (Appearance/Editor/Workspace/Shortcuts/About),
  bench tooling (tools/e2e/prepare-bench-vault.mjs + bench.e2e.mjs).
  Perf fix: tags(file_id) index (schema v4) — docs_list on 5,030 docs went
  4,341 ms → 45 ms; sidecar detection now one tree walk instead of one stat
  per doc. Bench (debug build): warm open 256 ms, docs_list 45 ms, search
  12 ms, cold index build 30 s for 5k docs. e2e: backend 45/45, UI 27/27,
  phase6 22/22, bench 5/5.
