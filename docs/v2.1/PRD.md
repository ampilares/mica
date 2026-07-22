# PRD: Mica v2.1 — Full local AFFiNE parity (free) + Mica Pro (paid)

**Version:** 2.1.0
**Date:** 2026-07-22
**Status:** Approved for implementation
**Builds on:** [../PRD.md](../PRD.md) (v2, shipped), [../plugin-marketplace.md](../plugin-marketplace.md)
**Parity source:** AFFiNE online docs (docs.affine.pro, affine.pro) surveyed 2026-07-22

---

## 1. Executive summary

v2 shipped AFFiNE's doc-centric shell on the files-first core. The parity
audit against AFFiNE's current docs found the remaining gaps fall into two
groups, and v2.1 productizes exactly that split:

1. **Free tier — everything AFFiNE offers a single local user.** Editor block
   depth (callouts, toggles, tables, math, attachments, link cards, embeds,
   synced blocks), edgeless depth (styling, groups, pen, mind maps,
   templates), split view + peek view, a real templates system, local doc
   history, and calendar feeds. The free app remains complete, offline, and
   account-free forever — the Obsidian trust model.
2. **Mica Pro — the former non-goals become the paid tier.** Encrypted sync,
   real-time collaboration, publishing, team workspaces, and Mica AI. Paid
   features are additive services on top of the same plain files; they are
   delivered as first-party paid plugins on the marketplace rails
   (per [plugin-marketplace.md](../plugin-marketplace.md)) and can never
   hold user data hostage.

**The invariant that survives every line of this document:** all canonical
data stays in ordinary files (`.md`, `.database.json`, `.drawio`) that any
editor can open. Free-tier features must map to portable file formats
(preferring Obsidian-compatible syntax where one exists). Paid features may
add *services*, never *proprietary formats*.

## 2. Tiering model

| | Free (Mica) | Paid (Mica Pro) |
|---|---|---|
| Everything in v2 + §4 below | ✔ forever | ✔ |
| Encrypted sync service | file-based DIY (Git/Drive/Syncthing) | ✔ managed, E2E-encrypted |
| Real-time collaboration | — | ✔ CRDT sessions, file checkpoints |
| Publish doc to web | — | ✔ hosted pages |
| Team workspaces (members, roles) | — | ✔ |
| Mica AI (draft/summarize/mindmap/Q&A) | — | ✔ (BYO-key option: open question Q1) |
| Plugin marketplace | install free plugins | + paid plugins (85/15 rev share) |

Principles:

- P-1 **No data ransom.** A lapsed subscription never blocks reading, editing,
  or exporting anything. Sync stops syncing; files remain files.
- P-2 **No account in free.** Zero network calls without explicit user action.
- P-3 **Paid = services + compute,** not unlocked UI toggles on local data.
  (Anything purely local belongs to free — that is the line.)
- P-4 **Offline-verifiable licensing.** Signed license file; grace period;
  no phone-home requirement to keep working.

## 3. Personas (delta from v2)

- **Local-first knowledge worker** (primary, unchanged) — now fully served by
  free tier; upgrade trigger is multi-device sync or AI.
- **Small team lead** — upgrade trigger is shared workspace + collaboration.
- **Plugin developer** — unchanged from marketplace plan; Pro features are
  first-party plugins proving the paid-plugin rails.

## 4. Free tier: functional requirements

P0 unless noted. File-format mappings are binding (details in specs §1).

### 4.1 Editor block depth (FR21-BLK)
- **-001 Callouts.** Obsidian-style `> [!note] Title` blockquote callouts
  (info/tip/warn/danger/quote at minimum), slash-menu insertable, colored
  rendering, round-trip preserved.
- **-002 Toggle lists.** Collapsible blocks serialized as
  `<details><summary>` HTML (renders on GitHub/most markdown viewers).
- **-003 Tables.** GFM pipe tables: insert via slash menu, add/remove
  rows/columns, tab navigation.
- **-004 Math.** Inline `$…$` and block `$$…$$` LaTeX rendered with KaTeX;
  source preserved verbatim.
- **-005 Attachments.** Drop any file → stored under assets, rendered as an
  attachment card (name, size, open externally); markdown stays a plain link.
- **-006 Link cards ("bookmarks").** A bare URL paragraph can be upgraded to
  a preview card (title/description/favicon). Metadata fetched on demand,
  cached in `.workspace/`, degrades to a plain link offline. (P1)
- **-007 Embeds.** YouTube (and generic iframe-able URLs) render as playable
  embeds from a plain markdown link; degrade to link elsewhere. (P1)
- **-008 Synced blocks / block embeds.** Obsidian syntax `![[Note]]` and
  `![[Note#Heading]]` renders the referenced content live (read-only in v2.1,
  edit-at-source affordance); updates when the source changes.
- **-009 Linked-doc hover preview.** Hovering a wiki link shows a popover
  preview of the target doc.

### 4.2 Edgeless depth (FR21-EDG)
- **-001 Style panel.** Selected elements: fill color, stroke color, stroke
  width, font size, text align — persisted in the drawio style string.
- **-002 Groups.** Group/ungroup (Ctrl+G/Ctrl+Shift+G) via native drawio
  group cells; move/select as one.
- **-003 Pen tool.** Freehand strokes with color/width, stored as
  draw.io-compatible polyline points; eraser deletes strokes.
- **-004 Mind maps.** Insert a mind-map root; Tab/Enter grow child/sibling
  nodes; auto-layout; stored as ordinary shapes + connectors tagged
  `data-workspace-type="mindmap"` so draw.io still renders the tree.
- **-005 Canvas templates.** Prebuilt scenes (brainstorm, kanban wall,
  flowchart starters) insertable onto the canvas. (P1)
