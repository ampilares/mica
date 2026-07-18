# Mica v2 PRD: Obsidian-Inspired Workspace and Tabs

**Status:** Proposed — ready for implementation approval  
**Branch:** `v2`  
**Date:** 2026-07-13  
**Product owner:** Mica project  
**Related plan:** [implementation-v2-obsidian-workspace.md](implementation-v2-obsidian-workspace.md)

## 1. Summary

Mica v2 will make the desktop workspace feel as fast, calm, and composable as
Obsidian while retaining Mica's own identity and its local-first, file-native
architecture.

The release replaces Mica's single global tab strip with a workspace made of
resizable pane groups. Each pane owns tabs, an active tab, navigation history,
and pane-local controls. Users can open, pin, reorder, close, move, and split
tabs without losing editor state. The app shell, sidebars, menus, empty states,
and interaction feedback will be refined into a coherent, keyboard-friendly UI.

This is not a visual clone. Obsidian is the interaction benchmark; Mica keeps
its name, accent, file formats, database and canvas capabilities, and original
component styling.

## 2. Evidence and Current-State Assessment

### 2.1 Obsidian desktop study

The local Obsidian 1.12.7 desktop app was inspected on 2026-07-13. The observed
workspace included two horizontal pane groups, independent tab strips, a
resizable divider, compact left-side tools, a file/search sidebar, pane-local
navigation controls, and a minimal status bar.

Observed tab and pane interactions:

- A pane has its own tabs, new-tab button, and tab-group menu.
- Tab-group actions include stacked tabs, close all, and direct tab selection.
- Tab context actions include close, close others, close all, pin, link with
  another tab, move to a new window, split right, and split down.
- A newly opened empty tab offers direct create-note and go-to-file actions.
- Pane headers expose back, forward, view mode, and more-options controls.
- Split panes preserve their own active content and can host different view
  types, such as a note beside a graph.

### 2.2 Mica today

Mica already has many appropriate pieces: a left activity rail, file sidebar,
global tab strip, right context panel, status bar, command palette, quick
switcher, note/database/canvas views, light/dark themes, and local settings.

The current workspace state is limited to:

```ts
tabs: OpenTab[]
activePath: string | null
```

Tabs are keyed by path. This prevents duplicate views of the same file,
multiple tab groups, pane-local active state, history, pinning, stable tab
identity, and reliable layout restoration. All content rendering is also owned
by one `App.tsx` loop, which makes split panes impossible without a structural
change.

## 3. Problem Statement

Mica can open several files, but it does not yet behave like a serious desktop
knowledge workspace. Users cannot keep reference material beside the document
they are editing, preserve a working arrangement, navigate backward through a
tab's history, protect a tab from replacement, or organize many open views.

The current UI is clean but visually heavier and less spatially coherent than
Obsidian. Controls are distributed between global surfaces even when they apply
to one pane, tabs consume too much vertical space, responsive behavior hides
sidebars instead of making them intentionally collapsible, and menus lack a
shared interaction system.

## 4. Product Vision

Opening Mica should restore a user's place exactly: panes, tabs, selected files,
split sizes, sidebars, and focus. Moving through notes should feel immediate.
The interface should remain quiet until a control is needed, then make the next
action obvious by mouse or keyboard.

## 5. Goals and Non-Goals

### 5.1 Goals

1. Deliver Obsidian-grade tab groups and split-pane workflows.
2. Preserve editor state and prevent accidental data or workspace loss.
3. Make navigation predictable with pane focus and per-tab back/forward history.
4. Restore the full workspace per vault across app restarts.
5. Create a sleek, compact, accessible visual system for the entire shell.
6. Keep note, database, canvas, graph, and auxiliary views working inside tabs.
7. Support mouse, trackpad, and keyboard workflows without feature disparity.

### 5.2 Non-goals for the first v2 release

- Copying Obsidian branding, proprietary assets, or exact pixel values.
- Reworking Markdown, database, canvas, search-index, or vault file formats.
- Adding cloud sync, accounts, collaboration, or mobile clients.
- Implementing Obsidian plugins, themes, or CSS-snippet compatibility.
- Shipping linked-tab synchronization or detached multi-window tabs in the
  first release. The data model must leave room for them.
