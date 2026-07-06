//! SQLite + FTS5 index (spec §7): full-text search, backlinks, tags.
//! Entirely rebuildable from canonical files — deleting the index database
//! loses nothing (NFR-REL-004).

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use mica_core::{ContentHash, CoreError, Result, VaultPath, INDEX_SCHEMA_VERSION};
use mica_markdown::extract_metadata;
use mica_vault::{FileKind, Vault};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    pub path: VaultPath,
    pub title: String,
    pub snippet: String,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickSwitchHit {
    pub path: VaultPath,
    pub title: String,
    pub kind: FileKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacklinkHit {
    pub source: VaultPath,
    pub source_title: String,
    /// The raw link target as written in the source note.
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagCount {
    pub tag: String,
    pub count: i64,
}

pub struct SearchIndex {
    conn: Connection,
}

impl SearchIndex {
    /// Open (or create) the index at `.workspace/index/index.db`. On schema
    /// mismatch or corruption the database is wiped and rebuilt lazily.
    pub fn open(db_path: &Path) -> Result<SearchIndex> {
        if let Some(dir) = db_path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| CoreError::io(dir, e))?;
        }
        let conn = match Connection::open(db_path) {
            Ok(c) => c,
            Err(_) => {
                // Corrupt or unopenable: start fresh (it's just a cache).
                let _ = std::fs::remove_file(db_path);
                Connection::open(db_path).map_err(|e| CoreError::Index(e.to_string()))?
            }
        };
        let mut index = SearchIndex { conn };
        if !index.schema_ok() {
            index.recreate_schema()?;
        }
        Ok(index)
    }

    pub fn open_in_memory() -> Result<SearchIndex> {
        let conn = Connection::open_in_memory().map_err(|e| CoreError::Index(e.to_string()))?;
        let mut index = SearchIndex { conn };
        index.recreate_schema()?;
        Ok(index)
    }

    fn schema_ok(&self) -> bool {
        let version: Option<String> = self
            .conn
            .query_row("SELECT value FROM meta WHERE key='schema_version'", [], |r| {
                r.get(0)
            })
            .optional()
            .unwrap_or(None);
        version.as_deref() == Some(&INDEX_SCHEMA_VERSION.to_string())
    }

    fn recreate_schema(&mut self) -> Result<()> {
        self.conn
            .execute_batch(
                r#"
                PRAGMA journal_mode=WAL;
                DROP TABLE IF EXISTS files;
                DROP TABLE IF EXISTS notes_fts;
                DROP TABLE IF EXISTS links;
                DROP TABLE IF EXISTS tags;
                DROP TABLE IF EXISTS meta;

                CREATE TABLE files (
                    id INTEGER PRIMARY KEY,
                    path TEXT NOT NULL UNIQUE,
                    kind TEXT NOT NULL,
                    title TEXT NOT NULL DEFAULT '',
                    note_id TEXT,
                    aliases TEXT NOT NULL DEFAULT '',
                    content_hash TEXT NOT NULL DEFAULT '',
                    mtime INTEGER NOT NULL DEFAULT 0,
                    size INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX files_kind ON files(kind);
                CREATE INDEX files_note_id ON files(note_id);

                CREATE VIRTUAL TABLE notes_fts USING fts5(
                    title, body, tags, path UNINDEXED
                );

                CREATE TABLE links (
                    source_file INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
                    target_raw TEXT NOT NULL,
                    target_path TEXT,
                    target_fragment TEXT,
                    kind TEXT NOT NULL,
                    resolved INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX links_source ON links(source_file);
                CREATE INDEX links_target ON links(target_path);

                CREATE TABLE tags (
                    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
                    tag TEXT NOT NULL
                );
                CREATE INDEX tags_tag ON tags(tag);

                CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                "#,
            )
            .map_err(|e| CoreError::Index(e.to_string()))?;
        self.conn
            .execute(
                "INSERT INTO meta(key, value) VALUES ('schema_version', ?1)",
                params![INDEX_SCHEMA_VERSION.to_string()],
            )
            .map_err(|e| CoreError::Index(e.to_string()))?;
        Ok(())
    }

    /// Full rebuild from the vault's canonical files.
    pub fn rebuild(&mut self, vault: &Vault) -> Result<usize> {
        self.recreate_schema()?;
        let tree = vault.scan_tree()?;
        let files: Vec<_> = tree
            .files()
            .iter()
            .map(|f| (f.path.clone(), f.kind.unwrap_or(FileKind::Other)))
            .collect();

        let tx = self
            .conn
            .transaction()
            .map_err(|e| CoreError::Index(e.to_string()))?;
        let mut count = 0usize;
        for (path, kind) in files {
            if let Err(e) = index_one(&tx, vault, &path, kind) {
                tracing::warn!("index skip {path}: {e}");
                continue;
            }
            count += 1;
        }
        tx.commit().map_err(|e| CoreError::Index(e.to_string()))?;
        self.resolve_links()?;
        Ok(count)
    }

    /// Warm start (NFR-PERF-001): reconcile the persisted index against the
    /// current tree by (mtime, size) instead of re-parsing everything.
    /// Falls back to indexing only new/changed files; removes vanished rows.
    pub fn sync(&mut self, vault: &Vault) -> Result<usize> {
        let tree = vault.scan_tree()?;
        let disk: Vec<(VaultPath, FileKind, i64, i64)> = tree
            .files()
            .iter()
            .filter_map(|f| {
                let meta = std::fs::metadata(vault.abs(&f.path)).ok()?;
                let mtime = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0);
                Some((
                    f.path.clone(),
                    f.kind.unwrap_or(FileKind::Other),
                    mtime,
                    meta.len() as i64,
                ))
            })
            .collect();

        let indexed: std::collections::HashMap<String, (i64, i64)> = {
            let mut stmt = self
                .conn
                .prepare("SELECT path, mtime, size FROM files")
                .map_err(|e| CoreError::Index(e.to_string()))?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((r.get::<_, String>(0)?, (r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)))
                })
                .map_err(|e| CoreError::Index(e.to_string()))?
                .filter_map(|r| r.ok())
                .collect();
            rows
        };

        let disk_paths: std::collections::HashSet<&str> =
            disk.iter().map(|(p, ..)| p.as_str()).collect();

        let mut changed = 0usize;
        let tx = self
            .conn
            .transaction()
            .map_err(|e| CoreError::Index(e.to_string()))?;
        // Remove rows for files that no longer exist.
        for path in indexed.keys() {
            if !disk_paths.contains(path.as_str()) {
                if let Ok(vp) = VaultPath::new(path) {
                    remove_one(&tx, &vp)?;
                    changed += 1;
                }
            }
        }
        // (Re-)index new or modified files.
        for (path, kind, mtime, size) in &disk {
            let unchanged = indexed
                .get(path.as_str())
                .map(|(m, s)| m == mtime && s == size)
                .unwrap_or(false);
            if unchanged {
                continue;
            }
            remove_one(&tx, path)?;
            if let Err(e) = index_one(&tx, vault, path, *kind) {
                tracing::warn!("index skip {path}: {e}");
                continue;
            }
            changed += 1;
        }
        tx.commit().map_err(|e| CoreError::Index(e.to_string()))?;
        if changed > 0 {
            self.resolve_links()?;
        }
        Ok(changed)
    }

    /// Index or re-index one file after a save or external change.
    pub fn update_file(&mut self, vault: &Vault, path: &VaultPath) -> Result<()> {
        let kind = FileKind::from_path(path);
        let tx = self
            .conn
            .transaction()
            .map_err(|e| CoreError::Index(e.to_string()))?;
        remove_one(&tx, path)?;
        index_one(&tx, vault, path, kind)?;
        tx.commit().map_err(|e| CoreError::Index(e.to_string()))?;
        self.resolve_links()
    }

    pub fn remove_file(&mut self, path: &VaultPath) -> Result<()> {
        let tx = self
            .conn
            .transaction()
            .map_err(|e| CoreError::Index(e.to_string()))?;
        remove_one(&tx, path)?;
        tx.commit().map_err(|e| CoreError::Index(e.to_string()))?;
        self.resolve_links()
    }

    pub fn rename_file(&mut self, vault: &Vault, from: &VaultPath, to: &VaultPath) -> Result<()> {
        {
            let tx = self
                .conn
                .transaction()
                .map_err(|e| CoreError::Index(e.to_string()))?;
            remove_one(&tx, from)?;
            let kind = FileKind::from_path(to);
            index_one(&tx, vault, to, kind)?;
            tx.commit().map_err(|e| CoreError::Index(e.to_string()))?;
        }
        self.resolve_links()
    }

    /// Re-resolve link targets against currently indexed files. Wiki links
    /// match by title → alias → file stem (case-insensitive).
    fn resolve_links(&mut self) -> Result<()> {
        let tx = self
            .conn
            .transaction()
            .map_err(|e| CoreError::Index(e.to_string()))?;
        {
            // Markdown links: resolve relative to the source file's folder.
            let mut md_stmt = tx
                .prepare(
                    "SELECT l.rowid, l.target_raw, f.path FROM links l
                     JOIN files f ON f.id = l.source_file WHERE l.kind='markdown'",
                )
                .map_err(|e| CoreError::Index(e.to_string()))?;
            let rows: Vec<(i64, String, String)> = md_stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .map_err(|e| CoreError::Index(e.to_string()))?
                .filter_map(|r| r.ok())
                .collect();
            drop(md_stmt);

            for (rowid, raw, source_path) in rows {
                let resolved = resolve_relative(&source_path, &raw);
                let (target, ok) = match resolved {
                    Some(p) => {
                        let exists: bool = tx
                            .query_row(
                                "SELECT 1 FROM files WHERE path=?1 COLLATE NOCASE",
                                params![p.as_str()],
                                |_| Ok(true),
                            )
                            .optional()
                            .map_err(|e| CoreError::Index(e.to_string()))?
                            .unwrap_or(false);
                        (Some(p.as_str().to_string()), exists)
                    }
                    None => (None, false),
                };
                tx.execute(
                    "UPDATE links SET target_path=?1, resolved=?2 WHERE rowid=?3",
                    params![target, ok as i64, rowid],
                )
                .map_err(|e| CoreError::Index(e.to_string()))?;
            }

            // Wiki links: match by title, alias, or file stem.
            let mut wiki_stmt = tx
                .prepare("SELECT rowid, target_raw FROM links WHERE kind='wiki'")
                .map_err(|e| CoreError::Index(e.to_string()))?;
            let rows: Vec<(i64, String)> = wiki_stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .map_err(|e| CoreError::Index(e.to_string()))?
                .filter_map(|r| r.ok())
                .collect();
            drop(wiki_stmt);

            for (rowid, raw) in rows {
                let needle = raw.to_lowercase();
                let path: Option<String> = tx
                    .query_row(
                        "SELECT path FROM files
                         WHERE kind='note' AND (
                            LOWER(title) = ?1
                            OR LOWER(',' || aliases || ',') LIKE '%,' || ?1 || ',%'
                            OR LOWER(path) LIKE '%/' || ?1 || '.md'
                            OR LOWER(path) = ?1 || '.md'
                         )
                         ORDER BY LENGTH(path) ASC LIMIT 1",
                        params![needle],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(|e| CoreError::Index(e.to_string()))?;
                tx.execute(
                    "UPDATE links SET target_path=?1, resolved=?2 WHERE rowid=?3",
                    params![path, path.is_some() as i64, rowid],
                )
                .map_err(|e| CoreError::Index(e.to_string()))?;
            }
        }
        tx.commit().map_err(|e| CoreError::Index(e.to_string()))
    }

    /// Ranked full-text search with snippets (FR-SRCH-001).
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
        let fts_query = build_fts_query(query);
        if fts_query.is_empty() {
            return Ok(Vec::new());
        }
        let mut stmt = self
            .conn
            .prepare(
                "SELECT path, title, snippet(notes_fts, 1, '<mark>', '</mark>', '…', 12), bm25(notes_fts)
                 FROM notes_fts WHERE notes_fts MATCH ?1
                 ORDER BY bm25(notes_fts) LIMIT ?2",
            )
            .map_err(|e| CoreError::Index(e.to_string()))?;
        let hits = stmt
            .query_map(params![fts_query, limit as i64], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, f64>(3)?,
                ))
            })
            .map_err(|e| CoreError::Index(e.to_string()))?
            .filter_map(|r| r.ok())
            .filter_map(|(path, title, snippet, score)| {
                Some(SearchHit {
                    path: VaultPath::new(&path).ok()?,
                    title,
                    snippet,
                    score,
                })
            })
            .collect();
        Ok(hits)
    }

    /// Prefix-matching title/path search for the quick switcher (FR-SRCH-004).
    pub fn quick_switch(&self, query: &str, limit: usize) -> Result<Vec<QuickSwitchHit>> {
        let q = format!("%{}%", query.to_lowercase().replace('%', ""));
        let mut stmt = self
            .conn
            .prepare(
                "SELECT path, title, kind FROM files
                 WHERE kind IN ('note','database','canvas')
                   AND (LOWER(title) LIKE ?1 OR LOWER(path) LIKE ?1
                        OR LOWER(aliases) LIKE ?1)
                 ORDER BY
                   CASE WHEN LOWER(title) LIKE ?2 THEN 0 ELSE 1 END,
                   LENGTH(title) ASC
                 LIMIT ?3",
            )
            .map_err(|e| CoreError::Index(e.to_string()))?;
        let prefix = format!("{}%", query.to_lowercase().replace('%', ""));
        let hits = stmt
            .query_map(params![q, prefix, limit as i64], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| CoreError::Index(e.to_string()))?
            .filter_map(|r| r.ok())
            .filter_map(|(path, title, kind)| {
                Some(QuickSwitchHit {
                    path: VaultPath::new(&path).ok()?,
                    title,
                    kind: match kind.as_str() {
                        "note" => FileKind::Note,
                        "database" => FileKind::Database,
                        "canvas" => FileKind::Canvas,
                        _ => FileKind::Other,
                    },
                })
            })
            .collect();
        Ok(hits)
    }

    /// Notes that link to `path` (FR-NOTE-007).
    pub fn backlinks(&self, path: &VaultPath) -> Result<Vec<BacklinkHit>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT f.path, f.title, l.target_raw FROM links l
                 JOIN files f ON f.id = l.source_file
                 WHERE l.target_path = ?1 COLLATE NOCASE
                 ORDER BY f.path",
            )
            .map_err(|e| CoreError::Index(e.to_string()))?;
        let hits = stmt
            .query_map(params![path.as_str()], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| CoreError::Index(e.to_string()))?
            .filter_map(|r| r.ok())
            .filter_map(|(source, title, target)| {
                Some(BacklinkHit {
                    source: VaultPath::new(&source).ok()?,
                    source_title: title,
                    target,
                })
            })
            .collect();
        Ok(hits)
    }

    /// Outgoing links from `path`, with resolution state.
    pub fn outgoing(&self, path: &VaultPath) -> Result<Vec<(String, Option<String>, bool)>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT l.target_raw, l.target_path, l.resolved FROM links l
                 JOIN files f ON f.id = l.source_file
                 WHERE f.path = ?1 COLLATE NOCASE",
            )
            .map_err(|e| CoreError::Index(e.to_string()))?;
        let rows = stmt
            .query_map(params![path.as_str()], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, i64>(2)? != 0,
                ))
            })
            .map_err(|e| CoreError::Index(e.to_string()))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    }

    pub fn tags(&self) -> Result<Vec<TagCount>> {
        let mut stmt = self
            .conn
            .prepare("SELECT tag, COUNT(*) FROM tags GROUP BY tag ORDER BY COUNT(*) DESC, tag")
            .map_err(|e| CoreError::Index(e.to_string()))?;
        let rows = stmt
            .query_map([], |r| {
                Ok(TagCount {
                    tag: r.get(0)?,
                    count: r.get(1)?,
                })
            })
            .map_err(|e| CoreError::Index(e.to_string()))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    }

    /// Resolve a wiki-link target the same way link indexing does; used by
    /// the editor for `[[` autocomplete and click-through.
    pub fn resolve_wiki(&self, name: &str) -> Result<Option<VaultPath>> {
        let needle = name.to_lowercase();
        let path: Option<String> = self
            .conn
            .query_row(
                "SELECT path FROM files
                 WHERE kind='note' AND (
                    LOWER(title) = ?1
                    OR LOWER(',' || aliases || ',') LIKE '%,' || ?1 || ',%'
                    OR LOWER(path) LIKE '%/' || ?1 || '.md'
                    OR LOWER(path) = ?1 || '.md'
                 )
                 ORDER BY LENGTH(path) ASC LIMIT 1",
                params![needle],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| CoreError::Index(e.to_string()))?;
        Ok(path.and_then(|p| VaultPath::new(&p).ok()))
    }
}

