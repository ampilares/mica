# E2E test drivers

These scripts drive the **real running app** over the WebView2 DevTools
protocol (CDP) and verify behavior against real files on disk.

## Running

1. Prepare a test vault at `C:/Users/Administrator/Documents/mica-test-vault`
   (see `VAULT` constant) containing `notes/welcome.md` and `notes/roadmap.md`
   with the fixture content the checks expect — or adapt the constants.
2. Start the Vite dev server: `npm run dev` in `apps/desktop`.
3. Launch the app with remote debugging:

   ```powershell
   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9223"
   .\target\debug\mica-tauri.exe
   ```

4. Run the suites (Node 22+, no dependencies):

   ```powershell
   node tools/e2e/backend.e2e.mjs     # IPC + file-on-disk critical path
   node tools/e2e/ui.e2e.mjs out.png  # DOM rendering + autosave round-trip
   ```

The UI suite relies on the dev-only `window.__mica` hook exposed in
`apps/desktop/src/main.tsx` (dev builds only).
