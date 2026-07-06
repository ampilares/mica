# Build notes — 2026-07-07

Session state for whoever (human or agent) picks this up next.

## Where things stand

**MVP (commit 1)** is built and e2e-verified: full Rust workspace + Tauri 2
shell + React/Tiptap frontend. Verified by driving the real app over the
WebView2 devtools protocol — suites live in `tools/e2e/` (35 backend + 17 UI
checks, all passing at commit time).

**Phase 1–5 follow-up work (this commit)** is code-complete and typechecked
(`tsc` clean, `cargo check -p mica-tauri` clean, all Rust unit tests passing
at last run), but the final full-suite verification pass was intentionally
stopped before running. What was added:

### Rust core
- `SearchIndex::sync` — warm-start indexing by (mtime, size) diff; used on
  vault open instead of full rebuild (NFR-PERF-001).
- `note_rename` now rewrites relative Markdown links in referring notes
  (`mica_markdown::rewrite_links`, minimal-diff, tested).
- New commands: `note_duplicate` (fresh ULID for the copy), `asset_save`
  (base64 → `assets/images/`), `vault_backup` (snapshot to
  `.workspace/backups/<stamp>/`), `vault_import_folder` (copy-in, collision-
  safe), `vault_export`.
- `CanvasOp::ReorderCell` for z-order.
- New tests: link rewrite, backup, import, interrupted-save (crash window).
- `tauri.conf.json`: asset protocol enabled (+ `protocol-asset` feature) so
  vault images render in the editor.

### Frontend
- Command palette (Ctrl+K): new note/db/canvas, search, backup, import
  folder, export current, duplicate, reveal, rebuild index, where-is-my-data,
  close vault.
- Right panel (Ctrl+\\): outline, backlinks, outgoing links.
- Bubble formatting toolbar (bold/italic/strike/code/link) on selection.
- Image paste → saved to assets, displayed via asset protocol (`VaultImage`
  node view keeps the vault-relative src in the Markdown).
- DatabaseView rewritten: rows come from `db_query` (core-side sort/filter),
  sort + filter menus persisting to the view, column header menus
  (rename/hide/retype-lite/delete/add option), drag column resize persisted
  to `column_widths`, row side-peek panel, windowed row virtualization
  (~ROW_HEIGHT 34px, 10-row overscan).
- CanvasView rewritten: multi-select + shift-click, marquee select, group
  move (frames carry geometric contents), zoom-to-fit (Ctrl+1) / reset
  (Ctrl+0) / select-all (Ctrl+A) / duplicate (Ctrl+D), bring-front/send-back,
  drag a note/database from the sidebar onto the canvas → link cell.
- Conflict dialog now shows a compact line diff (mine vs disk) — `src/diff.ts`.
- DataExplainer modal; `docs/vault-format.md` public format docs.

## Not done yet (next session)

1. **Verification pass**: rebuild `target/debug/mica-tauri.exe`, restart the
   app + Vite (`npm run dev` in apps/desktop, port 1420), rerun
   `tools/e2e/backend.e2e.mjs` and `ui.e2e.mjs` with a fresh test vault at
   `C:/Users/Administrator/Documents/mica-test-vault`. There was an
   **uncommitted plan** to extend backend.e2e.mjs with checks 16–19
   (duplicate, backup, rename-link-rewrite, asset_save) — re-apply that.
2. New UI surfaces (palette, right panel, bubble menu, sort/filter, marquee,
   image paste) have no automated UI checks yet — extend `ui.e2e.mjs`.
3. Windows installer: `npx tauri build` from `crates/mica-tauri` (NSIS).
4. Remaining plan gaps: Markdown source mode (CodeMirror), CSV import/export,
   canvas PNG/SVG export, graph panel, settings UI, performance benchmarks
   against 10k-note fixture vaults, fuzzing.

## Environment notes

- Toolchain: Rust 1.96.1 MSVC, VS Build Tools 2022, Node 22.
- E2E driving: launch the exe with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`;
  dev builds expose `window.__mica = { api, useStore }` (dev only).
- Vite binds IPv6 `localhost` only — probe with `Invoke-WebRequest
  http://localhost:1420`, not 127.0.0.1.
- Gotchas already fixed once (don't reintroduce): Tiptap Suggestion needs
  distinct `pluginKey`s; tiptap-markdown escapes `[[` (see
  `restoreWikiLinks`); UTF-8 BOM tolerated in both frontmatter splitters;
  watcher treats Remove-of-existing-path as own-write replace.
