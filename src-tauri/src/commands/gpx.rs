use crate::gpx::{parse_gpx, ranges_overlap, timestamp_range, timezone_for_point, TrackPoint};
use crate::AppState;
use rusqlite::params;
use serde::Serialize;
use tauri::State;
use uuid::Uuid;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpxFileData {
    pub id: String,
    pub file_path: String,
    pub added_at: i64,
    pub track_points: Vec<TrackPoint>,
    pub thumbnail_path: Option<String>,
    pub timezone: Option<String>,
}

/// Import a GPX file. Returns the parsed file data on success.
/// Errors if the file overlaps timestamps with an existing GPX file in the session.
#[tauri::command]
pub async fn import_gpx(
    state: State<'_, AppState>,
    path: String,
) -> Result<GpxFileData, String> {
    let points = parse_gpx(&path)?;
    let new_range = timestamp_range(&points);

    let conn = state.db.lock().map_err(|e| format!("db lock: {e}"))?;

    let existing: Vec<(String, Option<String>)> = {
        let mut stmt = conn
            .prepare("SELECT id, track_points FROM gpx_files")
            .map_err(|e| e.to_string())?;
        let rows: Vec<(String, Option<String>)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };

    if let Some(new_r) = new_range {
        for (id, tp_json) in &existing {
            if let Some(json) = tp_json {
                let existing_pts: Vec<TrackPoint> =
                    serde_json::from_str(json).unwrap_or_default();
                if let Some(existing_r) = timestamp_range(&existing_pts) {
                    if ranges_overlap(new_r, existing_r) {
                        return Err(format!(
                            "Multiple GPX files with overlapping timestamps cannot be added \
                             (conflicts with file id={})",
                            id
                        ));
                    }
                }
            }
        }
    }

    let id = Uuid::new_v4().to_string();
    let added_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let tp_json = serde_json::to_string(&points).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO gpx_files (id, file_path, added_at, track_points) VALUES (?1, ?2, ?3, ?4)",
        params![id, path, added_at, tp_json],
    )
    .map_err(|e| format!("insert gpx_files: {e}"))?;

    let timezone = points.first().and_then(|p| timezone_for_point(p.lat, p.lng));

    Ok(GpxFileData {
        id,
        file_path: path,
        added_at,
        track_points: points,
        thumbnail_path: None,
        timezone,
    })
}

/// Remove a GPX file from the session.
#[tauri::command]
pub async fn remove_gpx(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| format!("db lock: {e}"))?;
    conn.execute("DELETE FROM gpx_files WHERE id = ?1", params![id])
        .map_err(|e| format!("remove gpx: {e}"))?;
    Ok(())
}

/// Save a GPX route thumbnail (raw JPEG bytes) to the thumbnails directory
/// and record the path in the database. Returns the absolute path of the saved file.
#[tauri::command]
pub async fn save_gpx_thumbnail(
    state: State<'_, AppState>,
    id: String,
    data: Vec<u8>,
) -> Result<String, String> {
    let dest = state
        .thumbnails_dir
        .join(format!("gpx_{}.jpg", id));
    std::fs::write(&dest, &data).map_err(|e| format!("write thumbnail: {e}"))?;
    let dest_str = dest.to_string_lossy().into_owned();

    let conn = state.db.lock().map_err(|e| format!("db lock: {e}"))?;
    conn.execute(
        "UPDATE gpx_files SET thumbnail_path = ?1 WHERE id = ?2",
        params![dest_str, id],
    )
    .map_err(|e| format!("update thumbnail_path: {e}"))?;

    Ok(dest_str)
}
