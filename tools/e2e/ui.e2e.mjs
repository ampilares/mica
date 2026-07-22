// UI-layer e2e: drives the React app through the store and verifies the DOM.
import fs from "node:fs";

const VAULT =
  process.env.MICA_E2E_VAULT ??
  `${process.env.USERPROFILE?.replace(/\\/g, "/")}/Documents/mica-test-vault`;
const pages = await (await fetch("http://127.0.0.1:9223/json")).json();
const page = pages.find((p) => p.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const send = (method, params) => new Promise((resolve) => {
  const id = ++msgId; pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
async function evalJs(expression) {
  const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails));
  return res.result?.result?.value;
}
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Open the vault through the UI store (as Onboarding would).
await evalJs(`(async () => {
  const { api, useStore } = window.__mica;
  const info = await api.vaultOpen(${JSON.stringify(VAULT)});
  useStore.getState().setVault(info);
  await useStore.getState().refreshTree();
  return "ok";
})()`);
await sleep(600);
check("sidebar rendered", await evalJs(`!!document.querySelector('.sidebar')`));
check("file tree shows notes dir", await evalJs(`[...document.querySelectorAll('.tree-item')].some(el => el.textContent.includes('notes'))`));

// 2. Open a note tab; verify Tiptap rendered the markdown.
await evalJs(`window.__mica.useStore.getState().openTab({ path: 'notes/roadmap.md', kind: 'note', title: 'roadmap' }); 'ok'`);
await sleep(1200);
const editorText = await evalJs(`document.querySelector('.note-editor-content')?.innerText ?? ''`);
check("editor rendered roadmap content", editorText.includes("Ship the MVP"), editorText.slice(0, 60).replace(/\n/g, " "));
check("task list rendered as checkboxes", await evalJs(`document.querySelectorAll('.note-editor-content ul[data-type="taskList"] input[type="checkbox"]').length >= 2`));
check("wiki link decorated", await evalJs(`!!document.querySelector('.note-editor-content .wiki-link')`));

// 3. Type into the editor via the ProseMirror API and check autosave hits disk.
await evalJs(`(() => {
  const el = document.querySelector('.note-editor-content');
  el.dispatchEvent(new Event('focus'));
  // Append text at the end through execCommand-ish DOM input event:
  const sel = window.getSelection();
  sel.selectAllChildren(el);
  sel.collapseToEnd();
  document.execCommand('insertText', false, ' UI-typed zebra.');
  return 'ok';
})()`);
await sleep(2500); // autosave debounce is 1s
const roadmapDisk = fs.readFileSync(`${VAULT}/notes/roadmap.md`, "utf8");
check("typed text autosaved to disk", roadmapDisk.includes("zebra"), roadmapDisk.split("\n").filter(l => l.includes("zebra")).join(" | "));
check("frontmatter preserved on save", roadmapDisk.replace(/^﻿/, "").startsWith("---\ntitle: Roadmap") || roadmapDisk.replace(/^﻿/, "").startsWith("---\r\ntitle"), roadmapDisk.slice(0, 40).replace(/\n/g, "⏎"));
check("wiki links not escaped on save", roadmapDisk.includes("[[Welcome]]") && !roadmapDisk.includes("\\[\\["), "");
check("task list round-trips", roadmapDisk.includes("- [ ] Ship the MVP"), "");

// 4. Open the database tab; verify table renders.
await evalJs(`window.__mica.useStore.getState().openTab({ path: 'databases/e2e-tasks.database.json', kind: 'database', title: 'e2e-tasks' }); 'ok'`);
await sleep(900);
check("db toolbar rendered", await evalJs(`!!document.querySelector('.db-toolbar')`));
check("db table shows rows", await evalJs(`[...document.querySelectorAll('.db-table input[type="text"]')].some(i => i.value === 'First task')`));
// Switch to kanban.
await evalJs(`[...document.querySelectorAll('.db-view-switch button')].find(b => b.textContent === 'Kanban')?.click(); 'ok'`);
await sleep(500);
check("kanban renders columns", await evalJs(`document.querySelectorAll('.kanban-col').length >= 3`));
check("kanban card in Doing", await evalJs(`[...document.querySelectorAll('.kanban-col')].some(col => col.textContent.includes('Doing') && col.querySelector('.kanban-card'))`));

// 5. Open the canvas tab; verify SVG shapes render.
await evalJs(`window.__mica.useStore.getState().openTab({ path: 'canvases/e2e-map.drawio', kind: 'canvas', title: 'e2e-map' }); 'ok'`);
await sleep(900);
check("canvas svg rendered", await evalJs(`!!document.querySelector('.canvas-svg')`));
check("canvas shows 3 vertices + edge", await evalJs(`document.querySelectorAll('.canvas-svg .cell').length >= 3 && document.querySelectorAll('.canvas-svg .edge').length >= 1`));
check("note-link cell rendered", await evalJs(`!!document.querySelector('.canvas-svg .cell-note_link')`));

// 6. Quick search opens (v2 shell).
await evalJs(`window.__mica.useStore.getState().setQuickSearchOpen(true); 'ok'`);
await sleep(400);
check("quick search modal", await evalJs(`!!document.querySelector('.modal.quick-search input')`));
await evalJs(`window.__mica.useStore.getState().setQuickSearchOpen(false); 'ok'`);

// 6b. v2 shell: All-docs page lists the fixture docs.
await evalJs(`window.__mica.useStore.getState().refreshDocs(); 'ok'`);
await sleep(600);
await evalJs(`window.__mica.useStore.getState().openPage('all-docs'); 'ok'`);
await sleep(500);
check("all-docs page rendered", await evalJs(`!!document.querySelector('.docs-page')`));
check(
  "all-docs lists roadmap",
  await evalJs(`[...document.querySelectorAll('.docs-row .docs-title')].some(el => el.textContent.toLowerCase().includes('roadmap'))`),
);

// 6c. v2 shell: journal ensure creates today's doc.
const journalPath = await evalJs(`(async () => {
  const iso = new Date().toISOString().slice(0, 10);
  const file = await window.__mica.api.journalEnsure(iso);
  return file.path;
})()`);
check("journal created", /^journals\/\d{4}-\d{2}-\d{2}\.md$/.test(journalPath ?? ""), journalPath);
check("journal on disk", fs.existsSync(`${VAULT}/${journalPath}`));

// 6d. v2 shell: trash round-trip through the store-facing API.
const trashed = await evalJs(`(async () => {
  const { api } = window.__mica;
  const file = await api.noteCreate("Trash Me E2E");
  const moved = await api.trashMove(file.path);
  const list = await api.trashList();
  const entry = list.find((e) => e.trash_path === moved[0]);
  const restored = await api.trashRestore(moved[0]);
  return { original: file.path, listed: !!entry, restored };
})()`);
check("trash listed entry", trashed?.listed === true);
check("trash restore returns original path", trashed?.restored === trashed?.original, JSON.stringify(trashed));

// 6e. v2 shell: doc header + mode switch present on the note tab.
await evalJs(`window.__mica.useStore.getState().setActive('notes/roadmap.md'); 'ok'`);
await sleep(300);
check("doc header rendered", await evalJs(`[...document.querySelectorAll('.doc-header')].some(el => el.closest('.doc-pane').style.display !== 'none')`));
check("mode switch rendered", await evalJs(`!!document.querySelector('.mode-switch')`));

// 6f. v2 shell: edgeless mode creates the sidecar canvas.
await evalJs(`(async () => { await window.__mica.useStore.getState().setDocMode('notes/roadmap.md', 'edgeless'); return 'ok'; })()`);
await sleep(900);
check("sidecar canvas on disk", fs.existsSync(`${VAULT}/notes/roadmap.canvas.drawio`));
check("edgeless canvas rendered for note", await evalJs(`[...document.querySelectorAll('.doc-pane')].some(p => p.style.display !== 'none' && p.querySelector('.canvas-svg'))`));
await evalJs(`(async () => { await window.__mica.useStore.getState().setDocMode('notes/roadmap.md', 'page'); return 'ok'; })()`);
await sleep(400);

// 7. Screenshot the canvas view for the record.
await evalJs(`window.__mica.useStore.getState().setActive('canvases/e2e-map.drawio'); 'ok'`);
await sleep(400);
const shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(process.argv[2] ?? "mica-screenshot.png", Buffer.from(shot.result.data, "base64"));
console.log("screenshot saved");

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} UI checks passed`);
process.exit(failed ? 1 : 0);
