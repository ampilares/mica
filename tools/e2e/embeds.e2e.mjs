// Editor blocks II e2e (FR21-BLK-005..008): attachment cards, link cards
// (previews disabled → quiet fallback), wiki embeds (whole-doc + heading), and
// the unresolved chip. Follows the CDP driving pattern of blocks.e2e.mjs:
// seed notes on disk, open, assert rendering, force a save round-trip and
// assert byte-exact on-disk syntax, reload and re-assert.
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

// ---- exact block syntax under test ----
const NOTE_REL = "notes/embeds-e2e.md";
const NOTE_ABS = `${VAULT}/${NOTE_REL}`;
const TARGET_REL = "notes/target.md";
const TARGET_ABS = `${VAULT}/${TARGET_REL}`;

const ATTACH = "[report.pdf](../assets/files/report.pdf)";
const CARD = '[Example](https://example.com "mica:card")';
const EMBED_WHOLE = "![[target]]";
const EMBED_HEAD = "![[target#Section]]";
const UNRESOLVED = "![[Nope-Nonexistent]]";
const BODY =
  `${ATTACH}\n\n${CARD}\n\n${EMBED_WHOLE}\n\n${EMBED_HEAD}\n\n${UNRESOLVED}\n\nEdit anchor.\n`;
const FILE = `---\ntitle: Embeds E2E\n---\n\n${BODY}`;

const TARGET_FILE =
  `---\ntitle: target\n---\n\nIntro TARGET-BODY-TEXT here.\n\n## Section\n\nSECTION-BODY-TEXT inside.\n`;

// 1. Seed files on disk (note, embed target, a dummy attachment).
fs.mkdirSync(`${VAULT}/notes`, { recursive: true });
fs.mkdirSync(`${VAULT}/assets/files`, { recursive: true });
fs.writeFileSync(NOTE_ABS, FILE, "utf8");
fs.writeFileSync(TARGET_ABS, TARGET_FILE, "utf8");
fs.writeFileSync(`${VAULT}/assets/files/report.pdf`, "%PDF-1.4 dummy\n", "utf8");

await evalJs(`(async () => {
  const { api, useStore } = window.__mica;
  const info = await api.vaultOpen(${JSON.stringify(VAULT)});
  useStore.getState().setVault(info);
  await useStore.getState().refreshTree();
  // Ensure link previews are OFF so the card renders the quiet fallback.
  const cfg = await api.configGet();
  await api.configSet({ ...cfg, link_previews: false });
  return "ok";
})()`);
await sleep(700);

// 2. Open the note; give Tiptap + async node views time to render.
await evalJs(`window.__mica.useStore.getState().openTab({ path: ${JSON.stringify(NOTE_REL)}, kind: 'note', title: 'embeds-e2e' }); 'ok'`);
await sleep(1800);

const renderChecks = async (phase) => {
  check(
    `[${phase}] attachment card renders`,
    await evalJs(`(() => {
      const c = document.querySelector('.note-editor-content .attachment-card .attachment-name');
      return !!c && c.textContent.trim() === 'report.pdf';
    })()`),
  );
  check(
    `[${phase}] link card quiet fallback (previews off)`,
    await evalJs(`(() => {
      const hint = document.querySelector('.note-editor-content .link-card .link-card-hint');
      return !!hint && /Settings/i.test(hint.textContent);
    })()`),
  );
  check(
    `[${phase}] whole-doc wiki embed renders content`,
    await evalJs(`[...document.querySelectorAll('.note-editor-content .wiki-embed-body')].some(b => b.textContent.includes('TARGET-BODY-TEXT'))`),
  );
  check(
    `[${phase}] heading wiki embed renders section only`,
    await evalJs(`(() => {
      const bodies = [...document.querySelectorAll('.note-editor-content .wiki-embed-body')];
      const section = bodies.find(b => b.textContent.includes('SECTION-BODY-TEXT'));
      const headingOnly = bodies.find(b => b.textContent.includes('SECTION-BODY-TEXT') && !b.textContent.includes('TARGET-BODY-TEXT'));
      return !!section && !!headingOnly;
    })()`),
  );
  check(
    `[${phase}] unresolved embed chip renders`,
    await evalJs(`!!document.querySelector('.note-editor-content .wiki-embed-unresolved')`),
  );
};
await renderChecks("load");

// 3. Force a save round-trip by appending a marker at doc end.
await evalJs(`(() => {
  const el = document.querySelector('.note-editor-content');
  el.dispatchEvent(new Event('focus'));
  const sel = window.getSelection();
  sel.selectAllChildren(el);
  sel.collapseToEnd();
  document.execCommand('insertText', false, ' ZEBRA-RT');
  return 'ok';
})()`);
await sleep(3000); // autosave debounce is ~1s; be generous

const disk = fs.readFileSync(NOTE_ABS, "utf8");
check("round-trip: marker autosaved", disk.includes("ZEBRA-RT"));
check("round-trip: frontmatter preserved", disk.replace(/^﻿/, "").startsWith("---\ntitle: Embeds E2E"), disk.slice(0, 30).replace(/\n/g, "⏎"));
check("round-trip: attachment link byte-exact", disk.includes(ATTACH), firstMismatch(disk, ATTACH));
check("round-trip: link card title marker byte-exact", disk.includes(CARD), firstMismatch(disk, CARD));
check("round-trip: whole-doc embed byte-exact", disk.includes(EMBED_WHOLE), firstMismatch(disk, EMBED_WHOLE));
check("round-trip: heading embed byte-exact", disk.includes(EMBED_HEAD), firstMismatch(disk, EMBED_HEAD));
check("round-trip: unresolved embed byte-exact", disk.includes(UNRESOLVED), firstMismatch(disk, UNRESOLVED));

// 4. Reload the doc (close + reopen) and confirm it renders identically.
await evalJs(`window.__mica.useStore.getState().closeTab(${JSON.stringify(NOTE_REL)}); 'ok'`);
await sleep(400);
await evalJs(`window.__mica.useStore.getState().openTab({ path: ${JSON.stringify(NOTE_REL)}, kind: 'note', title: 'embeds-e2e' }); 'ok'`);
await sleep(1800);
await renderChecks("reload");

// Screenshot for the record.
const shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(process.argv[2] ?? "mica-embeds-screenshot.png", Buffer.from(shot.result.data, "base64"));
console.log("screenshot saved");

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} embed checks passed`);
process.exit(failed ? 1 : 0);

function firstMismatch(haystack, needle) {
  if (haystack.includes(needle)) return "";
  return "expected substring not found: " + JSON.stringify(needle.slice(0, 40));
}
