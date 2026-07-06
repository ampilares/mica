# Implementation Plan: Mica

**Version:** 0.1
**Date:** 2026-07-06
**Status:** Draft for review
**Sources:** [PRD.md](PRD.md), [specifications.md](specifications.md)

---

## 1. Approach

The MVP covers the full PRD scope (notes + databases + canvas), built in **priority order**: the P0 critical path ships first, and each phase ends with something usable and safe. Two rules hold across every phase:

1. **Data safety and performance are not phases — they are gates.** Atomic writes, round-trip tests, and performance budgets are built and enforced from Phase 1 onward, not retrofitted.
2. **A phase is done when its exit criteria pass**, including the relevant rows of the PRD §30 data-safety matrix and the NFR performance targets for the features it delivers.

Phase ordering by value and dependency:

```text
Phase 0  Foundations & format de-risking          (~2-3 weeks)
Phase 1  Vault + Markdown notes core        [P0]  (~6-8 weeks)   ← the daily-driver heart
Phase 2  Search, links & navigation         [P0]  (~4-5 weeks)
Phase 3  Databases                          [P0]  (~5-6 weeks)
Phase 4  Canvas                             [P0]  (~5-6 weeks)
Phase 5  MVP hardening & private beta       [P0]  (~4-5 weeks)   ← PRD §22 release criteria
Phase 6  Post-MVP: P1 features (beta)             (~6-8 weeks)
Phase 7  Post-MVP: P2 & 1.0 track                 (ongoing)
```

Phases 3 and 4 have no dependency on each other and can overlap if there is more than one developer. Estimates assume 1–2 engineers and will be recalibrated after Phase 1.

---

## Phase 0 — Foundations & Format De-Risking

**Goal:** Kill the highest technical risks before building UI, and stand up the skeleton everything else grows in. (PRD Roadmap Phase 0.)

### Work items

**Scaffolding**
- [ ] Cargo workspace with crate skeletons: `mica-core`, `mica-vault`, `mica-markdown`, `mica-db`, `mica-drawio`, `mica-search`, `mica-watch`, `mica-tauri` (others stubbed).
- [ ] Tauri 2.x app shell + React/TypeScript/Vite frontend; typed IPC binding generation (`tauri-specta`); window opens, one round-trip command works.
- [ ] CI on macOS/Windows/Linux: fmt, clippy, tests, frontend lint/typecheck, debug build.
- [ ] `mica-core`: ULID-based typed IDs, `VaultPath` (traversal-safe relative paths), error types, schema-version constants.

**Risk spikes (each produces a go/no-go writeup)**
- [ ] **Markdown round-trip spike:** `pulldown-cmark` parse → block model → deterministic serializer; prove byte-identical idempotence on a corpus of real-world Markdown (incl. an Obsidian vault export). This is the make-or-break spike.
- [ ] **draw.io compatibility spike:** generate `.drawio` XML from a scene model (shapes, connector, sticky, note-link placeholder) and verify it opens correctly in the draw.io desktop app; re-read our own output.
- [ ] **Tiptap block-UX spike:** slash menu, drag handle, Markdown input shortcuts on a 10k-word doc; measure typing latency.
- [ ] **Watcher spike:** `notify` behavior survey on all three OSes — rename events, editor save patterns (vim atomic rename, VS Code), debounce tuning.
- [ ] **FTS5 spike:** index 10k generated notes; measure scan time and query latency against NFR targets.

**Test infrastructure**
- [ ] Golden-fixture harness (committed fixture files + snapshot comparison).
- [ ] `proptest` round-trip harness for `mica-markdown`.
- [ ] Fixture-vault generator (1k / 5k / 10k notes + assets) for benchmarks, reused in every later phase.

### Exit criteria
- All five spikes pass their targets or have an approved mitigation.
- CI green on all three platforms.
- Round-trip property tests run in CI.

---

## Phase 1 — Vault + Markdown Notes Core [MVP / P0]

