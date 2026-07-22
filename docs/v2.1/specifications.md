# Mica v2.1 Technical Specifications

**Version:** 2.1.0
**Companions:** [PRD.md](PRD.md), [implementation.md](implementation.md)
**Baseline:** v2 specs ([../specifications.md](../specifications.md)) remain
authoritative for everything not amended here.

---

## 1. File-format mappings (binding)

Every free-tier feature maps to a portable syntax. Preference order:
(1) Obsidian-compatible, (2) GFM/common-renderer-compatible, (3) HTML-in-
markdown, (4) fenced app block. Nothing new is stored outside the vault
except rebuildable caches.

### 1.1 Callouts (FR21-BLK-001)
Obsidian callout syntax inside blockquotes:

```markdown
> [!info] Optional title
> Body continues as normal blockquote lines.
```

Kinds v2.1: `note, info, tip, warning, danger, quote` (unknown kinds render
as `note` and round-trip verbatim). Editor: dedicated Tiptap node parsing
`> [!kind]` first-line marker; serializer always re-emits the marker line.

### 1.2 Toggle lists (FR21-BLK-002)
```markdown
<details><summary>Toggle title</summary>

Any markdown content, including nested blocks.

</details>
```
Open/closed UI state is per-session only (not serialized; no `open`
attribute churn in diffs). Blank lines inside are required for renderer
compatibility and are emitted by the serializer.

### 1.3 Tables (FR21-BLK-003)
GFM pipe tables via Tiptap table extensions + tiptap-markdown GFM
serialization. Serializer normalizes column padding minimally (no
re-alignment churn on untouched tables: preserve original text when the
table AST is unchanged — same "don't rewrite what you didn't edit" rule the
note body already follows).

### 1.4 Math (FR21-BLK-004)
`$inline$` and `$$block$$`. Rendered with KaTeX (bundled, offline). Source
text is the canonical form; a `math` Tiptap node stores raw LaTeX and never
reformats it. Invalid LaTeX renders the raw source with an error tint.

### 1.5 Attachments (FR21-BLK-005)
Drop/paste non-image file → saved via existing `asset_save` into
`assets/files/`; markdown is `[name.ext](../assets/files/name.ext)`. A
paragraph consisting solely of such a link to a vault file renders as an
attachment card (icon by extension, file size via new `asset_stat` command,
click = open externally).

### 1.6 Link cards & embeds (FR21-BLK-006/007)
- Markdown stays a plain autolink paragraph: `https://example.com`.
- Card upgrade adds nothing to the file; presentation is chosen by a
  wrapper marker: `[!card](url)` — no. **Decision:** presentation state must
  live in the file to be deterministic. Use link title convention:
  `[Site Title](url "mica:card")` / `"mica:embed"`. Obsidian/GitHub render
  these as normal links (title tooltip); Mica renders card/embed.
- Metadata (title/description/favicon) cache: `.workspace/linkmeta.json`
  (rebuildable). Fetching requires the per-vault opt-in
  `link_previews: true` in config; absent/false = never fetch.
- Embeds v2.1: YouTube (privacy-enhanced embed URL), generic `<iframe>`
  allowlist configurable; everything else falls back to card/link.

### 1.7 Synced blocks / embeds (FR21-BLK-008)
Obsidian embed syntax, already partially indexed by mica-search:

```markdown
![[Other Note]]          # whole-doc embed (body, capped preview)
![[Other Note#Heading]]  # that heading's section
```

Rendered read-only with an "edit source" jump. Cycles are detected
(embed stack, max depth 3) and rendered as links. Backlink index already
records these; add `embed` link kind so backlinks can badge them.

