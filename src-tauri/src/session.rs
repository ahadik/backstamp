use rusqlite::{Connection, Result};

pub fn init_db(app_data_dir: &std::path::Path) -> Result<Connection> {
    let thumbnails_dir = app_data_dir.join("thumbnails");
    std::fs::create_dir_all(&thumbnails_dir)
        .expect("failed to create thumbnails directory");

    let db_path = app_data_dir.join("session.db");
    let conn = Connection::open(db_path)?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS photos (
    id          TEXT PRIMARY KEY,
    file_path   TEXT NOT NULL UNIQUE,
    file_hash   TEXT,
    added_at    INTEGER NOT NULL,
    nodateorder INTEGER
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
    id        TEXT PRIMARY KEY,
    file_path TEXT NOT NULL,
    added_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS corpus (
    category    TEXT NOT NULL,
    value       TEXT NOT NULL,
    is_builtin  INTEGER NOT NULL DEFAULT 0,
    last_used   INTEGER,
    use_count   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (category, value)
);
";