fn remove_one(tx: &rusqlite::Transaction, path: &VaultPath) -> Result<()> {
    let file_id: Option<i64> = tx
        .query_row(
            "SELECT id FROM files WHERE path=?1",
            params![path.as_str()],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| CoreError::Index(e.to_string()))?;
    if let Some(id) = file_id {
        tx.execute("DELETE FROM links WHERE source_file=?1", params![id])
            .map_err(|e| CoreError::Index(e.to_string()))?;
        tx.execute("DELETE FROM tags WHERE file_id=?1", params![id])
            .map_err(|e| CoreError::Index(e.to_string()))?;
        tx.execute("DELETE FROM files WHERE id=?1", params![id])
            .map_err(|e| CoreError::Index(e.to_string()))?;
    }
    tx.execute(
        "DELETE FROM notes_fts WHERE path=?1",
        params![path.as_str()],
    )
    .map_err(|e| CoreError::Index(e.to_string()))?;
    Ok(())
}

fn index_one(
    tx: &rusqlite::Transaction,
    vault: &Vault,
    path: &VaultPath,
    kind: FileKind,
) -> Result<()> {
    let abs = vault.abs(path);
    let meta_fs = std::fs::metadata(&abs).map_err(|e| CoreError::io(&abs, e))?;
    let mtime = meta_fs
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let size = meta_fs.len() as i64;

    let kind_str = match kind {
        FileKind::Note => "note",
        FileKind::Database => "database",
        FileKind::Canvas => "canvas",
        FileKind::Asset => "asset",
        FileKind::Other => "other",
    };

    let (title, note_id, aliases, hash) = match kind {
        FileKind::Note => {
            let (content, hash) = vault.read_text(path)?;
            let meta = extract_metadata(&content, path.stem());
            let title = meta.title.clone().unwrap_or_else(|| path.stem().to_string());

            tx.execute(
                "INSERT INTO files(path, kind, title, note_id, aliases, content_hash, mtime, size)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                params![
                    path.as_str(),
                    kind_str,
                    title,
                    meta.id,
                    meta.aliases.join(","),
                    hash.as_str(),
                    mtime,
                    size
                ],
            )
            .map_err(|e| CoreError::Index(e.to_string()))?;
            let file_id = tx.last_insert_rowid();

            tx.execute(
                "INSERT INTO notes_fts(title, body, tags, path) VALUES (?1,?2,?3,?4)",
                params![
                    title,
                    meta.plain_text,
                    meta.tags.join(" "),
                    path.as_str()
                ],
            )
            .map_err(|e| CoreError::Index(e.to_string()))?;

            for tag in &meta.tags {
                tx.execute(
                    "INSERT INTO tags(file_id, tag) VALUES (?1, ?2)",
                    params![file_id, tag],
                )
                .map_err(|e| CoreError::Index(e.to_string()))?;
            }
            for link in &meta.links {
                tx.execute(
                    "INSERT INTO links(source_file, target_raw, kind) VALUES (?1, ?2, ?3)",
                    params![
                        file_id,
                        link.target,
                        match link.kind {
                            mica_markdown::LinkKind::Wiki => "wiki",
                            mica_markdown::LinkKind::Markdown => "markdown",
                        }
                    ],
                )
                .map_err(|e| CoreError::Index(e.to_string()))?;
            }
            return Ok(());
        }
        FileKind::Database => {
            // Title from JSON "title" field when parseable; else file stem.
            let title = vault
                .read_text(path)
                .ok()
                .and_then(|(content, _)| {
                    serde_json::from_str::<serde_json::Value>(&content)
                        .ok()
                        .and_then(|v| v.get("title").and_then(|t| t.as_str()).map(String::from))
                })
                .unwrap_or_else(|| path.stem().to_string());
            (title, None::<String>, String::new(), ContentHash::of(&[]))
        }
        FileKind::Canvas => (
            path.stem().to_string(),
            None::<String>,
            String::new(),
            ContentHash::of(&[]),
        ),
        _ => (
            path.file_name().to_string(),
            None::<String>,
            String::new(),
            ContentHash::of(&[]),
        ),
    };

    tx.execute(
        "INSERT INTO files(path, kind, title, note_id, aliases, content_hash, mtime, size)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            path.as_str(),
            kind_str,
            title,
            note_id,
            aliases,
            hash.as_str(),
            mtime,
            size
        ],
    )
    .map_err(|e| CoreError::Index(e.to_string()))?;
    Ok(())
}

