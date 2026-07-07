# Build notes — 2026-07-07 (session 3)

Session state for whoever (human or agent) picks this up next.

## Where things stand

**MVP + Phase 1–5 features (commits 1–2)** are built and fully verified this
session: 45/45 backend + 17/17 UI e2e checks pass against the live app.
The verification pass the previous session left unfinished is done, including
the previously-lost plan to extend the backend suite (checks for duplicate,
backup, rename-link-rewrite, asset_save are now in `backend.e2e.mjs`).

**Phase 6 (P1 features) — this session** is code-complete and e2e-verified
(22/22 checks in the new `tools/e2e/phase6.e2e.mjs`):

- **Markdown source mode** (FR-NOTE-009): CodeMirror 6 raw-source editor with
  Rich/Source toggle (Ctrl+E), full-file editing incl. frontmatter — the Git
  conflict-marker surface. `SourceEditor.tsx`, `ModeToggle.tsx`.
- **Settings** (FR-SET): `SettingsDialog.tsx` (Ctrl+,) — theme
  (dark/light/system), UI/editor fonts + size, autosave delay (app-level,
  localStorage via zustand/persist in `settings.ts`); vault name, attachments
  folder, new-notes folder, naming strategy (vault-level, new `config_get`/
  `config_set` commands; `Vault::set_config` with `RwLock<VaultConfig>`;
  `naming: "slug" | "title"` drives `note_create` file names).
- **Multiple views per DB** (FR-DB-009): `view_add`/`view_delete`/`view_rename`
  ops; switcher UI (+ button, double-click rename, right-click delete).
- **Linked note rows** (FR-DB-010): `note_link` property type in the UI —
  clickable cell opens the note; picker resolves/creates by title.
- **CSV import/export** (FR-IMP-002/FR-EXP-002): `mica_db::csv` (RFC-4180
  reader, mapping import w/ new-property + select-option creation,
  view-ordered export); `csv_preview`/`db_import_csv`/`db_export_csv`
  commands; column-mapping dialog `CsvImportDialog.tsx` + CSV menu in the DB
  toolbar.
- **Search over DB rows + canvas labels** (FR-SRCH-002): indexed into FTS;
  INDEX_SCHEMA_VERSION bumped to 2 (old indexes rebuild on open).
- **Graph panel** (FR-SRCH-006): `SearchIndex::graph` + `link_graph` command;
  `GraphPanel.tsx` (Ctrl+G) — local graph (depth 2) or whole vault,
  deterministic force layout, click-to-open/recenter.
- **Canvas exports + interop**: PNG/SVG export from the live SVG (style
  inlining + rasterization; `export_file` command writes bytes);
  Obsidian Canvas + Excalidraw import/export (`mica_drawio::interop`,
  `canvas_import`/`canvas_export` commands, href re-basing between
  canvas-relative and vault-relative); frames navigation dropdown
  (FR-CAN-008, zoom-to-frame).
- **UI/UX redesign (first pass)**: Notion/AFFiNE-style token system in
  `styles.css` — refined dark + light palettes (`:root[data-theme=…]`),
  ghost buttons, pill hovers, layered shadows, slim scrollbars, modal
  animations, larger note titles, theme-aware canvas cell colors. Default
  theme is now `system`. Both themes screenshot-verified.

Rust: 50 tests green across the workspace. `tsc` clean.

## Not done yet (next session)

1. **Block-reference embeds** (FR-NOTE-010, Phase 6 item 10) — not started.
2. **Canvas PNG/SVG export**: implemented but not e2e-verified (needs the
   native save dialog; verify manually via canvas toolbar → Export).
3. **draw.io import hardening** beyond parse-through (FR-IMP-003 edge cases).
4. **Phase 6 item 11**: perf tuning on 25k-note vaults; benchmarks vs the 10k
   fixture vault remain a Phase 5 gate.
5. **UI redesign iteration**: first pass shipped; expect feedback rounds
   (typography scale, sidebar icons, empty states, onboarding polish) before
   Phase 5 hardening starts.
6. Then **Phase 5**: PRD §30 matrix, crash-recovery journal, fuzzing,
   perf gates, accessibility, installers (NSIS via `npx tauri build`).

## Environment notes

- Toolchain: Rust 1.96.1 MSVC (cargo at `~/.cargo/bin`, not always on PATH),
  Node 24, VS Build Tools 2022.
- E2E: see `tools/e2e/README.md`. Vault path is `MICA_E2E_VAULT` or
  `%USERPROFILE%/Documents/mica-test-vault`; `prepare-vault.mjs` builds the
  fixture. Suites run in order: backend → ui → phase6.
- E2E driving: launch the exe with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`;
  dev builds expose `window.__mica = { api, useStore }` (dev only).
- Vite binds IPv6 `localhost` only — probe with `Invoke-WebRequest
  http://localhost:1420`, not 127.0.0.1.
- Gotchas already fixed once (don't reintroduce): Tiptap Suggestion needs
  distinct `pluginKey`s; tiptap-markdown escapes `[[` (see
  `restoreWikiLinks`); UTF-8 BOM tolerated in both frontmatter splitters;
  watcher treats Remove-of-existing-path as own-write replace.
