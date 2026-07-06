# Product Requirements Document: Local-First Rust Notes Workspace

**Working title:** File-native AFFiNE-like Workspace  
**Version:** 0.1  
**Date:** 2026-07-02  
**Owner:** Product / Engineering  
**Status:** Draft for review

---

## 1. Executive Summary

Build a **local-first, file-native notes and knowledge workspace** that feels familiar to users of Notion and AFFiNE while preserving the transparent file ownership model of Obsidian. The app should support rich block-based notes, databases/tables, and an infinite visual canvas. Unlike cloud-first workspaces, the canonical source of truth is a normal folder on disk:

- Notes are saved as human-readable Markdown files.
- Tables and databases are saved as deterministic JSON files.
- Canvas drawings are saved as draw.io-compatible XML-style `.drawio` files where possible.
- Indexes, thumbnails, caches, and CRDT metadata are treated as rebuildable implementation artifacts, not the primary data store.

The product should be implemented with a **Rust-first architecture**. AFFiNE should be used as a primary product and architecture reference, especially for the block editor, edgeless canvas, database UX, and local-first principles, but this project’s differentiator is **file-native persistence** rather than an opaque app database.

---

## 2. Background and Source References

### 2.1 AFFiNE reference points

AFFiNE positions itself as a privacy-focused, local-first, open-source alternative to Notion and Miro, combining documents, whiteboards, databases, and AI in one workspace. Its public documentation describes key concepts that should inform this project:

- Block-based editor built on BlockSuite.
- Edgeless whiteboard/canvas mode with shapes, connectors, notes, embedded blocks, frames, and presentation mode.
- Multi-view databases with table, kanban, and gallery views.
- Local-first architecture using CRDTs, local storage, and optional cloud/server sync.
- A monorepo architecture with frontend, backend, BlockSuite editor, and native/Rust components.

This project should borrow the **product model** of “write, draw, and plan in one place,” while changing the persistence layer to user-owned files.

### 2.2 Obsidian reference points

Obsidian’s strength is that notes are stored as Markdown-formatted plain text files in a local vault folder. Users can edit those files with other editors, sync them with third-party tools, and manage them with the operating system. This project should preserve that philosophy while adding richer Notion/AFFiNE-like editing and structured data.

### 2.3 draw.io reference points

draw.io diagrams are XML-based `.drawio` files. draw.io documentation notes that the raw diagram XML describes shapes, connectors, styles, and metadata, and that diagram XML can be viewed or edited directly. This makes `.drawio` a good interchange format for the canvas layer, with the caveat that not every app-specific canvas block will map perfectly to draw.io.

### 2.4 Tauri/Rust reference points

Tauri is a strong candidate for the desktop shell because it supports cross-platform apps with web frontends and Rust application logic. The product can pair a high-quality web-based block editor/canvas UI with a Rust core responsible for storage, indexing, file watching, parsing, import/export, and optional sync.

### 2.5 Sources reviewed

- AFFiNE repository: https://github.com/toeverything/AFFiNE
- AFFiNE introduction: https://toeverything-affine.mintlify.app/introduction
- AFFiNE editor docs: https://toeverything-affine.mintlify.app/features/editor
- AFFiNE whiteboard docs: https://toeverything-affine.mintlify.app/features/whiteboard
- AFFiNE database docs: https://toeverything-affine.mintlify.app/features/database
- AFFiNE local-first docs: https://toeverything-affine.mintlify.app/features/local-first
- AFFiNE architecture docs: https://toeverything-affine.mintlify.app/contributing/architecture
- Obsidian data storage docs: https://obsidian.md/help/data-storage
- draw.io XML source docs: https://www.drawio.com/docs/manual/advanced/diagram-source-edit/
- draw.io XML export docs: https://www.drawio.com/docs/manual/export/export-to-xml/
- Tauri 2.0 docs: https://v2.tauri.app/

---

## 3. Product Vision

Create a workspace where users can:

1. Write notes with a modern block editor.
2. Organize information with structured databases.
3. Think visually on an infinite canvas.
4. Own their data as ordinary files.
5. Use Git, Dropbox, iCloud, Syncthing, rsync, or any other file-based workflow without vendor lock-in.
6. Open and edit the same content outside the app when needed.

The ideal user experience is: **Notion-like creation speed + AFFiNE-like canvas/database flexibility + Obsidian-like file ownership + Rust-level performance and reliability.**

---

## 4. Problem Statement

Modern knowledge tools tend to force users into one of two trade-offs:

- **Cloud workspace tools** provide polished block editing, databases, collaboration, and rich UI, but users do not directly own files in portable formats.
- **File-based Markdown tools** provide durable local ownership, portability, and Git compatibility, but often lack native databases, rich block interactions, and integrated whiteboards.

Users need a local-first workspace that provides the productivity of a modern all-in-one workspace while keeping content available as transparent, versionable, backup-friendly files.

---

## 5. Goals and Non-Goals

### 5.1 Goals

- Provide a desktop-first local workspace with block-based notes, databases, and canvas.
- Save canonical user records as Markdown, JSON, and draw.io-compatible XML files.
- Allow the vault folder to be browsed, backed up, synced, searched, and edited outside the app.
- Maintain deterministic file formatting for Git-friendly diffs.
- Detect external file changes and update the app without manual refresh.
- Support basic Obsidian-style wiki links and backlinks.
- Support import from Markdown folders and export back to clean Markdown/JSON/XML.
- Use Rust for core storage, indexing, parsing, file watching, and app services.
- Keep all MVP features usable offline.