**Goal:** A fast, safe, daily-usable Markdown notes app: create/open a vault, edit notes in a Notion-like block editor, everything saved as clean Markdown with atomic writes, external edits detected. This phase is the performance and data-safety foundation for everything after it.

**Requirements covered:** FR-VLT-001…005 · FR-NOTE-001…006, 008 · FR-FS-001…005 · FR-SRCH-003 · FR-IMP-001 · FR-EXP-001 · NFR-REL-001…004 · NFR-PERF-004 · NFR-PORT-001/004/005

### Work items

**Rust core**
- [ ] `mica-vault`: vault create (folder structure + `.workspace/config.json`), open, open-plain-Markdown-folder (zero-migration), recursive scan, file-tree model, nested-vault warning.
- [ ] `mica-vault`: **atomic write pipeline** (serialize → self-check re-parse → temp file → fsync → rename), delete-to-OS-trash, rename/move with link awareness (link rewriting lands in Phase 2).
- [ ] `mica-markdown`: production parser/serializer per spec §4.2 — frontmatter (fixed key order, unknown keys preserved), all P0 blocks, raw-block preservation for unknown syntax, wiki-link and `workspace-database`-fence recognition, inline `{#block_id}` parsing (emission comes with references in Phase 2).
- [ ] `mica-watch`: recursive watcher, 200 ms debounce + event coalescing, self-write filter (content-hash tagging), rename matching by frontmatter `id`, batched-rescan fallback for bulk changes.
- [ ] Conflict detector: `base_version` check on save; dirty-state vs external-change classification; `keep mine / take theirs / keep both` resolution ops (spec §8.2); deleted-while-open and Git-marker detection.
- [ ] `mica-import` / `mica-export` (P0 slice): open-in-place or copy-in Markdown folder import; export selected notes as standard Markdown.
- [ ] `mica-tauri`: vault, note, and conflict command surface + file/save/conflict event bridge (spec §6).

**Frontend**
- [ ] App layout: left sidebar (file tree, recents), tabbed main editor area, status bar (save status, word count).
- [ ] Tiptap editor with all P0 blocks; slash menu; Markdown input shortcuts; inline formatting toolbar; block drag handle + reorder; image paste → assets folder.
- [ ] Wiki-link autocomplete on `[[` (resolution against file tree in this phase; index-backed in Phase 2); unresolved-link styling + create-note flow.
- [ ] Debounced autosave (~1 s idle + blur/close/quit) with save-status indicator.
- [ ] External-change UX: silent reload when clean; conflict resolution panel when dirty; deleted/renamed-file prompts.
- [ ] File operations UI: create/rename/move/duplicate/delete from sidebar + palette; Reveal in Finder/Explorer, Open in external editor, Copy relative path.
- [ ] Vault onboarding: create vault / open vault / open folder-as-vault flows.

**Quality gates built in this phase**
- [ ] Golden + property round-trip suite covering every P0 block (spec §18).
- [ ] Crash-during-save simulation test (kill between temp write and rename → original file intact).
- [ ] Watcher integration tests on all three OSes in CI.
- [ ] Editor latency benchmark: p95 input < 16 ms on a 50,000-word note (NFR-PERF-004).

### Exit criteria
- A user can live in the app for plain notes: vault → write → link → external edit → conflict handling, offline.
- Untouched files are never modified; unknown Markdown survives edits verbatim.
- PRD §30 rows: crash-during-save, external-modify, deleted-index rebuild (n/a until Phase 2 — deferred), renamed-externally, unknown-file preservation — all pass.
- Editor latency benchmark passes in CI.

---

## Phase 2 — Search, Links & Navigation [MVP / P0]

**Goal:** Make the vault navigable at scale: full-text search, backlinks, tags, quick switcher — with index rebuild guarantees and the PRD's startup/scan/search performance targets.

**Requirements covered:** FR-SRCH-001, 003…005 · FR-NOTE-005 (full resolution), 007 · FR-SET (none) · NFR-PERF-001…003 · NFR-REL-004

### Work items

