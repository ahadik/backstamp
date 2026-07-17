use crate::corpus_seed;
use rusqlite::{Connection, Result};

pub fn init_db(app_data_dir: &std::path::Path) -> Result<Connection> {
    let thumbnails_dir = app_data_dir.join("thumbnails");
    std::fs::create_dir_all(&thumbnails_dir)
        .expect("failed to create thumbnails directory");

    let db_path = app_data_dir.join("session.db");
    let mut conn = Connection::open(db_path)?;
    apply_schema(&conn)?;
    run_migrations(&mut conn)?;
    Ok(conn)
}

// Each version step runs inside its own transaction: an interrupted or failing
// migration must roll back entirely rather than commit a partial shape with
// user_version unbumped (which the guards below can then mis-detect on retry).
fn run_migrations(conn: &mut Connection) -> Result<()> {
    let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version < 1 {
        let tx = conn.transaction()?;
        let col_exists: bool = tx
            .prepare("SELECT 1 FROM pragma_table_info('photos') WHERE name = 'sort_order'")?
            .exists([])?;
        if !col_exists {
            tx.execute_batch(
                "ALTER TABLE photos ADD COLUMN sort_order INTEGER DEFAULT 0",
            )?;
        }
        tx.pragma_update(None, "user_version", 1i64)?;
        tx.commit()?;
    }
    if version < 2 {
        let tx = conn.transaction()?;
        // Add settings table if not present
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );"
        )?;
        tx.pragma_update(None, "user_version", 2i64)?;
        tx.commit()?;
    }
    if version < 3 {
        let tx = conn.transaction()?;
        let col_exists: bool = tx
            .prepare("SELECT 1 FROM pragma_table_info('corpus') WHERE name = 'vendor'")?
            .exists([])?;
        if !col_exists {
            tx.execute_batch("ALTER TABLE corpus ADD COLUMN vendor TEXT")?;
        }
        // Migrate old 'film' corpus entries to 'film_vendor'
        tx.execute_batch(
            "UPDATE corpus SET category = 'film_vendor' WHERE category = 'film';",
        )?;
        // Migrate old 'film' metadata rows to 'film_vendor' (split "Vendor Type" on first space)
        // We do this in Rust because SQLite lacks a clean split-on-first-space.
        let film_rows: Vec<(String, String, String)> = {
            let mut stmt = tx.prepare(
                "SELECT photo_id, field, value FROM metadata_current WHERE field = 'film'
                 UNION ALL
                 SELECT photo_id, field, value FROM metadata_original WHERE field = 'film'",
            )?;
            let rows: Vec<(String, String, String)> = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
            })?
            .filter_map(|r| r.ok())
            .collect();
            rows
        };
        for (photo_id, _field, value) in &film_rows {
            let (vendor, film_type) = match value.find(' ') {
                Some(pos) => (Some(&value[..pos]), Some(&value[pos + 1..])),
                None => (Some(value.as_str()), None),
            };
            for (tbl, meta_field, meta_val) in &[
                ("metadata_current", "film_vendor", vendor),
                ("metadata_current", "film_type", film_type),
                ("metadata_original", "film_vendor", vendor),
                ("metadata_original", "film_type", film_type),
            ] {
                if let Some(v) = meta_val {
                    tx.execute(
                        &format!("INSERT OR REPLACE INTO {} (photo_id, field, value) VALUES (?1, ?2, ?3)", tbl),
                        rusqlite::params![photo_id, meta_field, v],
                    )?;
                }
            }
            tx.execute(
                "DELETE FROM metadata_current WHERE photo_id = ?1 AND field = 'film'",
                rusqlite::params![photo_id],
            )?;
            tx.execute(
                "DELETE FROM metadata_original WHERE photo_id = ?1 AND field = 'film'",
                rusqlite::params![photo_id],
            )?;
        }
        tx.pragma_update(None, "user_version", 3i64)?;
        tx.commit()?;
    }
    if version < 4 {
        let tx = conn.transaction()?;
        corpus_seed::seed_film_corpus(&tx)?;
        tx.pragma_update(None, "user_version", 4i64)?;
        tx.commit()?;
    }
    if version < 5 {
        let tx = conn.transaction()?;
        // Guard each column independently: an earlier interrupted run (before this
        // step was transactional) could have added one column but not the other.
        for col in ["track_points", "thumbnail_path"] {
            let exists: bool = tx
                .prepare("SELECT 1 FROM pragma_table_info('gpx_files') WHERE name = ?1")?
                .exists([col])?;
            if !exists {
                tx.execute_batch(&format!("ALTER TABLE gpx_files ADD COLUMN {} TEXT", col))?;
            }
        }
        tx.pragma_update(None, "user_version", 5i64)?;
        tx.commit()?;
    }
    if version < 6 {
        let tx = conn.transaction()?;
        corpus_seed::seed_camera_corpus(&tx)?;
        tx.pragma_update(None, "user_version", 6i64)?;
        tx.commit()?;
    }
    if version < 7 {
        let tx = conn.transaction()?;
        // Split legacy camera_body rows ("Make Model") into separate camera_make and
        // camera_model rows. Uses a priority-ordered known-makes list to find where the
        // make ends; if no known make matches, the whole value goes into camera_model.
        const KNOWN_MAKES: &[&str] = &[
            "Phase One", "Fujifilm", "Hasselblad", "Panasonic", "Olympus",
            "Samsung", "Pentax", "Canon", "Nikon", "Sony", "Leica",
            "Sigma", "Ricoh", "Apple", "Google", "Fuji",
        ];
        for table in &["metadata_original", "metadata_current"] {
            let rows: Vec<(String, String)> = {
                let mut stmt = tx.prepare(&format!(
                    "SELECT photo_id, value FROM {} WHERE field = 'camera_body'",
                    table
                ))?;
                let collected: Vec<(String, String)> = stmt
                    .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
                    .filter_map(|r| r.ok())
                    .collect();
                collected
            };
            for (photo_id, body) in &rows {
                // Compare a byte-length prefix of the original string rather than
                // to_lowercase() output: Unicode lowercasing can shift byte offsets,
                // making the body[m.len()..] slice below panic or split mid-word.
                let make = KNOWN_MAKES.iter().find(|&&m| {
                    body.get(..m.len())
                        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(m))
                });
                let (camera_make, camera_model) = match make {
                    Some(m) => {
                        let model = body[m.len()..].trim().to_string();
                        (Some(m.to_string()), if model.is_empty() { None } else { Some(model) })
                    }
                    None => (None, Some(body.clone())),
                };
                if let Some(ref v) = camera_make {
                    tx.execute(
                        &format!("INSERT OR REPLACE INTO {} (photo_id, field, value) VALUES (?1, ?2, ?3)", table),
                        rusqlite::params![photo_id, "camera_make", v],
                    )?;
                }
                if let Some(ref v) = camera_model {
                    tx.execute(
                        &format!("INSERT OR REPLACE INTO {} (photo_id, field, value) VALUES (?1, ?2, ?3)", table),
                        rusqlite::params![photo_id, "camera_model", v],
                    )?;
                }
                tx.execute(
                    &format!("DELETE FROM {} WHERE photo_id = ?1 AND field = 'camera_body'", table),
                    rusqlite::params![photo_id],
                )?;
            }
        }
        tx.pragma_update(None, "user_version", 7i64)?;
        tx.commit()?;
    }
    Ok(())
}