### 5.2 Non-Goals for MVP

- Real-time multi-user collaboration is not required for MVP.
- A hosted cloud service is not required for MVP.
- Full Notion API compatibility is not required.
- Full draw.io feature parity is not required.
- Full AFFiNE feature parity is not required.
- Mobile apps are not required for MVP.
- AI features are not required for MVP.
- End-to-end encrypted cloud sync is not required for MVP.

---

## 6. Target Users and Personas

### 6.1 Primary Persona: Local-First Knowledge Worker

**Profile:** Developer, researcher, writer, founder, consultant, or product manager.  
**Needs:** Fast notes, durable data ownership, search, backlinks, visual thinking, and structured tracking.  
**Pain:** Wants Notion-like UX but does not want content locked in a SaaS database.  
**Success:** Can use the app daily while keeping files in Git or a synced local folder.

### 6.2 Secondary Persona: Technical Team Lead

**Profile:** Leads a small engineering/product team.  
**Needs:** Project docs, decision logs, kanban/task databases, diagrams, architecture maps.  
**Pain:** Needs transparent files for review, versioning, backup, and compliance.  
**Success:** Team can store workspace in a repository or shared folder and review changes as diffs.

### 6.3 Secondary Persona: Visual Thinker

**Profile:** Designer, educator, strategist, architect, systems thinker.  
**Needs:** Infinite canvas, sticky notes, arrows, frames, embedded notes/databases.  
**Pain:** Whiteboard tools are separate from notes and often cloud-based.  
**Success:** Can create diagrams that remain portable as `.drawio` files.

---

## 7. Product Principles

1. **Files are the product.** The app enhances the vault; it must not trap the vault.
2. **Canonical data is human-inspectable.** Markdown and JSON should be understandable without the app.
3. **Caches are disposable.** Search indexes, thumbnails, and UI state can be rebuilt.
4. **Offline-first by default.** Every MVP workflow must work without internet.
5. **Git-friendly by design.** Stable ordering, stable IDs, deterministic formatting, and minimal churn.
6. **Interoperability over perfection.** Prefer formats other tools can read, even if some app-specific fidelity requires sidecar metadata.
7. **Progressive enhancement.** A note should still be useful as plain Markdown if opened elsewhere.
8. **Respect user intent.** External file edits must be detected, not overwritten silently.

---

## 8. Recommended Product Direction

### 8.1 Use AFFiNE as inspiration, not a blind fork

AFFiNE’s product model is highly aligned, but a direct fork carries complexity because AFFiNE’s current stack is a large TypeScript/Yarn monorepo with React/Electron, BlockSuite, Y.js, IndexedDB, server sync, PostgreSQL, Redis, and Rust native packages. This project should use AFFiNE as:

- A reference for interaction patterns.
- A reference for block/canvas/database concepts.
- A possible source of reusable open-source components where license and architecture fit.
- A compatibility target for imports/exports where practical.

The recommended architecture is a **new Rust-first app shell** with selective reuse of editor/canvas components rather than trying to convert all of AFFiNE into a file-native Rust application at once.

### 8.2 Proposed implementation model

- **Desktop shell:** Tauri 2.x.
- **Core:** Rust workspace crates for vault, file formats, search, indexing, file watching, import/export, sync adapters, and command API.
- **Frontend:** Web UI inside Tauri. React + BlockSuite-compatible UI is the pragmatic path if AFFiNE/BlockSuite reuse is desired. A pure Rust UI can be evaluated later, but a rich Notion/AFFiNE-like editor will likely ship faster with web editor technology.
- **Canonical storage:** User-visible vault files.
- **Runtime state:** In-memory block model and optional CRDT layer.
- **Index/cache:** Rebuildable SQLite/Tantivy-like local index in a hidden app folder.

---

## 9. Scope

### 9.1 MVP Scope

The MVP must support:

- Create/open a local vault folder.
- Create, edit, rename, move, and delete Markdown notes.
- Rich block editing for common Markdown-compatible blocks.
- Slash command menu for inserting blocks.
- Wiki links, backlinks, tags, and basic graph/link panel.
- File watcher that tracks external edits, creates, deletes, and renames.
- Full-text search over notes and database row text.
- Basic database block saved as JSON.
- Table view for databases.
- Basic kanban view for databases.
- Basic canvas saved as uncompressed `.drawio` XML.
- Canvas tools: select, pan, zoom, rectangle, ellipse, text, sticky note, connector, frame.
- Embed/link notes and databases on canvas as linked placeholder blocks.
- Deterministic formatter for Markdown frontmatter, JSON, and XML.
- Import an existing folder of Markdown files.
- Export selected notes/databases/canvases.
- Local backup/snapshot command.
- Cross-platform desktop builds for macOS, Windows, and Linux.

### 9.2 Post-MVP Scope

- Gallery database view.
- Formula and rollup properties.
- Relations between databases.
- More advanced canvas tools.
- Presentation mode from canvas frames.
- Plugin API.
- Mobile companion app.
- Optional encrypted sync.
- Optional peer-to-peer sync.
- Real-time collaboration.
- AI assistant.
- AFFiNE import/export.
- Obsidian plugin compatibility exploration.

---

## 10. User Journeys

### 10.1 Create a vault and first note

1. User opens the app.
2. User chooses “Create vault.”
3. User selects a local folder.
4. App creates a vault structure and hidden app settings folder.
5. User creates a note named “Project Plan.”
6. App creates `notes/project-plan.md`.
7. User writes with block editor.
8. App saves valid Markdown continuously.
9. User can open the Markdown file in another editor and see useful content.

