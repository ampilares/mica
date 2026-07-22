// Perf validation on the large bench vault (NFR2-001/002, spec §5).
// Prereq: node tools/e2e/prepare-bench-vault.mjs; app running with CDP :9223.
// Usage: node tools/e2e/bench.e2e.mjs [screenshot-prefix]
import fs from "node:fs";

const VAULT =
  process.env.MICA_BENCH_VAULT ??
  `${process.env.USERPROFILE?.replace(/\\/g, "/")}/Documents/mica-bench-vault`;

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  const s = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`output/${name}.png`, Buffer.from(s.result.data, "base64"));
};
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

// 1. Cold open: first open builds the index from scratch.
const coldMs = await evalJs(`(async () => {
  const { api, useStore } = window.__mica;
  const t0 = performance.now();
  const info = await api.vaultOpen(${JSON.stringify(VAULT)});
  const t1 = performance.now();
  useStore.getState().setVault(info);
  await useStore.getState().refreshTree();
  return Math.round(t1 - t0);
})()`);
console.log(`cold vault_open (index build, 5030 docs): ${coldMs} ms`);

// 2. Warm open: close + reopen reconciles by mtime/size.
const warmMs = await evalJs(`(async () => {
  const { api } = window.__mica;
  await api.vaultClose();
  const t0 = performance.now();
  await api.vaultOpen(${JSON.stringify(VAULT)});
  const t1 = performance.now();
  return Math.round(t1 - t0);
})()`);
check("warm vault_open < 2000 ms (NFR-PERF-001)", warmMs < 2000, `${warmMs} ms`);

// 3. docs_list latency (spec §2.1 target < 150 ms; median of 5).
const docsMs = await evalJs(`(async () => {
  const { api } = window.__mica;
  const times = [];
  let count = 0;
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    const docs = await api.docsList();
    times.push(performance.now() - t0);
    count = docs.length;
  }
  times.sort((a, b) => a - b);
  return { median: Math.round(times[2]), count };
})()`);
check("docs_list median < 150 ms", docsMs.median < 150, `${docsMs.median} ms for ${docsMs.count} docs`);

// 4. Search latency (NFR-PERF-003 < 150 ms).
const searchMs = await evalJs(`(async () => {
  const { api } = window.__mica;
  const t0 = performance.now();
  await api.searchQuery("deterministic serialization", 50);
  return Math.round(performance.now() - t0);
})()`);
check("search < 150 ms", searchMs < 150, `${searchMs} ms`);

// 5. All-docs page with 5k docs: windowing keeps the DOM small (NFR2-001).
await evalJs(`(async () => {
  const { useStore } = window.__mica;
  await useStore.getState().refreshDocs();
  useStore.getState().openPage('all-docs');
  return 'ok';
})()`);
await sleep(800);
const domRows = await evalJs(`document.querySelectorAll('.docs-row').length`);
const total = await evalJs(`window.__mica.useStore.getState().docs.length`);
check("windowing active (rows mounted << total)", domRows > 5 && domRows < 120, `${domRows} DOM rows for ${total} docs`);

// Scroll to the middle and verify the window follows.
await evalJs(`(() => { const el = document.querySelector('.page.docs-page'); el.scrollTop = el.scrollHeight / 2; return 'ok'; })()`);
await sleep(300);
const midRow = await evalJs(`document.querySelector('.docs-vspacer') ? document.querySelectorAll('.docs-row').length : -1`);
check("window follows scroll", midRow > 5 && midRow < 120, `${midRow} DOM rows at mid-scroll`);
await shot(process.argv[2] ? `${process.argv[2]}-alldocs` : "bench-alldocs");

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} bench checks passed`);
process.exit(failed ? 1 : 0);