**Rust core**
- [ ] `mica-search`: SQLite schema (spec §7.1), initial parallel scan with progress events, incremental updates from watcher/save events, warm-start mtime/hash diff, automatic rebuild on corruption or schema mismatch, `index_rebuild` command.
- [ ] Link graph: `links` table from wiki + Markdown links; backlink and outgoing-link queries; rename/move updates link rows **and rewrites relative links in referring files** (deterministic, minimal-diff edits).
- [ ] Tag extraction: inline `#tag` + frontmatter tags.
- [ ] Block IDs: emit `{#block_<ulid>}` on first reference; `[[Note#Heading]]` resolution.
- [ ] Search queries: ranked FTS with snippets/highlights; prefix-mode for quick switcher; alias-aware title matching.

**Frontend**
- [ ] Global search panel (⌘/Ctrl+Shift+F) with highlighted snippets, jump-to-match.
- [ ] Quick switcher (⌘/Ctrl+P): notes/databases/canvases by fuzzy title/path/alias, recents first (FR-SRCH-004).
- [ ] Command palette (⌘/Ctrl+K) with keyboard-first command coverage.
- [ ] Right panel: outline, backlinks with context, outgoing links.
- [ ] Tag browser in sidebar; clicking a tag = filtered search.
- [ ] Index progress UI for large vault opens; degraded-gracefully search while indexing.

### Exit criteria
- Search < 150 ms typical / p95 < 250 ms on the 10k fixture vault (CI benchmark).
- Warm start < 2 s @ 5k notes; initial scan < 60 s @ 10k notes + 1 GB assets (CI benchmark).
- Deleting `.workspace/index/` rebuilds an equivalent index (rebuild-equivalence test).
- Backlinks update correctly after edits, renames, and external changes.

---

## Phase 3 — Databases [MVP / P0]

**Goal:** Structured data as deterministic JSON files: table and kanban views, embeddable in notes, safe under Git.

**Requirements covered:** FR-DB-001…007 · FR-SRCH-002 (rows, pulled forward from P1 if time allows) · NFR-PERF-005

### Work items

**Rust core**
- [ ] `mica-db`: full model per spec §4.3 — properties (all 9 P0 types), views (table, kanban), rows/cells; deterministic serializer (fixed key order, stable IDs, unchanged rows byte-identical).
- [ ] Filter/sort engine evaluated in Rust; `db_query(path, view_id, page)` returns filtered/sorted/paged rows for virtualized rendering.
- [ ] Schema operations (add/rename/retype/delete property) with conservative cell migration; select-option management.
- [ ] Row CRUD + kanban regroup/reorder ops; all writes through the atomic pipeline with `base_version` conflict handling (same model as notes).
- [ ] Diff-minimality tests: one cell edit → one-hunk Git diff.

**Frontend**
- [ ] Full-page database: virtualized table view (TanStack Table + Virtual) — inline cell editors per type, column resize/hide/reorder/add/rename/retype, sort + filter toolbars persisting to the view.
- [ ] Kanban view (dnd-kit): drag between groups (updates select value) and within groups (per-group order); add column = new option.
- [ ] Row side-peek panel.
- [ ] Note embeds: `workspace-database` fence renders as live view inside the editor; create-database from slash menu (`/database`) and sidebar; view switcher; open-full-page.
- [ ] Property schema editor panel.

### Exit criteria
- Journey PRD §10.2 works end-to-end; the JSON file is inspectable and diffs cleanly in Git.
- 10,000-row fixture database: smooth scrolling and editing (NFR-PERF-005 benchmark).
- Determinism suite: identical logical DB → byte-identical file; invalid JSON on disk is surfaced, never overwritten (PRD §30).
- External edits to `.database.json` reload or conflict exactly like notes.

---

## Phase 4 — Canvas [MVP / P0]

**Goal:** Infinite canvas persisted as readable draw.io-compatible XML, with links to notes and databases.

**Requirements covered:** FR-CAN-001…005 · NFR-PERF-006 · NFR-PORT-003