### 10.2 Use a database inside a note

1. User types `/database`.
2. User creates a “Tasks” database.
3. App creates `databases/tasks.database.json`.
4. Note embeds or references the database block.
5. User adds columns: Status, Owner, Due Date.
6. User switches between table and kanban views.
7. JSON file updates deterministically.
8. User can inspect or version-control the JSON file.

### 10.3 Draw a canvas connected to notes

1. User creates a canvas called “System Map.”
2. App creates `canvases/system-map.drawio`.
3. User adds shapes, connectors, text, and sticky notes.
4. User drags a note onto the canvas.
5. Canvas stores a shape with a link/reference to `notes/project-plan.md`.
6. The note itself remains Markdown; the canvas references it.
7. User can open the `.drawio` file in draw.io and see a reasonable diagram.

### 10.4 External file edit

1. User edits a Markdown file in VS Code.
2. App file watcher detects the change.
3. App re-parses the file.
4. If no conflicting in-app edits exist, UI updates automatically.
5. If both app and external editor changed the same file, app shows a conflict resolution panel.

### 10.5 Git workflow

1. User stores vault in a Git repository.
2. App writes stable Markdown/JSON/XML with minimal formatting churn.
3. User commits changes.
4. Teammate pulls changes.
5. App detects file updates and rebuilds affected indexes.
6. Merge conflicts are standard text conflicts where possible.

---

## 11. Functional Requirements

### 11.1 Vault Management

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---:|---|
| FR-VLT-001 | User can create a new vault in any writable local folder. | P0 | App creates required folder structure and opens the workspace. |
| FR-VLT-002 | User can open an existing vault folder. | P0 | App scans files, builds index, and shows notes/databases/canvases. |
| FR-VLT-003 | User can open a plain Markdown folder as a vault. | P0 | Existing `.md` files appear as notes without destructive migration. |
| FR-VLT-004 | App stores non-canonical settings in a hidden folder. | P0 | Deleting the hidden cache does not delete user content. |
| FR-VLT-005 | App warns before creating nested vaults. | P1 | User receives warning about link/index ambiguity. |

### 11.2 Markdown Notes

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---:|---|
| FR-NOTE-001 | User can create, rename, move, duplicate, and delete notes. | P0 | File operations are reflected on disk. |
| FR-NOTE-002 | Notes are saved as `.md` files with optional YAML frontmatter. | P0 | File opens in external Markdown editor. |
| FR-NOTE-003 | Editor supports headings, paragraphs, bold, italic, strikethrough, inline code, code blocks, quotes, dividers, bullets, numbered lists, and task lists. | P0 | Each block round-trips to Markdown. |
| FR-NOTE-004 | Editor supports slash commands. | P0 | Typing `/` opens an insert menu. |
| FR-NOTE-005 | Editor supports wiki links using `[[Page Name]]`. | P0 | Link resolves to target note or prompts creation. |
| FR-NOTE-006 | Editor supports Markdown links and images. | P0 | Standard `[text](url)` and `![alt](path)` work. |
| FR-NOTE-007 | App maintains backlinks. | P0 | Backlink panel updates after edits. |
| FR-NOTE-008 | App preserves unknown Markdown syntax where possible. | P1 | Unsupported blocks are not destroyed by save. |
| FR-NOTE-009 | User can switch between rich editor, Markdown source, and preview. | P1 | All modes show the same file. |
| FR-NOTE-010 | App supports block IDs for stable references. | P1 | Blocks can be linked without breaking after reordering. |

### 11.3 Databases and Tables

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---:|---|
| FR-DB-001 | User can create a database from slash menu or sidebar. | P0 | App creates a `.database.json` file. |
| FR-DB-002 | User can embed a database view in a note. | P0 | Markdown contains a durable reference to the database file/view. |
| FR-DB-003 | MVP supports table view. | P0 | User can add/edit/delete rows and columns. |
| FR-DB-004 | MVP supports kanban view grouped by select/status property. | P0 | User can drag cards between groups. |
| FR-DB-005 | User can define property types. | P0 | Text, number, checkbox, select, multi-select, date, URL, file, note link. |
| FR-DB-006 | User can sort and filter rows. | P0 | Sort/filter state can be saved per view. |
| FR-DB-007 | JSON is deterministic. | P0 | Same logical database serializes to same key ordering and formatting. |
| FR-DB-008 | User can import/export CSV. | P1 | CSV import creates rows and mapped properties. |
| FR-DB-009 | User can create multiple views over one database. | P1 | Views are stored in JSON and selectable in UI. |
| FR-DB-010 | App supports linked note rows. | P1 | A row can reference or create a Markdown note. |

### 11.4 Canvas / Whiteboard

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---:|---|
| FR-CAN-001 | User can create a canvas file. | P0 | App creates `.drawio` XML file. |
| FR-CAN-002 | Canvas supports pan, zoom, select, move, resize, delete. | P0 | User can manipulate objects fluidly. |
| FR-CAN-003 | Canvas supports rectangle, ellipse, diamond, text, sticky note, connector, and frame. | P0 | Objects serialize into draw.io-compatible XML where possible. |
| FR-CAN-004 | User can link notes and databases onto the canvas. | P0 | Canvas contains link/reference; source file remains canonical. |
| FR-CAN-005 | Canvas saves uncompressed XML by default. | P0 | File diffs are readable in Git. |
| FR-CAN-006 | User can export canvas to PNG/SVG/PDF. | P1 | Export outputs a visual file. |
| FR-CAN-007 | User can open compatible `.drawio` files. | P1 | Basic draw.io diagrams render or degrade gracefully. |
| FR-CAN-008 | Canvas supports frames for navigation. | P1 | User can jump between frames. |
| FR-CAN-009 | Presentation mode from frames. | P2 | Frames can be presented in order. |

