# E2E test drivers

These scripts drive the **real running app** over the WebView2 DevTools
protocol (CDP) and verify behavior against real files on disk.

## Running

1. Pick a vault location (defaults to `%USERPROFILE%/Documents/mica-test-vault`;
   override with the `MICA_E2E_VAULT` env var) and create the fixture:

   ```powershell
   node tools/e2e/prepare-vault.mjs   # wipes + recreates the fixture vault
   ```

2. Start the Vite dev server: `npm run dev` in `apps/desktop`.
3. Launch the app with remote debugging:

   ```powershell
   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9223"
   .\target\debug\mica-tauri.exe
   ```

4. Run the suites in order (Node 22+, no dependencies):

   ```powershell
   node tools/e2e/backend.e2e.mjs     # IPC + file-on-disk critical path
   node tools/e2e/ui.e2e.mjs out.png  # DOM rendering + autosave round-trip
   node tools/e2e/phase6.e2e.mjs      # settings/views/CSV/graph/interop
   node tools/e2e/workspace-v2.e2e.mjs # split panes/tabs/history/persistence
   ```

The UI suite relies on the dev-only `window.__mica` hook exposed in
`apps/desktop/src/main.tsx` (dev builds only).

`workspace-v2.e2e.mjs` is dependency-free and checks the workspace store and
the DOM rendered by the real Tauri app. It covers split panes, pane-local tabs,
pinning, per-tab navigation history and source mode, MRU close selection, graph
tabs, sidebar state, and a snapshot API write/read round-trip. Run it against a
disposable fixture vault: the snapshot check intentionally writes
`.workspace/ui/workspace-v2.json` inside that vault.

## Automated coverage boundary

The frontend Vitest suite automatically covers pure workspace transitions,
invariants, legacy schema-v2 defaults, the domain/persistence portions of PRD
Journeys A–D, and a 50-tab/eight-pane serialize/restore scale case. Those tests
do not prove native WebView input behavior, application restart, filesystem
durability, screen-reader output, visual contrast, frame rate, or another OS.

The CDP scripts above cover a real running Tauri WebView and local files only
when run manually with the stated prerequisites. Their presence is not evidence
that they passed on a given commit. Pointer drag/drop, native-window transfer,
keyboard-only Journey C, restart Journey A, corrupt on-disk recovery, visual QA
at all PRD sizes/themes, accessibility assistive-technology checks, and macOS /
Windows / Linux smoke coverage remain manual release checks unless their run
results are recorded separately.

## Runtime prerequisites

- Windows with the WebView2 runtime (the current CDP launch instructions are
  PowerShell/WebView2-specific).
- Node.js 22 or newer, for the built-in `fetch` and `WebSocket` globals.
- A Mica development build, because production builds do not expose
  `window.__mica`.
- The fixture created by `prepare-vault.mjs`, with the Tauri app and Vite dev
  server still running against it. Run `backend.e2e.mjs` first when also
  running the legacy Phase 6 database/canvas checks.
