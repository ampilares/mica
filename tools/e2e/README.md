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
   ```

The UI suite relies on the dev-only `window.__mica` hook exposed in
`apps/desktop/src/main.tsx` (dev builds only).
