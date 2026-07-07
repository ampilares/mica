// Phase 6 feature checks: settings/config, source mode, multi-views, CSV,
// FTS over DB rows + canvas labels, link graph, canvas interop.
// Assumes backend.e2e.mjs ran first against the same vault (uses its files).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
  if (res.result?.result?.subtype === "error") throw new Error(res.result.result.description);
  return res.result?.result?.value;
}
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  // 1. Vault config get/set (settings backend)
  const cfg = await evalJs(`window.__mica.api.configGet()`);
  check("config_get returns config", cfg?.notes_dir === "notes" && typeof cfg.naming === "string", JSON.stringify(cfg));
  const cfg2 = await evalJs(
    `window.__mica.api.configSet(${JSON.stringify({ ...cfg, naming: "title" })})`,
  );
  check("config_set persists naming", cfg2.naming === "title");
  const diskCfg = JSON.parse(fs.readFileSync(`${VAULT}/.workspace/config.json`, "utf8"));
  check("config.json on disk updated", diskCfg.naming === "title");
  // Title naming affects note_create file names.
  const titled = await evalJs(`window.__mica.api.noteCreate("My Spaced Title")`);
  check("title naming strategy used", titled.path.endsWith("My Spaced Title.md"), titled.path);
  await evalJs(`window.__mica.api.configSet(${JSON.stringify({ ...cfg, naming: "slug" })})`);

  // 2. DB multi-views + note_link rows
  const db = await evalJs(`window.__mica.api.dbCreate("P6 Views")`);
  const applied = await evalJs(
    `window.__mica.api.dbApply(${JSON.stringify(db.path)}, [
      { op: "view_add", name: "Sprint board", view_type: "kanban" },
      { op: "view_rename", view_id: "table_default", name: "All rows" },
      { op: "property_add", name: "Spec", prop_type: "note_link" },
      { op: "row_create", cells: { prop_title: "Linked row" } }
    ], ${JSON.stringify(db.version)})`,
  );
  const dbAfter = JSON.parse(applied.content);
  check("view_add creates third view", dbAfter.views.length === 3 && dbAfter.views[2].name === "Sprint board");
  check("view_rename applied", dbAfter.views[0].name === "All rows");
  check("note_link property added", dbAfter.properties.some((p) => p.type === "note_link"));
  const applied2 = await evalJs(
    `window.__mica.api.dbApply(${JSON.stringify(db.path)}, [
      { op: "view_delete", view_id: ${JSON.stringify(dbAfter.views[2].id)} }
    ], ${JSON.stringify(applied.version)})`,
  );
  check("view_delete removes view", JSON.parse(applied2.content).views.length === 2);

  // 3. CSV import/export
  const csvSrc = path.join(os.tmpdir(), "mica-e2e.csv");
  fs.writeFileSync(csvSrc, 'Name,Status,Points\n"Fix, the thing",Doing,3\nShip,Launched,5\n');
  const preview = await evalJs(`window.__mica.api.csvPreview(${JSON.stringify(csvSrc.replace(/\\/g, "/"))})`);
  check("csv_preview parses", preview.headers.length === 3 && preview.total_rows === 2, JSON.stringify(preview.headers));
  const statusPropId = JSON.parse(applied2.content).properties.find((p) => p.name === "Status").id;
  const imported = await evalJs(
    `window.__mica.api.dbImportCsv(${JSON.stringify(db.path)}, ${JSON.stringify(csvSrc.replace(/\\/g, "/"))}, [
      { kind: "property", property_id: "prop_title" },
      { kind: "property", property_id: ${JSON.stringify(statusPropId)} },
      { kind: "new", name: "Points", prop_type: "number" }
    ], ${JSON.stringify(applied2.version)})`,
  );
  const dbImported = JSON.parse(imported.content);
  check("csv import adds rows", dbImported.rows.length === 3, String(dbImported.rows.length));
  check("csv import creates select option", dbImported.properties.find((p) => p.id === statusPropId).options.some((o) => o.name === "Launched"));
  const csvDest = path.join(os.tmpdir(), "mica-e2e-out.csv");
  const rows = await evalJs(
    `window.__mica.api.dbExportCsv(${JSON.stringify(db.path)}, "table_default", ${JSON.stringify(csvDest.replace(/\\/g, "/"))})`,
  );
  const outCsv = fs.readFileSync(csvDest, "utf8");
  check("csv export writes rows", rows === 3 && outCsv.includes('"Fix, the thing"'), outCsv.split("\n")[0]);

  // 4. FTS over DB rows + canvas labels
  await sleep(300);
  const dbHits = await evalJs(`window.__mica.api.searchQuery("Linked row", 10)`);
  check("search finds db row text", dbHits.some((h) => h.path === db.path), JSON.stringify(dbHits.map((h) => h.path)));
  const canvas = await evalJs(`window.__mica.api.canvasCreate("P6 Canvas")`);
  await evalJs(
    `window.__mica.api.canvasApply(${JSON.stringify(canvas.path)}, [
      { op: "add_cell", cell: { id: "p6_shape", kind: "rectangle", label: "Bioluminescent squid", geometry: { x: 0, y: 0, width: 180, height: 80 } } }
    ], ${JSON.stringify(canvas.version)})`,
  );
  await sleep(300);
  const canvasHits = await evalJs(`window.__mica.api.searchQuery("bioluminescent", 10)`);
  check("search finds canvas label", canvasHits.some((h) => h.path === canvas.path), JSON.stringify(canvasHits.map((h) => h.path)));

  // 5. Link graph
  const graph = await evalJs(`window.__mica.api.linkGraph(undefined, 2)`);
  check("link_graph returns nodes+edges", graph.nodes.length >= 2 && graph.edges.length >= 1, `${graph.nodes.length} nodes, ${graph.edges.length} edges`);
  const local = await evalJs(`window.__mica.api.linkGraph("notes/roadmap.md", 1)`);
  check("local graph centers on note", local.nodes.some((n) => n.path === "notes/roadmap.md"));

  // 6. Canvas interop: export obsidian + excalidraw, re-import obsidian
  const obsDest = path.join(os.tmpdir(), "mica-e2e.canvas").replace(/\\/g, "/");
  await evalJs(`window.__mica.api.canvasExport(${JSON.stringify(canvas.path)}, "obsidian", ${JSON.stringify(obsDest)})`);
  const obsJson = JSON.parse(fs.readFileSync(obsDest, "utf8"));
  check("obsidian export has nodes", obsJson.nodes.some((n) => n.text === "Bioluminescent squid"), JSON.stringify(obsJson.nodes));
  const exDest = path.join(os.tmpdir(), "mica-e2e.excalidraw").replace(/\\/g, "/");
  await evalJs(`window.__mica.api.canvasExport(${JSON.stringify(canvas.path)}, "excalidraw", ${JSON.stringify(exDest)})`);
  const exJson = JSON.parse(fs.readFileSync(exDest, "utf8"));
  check("excalidraw export valid", exJson.type === "excalidraw" && exJson.elements.length >= 1);
  const reimported = await evalJs(`window.__mica.api.canvasImport(${JSON.stringify(obsDest)}, "Reimported P6")`);
  check("obsidian re-import creates drawio", reimported.path.endsWith(".drawio") && reimported.content.includes("Bioluminescent squid"), reimported.path);

  // 7. UI: source mode toggle renders CodeMirror
  await evalJs(`window.__mica.useStore.getState().openTab({ path: 'notes/roadmap.md', kind: 'note', title: 'roadmap' }); 'ok'`);
  await sleep(800);
  await evalJs(`window.__mica.useStore.getState().toggleSourceMode('notes/roadmap.md'); 'ok'`);
  await sleep(800);
  const cmText = await evalJs(`document.querySelector('.source-editor-host .cm-content')?.textContent ?? ''`);
  check("source mode shows raw markdown incl. frontmatter", cmText.includes("title: Roadmap") && cmText.includes("[[Welcome]]"), cmText.slice(0, 40));
  await evalJs(`window.__mica.useStore.getState().toggleSourceMode('notes/roadmap.md'); 'ok'`);
  await sleep(500);

  // 8. UI: settings dialog + graph panel open
  await evalJs(`window.__mica.useStore.getState().setSettingsOpen(true); 'ok'`);
  await sleep(400);
  check("settings dialog renders", await evalJs(`!!document.querySelector('.modal.settings')`));
  await evalJs(`window.__mica.useStore.getState().setSettingsOpen(false); window.__mica.useStore.getState().setGraphOpen(true); 'ok'`);
  await sleep(600);
  check("graph panel renders nodes", await evalJs(`document.querySelectorAll('.graph-node').length >= 2`));
  await evalJs(`window.__mica.useStore.getState().setGraphOpen(false); 'ok'`);
} catch (e) {
  check("script completed", false, String(e.message ?? e));
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} phase-6 checks passed`);
process.exit(failed ? 1 : 0);