- **-006 Multiple note cards.** Any number of linked doc cards per canvas;
  double-click opens; card shows live title + preview.

### 4.3 Navigation (FR21-NAV)
- **-001 Split view.** Two side-by-side panes, drag tab to split, resizable
  divider, independent scroll; keyboard Ctrl+\\.
- **-002 Peek view.** Shift+click (or context "Peek") opens a doc in a
  centered modal preview without leaving the current tab; Esc closes,
  "Open" promotes to tab.
- **-003 Tab pinning.** (P2)

### 4.4 Templates (FR21-TPL)
- **-001** `templates/` folder is the template library; any doc saved there
  appears in a "New from template" picker (quick search action + sidebar).
- **-002** Settings: default new-doc behavior — blank page / blank edgeless /
  pick template / ask every time (AFFiNE parity).
- **-003** Journal template continues to work; per-template variables
  `{{date}}`, `{{title}}` substituted on instantiation.

### 4.5 Local doc history (FR21-HIS)
- **-001** Automatic local snapshots on save (debounced, content-hash
  deduped) into `.workspace/history/`, pruned by age/count budget.
- **-002** History panel per doc: timestamped list, diff view, restore
  (restore writes a new save; never destroys the current file silently).
- This is the free, files-first answer to AFFiNE Cloud's version history.

### 4.6 Calendar feeds (FR21-CAL, P2)
- **-001** Subscribe to read-only ICS URLs/files; events shown in the
  journal calendar panel and on that day's journal header. No event editing
  (AFFiNE has the same limitation).

## 5. Paid tier: Mica Pro requirements

Delivered as first-party paid plugins on marketplace rails (sandboxed, per
plugin-marketplace.md). v2.1 ships the **entitlement foundation + the first
paid service (Sync)**; Collab/Publish/AI/Teams are specified here, scheduled
in the implementation plan as Pro milestones.

### 5.1 Entitlements & licensing (FR21-LIC) — P0 in v2.1
- **-001** Signed offline-verifiable license file (Ed25519), stored in app
  config (never in the vault); Settings → Account shows tier and expiry.
- **-002** Feature gating API: `entitlements.has("sync")` etc.; every gate
  fails open to a clear upsell screen, never to data inaccessibility (P-1).
- **-003** 14-day grace on expiry; read access to Pro *services* may stop,
  local data never.

### 5.2 Mica Sync (FR21-SYN) — first Pro service
- **-001** E2E-encrypted vault sync between devices via a Mica-hosted relay;
  keys derived client-side, server stores ciphertext only.
- **-002** Sync unit = the vault's files (content-addressed chunks), not a
  proprietary database; a fresh device materializes a normal vault folder.
- **-003** Conflicts resolve through the existing file conflict UI; sync
  never auto-overwrites diverged files.

### 5.3 Later Pro services (specified, scheduled post-2.1 core)
- **Collab (FR21-COL):** live multi-cursor sessions layered on CRDT ops with
  periodic canonical-file checkpoints (v2 PRD §15.2 model).
- **Publish (FR21-PUB):** one-click hosted, read-only doc/canvas pages.
- **Teams (FR21-TEA):** shared workspaces, roles (owner/editor/viewer) on
  top of Sync.
- **Mica AI (FR21-AI):** draft/summarize/rewrite, mind-map generation,
  vault Q&A with local embedding index; cloud inference is the paid part.

## 6. Non-goals (v2.1)
- Mobile apps (revisit after Sync ships — sync makes mobile meaningful).
- Meeting transcription (AFFiNE macOS meetings feature).
- Database views beyond table/kanban (AFFiNE itself has only these shipped;
  we track their card/list views for a later release).
- Customizable keyboard shortcuts (AFFiNE also lacks this; backlog).
- Self-serve marketplace onboarding (marketplace plan Phase M2+ unchanged).

## 7. Success metrics
- Free: 90% of AFFiNE local-feature checklist passes a scripted parity audit;
  block features round-trip losslessly through external editors (golden tests).
- Pro: license activation < 30 s offline; sync of a 1 GB vault initial
  upload < 30 min on 50 Mbps; zero data-loss incidents in sync beta.
- Trust: 95% of surveyed users agree "the free app is complete without
  paying" (anti-dark-pattern check, P-3).

## 8. Release criteria (v2.1 core)
1. All P0/P1 free features function offline on a v2 vault, zero migration.
2. Every new block syntax round-trips byte-stable through save/load and
   renders acceptably in Obsidian/GitHub (documented per feature).
3. Entitlement scaffolding merged behind a build flag; Sync in private alpha.
4. `cargo test`, typecheck, e2e suites (extended for new features) green.
5. Updated user docs: vault-format additions, tier comparison page.

## 9. Risks
| Risk | Mitigation |
|---|---|
| HTML `<details>` in markdown breaks some renderers | Feature-flag the toggle block; docs note the tradeoff; body degrades to visible content |
| Link-card fetching looks like telemetry | Explicit opt-in on first use; per-vault setting; offline-silent |
| Paid tier erodes trust narrative | P-1..P-4 enforced in code review; free-tier completeness metric §7 |
| Sync service scope balloons | v2.1 ships alpha behind flag; GA is its own release train |
| Pen/mindmap fidelity in draw.io | Best-effort visual degrade documented (same policy as v2 embeds) |

## 10. Open questions
1. **Q1:** BYO-API-key AI in free tier (cost falls on user) — trust win vs.
   Pro cannibalization. Decide before AI milestone.
2. **Q2:** Sync pricing unit (per-user vs. per-vault-GB).
3. **Q3:** Should local history ship on by default (disk cost) or first-run
   prompt?
4. **Q4:** Peek view for databases/canvases in v2.1 or docs only?