### Work items

**Rust core**
- [ ] `mica-drawio`: scene model (spec §11.1) ↔ deterministic uncompressed `mxfile` XML (spec §4.4); validation-before-save; prior-valid-version protection; unknown cells/attributes preserved.
- [ ] `canvas_apply` batched scene ops with `base_version`; atomic writes; conflict handling as with notes.

**Frontend**
- [ ] SVG viewport: pan (hand tool, space-drag, trackpad), zoom (10–400%, to-fit, to-selection), world/screen mapping, viewport culling.
- [ ] Tools: select (click/marquee/multi), rectangle, ellipse, diamond, text, sticky note, connector with shape-anchor snapping, frame (parent/child containment).
- [ ] Manipulation: move, resize handles, delete, duplicate; connectors track endpoints; z-order controls.
- [ ] Note/database link cells: drag from sidebar → placeholder cell with `data-workspace-*` attributes; double-click opens source (FR-CAN-004).
- [ ] Canvas creation from sidebar/palette; canvas tab type.

### Exit criteria
- Journey PRD §10.3 works end-to-end; the saved `.drawio` opens with a reasonable diagram in draw.io desktop (manual compatibility checklist, automated XML-shape assertions).
- Smooth pan/zoom at 2,000 objects on the fixture canvas (NFR-PERF-006 benchmark).
- Invalid XML on disk is surfaced, never overwritten; prior valid version retained (PRD §30).
- Re-saving an untouched foreign `.drawio` preserves unknown content.

---

## Phase 5 — MVP Hardening & Private Beta [P0]

**Goal:** Meet every PRD §22 release criterion; ship installers to private beta users.

**Requirements covered:** remaining P0 gaps · NFR-PERF-001…006 verification · NFR-SEC-001…004 · PRD §22 · PRD §30 full matrix

### Work items

**Data safety & robustness**
- [ ] Local backup/snapshot command (`vault_backup` → `.workspace/backups/<timestamp>/`) + retention policy.
- [ ] Full PRD §30 data-safety matrix automated where possible, scripted manual QA otherwise; fix everything it finds.
- [ ] Crash recovery: unsaved-buffer journal so a crash loses at most the autosave window.
- [ ] Conflict UX polish: diff preview in the resolution panel.
- [ ] Fuzzing pass on all three parsers; fix findings.

**Performance**
- [ ] Profile against 10k-note fixture vault: startup, scan, search, editor, table, canvas — close every NFR gap; lock CI regression gates.
- [ ] Memory audit on large vaults; asset/thumbnail cache behavior.

**Product completeness**
- [ ] Export flows exposed in UI (notes → Markdown; databases/canvases as files).
- [ ] Onboarding polish for the 3-minute activation target (PRD §21.1).
- [ ] Accessibility pass on core workflows: keyboard navigation, focus management, screen-reader labels, high-contrast theme, reduced motion (PRD §17.2).
- [ ] App icon, basic branding, in-app "where is my data" explainer (trust metric, PRD §21.3).

**Distribution**
- [ ] Release builds + installers: macOS universal (signed + notarized), Windows (signed MSI/NSIS), Linux (AppImage + deb + rpm).
- [ ] Versioned release pipeline in CI; crash-free smoke test suite per platform.
- [ ] Beta documentation: vault format docs (the file formats are a public promise), getting-started guide.

### Exit criteria — MVP release (PRD §22)
1. Vault create/open works. ✅ Phase 1
2. Markdown round-trips stably. ✅ Phase 1
3. Databases create/edit/save to JSON. ✅ Phase 3
4. Canvas creates/edits/saves `.drawio`. ✅ Phase 4
5. Watcher handles external changes safely. ✅ Phases 1–4
6. Full-text search works. ✅ Phase 2
7. Index rebuilds from files. ✅ Phase 2
8. Serializer/parser + conflict test coverage. ✅ continuous
9. Manual QA: no data loss in common workflows. ⬅ this phase
10. Installers for macOS/Windows/Linux. ⬅ this phase