### 11.5 Search and Navigation

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---:|---|
| FR-SRCH-001 | Full-text search across Markdown notes. | P0 | Results include title, path, snippet, and match highlight. |
| FR-SRCH-002 | Search includes database row text and canvas labels. | P1 | Results can jump to row/canvas element. |
| FR-SRCH-003 | Sidebar file tree reflects vault folders. | P0 | Creating/moving files updates sidebar. |
| FR-SRCH-004 | Quick switcher opens notes/databases/canvases by title/path. | P0 | Keyboard command opens searchable palette. |
| FR-SRCH-005 | Tags are searchable and browsable. | P0 | `#tag` and frontmatter tags are indexed. |
| FR-SRCH-006 | Graph/backlinks view shows linked notes. | P1 | User can browse backlinks and outgoing links. |

### 11.6 File Watching and External Edits

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---:|---|
| FR-FS-001 | App watches vault for external file changes. | P0 | External create/modify/delete updates UI. |
| FR-FS-002 | App debounces rapid file changes. | P0 | Bulk operations do not freeze app. |
| FR-FS-003 | App detects conflicts between in-app and external edits. | P0 | User sees conflict panel instead of silent overwrite. |
| FR-FS-004 | App preserves unknown files. | P0 | Non-app files are visible or ignored without deletion. |
| FR-FS-005 | App supports safe atomic writes. | P0 | Saves do not leave partially written files after crash. |

### 11.7 Import and Export

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---:|---|
| FR-IMP-001 | Import existing Markdown folder. | P0 | Files remain in place or copy into vault based on user choice. |
| FR-IMP-002 | Import CSV as database. | P1 | User maps CSV columns to property types. |
| FR-IMP-003 | Import `.drawio` file as canvas. | P1 | Basic shapes/connectors render. |
| FR-EXP-001 | Export notes as Markdown. | P0 | Exported files are standard Markdown. |
| FR-EXP-002 | Export databases as JSON and CSV. | P1 | Export preserves rows/properties/views where applicable. |
| FR-EXP-003 | Export canvas as `.drawio`, PNG, SVG, and PDF. | P1 | Exported files open in expected apps. |

### 11.8 Settings and Preferences

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---:|---|
| FR-SET-001 | User can choose theme, editor font, and monospace font. | P1 | Preferences persist per vault or globally. |
| FR-SET-002 | User can configure attachment folder. | P1 | Images/files save to configured path. |
| FR-SET-003 | User can configure file naming strategy. | P1 | Slugs, title-case, timestamp, or custom template. |
| FR-SET-004 | User can configure save behavior. | P1 | Autosave interval and format-on-save options. |

---

## 12. Non-Functional Requirements

### 12.1 Performance

| ID | Requirement | Target |
|---|---|---:|
| NFR-PERF-001 | App startup with warm index | < 2 seconds for 5,000 notes |
| NFR-PERF-002 | Initial scan | < 60 seconds for 10,000 Markdown notes and 1 GB assets |
| NFR-PERF-003 | Search latency | < 150 ms for typical text query after index built |
| NFR-PERF-004 | Editor typing latency | No visible lag for notes up to 50,000 words |
| NFR-PERF-005 | Table view | Smooth editing for 10,000 rows, virtualized rendering required |
| NFR-PERF-006 | Canvas | Smooth pan/zoom for 2,000 basic objects |

### 12.2 Reliability and Data Safety

| ID | Requirement | Target |
|---|---|---:|
| NFR-REL-001 | Atomic writes | No corrupt file after app crash during save |
| NFR-REL-002 | Backup before destructive migration | Required |
| NFR-REL-003 | Conflict detection | Required for external edits |
| NFR-REL-004 | Index rebuild | App can rebuild from canonical files |
| NFR-REL-005 | File format versioning | Every app-specific JSON/XML format includes schema version |

### 12.3 Security and Privacy

| ID | Requirement | Target |
|---|---|---:|
| NFR-SEC-001 | Offline functionality | Full MVP functionality without network |
| NFR-SEC-002 | No required telemetry | Telemetry off by default or absent |
| NFR-SEC-003 | Local data control | No content leaves device without explicit user action |
| NFR-SEC-004 | Safe link handling | External links opened with user intent |
| NFR-SEC-005 | Plugin sandboxing | Required before third-party plugin system ships |

### 12.4 Portability

| ID | Requirement | Target |
|---|---|---:|
| NFR-PORT-001 | Markdown notes readable outside app | Required |
| NFR-PORT-002 | JSON databases inspectable outside app | Required |
| NFR-PORT-003 | Canvas interoperable with draw.io where possible | Required |
| NFR-PORT-004 | Cross-platform paths | Use relative paths within vault |
| NFR-PORT-005 | No absolute path lock-in | Required |

---

## 13. File and Data Model

### 13.1 Vault structure

Recommended default structure:

```text
MyVault/
  notes/
    project-plan.md
    research/
      local-first.md
  databases/
    tasks.database.json
    crm.database.json
  canvases/
    system-map.drawio
  assets/
    images/
    files/
  templates/
  .workspace/
    config.json
    index/
    thumbnails/
    crdt/
    backups/
```

Rules:

