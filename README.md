# Mica

A local-first, file-native notes workspace built with Rust and Tauri.

Write block-based notes, manage structured databases, and think on an infinite
canvas — while every canonical record lives as an ordinary file in a folder you
own (the **vault**):

| Record type | Canonical format | Extension |
|---|---|---|
| Note | Markdown + optional YAML frontmatter | `.md` |
| Database | Deterministic JSON | `.database.json` |
| Canvas | Uncompressed draw.io-compatible XML | `.drawio` |

Everything else (search index, thumbnails, view state) is a rebuildable cache
under `.workspace/` and never the source of truth. See [docs/PRD.md](docs/PRD.md),
[docs/specifications.md](docs/specifications.md), and
[docs/implementation.md](docs/implementation.md).

## Repository layout

```text
crates/
  mica-core/       domain models: typed ULIDs, VaultPath, hashes, errors
  mica-vault/      vault create/open/scan, file tree, atomic writes
  mica-markdown/   frontmatter parse/serialize, link/tag extraction
  mica-db/         database JSON model, ops, filter/sort engine
  mica-drawio/     canvas scene model ↔ draw.io XML
  mica-search/     SQLite FTS5 index: search, backlinks, tags
  mica-watch/      debounced file watcher with self-write filtering
  mica-tauri/      Tauri 2 app: commands, events, state
apps/
  desktop/         React + TypeScript + Tiptap frontend
```

## Development

Prerequisites: Rust (stable, MSVC on Windows), Node 20+, WebView2 (Windows).

```sh
# install frontend deps
cd apps/desktop && npm install

# run the desktop app (starts Vite + Tauri)
cd ../../crates/mica-tauri && npx --prefix ../../apps/desktop tauri dev

# run Rust tests
cargo test

# typecheck the frontend
cd apps/desktop && npx tsc --noEmit
```

## Status

MVP in progress — vault + notes + search + databases + canvas are functional
end-to-end; hardening (benchmarks, fuzzing, installers) tracked in
[docs/implementation.md](docs/implementation.md) Phase 5.