pub fn apply_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(SCHEMA)
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS photos (
    id          TEXT PRIMARY KEY,
    file_path   TEXT NOT NULL UNIQUE,
    file_hash   TEXT,
    added_at    INTEGER NOT NULL,
    nodateorder INTEGER,
    sort_order  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS metadata_original (
    photo_id TEXT NOT NULL,
    field    TEXT NOT NULL,
    value    TEXT,
    PRIMARY KEY (photo_id, field),
    FOREIGN KEY (photo_id) REFERENCES photos(id)
);

CREATE TABLE IF NOT EXISTS metadata_current (
    photo_id   TEXT NOT NULL,
    field      TEXT NOT NULL,
    value      TEXT,
    is_pending INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (photo_id, field),
    FOREIGN KEY (photo_id) REFERENCES photos(id)
);

CREATE TABLE IF NOT EXISTS apply_ops (
    id          TEXT PRIMARY KEY,
    applied_at  INTEGER NOT NULL,
    file_count  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS apply_history (
    apply_id     TEXT NOT NULL,
    photo_id     TEXT NOT NULL,
    field        TEXT NOT NULL,
    value_before TEXT,
    value_after  TEXT,
    FOREIGN KEY (apply_id) REFERENCES apply_ops(id)
);

CREATE TABLE IF NOT EXISTS gpx_files (
    id             TEXT PRIMARY KEY,
    file_path      TEXT NOT NULL,
    added_at       INTEGER NOT NULL,
    track_points   TEXT,
    thumbnail_path TEXT
);

CREATE TABLE IF NOT EXISTS corpus (
    category    TEXT NOT NULL,
    value       TEXT NOT NULL,
    is_builtin  INTEGER NOT NULL DEFAULT 0,
    last_used   INTEGER,
    use_count   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (category, value)
);

CREATE TABLE IF NOT EXISTS photo_keywords (
    photo_id TEXT NOT NULL,
    keyword  TEXT NOT NULL,
    PRIMARY KEY (photo_id, keyword),
    FOREIGN KEY (photo_id) REFERENCES photos(id)
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
";

#[cfg(test)]
mod tests {
    use super::*;

    fn in_memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        apply_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn schema_creates_photos_table() {
        let conn = in_memory_db();
        conn.execute(
            "INSERT INTO photos (id, file_path, added_at) VALUES (?1, ?2, ?3)",
            ("test-id", "/tmp/a.jpg", 1_700_000_000i64),
        )
        .unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM photos", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn schema_creates_metadata_original_table() {
        let conn = in_memory_db();
        conn.execute(
            "INSERT INTO photos (id, file_path, added_at) VALUES (?1, ?2, ?3)",
            ("p1", "/tmp/b.jpg", 1_700_000_000i64),
        )
        .unwrap();
        conn.execute(
            "INSERT INTO metadata_original (photo_id, field, value) VALUES (?1, ?2, ?3)",
            ("p1", "capture_date", "2024-03-15"),
        )
        .unwrap();
        let val: String = conn
            .query_row(
                "SELECT value FROM metadata_original WHERE photo_id = ?1 AND field = ?2",
                ("p1", "capture_date"),
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(val, "2024-03-15");
    }

    #[test]
    fn schema_creates_metadata_current_table() {
        let conn = in_memory_db();
        conn.execute(
            "INSERT INTO photos (id, file_path, added_at) VALUES (?1, ?2, ?3)",
            ("p2", "/tmp/c.jpg", 1_700_000_000i64),
        )
        .unwrap();
        conn.execute(
            "INSERT INTO metadata_current (photo_id, field, value, is_pending) VALUES (?1, ?2, ?3, 0)",
            ("p2", "lens", "RF 50mm"),
        )
        .unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM metadata_current", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn apply_schema_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        apply_schema(&conn).unwrap();
        // Running it a second time must not fail (CREATE TABLE IF NOT EXISTS)
        apply_schema(&conn).unwrap();
    }

    #[test]
    fn schema_creates_settings_table() {
        let conn = in_memory_db();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)",
            ("mapbox_token", "pk.test"),
        )
        .unwrap();
        let val: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                ["mapbox_token"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(val, "pk.test");
    }

    fn columns(conn: &Connection, table: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare(&format!("SELECT name FROM pragma_table_info('{}')", table))
            .unwrap();
        stmt.query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
    }

    #[test]
    fn fresh_migrations_reach_latest_version() {
        let mut conn = Connection::open_in_memory().unwrap();
        apply_schema(&conn).unwrap();
        run_migrations(&mut conn).unwrap();
        let version: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(version, 7);
        // Corpus was seeded by the v4/v6 steps.
        let corpus_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM corpus", [], |r| r.get(0))
            .unwrap();
        assert!(corpus_count > 0);
    }

    #[test]
    fn migrations_are_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();
        apply_schema(&conn).unwrap();
        run_migrations(&mut conn).unwrap();
        // A second run must be a no-op, not an error.
        run_migrations(&mut conn).unwrap();
        let version: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(version, 7);
    }

    #[test]
    fn v5_recovers_from_partial_column_add() {
        // Simulate a pre-transaction interrupted v5: gpx_files has track_points
        // but not thumbnail_path, and user_version was left at 4. The old guard
        // (which only checked track_points) would skip the block and never add
        // thumbnail_path; the fixed per-column guard must add the missing one.
        let mut conn = Connection::open_in_memory().unwrap();
        apply_schema(&conn).unwrap();
        // Bring corpus to its post-v3 shape (vendor column) so the starting state
        // matches a genuine version-4 database, then recreate gpx_files missing the
        // thumbnail_path column to mimic the interrupted v5.
        conn.execute_batch(
            "ALTER TABLE corpus ADD COLUMN vendor TEXT;
             DROP TABLE gpx_files;
             CREATE TABLE gpx_files (
                 id           TEXT PRIMARY KEY,
                 file_path    TEXT NOT NULL,
                 added_at     INTEGER NOT NULL,
                 track_points TEXT
             );",
        )
        .unwrap();
        conn.pragma_update(None, "user_version", 4i64).unwrap();

        run_migrations(&mut conn).unwrap();

        let cols = columns(&conn, "gpx_files");
        assert!(cols.iter().any(|c| c == "track_points"));
        assert!(
            cols.iter().any(|c| c == "thumbnail_path"),
            "thumbnail_path column should have been added by the recovered v5 migration"
        );
        let version: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(version, 7);
    }
}