- `notes/`, `databases/`, and `canvases/` are defaults, not hard requirements.
- Users may organize files differently.
- `.workspace/` is rebuildable except for explicit settings.
- All canonical content files use relative links.
- The app must not require users to keep files in app-generated folders.

### 13.2 Markdown note file

Canonical extension: `.md`

Recommended format:

~~~markdown
---
id: note_01JZ0Q2P3M5VCB8K0HQG2YJS4P
title: Project Plan
created: 2026-07-02T09:30:00+10:00
updated: 2026-07-02T10:15:00+10:00
tags:
  - project
  - planning
aliases:
  - Plan
schema_version: 1
---

# Project Plan

This is a normal Markdown note.

## Goals {#block_01JZ0Q4ZJGX3P0M7Y2S3JHKT2A}

- Build a local-first workspace.
- Keep files portable.

```workspace-database
path: ../databases/tasks.database.json
view: table_default
```

See also [[Local-first Architecture]].
~~~

Requirements:

- Frontmatter is optional for imported files.
- App-generated notes should include stable IDs.
- Block IDs should be inserted only when needed for stable references, embeds, comments, or backlinks.
- Unsupported Markdown should be preserved as raw Markdown blocks.
- App-specific embeds should degrade to readable fenced blocks.

### 13.3 Database JSON file

Canonical extension: `.database.json`

MVP can use one JSON file per database. For very large databases, a future sharded format may split schema/views and rows into separate files.

Recommended MVP format:

```json
{
  "schema_version": 1,
  "id": "db_01JZ0Q5B2D4AC4E8E8S4JW9H5A",
  "title": "Tasks",
  "created": "2026-07-02T09:40:00+10:00",
  "updated": "2026-07-02T10:10:00+10:00",
  "properties": [
    {
      "id": "prop_title",
      "name": "Task",
      "type": "title",
      "required": true
    },
    {
      "id": "prop_status",
      "name": "Status",
      "type": "select",
      "options": [
        { "id": "todo", "name": "To do", "color": "gray" },
        { "id": "doing", "name": "Doing", "color": "blue" },
        { "id": "done", "name": "Done", "color": "green" }
      ]
    },
    {
      "id": "prop_due",
      "name": "Due",
      "type": "date"
    }
  ],
  "views": [
    {
      "id": "table_default",
      "name": "Table",
      "type": "table",
      "sorts": [],
      "filters": [],
      "hidden_properties": []
    },
    {
      "id": "kanban_status",
      "name": "Kanban",
      "type": "kanban",
      "group_by": "prop_status",
      "sorts": [],
      "filters": []
    }
  ],
  "rows": [
    {
      "id": "row_01JZ0Q6GVDFQZQS8AR8E6PXS97",
      "created": "2026-07-02T09:41:00+10:00",
      "updated": "2026-07-02T09:45:00+10:00",
      "cells": {
        "prop_title": { "type": "text", "value": "Create PRD" },
        "prop_status": { "type": "select", "value": "doing" },
        "prop_due": { "type": "date", "value": "2026-07-05" }
      }
    }
  ]
}
```

Serialization rules:

- Stable key order.
- Two-space indentation.
- UTF-8.
- Trailing newline.
- Rows sorted by explicit view order or insertion order.
- Avoid rewriting unchanged rows when possible.
- Use stable IDs for databases, properties, views, rows, and options.

Future large-database format:

```text
databases/tasks/
  database.json       # schema, metadata, views
  rows/
    row_01.json
    row_02.json
```

### 13.4 Canvas `.drawio` file

Canonical extension: `.drawio`

Recommended approach:

- Use uncompressed XML by default for readable diffs.
- Store standard shapes/connectors/text using draw.io-compatible `mxfile`, `diagram`, `mxGraphModel`, `root`, and `mxCell` structures where practical.
- Store app-specific references as custom attributes or metadata inside cells.
- Represent embedded notes/databases as linked placeholder objects so draw.io can still display a meaningful diagram.
- Keep actual note/database content in `.md` and `.database.json` files.

Example conceptual structure:

```xml
<mxfile host="workspace" modified="2026-07-02T10:00:00+10:00" version="1" type="device">
  <diagram id="canvas_01JZ0Q7D4Z1WACN09S86Y5VE7X" name="System Map">
    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="shape_01JZ0Q88PJYGKPX7V2MGYBPM6W" value="Project Plan" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1" data-workspace-type="note-link" data-workspace-href="../notes/project-plan.md">
          <mxGeometry x="120" y="80" width="180" height="80" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

Compatibility caveats:

- draw.io can display standard diagram elements.
- App-specific block embeds may appear as regular labeled shapes outside the app.
- Complex rich-text/database widgets should not be embedded directly into `.drawio`; they should be references.
- The app should validate XML before save and keep backups of prior valid versions.

### 13.5 Assets

Assets include images, PDFs, audio, video, and arbitrary file attachments.

Recommended rules:

- Store assets under `assets/` by default.
- Use content-addressed filenames optionally: `assets/images/sha256_<hash>.png`.
- Markdown uses relative paths.
- Canvas references assets by relative paths.
- App maintains thumbnail cache under `.workspace/thumbnails/`.

### 13.6 Index and cache

The app may maintain:

- Full-text search index.
- Backlink index.
- Tag index.
- Database row index.
- Canvas label index.
- Thumbnail cache.
- Recent files.
- View state.

These must be rebuildable from canonical files.

---

## 14. In-App Data Flow

```text
User action
  ↓
Frontend editor/canvas/database UI
  ↓
Command API to Rust core
  ↓
In-memory document model
  ↓
Format-specific serializer
  ↓
