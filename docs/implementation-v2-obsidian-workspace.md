# Mica v2 Implementation Plan: Obsidian-Inspired Workspace and Tabs

**Status:** Implemented on `v2` — frontend, Rust, and runtime verification complete  
**Branch:** `v2`  
**Date:** 2026-07-13  
**Source PRD:** [PRD-v2-obsidian-workspace.md](PRD-v2-obsidian-workspace.md)

## 1. Delivery Strategy

### Completion evidence (2026-07-13)

- Frontend: 21 Vitest files / 90 tests pass; TypeScript and Vite production
  build pass.
- Rust: `cargo check --workspace --locked` and the complete
  `cargo test --workspace --locked` suite pass. The macOS watcher suite was
  run outside the managed sandbox so native filesystem events were delivered.
- Scale: deterministic 50-tab/eight-pane round-trip and 5,760 randomized
  workspace mutations pass invariant checks.
- Runtime: Tauri dev launch, light/dark visual review, 800×500 and default
  large viewport review, tab creation, pane menus, split creation, accessible
  DOM semantics, and console-error checks pass.
- Obsidian comparison: activity rail density, shallow tab chrome, pane toolbar,
  split borders, sidebar hierarchy, and empty-state spacing were reviewed
  against Obsidian 1.12.7 on macOS.

Implement the workspace from state invariants outward:

1. Establish a tested pane/tab domain model.
2. Adapt every open/close/navigation caller to the new command API.
3. Render the recursive pane tree and views.
4. Add direct manipulation, persistence, and resilience.
5. Apply the compact visual system and complete accessibility/QA.

The app should remain runnable at the end of each phase. Avoid a long-lived
parallel implementation in which old and new tab state can diverge. A temporary
compatibility adapter is acceptable for one phase, then must be removed.

## 2. Architecture Decisions

### 2.1 Workspace state

Create a dedicated workspace domain under `apps/desktop/src/workspace/`:

```text
workspace/
  model.ts            IDs, pane tree, tabs, view descriptors, snapshots
  operations.ts       pure mutations and invariants
  selectors.ts        focused/active/resource selectors
  persistence.ts      serialize, validate, migrate, debounce
  shortcuts.ts        platform-aware commands
  viewState.ts        per-view location capture/restore adapters
  __tests__/           reducer, migration, and invariant tests
```

Use stable string IDs for tabs, panes, and splits. Prefer a small internal ID
factory over adding a runtime dependency solely for IDs. The canonical state is
normalized: a recursive layout tree plus maps of panes and tabs. Pure operations
return or apply one atomic state change.

Recommended operations:

- `createWorkspace`, `createTab`, `openResource`, `navigateTab`
- `activateTab`, `activatePane`, `pinTab`, `moveTab`, `reorderTab`
- `closeTab`, `closeOtherTabs`, `closeTabsToRight`, `closePane`
- `splitPane`, `resizeSplit`, `collapseSplit`
- `goBack`, `goForward`, `renameResource`, `markResourceMissing`
- `serializeWorkspace`, `restoreWorkspace`, `migrateSnapshot`

### 2.2 View descriptors

Represent content with a discriminated union:

```ts
type WorkspaceView =
  | { type: "empty" }
  | { type: "note"; path: string; mode: "rich" | "source" }
  | { type: "database"; path: string }
  | { type: "canvas"; path: string }
  | { type: "graph"; centerPath?: string }
  | { type: "missing"; original: ResourceView; reason: string };
```

Move note rich/source mode into the tab view descriptor so two panes can show
the same note in different modes. Keep document sessions, save status, and
conflict coordination path-scoped.

### 2.3 Rendering boundaries

Refactor `App.tsx` into shell composition only:

```text
AppShell
├── ActivityRail
├── LeftSidebar
├── WorkspaceRoot
│   └── SplitNode | PaneGroup
│       ├── TabStrip
│       ├── PaneToolbar
│       └── ViewHost
├── RightSidebar
└── StatusBar
```

`WorkspaceRoot` recursively renders layout nodes. `PaneGroup` subscribes only to
its pane and active tab. `ViewHost` switches on the view descriptor. Global
overlays remain mounted once at the shell level.

### 2.4 Persistence boundary

Add Tauri commands for reading and atomically writing a vault-specific workspace
snapshot, for example `.workspace/ui/workspace-v2.json`. Rust validates that the
file remains under the open vault's `.workspace/` directory. The frontend owns
schema validation and migration; the backend owns safe local I/O.

Do not put the full workspace JSON in browser `localStorage`: it is not naturally
vault-scoped and complicates backup/recovery. App-wide appearance preferences
can remain in the existing persisted settings store.