/// Resolve a relative markdown link target against its source file's folder.
fn resolve_relative(source_path: &str, target: &str) -> Option<VaultPath> {
    let target = target.split(['?', '#']).next()?;
    if target.is_empty() {
        return None;
    }
    let source_dir = source_path.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
    let combined = if source_dir.is_empty() {
        target.to_string()
    } else {
        format!("{source_dir}/{target}")
    };
    VaultPath::new(&combined).ok()
}

/// Convert a user query into an FTS5 MATCH expression: each term quoted with
/// prefix matching, ANDed together. Avoids FTS5 syntax injection.
fn build_fts_query(query: &str) -> String {
    query
        .split_whitespace()
        .map(|t| t.replace('"', ""))
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{t}\"*"))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, Vault, SearchIndex) {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::create(dir.path()).unwrap();
        let index = SearchIndex::open_in_memory().unwrap();
        (dir, vault, index)
    }

    #[test]
    fn index_and_search() {
        let (_dir, vault, mut index) = setup();
        let p = VaultPath::new("notes/alpha.md").unwrap();
        vault
            .write_text(&p, "# Alpha\n\nQuantum flux capacitors are neat. #physics\n")
            .unwrap();
        index.rebuild(&vault).unwrap();

        let hits = index.search("quantum", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "Alpha");
        assert!(hits[0].snippet.contains("<mark>"));

        let tags = index.tags().unwrap();
        assert!(tags.iter().any(|t| t.tag == "physics"));
    }

    #[test]
    fn backlinks_resolve_by_title() {
        let (_dir, vault, mut index) = setup();
        vault
            .write_text(
                &VaultPath::new("notes/target.md").unwrap(),
                "---\ntitle: Target Note\n---\n\n# Target Note\n",
            )
            .unwrap();
        vault
            .write_text(
                &VaultPath::new("notes/source.md").unwrap(),
                "# Source\n\nSee [[Target Note]].\n",
            )
            .unwrap();
        index.rebuild(&vault).unwrap();

        let backlinks = index
            .backlinks(&VaultPath::new("notes/target.md").unwrap())
            .unwrap();
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].source.as_str(), "notes/source.md");
    }

    #[test]
    fn quick_switch_prefers_title_prefix() {
        let (_dir, vault, mut index) = setup();
        vault
            .write_text(&VaultPath::new("notes/planning.md").unwrap(), "# Planning\n")
            .unwrap();
        vault
            .write_text(&VaultPath::new("notes/plan.md").unwrap(), "# Plan\n")
            .unwrap();
        index.rebuild(&vault).unwrap();
        let hits = index.quick_switch("plan", 10).unwrap();
        assert_eq!(hits[0].title, "Plan");
    }

    #[test]
    fn rebuild_equivalence_after_delete() {
        let (_dir, vault, mut index) = setup();
        let p = VaultPath::new("notes/x.md").unwrap();
        vault.write_text(&p, "# X\n\ncontent\n").unwrap();
        index.rebuild(&vault).unwrap();
        index.remove_file(&p).unwrap();
        assert!(index.search("content", 10).unwrap().is_empty());
        index.update_file(&vault, &p).unwrap();
        assert_eq!(index.search("content", 10).unwrap().len(), 1);
    }
}