Atomic write to canonical file
  ↓
File watcher confirms change
  ↓
Index/cache update
  ↓
UI refresh / sync status update
```

External edit flow:

```text
External editor changes file
  ↓
File watcher detects change
  ↓
Parser validates file
  ↓
Conflict detector compares in-memory dirty state
  ↓
If safe: update model and index
If conflict: show resolution panel
```

---

## 15. Conflict Strategy

### 15.1 MVP conflict model

Because the source of truth is normal files, the MVP should use robust file-level conflict handling rather than trying to solve every concurrent edit with CRDTs.

Conflict scenarios:

1. **External change while no in-app edits are pending:** auto-reload.
2. **In-app unsaved change while external change arrives:** show conflict panel.
3. **File deleted externally while open:** prompt user to restore, save as new, or close.
4. **File renamed externally:** follow rename if identity can be matched by ID/frontmatter; otherwise treat as delete/create.
5. **Git merge conflict markers appear:** show file as conflicted and guide user to source mode.

### 15.2 Future CRDT strategy

For future real-time collaboration, keep an internal CRDT model for rich editing but still serialize to canonical files. This creates a tension between CRDT fidelity and readable file diffs, so the product should treat CRDT metadata as optional support data rather than replacing Markdown/JSON/XML.

Possible future approach:

- Store human-readable canonical files.
- Store CRDT operation logs in `.workspace/crdt/` for active collaboration sessions.
- Periodically checkpoint canonical files.
- Allow collaboration users to choose “portable mode” vs. “full-fidelity collaboration mode.”

---

## 16. UX Requirements

### 16.1 Overall layout

The desktop app should include:

- Left sidebar: vault switcher, file tree, favorites, recent notes, tags.
- Main editor area: tabs or split panes.
- Right sidebar: outline, backlinks, properties, comments/activity later.
- Command palette.
- Bottom status area: sync/file status, word count, selection info.

### 16.2 Note editor UX

- Notion-like block controls: drag handle, plus button, slash menu.
- Markdown shortcuts: `#`, `##`, `-`, `1.`, `>`, `` ``` ``, `[]`.
- Inline formatting toolbar on selection.
- Keyboard-first editing.
- Block drag-and-drop.
- Copy/paste from Markdown, HTML, and office documents where possible.

### 16.3 Database UX

- Database can be full-page or embedded in notes/canvas.
- Table view supports column resizing, hide/show, sort, filter, grouping later.
- Kanban view supports drag between status groups.
- Row opens as side peek or linked note.
- Properties panel for schema editing.

### 16.4 Canvas UX

- AFFiNE/Miro-like infinite canvas.
- Toolbar with select, hand, text, sticky, shape, connector, frame.
- Minimap or navigator later.
- Drag notes/databases from sidebar onto canvas.
- Double-click linked note/database object to open/edit source.
- Frames can organize canvas regions.

### 16.5 File transparency UX

- “Reveal in Finder/Explorer” for every note/database/canvas/asset.
- “Open in external editor” action.
- “Copy relative path” action.
- “Show file diff” when Git is available later.
- Clear status when file has external changes.

---

## 17. Platform Requirements

### 17.1 MVP platforms

- macOS Apple Silicon and Intel.
- Windows 10/11.
- Major Linux desktop distributions through AppImage/deb/rpm or equivalent.

### 17.2 Accessibility

- Keyboard navigation for core workflows.
- Screen-reader labels for main controls.
- High-contrast theme.
- Configurable font size.
- Reduced motion option.

### 17.3 Internationalization

- MVP language: English.
- Architecture should support future localization.
- File formats must support Unicode paths and content.

---

## 18. Technical Architecture

### 18.1 High-level architecture

```text
┌────────────────────────────────────────────────────┐
│                    Tauri Shell                     │
│  Windowing, menus, OS integration, permissions      │
└───────────────────────┬────────────────────────────┘
                        │
┌───────────────────────▼────────────────────────────┐
│                    Frontend UI                     │
│  Block editor, database views, canvas, settings     │
└───────────────────────┬────────────────────────────┘
                        │ Commands/events
┌───────────────────────▼────────────────────────────┐
│                    Rust Core                       │
│  Vault service, parser, serializer, search, watcher │
└───────┬───────────────┬────────────────┬───────────┘
        │               │                │
┌───────▼──────┐ ┌──────▼───────┐ ┌──────▼──────────┐
│ File System  │ │ Search Index │ │ Cache/Thumbnails│
│ MD/JSON/XML  │ │ Rebuildable  │ │ Rebuildable     │
└──────────────┘ └──────────────┘ └─────────────────┘
```

### 18.2 Rust core crates

Proposed workspace structure:

```text
crates/
  workspace-core/       # domain models and IDs
  workspace-vault/      # vault scan, file tree, path rules
  workspace-markdown/   # Markdown parse/serialize
  workspace-db/         # database JSON model
  workspace-drawio/     # drawio XML model and serializer
  workspace-search/     # full-text and metadata indexing
  workspace-watch/      # file watcher and change events
  workspace-assets/     # attachments and thumbnails
  workspace-import/     # imports from Markdown/CSV/drawio/AFFiNE later
  workspace-export/     # export pipelines
  workspace-sync/       # future sync abstraction
  workspace-tauri/      # Tauri command bindings
```

### 18.3 Frontend packages

If using a web frontend:

```text
apps/desktop/
  src/
    editor/
    database/
    canvas/
    sidebar/
    command-palette/
    settings/
    bindings/
```

### 18.4 AFFiNE/BlockSuite reuse strategy