- Replacing Tiptap or CodeMirror.

## 6. Users and Jobs to Be Done

### 6.1 Primary user: focused knowledge worker

When researching or writing, I want notes and reference views side by side so I
can synthesize information without repeatedly switching context.

### 6.2 Secondary user: technical power user

When working in a large vault, I want keyboard-first navigation, stable layouts,
and predictable tab behavior so the tool stays out of my way.

### 6.3 Secondary user: visual project planner

When connecting notes, databases, and canvases, I want each view type to behave
as a first-class tab so I can arrange a dashboard for a project.

## 7. Product Principles

- **Local and durable:** workspace metadata may be cached, but canonical user
  content stays in ordinary vault files.
- **Spatially stable:** opening a file should not unexpectedly rearrange panes.
- **Quiet by default:** chrome is compact, low-contrast, and progressive.
- **Fast paths first:** frequent actions have direct controls and shortcuts.
- **One interaction language:** menus, tooltips, focus rings, icons, spacing, and
  motion behave consistently across the app.
- **Mica, not a clone:** use Obsidian's proven behaviors while keeping Mica's
  visual character and data model.

## 8. Scope and Priorities

### 8.1 P0 — required for v2 release

- Recursive horizontal and vertical split panes with draggable dividers.
- Independent tab groups with stable tab IDs and pane-local active tabs.
- Open, activate, create empty, close, close others, and close all tabs.
- Pin/unpin tabs and replacement-safe pinned behavior.
- Reorder tabs and drag tabs between panes.
- Split a tab right or down from its context menu.
- Pane focus with clear but subtle focus indication.
- Per-tab back and forward history.
- Note, source, database, canvas, graph, and empty views in the workspace.
- Workspace restore per vault, including split ratios and sidebar state.
- Compact Obsidian-inspired shell and shared icons/menu primitives.
- Full shortcut coverage, focus management, and accessible semantics.
- Regression coverage for state transitions and critical user journeys.

### 8.2 P1 — delivered in v2

- Stack tabs within a pane.
- Reopen the most recently closed tab or pane.
- Move a tab to a newly created native window.
- Link two tabs so navigation in one updates the other.
- Save, name, and restore workspace presets.
- Drag files from the sidebar to a pane edge to create a split.

### 8.3 Deferred

- Arbitrary floating panels.
- Cross-device workspace sync.
- Mobile pane layouts.
- Third-party workspace extensions.

## 9. Workspace Information Architecture

The desktop shell has four layers:

1. **Activity rail:** compact global tools and settings.
2. **Left sidebar:** switchable file, search, bookmark, and tag panels.
3. **Workspace area:** recursive pane tree containing tab groups and views.
4. **Right sidebar and status area:** contextual outline/backlinks/properties and
   low-priority document state.

The workspace area, not the app root, owns tab controls. Every visible pane has:

- a tab strip;
- new-tab and group-menu controls;
- a pane toolbar with back/forward, title/view indicator, and view options;
- one active view;
- an empty-tab state when no resource has been chosen.

## 10. Interaction Requirements

### 10.1 Opening files

- **FR-OPEN-001:** Opening a file from the sidebar or quick switcher targets the
  focused pane.
- **FR-OPEN-002:** If the focused tab is an empty tab, the file occupies it.
- **FR-OPEN-003:** If the same resource is already open in the focused pane, that
  tab is activated instead of duplicated.
- **FR-OPEN-004:** Normal open navigates the current unpinned tab and appends to
  its history. If the active tab is pinned, a new unpinned tab is created.
- **FR-OPEN-005:** Modified open (`Cmd/Ctrl+Enter` or middle click) always opens a
  new background tab; `Cmd/Ctrl+Shift+Enter` focuses it.
- **FR-OPEN-006:** A resource may be open simultaneously in different panes.

### 10.2 Tab lifecycle