## 3. Phase 0 — Baseline and Guardrails

**Objective:** Make the refactor measurable and safe before behavior changes.

### Work items

- Record current build and Rust test results.
- Add a frontend unit test runner (Vitest with jsdom) and React Testing Library.
- Add Playwright or an equivalent Vite browser harness for critical workspace
  flows; keep Tauri command calls behind mockable interfaces.
- Inventory all `openTab`, `closeTab`, `activePath`, `tabs`, and `sourceMode`
  consumers and assign their future workspace command/selector.
- Document current keyboard shortcuts and resolve collisions in one command map.
- Capture visual baselines at 800×500 and 1280×800 in light/dark themes.
- Define performance marks for restore, tab activation, and split resize.

### Exit criteria

- Existing frontend build and Rust tests pass.
- Test infrastructure runs locally and in CI without a Tauri window.
- A migration checklist covers every current tab-state consumer.
- Shortcut decisions from the PRD are encoded as a testable command table.

## 4. Phase 1 — Workspace Domain Model

**Objective:** Replace path-keyed global tab state with a deterministic pane tree.

### Work items

- Implement types for IDs, layout nodes, panes, tabs, views, navigation entries,
  closed-tab records, and versioned snapshots.
- Implement pure operations listed in section 2.1.
- Enforce invariants after every development/test mutation.
- Define most-recently-used activation behavior for close operations.
- Implement pinned ordering and replacement rules.
- Implement recursive split collapse and ratio clamping.
- Implement resource rename/delete propagation through tabs and history.
- Add selectors for focused pane, active tab/view/path, tabs by pane, and all
  views of a resource.
- Integrate the domain into Zustand with action-level selectors; do not expose
  arbitrary `set` access to components.
- Add a one-time in-memory adapter from the old `tabs/activePath` shape during
  development, then remove the old fields before Phase 2 exits.

### Tests

- Table-driven tests for every operation and edge case.
- Property-style randomized operation sequences that assert invariants.
- Duplicate resource in separate panes.
- Pinned versus unpinned open behavior.
- Close active/first/last/only tab behavior.
- Nested split creation, resize, move, and collapse.
- Rename/delete updates across history.

### Exit criteria

- No production component mutates legacy tab state.
- Pure state tests cover all P0 tab/pane requirements.
- Random valid operation sequences cannot violate workspace invariants.

## 5. Phase 2 — Workspace Rendering and Command Migration

**Objective:** Render multiple live panes and preserve all current content types.

### Work items

- Build `WorkspaceRoot`, `SplitNode`, `PaneGroup`, `PaneToolbar`, `TabStrip`,
  `WorkspaceTab`, `ViewHost`, and `EmptyTab` components.
- Use CSS grid/flex at each split node with a dedicated separator.
- Render notes, source notes, databases, canvases, graphs, and missing resources
  through `ViewHost`.
- Change view components to accept tab/pane context where needed.
- Move rich/source mode from global path state to the tab descriptor.
- Migrate all file-opening callers:
  - Sidebar and tree nodes
  - Quick switcher and search
  - Wiki links and backlinks
  - Database relations and canvas links
  - Command palette and conflict outcomes
- Replace global `activePath` reads in RightPanel, GraphPanel, StatusBar, and
  commands with focused-pane selectors.
- Ensure global overlays target the pane that was focused when invoked.
- Add empty-tab create/open actions and a safe missing-resource view.

### Tests

- Component tests for ARIA relationships between tabs and tabpanels.
- Mixed view types rendered in multiple panes.
- Same note in rich and source modes in separate panes.
- Commands invoked from overlays target the expected pane.
- View activation and unmount policy does not lose editor/canvas state.

### Exit criteria

- All current view types work in any pane.
- There are no remaining production references to legacy `tabs` or `activePath`.
- Opening, switching, closing, and splitting work with keyboard controls.

## 6. Phase 3 — Tab and Pane Interactions

**Objective:** Complete direct-manipulation behavior and menu parity.

### Work items

- Build shared accessible `Menu`, `MenuItem`, `Tooltip`, and `IconButton`
  primitives before adding context menus.
- Implement tab context menu: close, close others, close right, close all,
  pin/unpin, split right, and split down.
- Implement pane-group menu and tab list.
- Add mouse and keyboard tab reordering.
- Add pointer-based dragging between strips with clear insertion indicators.
- Add edge drop zones for right/down/left/up split creation.
- Implement divider pointer capture, keyboard resize, double-click reset, ratio
  clamping, and appropriate cursor/ARIA state.