Options:

| Option | Description | Pros | Cons | Recommendation |
|---|---|---|---|---|
| Direct AFFiNE fork | Fork AFFiNE and replace storage layer. | Fastest access to mature UI concepts. | Large architecture mismatch; hard to become Rust-first/file-native. | Prototype only. |
| Reuse BlockSuite/editor packages | Build new shell/core, reuse editor primitives. | Balanced reuse and control. | Need integration work and license review. | Preferred path. |
| Build custom editor/canvas from scratch | Full Rust-first control. | Maximum ownership. | Much slower; high editor complexity. | Avoid for MVP unless reuse is blocked. |
| Pure Rust UI | egui/Iced/Slint-style desktop UI. | Rust purity, native control. | Rich block editor/canvas harder. | Consider later for focused modes, not MVP. |

### 18.5 Storage adapter design

The central abstraction should be a `RecordStore` that maps logical records to files.

Conceptual traits:

```rust
trait RecordStore {
    fn load_record(&self, id: RecordId) -> Result<Record>;
    fn save_record(&self, record: &Record) -> Result<SaveResult>;
    fn delete_record(&self, id: RecordId) -> Result<()>;
    fn watch(&self) -> Result<RecordEventStream>;
}
```

Record types:

- `NoteRecord` → `.md`
- `DatabaseRecord` → `.database.json`
- `CanvasRecord` → `.drawio`
- `AssetRecord` → binary file + metadata
- `WorkspaceConfigRecord` → `.workspace/config.json`

---

## 19. File Format Versioning and Migrations

Every app-created canonical file should include schema version metadata when practical:

- Markdown: `schema_version` in frontmatter.
- JSON database: top-level `schema_version`.
- draw.io XML: `data-workspace-schema-version` attribute or metadata object.

Migration requirements:

1. Migrations must be idempotent.
2. Migrations must create backup files or a vault snapshot before destructive rewrites.
3. Users must be able to preview large migrations.
4. App must support opening older formats where reasonable.
5. App must never rewrite all files merely because the app version changed.

---

## 20. Sync and Collaboration Strategy

### 20.1 MVP sync

MVP sync is intentionally file-based and user-controlled:

- Git.
- Dropbox/iCloud/OneDrive/Google Drive.
- Syncthing.
- rsync.
- Network drives.

The app must behave correctly when files are updated by these tools.

### 20.2 Future sync

Potential future sync modes:

1. **Git integration:** commit, diff, branch, pull, push from app.
2. **Peer-to-peer sync:** device-to-device with conflict handling.
3. **Hosted encrypted sync:** optional paid or self-hosted service.
4. **Real-time collaboration:** CRDT-based sessions with file checkpoints.

Future sync must not undermine the core promise that users can keep canonical records as portable files.

---

## 21. Success Metrics

### 21.1 Activation

- 80% of new users can create/open a vault and write a first note within 3 minutes.
- 60% of new users import or create at least 5 notes in first session.
- 40% of new users create a database or canvas within first week.

### 21.2 Retention

- 35% weekly active retention after 4 weeks for beta users.
- Median active user opens the app at least 4 days per week.

### 21.3 Trust and data ownership

- 95% of beta users agree: “I understand where my data is stored.”
- 90% of beta users agree: “I can use my files outside the app.”
- Zero known data-loss bugs before public 1.0.

### 21.4 Performance

- Search p95 < 250 ms after index built.
- Editor input p95 < 16 ms frame budget for normal notes.
- Initial import of 1,000 Markdown files p95 < 10 seconds on target hardware.

---

## 22. MVP Release Criteria

The MVP is ready for private beta when:

1. Users can create/open a vault.
2. Markdown editing is stable and round-trips correctly.
3. Databases can be created, edited, and saved to JSON.
4. Canvas files can be created, edited, and saved to `.drawio` XML.
5. File watcher handles external changes safely.
6. Full-text search works across notes.
7. App can rebuild index from files.
8. Automated tests cover serializers/parsers and conflict cases.
9. Manual QA confirms no data loss in common workflows.
10. Installers exist for macOS, Windows, and Linux.

---

## 23. Roadmap

### Phase 0: Discovery and Prototype

- Validate AFFiNE/BlockSuite reuse feasibility.
- Validate draw.io XML generation and round-trip compatibility.
- Build Rust vault scanner and file watcher prototype.
- Build Markdown parser/serializer prototype.
- Build database JSON schema prototype.
- Decide UI/editor implementation path.

### Phase 1: MVP Alpha

- Tauri app shell.
- Vault create/open.
- File tree and quick switcher.
- Markdown note editor.
- Autosave and atomic file writes.
- File watcher and external edit reload.
- Search index.
- Basic database table view.
- Basic canvas editor and `.drawio` save.

### Phase 2: Private Beta

- Kanban database view.
- Backlinks and graph panel.
- Better conflict UI.
- CSV import/export.
- Draw.io import/export hardening.
- Theme/settings.
- Crash recovery and backups.
- Performance tuning for large vaults.

### Phase 3: Public Beta

- Gallery view.
- Canvas frames and presentation mode.
- Git integration.
- Plugin API preview.
- AFFiNE import exploration.
- Obsidian compatibility polish.

### Phase 4: 1.0

- Stable file format guarantees.
- Migration tools.
- Security review.
- Accessibility pass.
- Documentation.
- Signed installers and auto-update.

---

