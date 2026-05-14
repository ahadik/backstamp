use crate::gpx::TrackPoint;
use crate::thumbnail::path_key;
use crate::AppState;
use rusqlite::params;
use serde::Serialize;
use std::path::Path;
use tauri::State;

use super::photos::Metadata;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PhotoRow {
    id: String,
    file_path: String,
    file_status: String,
    thumbnail_small: String,
    thumbnail_large: String,
    original_metadata: Metadata,
    current_metadata: Metadata,
    pending_changes: Option<serde_json::Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GpxRow {
    id: String,
    file_path: String,
    added_at: i64,
    track_points: Vec<TrackPoint>,
    thumbnail_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionLoadResult {
    photos: Vec<PhotoRow>,
    gpx_files: Vec<GpxRow>,
    can_rollback: bool,
    working_timezone: String,
    grid_columns: i64,
    map_panel_height: f64,
}

fn snake_to_camel(s: &str) -> &str {
    match s {
        "capture_date" => "captureDate",
        "capture_time" => "captureTime",
        "utc_offset" => "utcOffset",
        "timezone" => "timezone",
        "gps_lat" => "gpsLat",
        "gps_lng" => "gpsLng",
        "camera_make" => "cameraMake",
        "camera_model" => "cameraModel",
        "lens" => "lens",
        "film_vendor" => "filmVendor",
        "film_type" => "filmType",
        other => other,
    }
}

fn load_pending_for(conn: &rusqlite::Connection, photo_id: &str) -> Option<serde_json::Value> {
    let query = "SELECT field, value FROM metadata_current WHERE photo_id = ?1 AND is_pending = 1";
    let pairs: Vec<(String, Option<String>)> = conn
        .prepare(query)
        .ok()?
        .query_map(rusqlite::params![photo_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })
        .ok()?
        .filter_map(|r| r.ok())
        .collect();

    if pairs.is_empty() {
        return None;
    }
    let mut map = serde_json::Map::new();
    for (field, value) in pairs {
        map.insert(
            snake_to_camel(&field).to_string(),
            value.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null),
        );
    }
    Some(serde_json::Value::Object(map))
}

fn load_metadata_for(
    conn: &rusqlite::Connection,
    photo_id: &str,
    use_current: bool,
) -> Metadata {
    let table = if use_current {
        "metadata_current"
    } else {
        "metadata_original"
    };
    let query = format!("SELECT field, value FROM {} WHERE photo_id = ?1", table);

    let pairs: Vec<(String, String)> = if let Ok(mut stmt) = conn.prepare(&query) {
        if let Ok(rows) = stmt.query_map(params![photo_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }) {
            rows.filter_map(|r| r.ok()).collect()
        } else {
            vec![]
        }
    } else {
        vec![]
    };

    let mut m = Metadata {
        capture_date: None,
        capture_time: None,
        utc_offset: None,
        timezone: None,
        gps_lat: None,
        gps_lng: None,
        camera_make: None,
        camera_model: None,
        lens: None,
        film_vendor: None,
        film_type: None,
    };
    for (field, value) in pairs {
        match field.as_str() {
            "capture_date" => m.capture_date = Some(value),
            "capture_time" => m.capture_time = Some(value),
            "utc_offset" => m.utc_offset = Some(value),
            "timezone" => m.timezone = Some(value),
            "gps_lat" => m.gps_lat = value.parse().ok(),
            "gps_lng" => m.gps_lng = value.parse().ok(),
            "camera_make" => m.camera_make = Some(value),
            "camera_model" => m.camera_model = Some(value),
            "lens" => m.lens = Some(value),
            "film_vendor" => m.film_vendor = Some(value),
            "film_type" => m.film_type = Some(value),
            _ => {}
        }
    }
    m
}

#[tauri::command]
pub async fn load_session(state: State<'_, AppState>) -> Result<SessionLoadResult, String> {
    let conn = state.db.lock().map_err(|e| format!("db lock: {}", e))?;

    let photo_ids: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, file_path FROM photos ORDER BY sort_order ASC, added_at ASC")
            .map_err(|e| e.to_string())?;
        let rows: Vec<(String, String)> = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };

    let photos: Vec<PhotoRow> = photo_ids
        .into_iter()
        .map(|(id, file_path)| {
            let file_status = if Path::new(&file_path).exists() {
                "ok"
            } else {
                "missing"
            }
            .to_string();
            let key = path_key(Path::new(&file_path));
            let thumb_dir = &state.thumbnails_dir;
            PhotoRow {
                file_status,
                thumbnail_small: thumb_dir
                    .join(format!("{}_small.jpg", key))
                    .to_string_lossy()
                    .into_owned(),
                thumbnail_large: thumb_dir
                    .join(format!("{}_large.jpg", key))
                    .to_string_lossy()
                    .into_owned(),
                original_metadata: load_metadata_for(&conn, &id, false),
                current_metadata: load_metadata_for(&conn, &id, true),
                pending_changes: load_pending_for(&conn, &id),
                id,
                file_path,
            }
        })
        .collect();

    let gpx_files: Vec<GpxRow> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, file_path, added_at, track_points, thumbnail_path
                 FROM gpx_files ORDER BY added_at ASC",
            )
            .map_err(|e| e.to_string())?;
        let raw: Vec<(String, String, i64, Option<String>, Option<String>)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        raw.into_iter()
        .map(|(id, file_path, added_at, tp_json, thumbnail_path)| {
            let track_points: Vec<TrackPoint> = tp_json
                .as_deref()
                .and_then(|j| serde_json::from_str(j).ok())
                .unwrap_or_default();
            GpxRow { id, file_path, added_at, track_points, thumbnail_path }
        })
        .collect()
    };

    let can_rollback: bool = conn
        .query_row("SELECT COUNT(*) FROM apply_ops", [], |r| r.get::<_, i64>(0))
        .map(|n| n > 0)
        .unwrap_or(false);

    let working_timezone = conn
        .query_row("SELECT value FROM settings WHERE key = 'ui.workingTimezone'", [], |r| r.get(0))
        .unwrap_or_else(|_| "America/Los_Angeles".to_string());

    let grid_columns: i64 = conn
        .query_row("SELECT value FROM settings WHERE key = 'ui.gridColumns'", [], |r| r.get::<_, String>(0))
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(5);

    let map_panel_height: f64 = conn
        .query_row("SELECT value FROM settings WHERE key = 'ui.mapPanelHeight'", [], |r| r.get::<_, String>(0))
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(200.0);

    Ok(SessionLoadResult {
        photos,
        gpx_files,
        can_rollback,
        working_timezone,
        grid_columns,
        map_panel_height,
    })
}