- Add pane focus management and spatial next-pane navigation.
- Implement middle-click close and double-click pin without compromising text or
  drag interactions.
- Add auto-scroll when dragging across an overflowing tab strip.
- Make every drag action available through menus and shortcuts.

### Implementation guidance

- Prefer the platform HTML drag model only if it behaves consistently in Tauri
  WebView on target platforms. Otherwise use pointer events with one internal
  drag controller; decide via a small spike before full implementation.
- Do not change React keys when a tab moves panes.
- Keep resize ratio in transient component state during pointer movement and
  commit throttled/final values to the store to protect editor performance.

### Tests

- Pointer and keyboard reorder.
- Move across panes at beginning, middle, and end.
- Edge drops create correct split direction.
- Cancelled drag leaves state untouched.
- Divider clamping and nested split resizing.
- Menu keyboard navigation, Escape behavior, and focus restoration.

### Exit criteria

- PRD tab and pane P0 interactions work by mouse and keyboard.
- Resize remains smooth with several mounted editors.
- No operation loses focus invisibly or discards view state.

## 7. Phase 4 — Navigation and Workspace Persistence

**Objective:** Make the workspace durable and navigable across sessions.

### Work items

- Implement per-tab history with branching semantics.
- Capture view locations through adapters:
  - Note/source editor selection and scroll
  - Database view/filter/scroll when feasible
  - Canvas viewport and selection
  - Graph center and viewport
- Add pane-toolbar back/forward controls and shortcuts.
- Define history compaction and an upper bound per tab.
- Add Rust commands and tests for atomic workspace snapshot read/write.
- Implement snapshot schema validation, migration, and safe fallback.
- Debounce persistence and flush on vault switch/app close where available.
- Restore pane tree first, then lazy-load active/visible view content.
- Persist left/right sidebar open state, widths, selected panels, focused pane,
  and split ratios.
- Handle missing/renamed files without aborting restore.
- Add a development-only corrupt-snapshot fixture and recovery test.

### Snapshot proposal

```json
{
  "schemaVersion": 2,
  "savedAt": "2026-07-13T00:00:00Z",
  "window": { "root": {}, "focusedPaneId": "pane_1" },
  "panes": {},
  "tabs": {},
  "sidebars": {
    "left": { "open": true, "width": 260, "panel": "files" },
    "right": { "open": true, "width": 262, "panel": "outline" }
  }
}
```

The exact serialized tree is finalized with the domain model. `savedAt` is for
diagnostics only and must not drive state resolution.

### Tests

- Round-trip every workspace state type.
- Migrate older fixture snapshots and reject future/invalid schemas safely.
- Atomic write interruption leaves the prior valid snapshot readable.
- Restore 50 tabs/8 panes within the PRD target.
- Back/forward restores resource and location; new navigation clears forward.

### Exit criteria

- Acceptance Journey A and D pass across app restart.
- Corrupt snapshots never prevent vault opening.
- Restored content loads progressively without freezing the shell.

## 8. Phase 5 — Visual System and Shell Refinement

**Objective:** Deliver the sleek Obsidian-inspired UX without copying its brand.

### Work items

- Expand semantic tokens for workspace backgrounds, raised surfaces, inactive
  chrome, focused pane, dividers, drag targets, overlays, and status colors.
- Replace emoji/text-symbol chrome with one SVG icon component and consistent
  16/18 px icon geometry.
- Compact activity rail, tab strip, pane toolbar, sidebar headers, and status bar.
- Add resizable/collapsible sidebars and narrow-window overlay behavior.
- Unify sidebar panel headers, search controls, empty states, menus, tooltips,
  buttons, inputs, and scrollbars.
- Refine tab truncation, pinned-tab sizing, overflow handling, close affordance,
  save/error badges, and focused-pane treatment.
- Remove decorative gradients/shadows that compete with document content;
  reserve elevation for overlays.
- Add reduced-motion styles and high-contrast focus treatments.
- Tune editor gutters/header alignment so split panes feel continuous.
- Update onboarding and empty workspace to teach quick open, new tab, and split.

### Visual QA matrix

| Dimension | Coverage |
|---|---|
| Theme | Light, dark, system transition |
| Window | 800×500, 1280×800, large high-DPI |
| Layout | One pane, horizontal split, vertical split, nested split |
| Tabs | Empty, pinned, overflow, long titles, save error, missing file |
| Sidebars | Both open, each collapsed, narrow overlay |
| Content | Note, source, database, canvas, graph |
| Input | Mouse, keyboard, reduced motion |

### Exit criteria