## 24. Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---:|---:|---|
| Rich block editor does not map cleanly to Markdown. | High | High | Define supported Markdown-compatible blocks; preserve unsupported raw blocks; use sidecar metadata only when necessary. |
| draw.io format cannot represent all AFFiNE-like canvas objects. | Medium | High | Store compatible shapes directly; represent complex embeds as linked placeholders. |
| Direct AFFiNE fork becomes too complex. | High | Medium | Use AFFiNE as reference; selectively reuse packages; keep Rust core independent. |
| External sync tools cause conflicts. | High | High | Strong conflict detection, backups, source mode, and Git-friendly deterministic writes. |
| JSON database files become too large or conflict-prone. | Medium | Medium | MVP single file; later sharded row format for large databases. |
| File watcher behavior varies by OS. | Medium | Medium | Robust debouncing, rescan fallback, integration tests on all platforms. |
| Users expect full Notion parity. | Medium | High | Clear positioning: local-first file-native workspace, not full Notion clone. |
| Data loss from serializer bugs. | Critical | Medium | Golden file tests, property tests, backup before migration, atomic writes, crash testing. |
| License issues with AFFiNE/BlockSuite reuse. | High | Low/Medium | Legal review before code reuse; track upstream licenses; avoid proprietary assets/branding. |

---

## 25. Open Questions

1. Should the product be a direct AFFiNE fork, a new app using BlockSuite components, or a fully independent implementation?
2. What is the desired level of draw.io interoperability: “opens visually” or “full round-trip editing in draw.io”?
3. Should databases be single-file JSON in MVP or use sharded row files from the start?
4. Should Markdown frontmatter be required for app-created notes?
5. Should app-specific block IDs be visible in Markdown or stored in sidecar metadata?
6. Should the app support Obsidian Canvas JSON as an additional canvas import/export format?
7. Is Git integration a core 1.0 requirement or post-1.0?
8. Should sync/collaboration be avoided entirely in 1.0 to protect the file-native promise?
9. What plugin sandbox model should be used?
10. What level of mobile support is expected after desktop MVP?

---

## 26. Suggested Decisions for Initial Build

Recommended decisions for fastest path to a useful MVP:

1. **Build a new Rust/Tauri app rather than directly rewriting AFFiNE.**
2. **Reuse AFFiNE/BlockSuite concepts and possibly editor packages after license review.**
3. **Make Markdown, JSON, and `.drawio` the canonical record formats.**
4. **Use a hidden `.workspace/` folder only for settings, indexes, caches, thumbnails, and optional CRDT metadata.**
5. **Use single-file `.database.json` for MVP, with schema designed to migrate to sharded rows.**
6. **Use uncompressed `.drawio` XML by default for readable diffs.**
7. **Represent canvas note/database embeds as linked objects, not duplicated content.**
8. **Ship without real-time collaboration in MVP.**
9. **Treat Git/file-sync compatibility as a first-class acceptance criterion.**
10. **Prioritize data safety over advanced block fidelity.**

---

## 27. Appendix: Example Markdown Database Embed

A Markdown note should include database references in a readable, portable way. Recommended fenced syntax:

~~~markdown
```workspace-database
path: ../databases/tasks.database.json
view: kanban_status
```
~~~

In editors that do not understand the app, this appears as a readable code block. In the app, it renders as an interactive database view.

Alternative inline directive syntax:

```markdown
![[../databases/tasks.database.json#view=kanban_status]]
```

The fenced syntax is preferred for clarity and extensibility.

---

## 28. Appendix: Example Canvas Link Semantics

Canvas object linking to a note:

```xml
<mxCell
  id="shape_01JZ0Q88PJYGKPX7V2MGYBPM6W"
  value="Project Plan"
  style="rounded=1;whiteSpace=wrap;html=1;"
  vertex="1"
  parent="1"
  data-workspace-type="note-link"
  data-workspace-href="../notes/project-plan.md">
  <mxGeometry x="120" y="80" width="180" height="80" as="geometry" />
</mxCell>
```

Canvas object linking to a database view:

```xml
<mxCell
  id="shape_01JZ0Q9T7JPPZDM2TR2DGSAW4B"
  value="Tasks / Kanban"
  style="rounded=1;whiteSpace=wrap;html=1;dashed=1;"
  vertex="1"
  parent="1"
  data-workspace-type="database-link"
  data-workspace-href="../databases/tasks.database.json"
  data-workspace-view="kanban_status">
  <mxGeometry x="360" y="80" width="220" height="120" as="geometry" />
</mxCell>
```

---

## 29. Appendix: Definition of Done for File Format Work

A file format feature is done only when:

- Parser handles valid files.
- Parser produces useful diagnostics for invalid files.
- Serializer is deterministic.
- Round-trip tests pass.
- Golden fixtures are committed.
- External editor changes are tested.
- Backups are created before migrations.
- Unknown fields/syntax are preserved where promised.
- User-facing docs explain the format.

---

## 30. Appendix: Data Safety Test Matrix

| Scenario | Expected Result |
|---|---|
| App crashes during note save | Original or new complete file remains; no partial file. |
| Power loss during database save | Previous JSON recoverable from backup or atomic write. |
| External editor modifies open note | App reloads or shows conflict. |
| Git conflict markers added | App detects conflict and opens source/conflict mode. |
| Invalid JSON database | App shows error and does not overwrite file. |
| Invalid draw.io XML | App shows error and keeps prior valid version. |
| Hidden index deleted | App rebuilds index from canonical files. |
| Asset moved externally | App shows broken link and offers relink. |
| File renamed externally | App preserves identity if frontmatter ID matches. |
| Large vault imported | App remains responsive and indexes progressively. |