---

## Phase 6 — Post-MVP: P1 Features (Public-Beta Track)

**Goal:** Round out the P1 requirement set based on beta feedback. Order within this phase is adjustable; suggested sequence by expected impact:

1. **Editor view modes** (FR-NOTE-009): Markdown source mode (CodeMirror) + preview — also the Git-conflict-marker editing surface.
2. **Settings** (FR-SET-001…004): theme, fonts, attachment folder, naming strategy, autosave/format-on-save.
3. **Multiple views per database** (FR-DB-009) and **linked note rows** (FR-DB-010).
4. **CSV import/export** (FR-IMP-002, FR-EXP-002) with column-mapping UI.
5. **Search over DB rows and canvas labels** (FR-SRCH-002) if not pulled into Phase 3.
6. **Graph / link-explorer panel** (FR-SRCH-006).
7. **Canvas exports** PNG/SVG/PDF (FR-EXP-003 / FR-CAN-006) and **draw.io import hardening** (FR-IMP-003 / FR-CAN-007).
8. **Canvas frames navigation** (FR-CAN-008).
9. **Block-reference embeds** building on inline block IDs (FR-NOTE-010 completion).
10. **Performance tuning for very large vaults** (25k+ notes) from beta telemetry-free feedback.

**Exit criteria:** P1 requirement list closed or consciously deferred; public beta shipped.

---

## Phase 7 — Post-MVP: P2 & 1.0 Track

From PRD Phases 3–4 and post-MVP scope, in rough order:

- Gallery database view; formula/rollup properties; database relations.
- Presentation mode from canvas frames (FR-CAN-009).
- Git integration (commit/diff/pull/push in-app) — decision point per PRD open question 7.
- Plugin API design + sandbox model (NFR-SEC-005 gate before any third-party plugins).
- AFFiNE and Obsidian-Canvas import/export exploration.
- Sharded database row format for very large databases (migration path per spec §16).
- **1.0 hardening:** stable file-format guarantee + published format docs, migration tools, external security review, full accessibility audit, signed auto-update.
- Later horizons per PRD: mobile companion, encrypted/P2P sync, real-time collaboration (CRDT sidecar model, PRD §15.2), AI features.

---

## 2. Cross-Cutting Engineering Practices

- **Definition of Done for any file-format work** is PRD §29 verbatim: parser + diagnostics, deterministic serializer, round-trip tests, golden fixtures, external-edit tests, migration backups, unknown-content preservation, format docs.
- **Every canonical write** goes through the atomic pipeline; no direct `fs::write` to vault files anywhere (enforced by clippy lint config / code review checklist).
- **Benchmarks are CI gates**, not dashboards: a phase cannot merge a regression past its locked NFR budgets.
- **Three-platform CI always**: watcher and path behavior diverge per OS; platform-specific bugs are found in CI, not by beta users.
- **No network code paths** in MVP; Tauri capability allowlist reviewed each release.
- **Docs ship with features**: the vault format documentation is part of the product's trust promise and is updated in the same PR as format changes.

## 3. Top Risks Tracked Against This Plan

| Risk (PRD §24) | Owned in phase | Mitigation checkpoint |
|---|---|---|
| Block editor ↔ Markdown mismatch | 0, 1 | Round-trip spike gate; raw-block preservation; golden corpus incl. real Obsidian vaults |
| draw.io fidelity limits | 0, 4 | Compatibility spike; placeholder-shape strategy; manual draw.io checklist per release |
| Serializer data loss | 1, 3, 4 | Property tests + fuzzing + crash simulation + §30 matrix before beta |
| OS watcher variance | 0, 1 | Per-OS integration tests in CI; rescan fallback |
| Sync-tool conflicts | 1, 5 | `base_version` guard, conflict panel, keep-both default safety, backups |
| Custom canvas takes too long | 4 | Scoped MVP toolset; culling early; Phase 3/4 parallelizable to protect the timeline |