### 1.8 Edgeless additions (FR21-EDG)
All persist into existing draw.io style strings / structures:
- Style panel writes `fillColor`, `strokeColor`, `strokeWidth`, `fontSize`,
  `align` keys into `SceneCell.style` (merge, don't clobber unknown keys).
- Groups: native cells `style="group"` with child `parent` references —
  draw.io's own grouping model. New ops: `group_cells`, `ungroup_cells`.
- Pen strokes: cell kind `pen`, style
  `shape=mica-pen;points=x1,y1 x2,y2 …;strokeColor=…;strokeWidth=…` plus a
  draw.io-readable fallback: serialize as `curved=1` polyline edge-less
  shape (documented best-effort visual in draw.io).
- Mind maps: root/child cells are normal rectangles + connectors with
  `data-workspace-type="mindmap"` and `data-workspace-parent` attributes;
  layout is recomputed app-side (tidy tree, rightward), positions persisted
  so draw.io shows the same tree.
- New scene ops: `group_cells`, `ungroup_cells`, `add_stroke`,
  `mindmap_add_child`, `mindmap_add_sibling` (mica-drawio crate).

### 1.9 Templates (FR21-TPL)
- Library = every `.md` in `templates/` (recursive, sidecars included).
- Instantiation copies frontmatter (minus `id`, regenerated) + body, then
  substitutes `{{date}}` (ISO), `{{date:MMM D, YYYY}}`, `{{title}}`, `{{time}}`.
- Config keys (`extra`): `default_new_doc: "page" | "edgeless" | "template:<path>" | "ask"`.

### 1.10 Local history (FR21-HIS)
- Store: `.workspace/history/<vault-rel-path>/<RFC3339-fs-safe>.md` (same
  for `.database.json`/`.drawio`). Written by the Rust save path after a
  successful canonical write, debounced ≥ 5 min between snapshots per file,
  skipped when content hash equals the last snapshot.
- Budget: per-file keep newest 50 or 90 days (config keys
  `history_max_per_file`, `history_max_age_days`); pruning on vault open.
- Restore = read snapshot → `note_save` with current base_version (conflict
  machinery applies). History is a cache-class folder: deleting it loses
  only history, never truth.

### 1.11 Calendar feeds (FR21-CAL, P2)
Config `calendars: [{ "name": "...", "url": "https://…ics" | "file:..." }]`.
Rust fetch/parse (ical parser crate) on demand + 1 h cache in
`.workspace/calcache.json`. Events render in JournalCalendar + journal
header. Strictly read-only.

## 2. Backend additions (Rust)

```rust
// assets
asset_stat(path) -> { size: u64, mtime: String }

// embeds
note_section(path, heading: Option<String>) -> { markdown: String }
  // body or heading-bounded slice, embed-depth handled by frontend

// link previews (gated by config link_previews)
link_preview(url) -> { title, description, favicon_b64 } // cached

// canvas ops (mica-drawio): GroupCells, UngroupCells, AddStroke,
// MindmapAddChild, MindmapAddSibling — pure scene transforms + tests

// templates
template_list() -> Vec<{ path, title }>
template_instantiate(template: String, title: String, dir: Option<String>)
  -> LoadedFile

// history
history_list(path) -> Vec<{ stamp, size }>
history_read(path, stamp) -> { content }
history_restore(path, stamp, base_version) -> SaveOutcome
// snapshot hook inside guarded_write (note/db/canvas saves)

// calendar (P2)
calendar_events(from: String, to: String) -> Vec<{ start, end, title, calendar }>

// entitlements (Pro scaffolding, build-flagged)
license_install(text) -> LicenseInfo   // verify Ed25519, store app-side
license_info() -> LicenseInfo          // tier, expiry, grace state
```

Licensing: public key baked into the binary; license = signed JSON
`{ tier, email, expires, issued }`; verification pure-offline; stored in the
OS app-config dir (never the vault). Gating helper exposed to frontend as
`entitlements` command; UI reads it once per session.

## 3. Frontend architecture (delta)

### 3.1 Editor
- New Tiptap nodes: `callout`, `toggle` (details), `mathInline`/`mathBlock`
  (KaTeX), `attachmentCard`, `linkCard`, `embedFrame`, `wikiEmbed`.
- Slash menu gains: Callout, Toggle, Table, Math, Attachment, Bookmark,
  YouTube, Embed doc, Template.
- Hover preview: shared `DocPreviewPopover` (used by wiki links and peek);
  content via `note_section` capped at N blocks.
- New deps: `katex`, `@tiptap/extension-table` family. (No network deps.)

### 3.2 Split view (FR21-NAV-001)
Store gains pane model:

```ts
interface Layout { panes: [Pane] | [Pane, Pane]; activePane: 0 | 1; ratio: number }
interface Pane { tabs: OpenTab[]; activePath: string | null }
```

Migration: existing single-pane state becomes `panes[0]`. Tab strip renders
per pane; drag a tab onto the right 20% of the content area (or Ctrl+\\) to
split; closing the last tab of pane 2 unsplits. All `openDoc` paths route to
the active pane. Right sidebar follows the active pane's doc.

### 3.3 Peek view (FR21-NAV-002)
`PeekModal` renders a read-only NoteEditor (or DB/canvas placeholder per
open question Q4) for a path; Shift+click on any doc link/row opens it;
Esc closes; "Open" converts to a real tab in the active pane.

### 3.4 History panel
Right-sidebar tab "History": snapshot list → side-by-side diff (reuse
`diff.ts`) → Restore button (confirm). Entry point also in doc more-menu.

### 3.5 Templates UI
- Quick search: "New from template…" action group.
- Sidebar new-doc dropdown gains "From template…".
- Settings → Editor: default-new-doc select (page/edgeless/template/ask).

### 3.6 Pro surfaces (build-flagged `MICA_PRO`)
- Settings → Account: license install/info, tier badge, upsell copy.
- Sync plugin UI ships with the sync alpha, not in core bundle.

## 4. Compatibility & determinism rules
- Every new serializer path has golden-file tests plus an external-render
  smoke doc (`docs/compat/blocks.md`) checked into the repo.
- Untouched blocks must re-serialize byte-identically (existing rule).
- New config keys ride the `extra` flatten; unknown keys keep round-tripping.
- `.workspace/linkmeta.json`, `history/`, `calcache.json` are cache-class:
  rebuildable or losable without touching truth.

## 5. Testing requirements
- Rust: unit tests per new command; scene-op tests (group/ungroup/stroke/
  mindmap); history snapshot/prune/restore; license verify (valid, expired,
  tampered, grace).
- Frontend: tsc + build; e2e additions: callout/toggle/table/math round-trip
  through disk, split view open/close, peek open, template instantiation,
  history restore, embed rendering (`![[...]]`).
- Parity audit script (`tools/e2e/parity.e2e.mjs`): walks the FR21 checklist
  and asserts each feature's DOM/file signature — this is PRD §7's metric.
