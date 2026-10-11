// Generates a large fixture vault for perf validation (NFR2-001, spec §5):
// 5,000 markdown docs with frontmatter, tags, wiki links, and journals.
// Usage: node tools/e2e/prepare-bench-vault.mjs [count]
import fs from "node:fs";
import path from "node:path";

const VAULT =
  process.env.MICA_BENCH_VAULT ??
  `${process.env.USERPROFILE?.replace(/\\/g, "/")}/Documents/mica-bench-vault`;
const COUNT = Number(process.argv[2] ?? 5000);

fs.rmSync(VAULT, { recursive: true, force: true });
for (const dir of ["notes", "journals", "databases", "canvases"]) {
  fs.mkdirSync(path.join(VAULT, dir), { recursive: true });
}

const TAGS = ["alpha", "beta", "gamma", "delta", "project", "research", "ops", "ideas"];
const pad = (n, w = 4) => String(n).padStart(w, "0");

for (let i = 0; i < COUNT; i++) {
  const tags = [TAGS[i % TAGS.length], TAGS[(i * 3) % TAGS.length]];
  const linkTarget = `Bench Note ${pad((i + 17) % COUNT)}`;
  const body = Array.from(
    { length: 8 },
    (_, p) =>
      `Paragraph ${p} of bench note ${i}: local-first files, deterministic serialization, and portable vaults. #${tags[p % 2]}`,
  ).join("\n\n");
  const content = `---
title: Bench Note ${pad(i)}
created: 2026-01-${pad((i % 28) + 1, 2)}T09:00:00Z
updated: 2026-06-${pad((i % 28) + 1, 2)}T10:00:00Z
tags: [${tags.join(", ")}]
schema_version: 1
---

# Bench Note ${pad(i)}

See [[${linkTarget}]].

${body}
`;
  const sub = `notes/${Math.floor(i / 500)}`;
  fs.mkdirSync(path.join(VAULT, sub), { recursive: true });
  fs.writeFileSync(path.join(VAULT, sub, `bench-note-${pad(i)}.md`), content);
}

// A month of journals.
for (let d = 1; d <= 30; d++) {
  const iso = `2026-06-${pad(d, 2)}`;
  fs.writeFileSync(
    path.join(VAULT, "journals", `${iso}.md`),
    `---\ntitle: Jun ${d}, 2026\njournal: ${iso}\nschema_version: 1\n---\n\n# Jun ${d}, 2026\n\nDaily bench entry.\n`,
  );
}

console.log(`bench vault ready at ${VAULT} (${COUNT} notes + 30 journals)`);