- **FR-TAB-001:** Every tab has a stable ID independent of its resource path.
- **FR-TAB-002:** Tabs display view icon, title, dirty/save error state when
  relevant, pinned state, and a close control on hover or selection.
- **FR-TAB-003:** Clicking activates; middle-click closes; double-click pins or
  unpins; keyboard focus and activation remain distinct.
- **FR-TAB-004:** Tabs can be reordered within a strip by drag and drop.
- **FR-TAB-005:** Context menu actions are Close, Close others, Close tabs to the
  right, Close all, Pin/Unpin, Split right, Split down, and Move to new window
  when that P1 capability is available.
- **FR-TAB-006:** Closing the active tab selects the most recently used remaining
  tab, then the nearest neighbor as fallback.
- **FR-TAB-007:** Closing the final tab leaves an empty tab rather than removing
  the pane. Closing an empty final pane collapses its parent split.
- **FR-TAB-008:** Pinned tabs appear before unpinned tabs and cannot be replaced
  by ordinary navigation.
- **FR-TAB-009:** Unsaved or failed-save content must be flushed or explicitly
  resolved before a destructive close completes.

### 10.3 Pane lifecycle

- **FR-PANE-001:** Users can split the focused pane right or down. The selected
  tab moves to the new pane by default; modifier action duplicates the view.
- **FR-PANE-002:** Split ratios are adjustable by pointer and keyboard, clamped
  to keep each pane usable.
- **FR-PANE-003:** The last interacted pane becomes the focused pane and the
  target for open/new commands.
- **FR-PANE-004:** Tabs can be dragged between panes. Dropping on an edge creates
  a split; dropping on a tab strip inserts at the indicated position.
- **FR-PANE-005:** Empty panes can be closed. The recursive split tree collapses
  cleanly without leaving redundant containers.
- **FR-PANE-006:** A pane-group menu lists its tabs and exposes New tab, Stack
  tabs (P1), Close all, Split right, Split down, and Close pane.

### 10.4 Navigation history

- **FR-NAV-001:** Each tab stores back and forward entries, including resource
  and view-specific location such as editor scroll or canvas viewport when
  available.
- **FR-NAV-002:** Navigating after going back clears the forward branch.
- **FR-NAV-003:** Back/forward controls reflect availability and expose standard
  shortcuts (`Cmd/Ctrl+Alt+Left/Right`).
- **FR-NAV-004:** Renames update live tabs and history references without losing
  tab identity.
- **FR-NAV-005:** Deleted resources show a recoverable missing-file state and do
  not crash workspace restoration.

### 10.5 Workspace persistence

- **FR-WS-001:** Mica saves one workspace snapshot per vault under rebuildable
  `.workspace/` state, never inside canonical Markdown/database/canvas files.
- **FR-WS-002:** The snapshot includes schema version, pane tree, tab order,
  active/focused IDs, pinning, history, split ratios, sidebar visibility and
  width, and active sidebar panels.
- **FR-WS-003:** Updates are debounced and written atomically.
- **FR-WS-004:** Invalid, missing, or newer-version snapshots fall back to a safe
  one-pane workspace without blocking vault open.
- **FR-WS-005:** Restore skips unsafe transient state, validates vault-relative
  paths, and records no document content.

## 11. Visual and UX Requirements

### 11.1 Visual direction

- Use neutral, low-chroma surfaces with one Mica accent color.
- Reduce the standard tab strip from 42 px toward a 34–36 px compact target.
- Use 1 px dividers, small radii, and elevation only for floating menus/dialogs.
- Replace emoji and text-symbol chrome with a consistent SVG icon set.
- Make active state legible through surface and border changes, not saturated
  fills everywhere.
- Keep editor content visually dominant; pane chrome should recede.
- Preserve light, dark, and system themes through semantic design tokens.

### 11.2 App shell

- The activity rail is 40–44 px wide and uses tooltips for every unlabeled icon.
- Sidebars are independently collapsible and resizable, with persisted widths.
- Sidebar panels share compact headers, local actions, search/filter areas, and
  scroll behavior.
