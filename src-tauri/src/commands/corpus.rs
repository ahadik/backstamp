use crate::AppState;
use rusqlite::params;
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CorpusEntry {
    value: String,
    is_builtin: bool,
    last_used: Option<i64>,
    use_count: i64,
    vendor: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CorpusState {
    camera_make_options: Vec<CorpusEntry>,
    camera_model_options: Vec<CorpusEntry>,
    lens_options: Vec<CorpusEntry>,
    film_vendors: Vec<CorpusEntry>,
    film_types: Vec<CorpusEntry>,
}

fn load_category(conn: &rusqlite::Connection, category: &str) -> Vec<CorpusEntry> {
    let mut stmt = match conn.prepare(
        "SELECT value, is_builtin, last_used, use_count, vendor
         FROM corpus WHERE category = ?1 ORDER BY value",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map(params![category], |row| {
        Ok(CorpusEntry {
            value: row.get(0)?,
            is_builtin: row.get::<_, i64>(1)? != 0,
            last_used: row.get(2)?,
            use_count: row.get(3)?,
            vendor: row.get(4)?,
        })
    })
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

#[tauri::command]
pub async fn load_corpus(state: State<'_, AppState>) -> Result<CorpusState, String> {
    let conn = state.db.lock().map_err(|e| format!("db lock: {}", e))?;
    Ok(CorpusState {
        camera_make_options: load_category(&conn, "camera_make"),
        camera_model_options: load_category(&conn, "camera_model"),
        lens_options: load_category(&conn, "lens"),
        film_vendors: load_category(&conn, "film_vendor"),
        film_types: load_category(&conn, "film_type"),
    })
}

#[tauri::command]
pub async fn add_corpus_entry(
    state: State<'_, AppState>,
    category: String,
    value: String,
    vendor: Option<String>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| format!("db lock: {}", e))?;
    conn.execute(
        "INSERT OR IGNORE INTO corpus (category, value, is_builtin, use_count, vendor) VALUES (?1, ?2, 0, 0, ?3)",
        params![category, value.trim(), vendor.as_deref()],
    )
    .map_err(|e| format!("add_corpus_entry: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn remove_corpus_entry(
    state: State<'_, AppState>,
    category: String,
    value: String,
    vendor: Option<String>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| format!("db lock: {}", e))?;
    if category == "film_vendor" {
        // Cascade: remove all film_types belonging to this vendor
        conn.execute(
            "DELETE FROM corpus WHERE category = 'film_type' AND vendor = ?1 AND is_builtin = 0",
            params![value],
        )
        .map_err(|e| format!("remove_corpus_entry cascade: {}", e))?;
    }
    if let Some(v) = vendor {
        conn.execute(
            "DELETE FROM corpus WHERE category = ?1 AND value = ?2 AND vendor IS ?3 AND is_builtin = 0",
            params![category, value, v],
        )
    } else {
        conn.execute(
            "DELETE FROM corpus WHERE category = ?1 AND value = ?2 AND is_builtin = 0",
            params![category, value],
        )
    }
    .map_err(|e| format!("remove_corpus_entry: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn record_corpus_use(
    state: State<'_, AppState>,
    category: String,
    value: String,
    vendor: Option<String>,
) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let conn = state.db.lock().map_err(|e| format!("db lock: {}", e))?;
    if let Some(ref v) = vendor {
        // Try vendor-exact match first.
        let updated = conn.execute(
            "UPDATE corpus SET last_used = ?1, use_count = use_count + 1
             WHERE category = ?2 AND value = ?3 AND vendor IS ?4",
            params![now, category, value, v],
        )
        .map_err(|e| format!("record_corpus_use: {}", e))?;
        // If no match, the entry may be a legacy null-vendor entry — promote it.
        if updated == 0 {
            conn.execute(
                "UPDATE corpus SET last_used = ?1, use_count = use_count + 1, vendor = ?4
                 WHERE category = ?2 AND value = ?3 AND vendor IS NULL",
                params![now, category, value, v],
            )
            .map_err(|e| format!("record_corpus_use promote: {}", e))?;
        }
    } else {
        conn.execute(
            "UPDATE corpus SET last_used = ?1, use_count = use_count + 1
             WHERE category = ?2 AND value = ?3",
            params![now, category, value],
        )
        .map_err(|e| format!("record_corpus_use: {}", e))?;
    }
    Ok(())
}