#[tauri::command]
pub async fn clear_session(state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| format!("db lock: {}", e))?;

    let paths: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT file_path FROM photos ORDER BY added_at")
            .map_err(|e| format!("prepare: {}", e))?;
        let rows: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| format!("query photos: {}", e))?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };

    if paths.is_empty() {
        println!("[clear_session] no photos to clear");
    } else {
        println!("[clear_session] clearing {} photo(s):", paths.len());
        for path in &paths {
            println!("  - {}", path);
        }
    }

    conn.execute_batch(
        "DELETE FROM apply_history;
         DELETE FROM apply_ops;
         DELETE FROM photo_keywords;
         DELETE FROM metadata_current;
         DELETE FROM metadata_original;
         DELETE FROM photos;
         DELETE FROM gpx_files;
         DELETE FROM settings WHERE key LIKE 'ui.%';",
    )
    .map_err(|e| format!("clear session: {}", e))?;
    drop(conn);

    if state.thumbnails_dir.exists() {
        std::fs::remove_dir_all(&state.thumbnails_dir)
            .map_err(|e| format!("clear thumbnails: {}", e))?;
        std::fs::create_dir_all(&state.thumbnails_dir)
            .map_err(|e| format!("recreate thumbnails dir: {}", e))?;
    }

    Ok(())
}
