# Implementation Plan: Mica v2.1

**Version:** 2.1.0
**Date:** 2026-07-22
**Sources:** [PRD.md](PRD.md), [specifications.md](specifications.md)

---

## 1. Approach

Same rules as v2: data safety is a gate (every new serializer lands with
golden tests in the same change), and each phase ends green (`cargo test`,
`tsc --noEmit`, e2e) with a v2 vault opening unmodified.

Free-tier phases front-load daily-use value (editor blocks first). Pro work
runs as a separate track so the free release never waits on service code.
Coding is parallelized across subagents with disjoint file boundaries
(component-scoped CSS; one owner per shared file per phase — the pattern
that worked in R7).

```text
Core (free) track                          Pro track (build-flagged)
──────────────────────────────             ─────────────────────────
C1  Editor blocks I: callout, toggle,      P1  Entitlements: license verify,
    table, math                                Settings→Account, gating API
C2  Editor blocks II: attachments,         P2  Sync alpha: chunker, E2E crypto,
    link cards, embeds (opt-in fetch)          relay protocol, conflict surfacing
C3  Wiki embeds + hover previews           P3  (post-2.1) Publish, Teams,
C4  Split view + peek view                     Collab, Mica AI milestones
C5  Templates system
C6  Edgeless depth: style panel, groups,
    pen, mind maps, canvas templates
C7  Local history
C8  Calendar feeds (P2, optional gate)
C9  Parity audit, docs, hardening, release
```

C1→C2→C3 sequential (same editor files). C4, C5, C6, C7 are mutually
independent after C1 and can run as parallel agents. P1 can start any time;
P2 needs P1.

## 2. Phase details & exit criteria

### C1 — Editor blocks I (callout, toggle, table, math)
- Tiptap nodes + serializers per spec §1.1–1.4; slash-menu entries;
  KaTeX + table deps added.
- mica-markdown: extraction must not treat callout/`<details>` content as
  opaque (plain text still indexed; tags/links inside still extracted).
- Golden files: each block round-trips byte-stable; `docs/compat/blocks.md`
  smoke doc added.
**Exit:** type a callout/toggle/table/math via slash menu → file on disk
matches spec syntax → reload renders identically → external edit of the
same syntax renders. e2e covers all four.

### C2 — Editor blocks II (attachments, link cards, embeds)
- `asset_stat` command; attachment card node.
- Link-preview opt-in flow + `link_preview` command + cache; card/embed via
  the `"mica:card"`/`"mica:embed"` title convention (spec §1.6).
- YouTube embed allowlist.
**Exit:** drop a PDF → card renders, file link in md; paste URL → offered
card upgrade only after opt-in; offline shows plain links; e2e added.

### C3 — Wiki embeds + hover previews
- `note_section` command (heading slicing, tested against ATX levels).
- `wikiEmbed` node for `![[...]]` with cycle guard; backlink badge kind.
- `DocPreviewPopover` on wiki-link hover (350 ms delay, cached).
**Exit:** `![[Note#Heading]]` renders that section read-only and updates on
source save; cycles degrade to links; hover preview works from editor and
backlinks panel.

### C4 — Split view + peek view
- Store pane model migration (spec §3.2) — the one shared-store change of
  the release; owned by a single agent, reviewed against every openDoc call
  site (Sidebar, QuickSearch, AllDocs, Backlinks, JournalCalendar,
  DocHeader, CanvasView note-cards).
- Tab drag-to-split, Ctrl+\\, ratio persistence; PeekModal + Shift+click
  wiring.
**Exit:** e2e: split, open different docs per pane, unsplit; peek from
all-docs row and wiki link; no regression in the 27 existing UI checks.

### C5 — Templates system
- `template_list`/`template_instantiate` (+ variable substitution tests).
- Picker in quick search + sidebar; default-new-doc setting per spec §1.9.
**Exit:** create template with `{{date}}`/`{{title}}` → instantiate → new
doc has fresh id, substituted body; "ask every time" flow works.

### C6 — Edgeless depth
- mica-drawio ops: group/ungroup/stroke/mindmap (+ unit tests incl.
  draw.io round-trip of grouped/pen/mindmap scenes).
- CanvasView: style panel (selection-scoped), pen tool + eraser, mindmap
  insert + Tab/Enter growth + tidy layout, canvas template picker.
**Exit:** grouped move works; pen stroke survives reload and opens in
draw.io as a visible path; mindmap children lay out and persist; style
edits diff minimally (style-string merge test).

### C7 — Local history
- Snapshot hook in guarded_write + prune on open (budgets per spec §1.10);
  `history_*` commands with tests (dedupe, prune, restore-conflict).
- History right-panel tab + diff + restore UI.
**Exit:** edit a doc 3× over debounce boundaries → 3 snapshots; restore an
old one → current content preserved as newest snapshot; deleting
`.workspace/history` harms nothing.

### C8 — Calendar feeds (optional gate; ships only if C1–C7 land early)
- ICS fetch/parse/cache + `calendar_events`; JournalCalendar overlay +
  journal-header event list.
**Exit:** file-based ICS fixture renders events on correct days offline.

### C9 — Parity audit & release
- `tools/e2e/parity.e2e.mjs` asserting the FR21 checklist end-to-end.
- vault-format.md + README tier table; docs/compat/blocks.md verified
  against GitHub + Obsidian rendering (manual, screenshotted).
- Bench rerun (5k vault) — no regression vs v2 numbers (docs_list ≤ 150 ms,
  warm open ≤ 2 s); editor blocks perf: 1k-callout doc types without lag.
**Exit:** PRD §8 release criteria all pass; version 2.1.0 tagged.

### P1 — Entitlements (parallel, build-flagged MICA_PRO)
- mica-license crate: Ed25519 verify, expiry/grace logic (pure, heavily
  unit-tested incl. tamper cases); `license_install`/`license_info`
  commands; Settings → Account pane; `entitlements` gating helper.
- No Pro feature in the free binary path; flag off = pane hidden.
**Exit:** valid/expired/tampered license fixtures behave per spec; free
build byte-identical behavior with flag off.

### P2 — Sync alpha (needs P1; own release train)
- Content-addressed chunker over vault files; client-side key derivation
  (age or libsodium sealed boxes); relay protocol (push/pull/list) against
  a reference server; conflict surfacing through existing dialog.
- Private alpha behind license tier `pro-alpha`; explicitly excluded from
  v2.1 GA criteria.
**Exit (alpha):** two devices converge on a 1k-doc vault; forced divergence
surfaces the conflict UI; server proven to hold ciphertext only (test
decrypts nothing without client key).

## 3. Verification strategy
- Every phase: `cargo test`, `tsc --noEmit`, `npm run build`, targeted e2e
  additions kept green cumulatively (backend/ui/phase6/bench + new parity).
- Subagent workflow: orchestrator writes phase briefs with explicit file
  ownership; every agent diff is reviewed for correctness + determinism
  rules before merge; serializer changes require golden files in-diff.
- Manual QA checklist per phase appended to this file's status log.

## 4. Status log
- 2026-07-22 — v2.1 plan adopted. Execution not started.
