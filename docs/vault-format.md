# Mica Vault Format

Your vault is an ordinary folder. Every record Mica creates is a file you can
read, edit, sync, and version outside the app. This document is the public
promise of what those files look like.

## Layout

```text
MyVault/
  notes/                    # defaults — you may organize files anywhere
  databases/
  canvases/
  assets/
  templates/
  .workspace/
    config.json             # vault settings (kept)
    backups/                # snapshots (kept)
    index/index.db          # search index (disposable, rebuilt from files)
```

Rules:

- Canonical files are discovered by extension anywhere in the vault, not only
  in the default folders.
- Unknown files are listed in the app and never modified or deleted.
- Deleting `.workspace/index/` loses nothing; the index rebuilds from files.
- All intra-vault links are relative paths; the vault can move machines freely.
- Deletes from the app go to the OS trash, never a hard unlink.
- Every save is atomic: content is written to a temp file, fsynced, then
  renamed over the target. A crash mid-save leaves the previous file intact.

## Notes — `.md`

CommonMark + GFM (tables, strikethrough, task lists) + `[[wiki links]]`.

App-created notes carry YAML frontmatter with a stable ID:

```markdown
---
id: note_01JZ0Q2P3M5VCB8K0HQG2YJS4P
title: Project Plan
created: 2026-07-02T09:30:00+10:00
updated: 2026-07-02T10:15:00+10:00
tags:
  - project
schema_version: 1
---

# Project Plan
```

- Frontmatter key order is fixed (`id`, `title`, `created`, `updated`, `tags`,
  `aliases`, your own keys in original order, `schema_version` last). Unknown
  keys are preserved verbatim.
- Files that never had frontmatter never get frontmatter added.
- `[[Page Name]]` resolves by title → alias → filename, case-insensitive.
- Inline `#tags` and frontmatter tags are both indexed.
- A UTF-8 BOM at the start of a file is tolerated.

### Database embeds

A note embeds a database view with a fenced block that stays readable in any
other editor:

````markdown
```workspace-database
path: ../databases/tasks.database.json
view: table_default
```
````

## Databases — `.database.json`

One JSON file per database. Deterministic output: fixed key order, 2-space
indent, LF, trailing newline; unchanged rows serialize byte-identically so Git
diffs touch only edited lines.

```jsonc
{
  "schema_version": 1,
  "id": "db_<ulid>",
  "title": "Tasks",
  "created": "…", "updated": "…",
  "properties": [ { "id": "prop_title", "name": "Name", "type": "title", "required": true } ],
  "views": [ { "id": "table_default", "name": "Table", "type": "table", "sorts": [], "filters": [] } ],
  "rows": [ { "id": "row_<ulid>", "created": "…", "updated": "…", "cells": { "prop_title": { "type": "title", "value": "…" } } } ]
}
```

Property types: `title` (exactly one), `text`, `number`, `checkbox`, `select`,
`multi_select`, `date`, `url`, `file`, `note_link`. View types: `table`
(column order/widths, hidden properties, sorts, filters), `kanban` (`group_by`
a select property, per-group card order). Unknown top-level keys are preserved.

## Canvases — `.drawio`

Uncompressed draw.io-compatible XML (`mxfile > diagram > mxGraphModel > root >
mxCell*`) that opens visually in draw.io. Mica-specific data rides in
`data-workspace-*` attributes so other tools still see labeled shapes:

```xml
<mxCell id="shape_…" value="Project Plan" style="rounded=1;whiteSpace=wrap;html=1;"
        vertex="1" parent="1"
        data-workspace-type="note-link"
        data-workspace-href="../notes/project-plan.md">
  <mxGeometry x="120" y="80" width="180" height="80" as="geometry" />
</mxCell>
```

- Cell order is z-order; attribute order and indentation are fixed.
- An invalid `.drawio` on disk is surfaced as an error and never overwritten.
- Unknown cells and attributes from foreign draw.io files are preserved.

## Versioning

Every app-created file carries a schema version (`schema_version` frontmatter
key / JSON field / `data-workspace-schema-version` XML attribute). Migrations
are lazy (a file migrates only when you edit it), idempotent, and snapshot to
`.workspace/backups/` first. The app never rewrites the whole vault because
the app version changed.