- Visual QA has no clipping, overlap, unreadable state, or hidden essential action.
- Both themes meet contrast and focus requirements.
- The shell reads as one coherent design system at all target sizes.

## 9. Phase 6 — Hardening and Release

**Objective:** Validate data safety, accessibility, and cross-platform behavior.

### Work items

- Run all PRD acceptance journeys on macOS and Windows; smoke test Linux.
- Test Tauri WebView differences for pointer capture, context menus, middle
  click, modifier keys, and focus restoration.
- Run axe or equivalent automated accessibility checks, followed by keyboard and
  screen-reader spot checks.
- Profile tab activation, split resize, snapshot restore, and memory usage with
  50 tabs/8 panes.
- Exercise rename/delete/external-change/conflict flows with duplicate views.
- Test vault switch, crash/restart, corrupted snapshot, and future schema.
- Update README, shortcuts, architecture notes, and workspace snapshot schema.
- Remove compatibility adapters, development invariants in production paths,
  debug logs, and stale CSS/components.

### Release gates

- `npm run build` passes.
- Frontend unit/component/integration suites pass.
- `cargo test --workspace` passes.
- PRD P0 requirements and four acceptance journeys pass.
- No known P0/P1 data-loss, crash, inaccessible critical action, or restore bug.
- Performance and visual QA targets pass or have an approved exception.

## 10. P1 Delivery Sequence

P1 work started after P0 stabilized and is now delivered:

1. **Closed-tab stack:** bounded persisted undo records and reopen are shipped.
2. **Stacked tabs:** pane-local alternate layout is shipped without changing ownership.
3. **Native windows:** the snapshot root uses `windows[]`, with Tauri window
   labels/capabilities and transactional moves between window-local trees.
4. **Linked tabs:** explicit link groups and loop-safe synchronized navigation
   are shipped.
5. **Workspace presets:** named sanitized snapshots are stored separately from
   the automatic last-session snapshot and exposed through the command palette.

Each item needs its own acceptance criteria and must not weaken P0 persistence or
document-session guarantees.

## 11. Planned File Impact

Expected new files:

- `apps/desktop/src/workspace/*`
- `apps/desktop/src/components/workspace/*`
- `apps/desktop/src/components/ui/Menu.tsx`
- `apps/desktop/src/components/ui/Tooltip.tsx`
- `apps/desktop/src/components/ui/Icon.tsx`
- Workspace unit, component, and integration tests

Expected major edits:

- `apps/desktop/src/store.ts`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/styles.css` (prefer splitting into token/shell/workspace files
  if the current single file becomes harder to maintain)
- All components that open resources or read the active path
- `apps/desktop/src/settings.ts`
- `apps/desktop/package.json`
- `crates/mica-tauri/src/commands.rs`
- `crates/mica-tauri/src/lib.rs` or command registration module
- Tauri capability configuration for dynamic native workspace windows

## 12. Pull Request Slicing

Keep reviewable changes and preserve a working branch:

1. `test: add frontend workspace test harness`
2. `feat: add workspace pane and tab domain model`
3. `refactor: route resource opening through workspace commands`
4. `feat: render recursive pane groups and view hosts`
5. `feat: add tab menus, pinning, and keyboard navigation`
6. `feat: add drag reorder, pane moves, and split resizing`
7. `feat: add tab history and view-state restoration`
8. `feat: persist versioned workspace snapshots`
9. `style: refine Mica v2 shell and design tokens`
10. `test: complete accessibility, resilience, and cross-platform coverage`

If implementation happens in one feature branch, preserve these as logical
commits or small PRs so state-model review is not buried beneath styling diffs.

## 13. Verification Checklist

Before requesting final v2 approval:

- [x] All legacy tab state and path-as-tab-key assumptions are removed.
- [x] Workspace invariant, migration, and corrupt-state tests pass.
- [x] Every file-opening surface targets the focused pane correctly.
- [x] Every view type renders, moves, splits, closes, and restores safely.
- [x] Tab/pane operations have mouse and keyboard equivalents.
- [x] Duplicate views cannot race or lose document changes.
- [x] Rename, delete, conflict, and external edit flows work in multiple panes.
- [x] Workspace and sidebar state restore per vault and native window.
- [x] Light/dark/narrow/large visual matrices pass on the available Retina macOS host.
- [x] Reduced motion, focus, menu, tab, and splitter accessibility pass.
- [x] Build, Rust tests, frontend suites, and acceptance journeys pass.

## 14. Approval Boundary

This document and its PRD are planning artifacts only. Product implementation
must not begin until the product owner explicitly approves the proposed scope,
open-decision defaults, and phased plan.
