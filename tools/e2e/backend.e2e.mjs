// E2E driver: connects to the running Mica app over the WebView2 CDP socket
// and exercises the MVP critical path with real IPC + real files on disk.
import fs from "node:fs";

const VAULT =
  process.env.MICA_E2E_VAULT ??
  `${process.env.USERPROFILE?.replace(/\\/g, "/")}/Documents/mica-test-vault`;
const CDP_LIST = "http://127.0.0.1:9223/json";

const pages = await (await fetch(CDP_LIST)).json();
const page = pages.find((p) => p.type === "page");
if (!page) throw new Error("no page target");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};

function send(method, params) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalJs(expression) {
  const res = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.result?.exceptionDetails) {
    throw new Error(
      "page exception: " + JSON.stringify(res.result.exceptionDetails, null, 2),
    );
  }
  if (res.result?.result?.subtype === "error") {
    throw new Error("page error: " + res.result.result.description);
  }
  return res.result?.result?.value;
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  // 0. Sanity: app booted, dev hooks present
  const hasMica = await evalJs("typeof window.__mica === 'object'");
  check("dev hooks exposed", hasMica === true);
  const pong = await evalJs("window.__mica.api.ping()");
  check("IPC round-trip (ping)", pong === "pong");

  // 1. Open the prepared vault through the real command
  const info = await evalJs(
    `window.__mica.api.vaultOpen(${JSON.stringify(VAULT)})`,
  );
  check("vault_open", !!info && typeof info.root === "string", JSON.stringify(info));
  await evalJs(`(() => { const s = window.__mica.useStore.getState(); s.setVault(${JSON.stringify(
    { root: VAULT, name: "mica-test-vault" },
  )}); return s.refreshTree(); })()`);
  await sleep(500);

  // 2. Register an event recorder for watcher events
  await evalJs(
    `window.__events = []; window.__TAURI__.event.listen('vault:events', e => window.__events.push(...e.payload)).then(() => 'ok')`,
  );

  // 3. File tree contains the pre-existing notes
  const tree = await evalJs(`window.__mica.api.vaultTree()`);
  const flat = JSON.stringify(tree);
  check("tree shows welcome.md", flat.includes("welcome.md"));
  check("tree shows roadmap.md", flat.includes("roadmap.md"));

  // 4. Note create → file exists on disk with frontmatter
  const created = await evalJs(`window.__mica.api.noteCreate("E2E Note")`);
  check("note_create returns path", created.path?.endsWith(".md"), created.path);
  const absCreated = `${VAULT}/${created.path}`;
  check("created note exists on disk", fs.existsSync(absCreated));
  const createdContent = fs.readFileSync(absCreated, "utf8");
  check(
    "created note has id frontmatter",
    createdContent.startsWith("---\nid: note_"),
  );

  // 5. Note save with base_version, verify disk content
  const newContent = createdContent.replace(
    "# E2E Note",
    "# E2E Note\n\nEdited by the e2e driver. Links to [[Roadmap]]. #e2e",
  );
  const saved = await evalJs(
    `window.__mica.api.noteSave(${JSON.stringify(created.path)}, ${JSON.stringify(newContent)}, ${JSON.stringify(created.version)})`,
  );
  check("note_save returns new version", typeof saved.version === "string" && saved.version !== created.version);
  const diskAfterSave = fs.readFileSync(absCreated, "utf8");
  check("saved content on disk", diskAfterSave.includes("Edited by the e2e driver"));
  check("save touched updated timestamp", /updated: /.test(diskAfterSave));

  // 6. Stale save → conflict error (base_version guard)
  let conflictCode = null;
  try {
    await evalJs(
      `window.__mica.api.noteSave(${JSON.stringify(created.path)}, "# hijack\\n", ${JSON.stringify(created.version)})`,
    );
  } catch (e) {
    conflictCode = String(e.message).includes("conflict") ? "conflict" : e.message;
  }
  check("stale base_version rejected as conflict", conflictCode === "conflict", String(conflictCode));

  // 7. Search finds content (index updated after save)
  await sleep(400);
  const hits = await evalJs(`window.__mica.api.searchQuery("Ship the MVP", 10)`);
  check("search finds roadmap", hits.some((h) => h.path.includes("roadmap")), JSON.stringify(hits.map(h => h.path)));
  const hits2 = await evalJs(`window.__mica.api.searchQuery("e2e driver", 10)`);
  check("search finds newly saved note", hits2.some((h) => h.path === created.path));

  // 8. Backlinks: welcome.md and the e2e note link to [[Roadmap]]
  const backlinks = await evalJs(
    `window.__mica.api.backlinks("notes/roadmap.md")`,
  );
  const sources = backlinks.map((b) => b.source);
  check("backlinks include welcome.md", sources.includes("notes/welcome.md"), JSON.stringify(sources));
  check("backlinks include e2e note", sources.includes(created.path));

  // 9. Wiki resolution + tags
  const resolved = await evalJs(`window.__mica.api.resolveWiki("Roadmap")`);
  check("resolve_wiki('Roadmap')", resolved === "notes/roadmap.md", String(resolved));
  const tags = await evalJs(`window.__mica.api.tagsList()`);
  const tagNames = tags.map((t) => t.tag);
  check("tags indexed", tagNames.includes("planning") && tagNames.includes("e2e"), JSON.stringify(tagNames));

  // 10. Quick switcher
  const qs = await evalJs(`window.__mica.api.quickSwitch("road", 10)`);
  check("quick_switch finds Roadmap", qs.some((h) => h.path === "notes/roadmap.md"));

  // 11. Database: create, add rows, kanban move, query
  const db = await evalJs(`window.__mica.api.dbCreate("E2E Tasks")`);
  check("db_create path", db.path?.endsWith(".database.json"), db.path);
  const dbAbs = `${VAULT}/${db.path}`;
  check("database file on disk", fs.existsSync(dbAbs));
  const dbJson = JSON.parse(fs.readFileSync(dbAbs, "utf8"));
  check("database has title prop + views", dbJson.properties?.length >= 2 && dbJson.views?.length === 2);

  const applied = await evalJs(
    `window.__mica.api.dbApply(${JSON.stringify(db.path)}, [
      { op: "row_create", cells: { prop_title: "First task" } },
      { op: "row_create", cells: { prop_title: "Second task" } }
    ], ${JSON.stringify(db.version)})`,
  );
  const dbAfter = JSON.parse(applied.content);
  check("db rows created", dbAfter.rows.length === 2);
  const statusProp = dbAfter.views.find((v) => v.type === "kanban").group_by;
  const rowId = dbAfter.rows[0].id;
  const applied2 = await evalJs(
    `window.__mica.api.dbApply(${JSON.stringify(db.path)}, [
      { op: "kanban_move", view_id: "kanban_status", row_id: ${JSON.stringify(rowId)}, to_group: "doing", index: 0 }
    ], ${JSON.stringify(applied.version)})`,
  );
  const dbAfter2 = JSON.parse(applied2.content);
  check(
    "kanban move set select value",
    dbAfter2.rows[0].cells[statusProp]?.value === "doing",
  );
  const q = await evalJs(
    `window.__mica.api.dbQuery(${JSON.stringify(db.path)}, "kanban_status", 0, 0)`,
  );
  check(
    "db_query kanban groups",
    q.groups?.find((g) => g.group === "doing")?.row_ids.includes(rowId),
    JSON.stringify(q.groups),
  );
  const diskDb = JSON.parse(fs.readFileSync(dbAbs, "utf8"));
  check("db file deterministic + updated on disk", diskDb.rows.length === 2 && diskDb.rows[0].cells[statusProp].value === "doing");

  // 12. Canvas: create, add shapes + connector + note link, verify XML
  const canvas = await evalJs(`window.__mica.api.canvasCreate("E2E Map")`);
  check("canvas_create path", canvas.path?.endsWith(".drawio"), canvas.path);
  const canvasApplied = await evalJs(
    `window.__mica.api.canvasApply(${JSON.stringify(canvas.path)}, [
      { op: "add_cell", cell: { id: "shape_e2e_a", kind: "rectangle", label: "Box A", geometry: { x: 100, y: 100, width: 180, height: 80 } } },
      { op: "add_cell", cell: { id: "shape_e2e_b", kind: "sticky", label: "Sticky B", geometry: { x: 400, y: 100, width: 180, height: 140 } } },
      { op: "add_cell", cell: { id: "edge_e2e_1", kind: "connector", label: "", source: "shape_e2e_a", target: "shape_e2e_b" } },
      { op: "add_cell", cell: { id: "shape_e2e_link", kind: "note_link", label: "Roadmap", href: "../notes/roadmap.md", geometry: { x: 100, y: 300, width: 200, height: 90 } } }
    ], ${JSON.stringify(canvas.version)})`,
  );
  const canvasAbs = `${VAULT}/${canvas.path}`;
  const xml = fs.readFileSync(canvasAbs, "utf8");
  check("drawio XML has mxfile + cells", xml.includes("<mxfile") && xml.includes('id="shape_e2e_a"'));
  check("drawio connector serialized", xml.includes('edge="1" source="shape_e2e_a" target="shape_e2e_b"'));
  check(
    "note link cell has workspace attrs",
    xml.includes('data-workspace-type="note-link"') && xml.includes('data-workspace-href="../notes/roadmap.md"'),
  );
  check("canvas apply returns version", typeof canvasApplied.version === "string");

  // 13. External edit → watcher event + index update
  await evalJs(`window.__events = []; 'cleared'`);
  fs.appendFileSync(`${VAULT}/notes/welcome.md`, "\nExternal xylophone edit.\n");
  await sleep(1500);
  const events = await evalJs(`window.__events`);
  check(
    "watcher reports external modify",
    events.some((e) => (e.type === "modified" || e.type === "created") && e.path === "notes/welcome.md"),
    JSON.stringify(events),
  );
  const hits3 = await evalJs(`window.__mica.api.searchQuery("xylophone", 10)`);
  check("external edit is searchable (incremental index)", hits3.some((h) => h.path === "notes/welcome.md"));

  // 14. Self-write filter: app saves must NOT come back as external events
  await evalJs(`window.__events = []; 'cleared'`);
  const reload = await evalJs(`window.__mica.api.noteLoad(${JSON.stringify(created.path)})`);
  await evalJs(
    `window.__mica.api.noteSave(${JSON.stringify(created.path)}, ${JSON.stringify(newContent + "\nOne more line.\n")}, ${JSON.stringify(reload.version)})`,
  );
  await sleep(1500);
  const echoEvents = await evalJs(`window.__events`);
  check(
    "own save filtered from watcher events",
    !echoEvents.some((e) => e.path === created.path),
    JSON.stringify(echoEvents),
  );

  // 15. Index rebuild from files
  const count = await evalJs(`window.__mica.api.indexRebuild()`);
  check("index_rebuild processes files", typeof count === "number" && count >= 4, String(count));

  // 16. Duplicate: fresh ULID, content otherwise preserved
  const dup = await evalJs(`window.__mica.api.noteDuplicate(${JSON.stringify(created.path)})`);
  check("note_duplicate creates copy", dup.path !== created.path && fs.existsSync(`${VAULT}/${dup.path}`), dup.path);
  const dupContent = fs.readFileSync(`${VAULT}/${dup.path}`, "utf8");
  const origId = fs.readFileSync(absCreated, "utf8").match(/^id: (note_\S+)/m)?.[1];
  const dupId = dupContent.match(/^id: (note_\S+)/m)?.[1];
  check("duplicate has fresh id", !!dupId && dupId !== origId, `${origId} vs ${dupId}`);
  check("duplicate keeps body", dupContent.includes("Edited by the e2e driver"));

  // 17. Backup snapshot
  const backup = await evalJs(`window.__mica.api.vaultBackup()`);
  check("vault_backup returns folder + files", typeof backup.folder === "string" && backup.files >= 4, JSON.stringify(backup));
  check("backup folder on disk", fs.existsSync(`${VAULT}/.workspace/backups/${backup.folder}`) || fs.existsSync(backup.folder), backup.folder);

  // 18. Rename rewrites relative links in referrers
  const renamed = await evalJs(
    `window.__mica.api.noteRename(${JSON.stringify(created.path)}, "notes/e2e-note-renamed.md")`,
  );
  check("note_rename returns new path", renamed === "notes/e2e-note-renamed.md", String(renamed));
  check("renamed file on disk", fs.existsSync(`${VAULT}/notes/e2e-note-renamed.md`) && !fs.existsSync(absCreated));
  await sleep(400);
  const backlinksAfter = await evalJs(`window.__mica.api.backlinks("notes/roadmap.md")`);
  check(
    "backlinks track renamed source",
    backlinksAfter.some((b) => b.source === "notes/e2e-note-renamed.md"),
    JSON.stringify(backlinksAfter.map((b) => b.source)),
  );

  // 19. asset_save stores decoded bytes under assets/images
  const pngB64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const assetPath = await evalJs(`window.__mica.api.assetSave("e2e pixel.png", ${JSON.stringify(pngB64)})`);
  check("asset_save path under assets/images", /^assets\/images\/.+\.png$/.test(assetPath), String(assetPath));
  const assetBytes = fs.readFileSync(`${VAULT}/${assetPath}`);
  check("asset bytes round-trip", assetBytes.length === Buffer.from(pngB64, "base64").length && assetBytes[0] === 0x89);
} catch (e) {
  check("script completed", false, String(e.message ?? e));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
