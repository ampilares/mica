// Creates a fresh fixture vault for the e2e suites. Destructive: wipes the
// target folder first. Vault path comes from MICA_E2E_VAULT (same default as
// the suites).
import fs from "node:fs";
import path from "node:path";

const VAULT =
  process.env.MICA_E2E_VAULT ??
  `${process.env.USERPROFILE?.replace(/\\/g, "/")}/Documents/mica-test-vault`;

fs.rmSync(VAULT, { recursive: true, force: true });
fs.mkdirSync(path.join(VAULT, "notes"), { recursive: true });

fs.writeFileSync(
  path.join(VAULT, "notes", "welcome.md"),
  `---
title: Welcome
tags: [planning]
---

# Welcome

This vault is the e2e fixture. See the [[Roadmap]] for what ships next. #planning
`,
);

fs.writeFileSync(
  path.join(VAULT, "notes", "roadmap.md"),
  `---
title: Roadmap
tags: [planning]
---

# Roadmap

Linked from [[Welcome]]. #planning

- [ ] Ship the MVP
- [ ] Write the docs
`,
);

console.log(`fixture vault ready at ${VAULT}`);