- Pane chrome aligns across splits so dividers and tab strips feel structural.
- The status bar is optional, compact, and contextual to the focused tab.

### 11.3 Motion and feedback

- Hover feedback appears within 100 ms; standard transitions finish within
  120–180 ms.
- Drag targets and insertion indicators are unmistakable without large overlays.
- Splits do not animate content dimensions during active resizing.
- Respect `prefers-reduced-motion`.
- Save errors, conflicts, and missing files remain visible until resolved.

### 11.4 Responsive behavior

- Minimum supported window size remains 800×500 for v2.
- Narrow widths collapse sidebars into toggled overlays before compromising the
  focused pane's minimum width.
- When a restored layout cannot fit, Mica preserves the tree but temporarily
  collapses low-priority sidebars and allows pane-local overflow.

## 12. Keyboard and Accessibility Requirements

- **A11Y-001:** Tab strips implement the WAI-ARIA tabs pattern with roving
  `tabindex`, associated tabpanels, and arrow-key navigation.
- **A11Y-002:** Splitters expose separator semantics, current value, and keyboard
  resizing with arrows plus larger modified steps.
- **A11Y-003:** Menus support arrow navigation, Home/End, Escape, typeahead, and
  focus restoration.
- **A11Y-004:** Every icon-only control has an accessible name and tooltip.
- **A11Y-005:** Focus is always visible in both themes and is never encoded by
  color alone.
- **A11Y-006:** Text and essential controls meet WCAG 2.2 AA contrast targets.
- **A11Y-007:** Drag-only actions have menu and keyboard equivalents.

Required shortcuts:

| Action | macOS | Windows/Linux |
|---|---|---|
| New tab | `Cmd+T` | `Ctrl+T` |
| Close tab | `Cmd+W` | `Ctrl+W` |
| Reopen closed tab (P1) | `Cmd+Shift+T` | `Ctrl+Shift+T` |
| Next/previous tab | `Ctrl+Tab` / `Ctrl+Shift+Tab` | Same |
| Select tab 1–8 / last | `Cmd+1…8` / `Cmd+9` | `Ctrl+1…8` / `Ctrl+9` |
| Split right | `Cmd+\` | `Ctrl+\` |
| Split down | command palette | command palette |
| Focus next pane | `Cmd+Option+Shift+Arrow` | `Ctrl+Alt+Shift+Arrow` |
| Navigate back/forward | `Cmd+Option+Left/Right` | `Ctrl+Alt+Left/Right` |

Shortcut conflicts with current Mica bindings must be resolved during the
implementation inventory. In particular, the existing right-panel shortcut on
`Cmd/Ctrl+\` moves to a new documented binding.

## 13. Technical Model and Constraints

### 13.1 Proposed state shape

```ts
type WorkspaceNode =
  | { type: "split"; id: string; direction: "row" | "column";
      ratio: number; first: WorkspaceNode; second: WorkspaceNode }
  | { type: "pane"; id: string; tabIds: string[]; activeTabId: string };

