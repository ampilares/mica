// Editor blocks I e2e (FR21-BLK-001..004): callout, toggle, table, math.
// Follows the CDP driving pattern of ui.e2e.mjs. Writes a note containing all
// four blocks, opens it, asserts each renders, forces a save round-trip and
// asserts the on-disk syntax is byte-exact, then reloads and re-asserts.
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

// The exact block syntax under test (frontmatter + all four blocks).
const NOTE_REL = "notes/blocks-e2e.md";
const NOTE_ABS = `${VAULT}/${NOTE_REL}`;
const CALLOUT = "> [!info] Heads up\n> This is a callout body.";
const TOGGLE = "<details><summary>Details title</summary>\n\nToggle body text.\n\n</details>";
const TABLE = "| Name | Value |\n| --- | --- |\n| Alpha | 1 |\n| Beta | 2 |";
const MATH_BLOCK = "$$\nE = mc^2\n$$";
const MATH_INLINE = "Inline math $a^2 + b^2 = c^2$ here.";
const BODY =
  `${CALLOUT}\n\n${TOGGLE}\n\n${TABLE}\n\n${MATH_BLOCK}\n\n${MATH_INLINE}\n\nEdit anchor.\n`;
const FILE = `---\ntitle: Blocks E2E\n---\n\n${BODY}`;

// 1. Open the vault and seed the note file on disk.
fs.mkdirSync(`${VAULT}/notes`, { recursive: true });
fs.writeFileSync(NOTE_ABS, FILE, "utf8");
await evalJs(`(async () => {
  const { api, useStore } = window.__mica;
  const info = await api.vaultOpen(${JSON.stringify(VAULT)});
  useStore.getState().setVault(info);
  await useStore.getState().refreshTree();
  return "ok";
})()`);
await sleep(600);

// 2. Open the note; give Tiptap + KaTeX time to render the node views.
await evalJs(`window.__mica.useStore.getState().openTab({ path: ${JSON.stringify(NOTE_REL)}, kind: 'note', title: 'blocks-e2e' }); 'ok'`);
await sleep(1600);

const renderChecks = async (phase) => {
  check(`[${phase}] callout renders`, await evalJs(`!!document.querySelector('.note-editor-content .callout[data-kind="info"]')`));
  check(`[${phase}] toggle renders as <details>`, await evalJs(`!!document.querySelector('.note-editor-content details[data-toggle], .note-editor-content .toggle')`));
  check(`[${phase}] table renders with header cell`, await evalJs(`[...document.querySelectorAll('.note-editor-content table th')].some(th => th.textContent.trim() === 'Name')`));
  check(`[${phase}] KaTeX output in DOM`, await evalJs(`document.querySelectorAll('.note-editor-content .katex').length >= 2`));
};
await renderChecks("load");

// 3. Force a save round-trip by appending a harmless marker at doc end.
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
check("round-trip: frontmatter preserved", disk.replace(/^﻿/, "").startsWith("---\ntitle: Blocks E2E") || disk.replace(/^﻿/, "").startsWith("---\r\ntitle: Blocks E2E"), disk.slice(0, 30).replace(/\n/g, "⏎"));
check("round-trip: callout syntax exact", disk.includes(CALLOUT), firstMismatch(disk, CALLOUT));
check("round-trip: toggle syntax exact (blank lines)", disk.includes(TOGGLE), firstMismatch(disk, TOGGLE));
check("round-trip: GFM table syntax exact", disk.includes("| Name | Value |") && disk.includes("| --- | --- |") && disk.includes("| Alpha | 1 |"));
check("round-trip: block math syntax exact", disk.includes(MATH_BLOCK), firstMismatch(disk, MATH_BLOCK));
check("round-trip: inline math syntax exact", disk.includes("$a^2 + b^2 = c^2$"));

// 4. Reload the doc (close + reopen) and confirm it renders identically.
await evalJs(`window.__mica.useStore.getState().closeTab(${JSON.stringify(NOTE_REL)}); 'ok'`);
await sleep(400);
await evalJs(`window.__mica.useStore.getState().openTab({ path: ${JSON.stringify(NOTE_REL)}, kind: 'note', title: 'blocks-e2e' }); 'ok'`);
await sleep(1600);
await renderChecks("reload");

// Screenshot for the record.
const shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(process.argv[2] ?? "mica-blocks-screenshot.png", Buffer.from(shot.result.data, "base64"));
console.log("screenshot saved");

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} block checks passed`);
process.exit(failed ? 1 : 0);

// Small helper: show the first differing region to make failures debuggable.
function firstMismatch(haystack, needle) {
  if (haystack.includes(needle)) return "";
  return "expected substring not found: " + JSON.stringify(needle.slice(0, 40));
}