type WorkspaceTab = {
  id: string;
  view: WorkspaceView;
  title: string;
  pinned: boolean;
  history: NavigationEntry[];
  historyIndex: number;
};
```

`WorkspaceView` is a discriminated union for empty, note, source, database,
canvas, graph, and future view types. Tab IDs and pane IDs are runtime-stable
opaque identifiers. Paths remain vault-relative and are never used as React
keys for tab identity.

### 13.2 State ownership

- A dedicated workspace store owns tree mutations and invariants.
- View components receive a `tabId`, `paneId`, view descriptor, and active flag.
- Global commands resolve their target through `focusedPaneId`.
- Document save/conflict state remains shared by canonical path so two views do
  not create competing file writers.
- Selectors isolate pane rerenders; resizing one split must not rerender every
  editor on each pointer event.

### 13.3 Invariants

1. The root always resolves to at least one pane.
2. Every tab belongs to exactly one pane.
3. Every pane has at least one tab; an empty tab is a valid tab.
4. A pane's `activeTabId` belongs to that pane.
5. IDs are unique and persisted snapshots are schema-versioned.
6. Split ratios remain within configured bounds.
7. Tree mutations are pure, deterministic, and unit-testable.

## 14. Non-Functional Requirements

- **NFR-PERF-001:** Restoring 50 tabs across 8 panes completes its workspace
  state load in under 150 ms on a reference developer machine, excluding lazy
  document I/O.
- **NFR-PERF-002:** Tab activation provides visual response within one frame and
  interactive content within 100 ms when already mounted or cached.
- **NFR-PERF-003:** Divider dragging sustains 60 fps under normal layouts.
- **NFR-REL-001:** No tab or pane operation may discard unsaved content.
- **NFR-REL-002:** A corrupt workspace snapshot cannot prevent vault access.
- **NFR-REL-003:** Existing vaults open without migration of canonical content.
- **NFR-PRIV-001:** Workspace snapshots contain only local UI state and relative
  resource identifiers; no content or telemetry leaves the device.
- **NFR-TEST-001:** Workspace reducers achieve comprehensive transition and
  invariant coverage; critical flows have browser-level integration tests.

## 15. Success Metrics

The v2 workspace is successful when:

- 100% of defined P0 acceptance journeys pass on macOS and Windows.
- A restored multi-pane workspace matches its saved structure and focus.
- No data-loss defect is found in tab close, move, split, or restore testing.
- All P0 actions are available without a pointer.
- A usability pass can complete “open two notes side by side, pin one, navigate
  the other, restart, and resume” without instruction.
- Visual QA passes at 800×500, 1280×800, and a high-DPI large window in both
  light and dark themes.

## 16. Release Acceptance Journeys

### Journey A: research beside writing

1. Open a note, split it right, and open a second note in the new pane.
2. Resize the divider and pin the reference note.
3. Navigate links in the writing pane, then use Back to return.
4. Restart Mica and verify panes, ratio, tabs, pin, active tab, and focus restore.

### Journey B: tab organization

1. Open six mixed note/database/canvas tabs in one pane.
2. Reorder tabs, close tabs to the right, and move one tab into another pane.
3. Verify the correct most-recent tab activates and no view state is lost.

### Journey C: keyboard-only workspace

1. Create a new tab, open a file, split right, and switch pane focus.
2. Navigate tabs, open the context menu, pin a tab, and close another.
3. Complete the flow with visible focus and no pointer input.

### Journey D: resilience

1. Restore a workspace containing a renamed, deleted, or unsupported resource.
2. Verify unaffected tabs load, missing tabs show a safe recovery state, and the
   workspace remains editable and saveable.

## 17. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Editor instances lose state while moving between panes | Stable tab keys; move descriptors rather than remounting where possible; explicit view-state adapters |
| Duplicate views race while saving one path | Centralize document/save sessions by path; keep views as subscribers |
| Recursive layout state becomes corrupt | Pure reducer operations, invariants after every mutation in development, versioned restore validation |
| Drag and drop becomes inaccessible or brittle | Menu/keyboard parity first; use explicit drop zones and pointer-capture tests |
| Visual redesign expands without bound | Token and shell scope first; defer editor feature redesign and non-P0 parity |
| Native multi-window support complicates persistence | Design IDs and snapshots for windows now; ship detachment as P1 |

## 18. Open Product Decisions

These are proposed defaults and do not block starting P0 unless the product
owner chooses differently:

1. Normal file open uses the current unpinned tab; modified open creates a tab.
2. Double-click toggles pinning to mirror the familiar “keep this tab” behavior.
3. Splitting moves the current tab by default; holding Option/Alt duplicates it.
4. The first v2 release supports a recursive binary split tree, not arbitrary
   grid containers.
5. Stacked tabs, linked tabs, detached native windows, closed-tab reopening,
   and named workspace presets ship as the v2 P1 layer.

## 19. Definition of Done

P0 is complete only when all requirements in sections 8.1, 10, 11, and 12 are
implemented; the acceptance journeys pass; state migration and failure paths
are tested; light/dark visual QA is approved; and the documentation reflects the
shipped shortcuts and workspace snapshot schema.
