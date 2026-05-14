use crate::write_metadata::{FieldWrite, PhotoWrite};
use crate::AppState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingField {
    pub field: String,
    pub value: Option<String>,
}

#[tauri::command]
pub async fn set_pending_changes(
    photo_ids: Vec<String>,
    fields: Vec<PendingField>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| format!("db lock: {}", e))?;
    for photo_id in &photo_ids {
        for f in &fields {
            let db_field = camel_to_snake(&f.field);
            conn.execute(
                "INSERT INTO metadata_current (photo_id, field, value, is_pending)
                 VALUES (?1, ?2, ?3, 1)
                 ON CONFLICT(photo_id, field)
                 DO UPDATE SET value = excluded.value, is_pending = 1",
                rusqlite::params![photo_id, db_field, f.value],
            )
            .map_err(|e| format!("set_pending: {}", e))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn clear_pending_changes(
    photo_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| format!("db lock: {}", e))?;
    for photo_id in &photo_ids {
        conn.execute(
            "UPDATE metadata_current SET is_pending = 0 WHERE photo_id = ?1",
            rusqlite::params![photo_id],
        )
        .map_err(|e| format!("clear_pending: {}", e))?;
    }
    Ok(())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ApplyProgressEvent {
    done: usize,
    total: usize,
    photo_id: String,
    file_path: String,
    success: bool,
    error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UndoProgressEvent {
    done: usize,
    total: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ApplyCompleteEvent {
    failed_files: Vec<FailedFile>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FailedFile {
    photo_id: String,
    file_path: String,
    error: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackResult {
    pub can_rollback: bool,
    pub failed_files: Vec<FailedFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetResult {
    pub failed_files: Vec<FailedFile>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PhotoApplyChanges {
    capture_date: Option<Option<String>>,
    capture_time: Option<Option<String>>,
    utc_offset: Option<Option<String>>,
    gps_lat: Option<Option<f64>>,
    gps_lng: Option<Option<f64>>,
    camera_make: Option<Option<String>>,
    camera_model: Option<Option<String>>,
    lens: Option<Option<String>>,
    film: Option<Option<String>>,
}

fn camel_to_snake(key: &str) -> &str {
    match key {
        "captureDate" => "capture_date",
        "captureTime" => "capture_time",
        "utcOffset" => "utc_offset",
        "timezone" => "timezone",
        "gpsLat" => "gps_lat",
        "gpsLng" => "gps_lng",
        "cameraMake" => "camera_make",
        "cameraModel" => "camera_model",
        "lens" => "lens",
        "film" => "film",       // kept for backward compat with old apply_history rows
        "filmVendor" => "film_vendor",
        "filmType" => "film_type",
        other => other,
    }
}

fn value_to_string(v: &Value) -> Option<String> {
    match v {
        Value::Null => None,
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => Some(v.to_string()),
    }
}

fn changes_to_photo_write(
    photo_id: &str,
    file_path: &str,
    fields: &HashMap<String, Value>,
) -> PhotoWrite {
    let mut fw_list: Vec<FieldWrite> = Vec::new();
    let mut utc_offset: Option<String> = None;

    for (field_camel, val) in fields {
        let field = camel_to_snake(field_camel);
        if field == "utc_offset" {
            utc_offset = value_to_string(val);
            continue;
        }
        if field == "timezone" {
            // timezone is stored in SQLite but not written via ExifTool directly
            // utcOffset handles the EXIF write
            continue;
        }
        fw_list.push(FieldWrite {
            field: field.to_string(),
            value: value_to_string(val),
        });
    }

    PhotoWrite {
        photo_id: photo_id.to_string(),
        file_path: std::path::PathBuf::from(file_path),
        fields: fw_list,
        utc_offset,
    }
}

fn history_to_photo_write(
    photo_id: &str,
    file_path: &str,
    entries: &[(String, Option<String>)],
) -> PhotoWrite {
    let mut fw_list: Vec<FieldWrite> = Vec::new();
    let mut utc_offset: Option<String> = None;

    for (field, val) in entries {
        if field == "utc_offset" {
            utc_offset = val.clone();
            continue;
        }
        if field == "timezone" {
            continue;
        }
        fw_list.push(FieldWrite {
            field: field.clone(),
            value: val.clone(),
        });
    }

    PhotoWrite {
        photo_id: photo_id.to_string(),
        file_path: std::path::PathBuf::from(file_path),
        fields: fw_list,
        utc_offset,
    }
}

#[tauri::command]
pub async fn apply_changes(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: Value,
) -> Result<(), String> {
    let changes_map: HashMap<String, HashMap<String, Value>> = {
        let obj = payload
            .get("changes")
            .and_then(|v| v.as_object())
            .ok_or("invalid payload: expected changes object")?;
        obj.iter()
            .map(|(photo_id, fields)| {
                let fields_map: HashMap<String, Value> = fields
                    .as_object()
                    .map(|o| o.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
                    .unwrap_or_default();
                (photo_id.clone(), fields_map)
            })
            .collect()
    };

    let total = changes_map.len();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let apply_id = Uuid::new_v4().to_string();

    state.apply_cancel_flag.store(false, Ordering::Relaxed);

    // Read file paths and record apply_ops + apply_history
    let mut photo_file_paths: HashMap<String, String> = HashMap::new();
    {
        let conn = state.db.lock().map_err(|e| format!("db lock: {}", e))?;

        conn.execute(
            "INSERT INTO apply_ops (id, applied_at, file_count) VALUES (?1, ?2, ?3)",
            params![apply_id, now, total as i64],
        )
        .map_err(|e| format!("insert apply_ops: {}", e))?;

        for (photo_id, fields) in &changes_map {
            // Look up file path
            let file_path: String = conn
                .query_row(
                    "SELECT file_path FROM photos WHERE id = ?1",
                    params![photo_id],
                    |r| r.get(0),
                )
                .unwrap_or_default();
            photo_file_paths.insert(photo_id.clone(), file_path);

            for (field_camel, new_val) in fields {
                let field = camel_to_snake(field_camel);
                let new_str = value_to_string(new_val);

                let before: Option<String> = conn
                    .query_row(
                        "SELECT value FROM metadata_current WHERE photo_id = ?1 AND field = ?2",
                        params![photo_id, field],
                        |r| r.get(0),
                    )
                    .ok();

                conn.execute(
                    "INSERT INTO apply_history (apply_id, photo_id, field, value_before, value_after)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![apply_id, photo_id, field, before, new_str],
                )
                .map_err(|e| format!("insert apply_history: {}", e))?;
            }
        }
    }

    let db = std::sync::Arc::clone(&state.db);
    let exiftool = std::sync::Arc::clone(&state.exiftool);
    let cancel_flag = std::sync::Arc::clone(&state.apply_cancel_flag);
    let app_clone = app.clone();

    let photo_ids: Vec<(String, HashMap<String, Value>)> = changes_map.into_iter().collect();

    tokio::task::spawn_blocking(move || {
        let mut done = 0usize;
        let mut cancelled_at: Option<usize> = None;
        let mut failed_files: Vec<FailedFile> = Vec::new();
        let mut written_ids: Vec<String> = Vec::new();

        for (i, (photo_id, fields)) in photo_ids.iter().enumerate() {
            if cancel_flag.load(Ordering::Relaxed) {
                cancelled_at = Some(i);
                break;
            }

            let file_path = photo_file_paths.get(photo_id).cloned().unwrap_or_default();

            // Write to disk via ExifTool
            let write = changes_to_photo_write(photo_id, &file_path, fields);
            let write_result = if let Ok(mut et) = exiftool.lock() {
                crate::write_metadata::write_metadata(&mut et, &write)
            } else {
                Err("exiftool lock failed".to_string())
            };

            match write_result {
                Ok(()) => {
                    // Update metadata_current in SQLite
                    if let Ok(conn) = db.lock() {
                        for (field_camel, new_val) in fields {
                            let field = camel_to_snake(field_camel);
                            let new_str = value_to_string(new_val);
                            let _ = conn.execute(
                                "INSERT INTO metadata_current (photo_id, field, value, is_pending)
                                 VALUES (?1, ?2, ?3, 0)
                                 ON CONFLICT(photo_id, field)
                                 DO UPDATE SET value = excluded.value, is_pending = 0",
                                params![photo_id, field, new_str],
                            );
                        }
                    }
                    written_ids.push(photo_id.clone());
                    done += 1;
                    let _ = app_clone.emit(
                        "apply:progress",
                        ApplyProgressEvent {
                            done,
                            total,
                            photo_id: photo_id.clone(),
                            file_path: file_path.clone(),
                            success: true,
                            error: None,
                        },
                    );
                }
                Err(err) => {
                    failed_files.push(FailedFile {
                        photo_id: photo_id.clone(),
                        file_path: file_path.clone(),
                        error: err.clone(),
                    });
                    done += 1;
                    let _ = app_clone.emit(
                        "apply:progress",
                        ApplyProgressEvent {
                            done,
                            total,
                            photo_id: photo_id.clone(),
                            file_path: file_path.clone(),
                            success: false,
                            error: Some(err),
                        },
                    );
                }
            }
        }

        if let Some(_cancelled_idx) = cancelled_at {
            // Undo already-successfully-written files in reverse order
            let undo_entries: Vec<(String, String, Option<String>)> =
                if let Ok(conn) = db.lock() {
                    let mut stmt = match conn.prepare(
                        "SELECT ah.photo_id, ah.field, ah.value_before
                         FROM apply_history ah
                         JOIN photos p ON p.id = ah.photo_id
                         WHERE ah.apply_id = ?1",
                    ) {
                        Ok(s) => s,
                        Err(_) => {
                            let _ = app_clone.emit("apply:cancelled", ());
                            return;
                        }
                    };
                    stmt.query_map(params![apply_id], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, Option<String>>(2)?,
                        ))
                    })
                    .map(|rows| rows.filter_map(|r| r.ok()).collect())
                    .unwrap_or_default()
                } else {
                    vec![]
                };

            // Group by photo_id for undo writes
            let written_set: std::collections::HashSet<&str> =
                written_ids.iter().map(|s| s.as_str()).collect();

            // Build per-photo undo writes
            let mut undo_by_photo: HashMap<String, Vec<(String, Option<String>)>> =
                HashMap::new();
            for (pid, field, before) in &undo_entries {
                if written_set.contains(pid.as_str()) {
                    undo_by_photo
                        .entry(pid.clone())
                        .or_default()
                        .push((field.clone(), before.clone()));
                }
            }

            let undo_total = undo_by_photo.len();
            let mut undo_done = 0;

            // Undo in reverse order
            for photo_id in written_ids.iter().rev() {
                if let Some(fields) = undo_by_photo.get(photo_id) {
                    let file_path =
                        photo_file_paths.get(photo_id).cloned().unwrap_or_default();
                    let undo_write = history_to_photo_write(photo_id, &file_path, fields);
                    if let Ok(mut et) = exiftool.lock() {
                        let _ =
                            crate::write_metadata::write_metadata(&mut et, &undo_write);
                    }
                    // Restore SQLite
                    if let Ok(conn) = db.lock() {
                        for (field, before) in fields {
                            let _ = conn.execute(
                                "INSERT INTO metadata_current (photo_id, field, value, is_pending)
                                 VALUES (?1, ?2, ?3, 1)
                                 ON CONFLICT(photo_id, field)
                                 DO UPDATE SET value = excluded.value, is_pending = 1",
                                params![photo_id, field, before],
                            );
                        }
                    }
                    undo_done += 1;
                    let _ = app_clone.emit(
                        "apply:undo_progress",
                        UndoProgressEvent {
                            done: undo_done,
                            total: undo_total,
                        },
                    );
                }
            }

            // Clean up the partial apply record
            if let Ok(conn) = db.lock() {
                let _ = conn.execute(
                    "DELETE FROM apply_history WHERE apply_id = ?1",
                    params![apply_id],
                );
                let _ = conn.execute(
                    "DELETE FROM apply_ops WHERE id = ?1",
                    params![apply_id],
                );
            }

            let _ = app_clone.emit("apply:cancelled", ());
        } else {
            // Normal completion — clean up apply_ops if all failed
            if written_ids.is_empty() && !failed_files.is_empty() {
                if let Ok(conn) = db.lock() {
                    let _ = conn.execute(
                        "DELETE FROM apply_history WHERE apply_id = ?1",
                        params![apply_id],
                    );
                    let _ = conn.execute(
                        "DELETE FROM apply_ops WHERE id = ?1",
                        params![apply_id],
                    );
                }
            }
            let _ = app_clone.emit(
                "apply:complete",
                ApplyCompleteEvent {
                    failed_files,
                },
            );
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn apply_cancel(state: State<'_, AppState>) -> Result<(), String> {
    state.apply_cancel_flag.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub async fn rollback(
    state: State<'_, AppState>,
) -> Result<RollbackResult, String> {
    let conn = state.db.lock().map_err(|e| format!("db lock: {}", e))?;

    let apply_id: String = conn
        .query_row(
            "SELECT id FROM apply_ops ORDER BY applied_at DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .map_err(|_| "No apply history to roll back".to_string())?;

    // Load apply_history grouped by photo with file paths
    let entries: Vec<(String, String, String, Option<String>)> = {
        let mut stmt = conn
            .prepare(
                "SELECT ah.photo_id, p.file_path, ah.field, ah.value_before
                 FROM apply_history ah
                 JOIN photos p ON p.id = ah.photo_id
                 WHERE ah.apply_id = ?1",
            )
            .map_err(|e| format!("prepare rollback: {}", e))?;
        let rows: Vec<_> = stmt.query_map(params![apply_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| format!("query rollback: {}", e))?
        .filter_map(|r| r.ok())
        .collect();
        rows
    };

    // Group by photo_id
    let mut by_photo: HashMap<String, (String, Vec<(String, Option<String>)>)> = HashMap::new();
    for (photo_id, file_path, field, before) in &entries {
        let entry = by_photo
            .entry(photo_id.clone())
            .or_insert_with(|| (file_path.clone(), vec![]));
        entry.1.push((field.clone(), before.clone()));
    }

    drop(conn); // release lock before ExifTool writes

    let mut failed_files: Vec<FailedFile> = Vec::new();
    let mut restored_ids: Vec<String> = Vec::new();

    for (photo_id, (file_path, fields)) in &by_photo {
        let undo_write = history_to_photo_write(photo_id, file_path, fields);
        let result = {
            let mut et = state
                .exiftool
                .lock()
                .map_err(|e| format!("exiftool lock: {}", e))?;
            crate::write_metadata::write_metadata(&mut et, &undo_write)
        };
        match result {
            Ok(()) => restored_ids.push(photo_id.clone()),
            Err(e) => failed_files.push(FailedFile {
                photo_id: photo_id.clone(),
                file_path: file_path.clone(),
                error: e,
            }),
        }
    }

    // Restore SQLite for successfully written photos
    let conn = state.db.lock().map_err(|e| format!("db lock: {}", e))?;
    for photo_id in &restored_ids {
        if let Some((_, fields)) = by_photo.get(photo_id) {
            for (field, before) in fields {
                conn.execute(
                    "INSERT INTO metadata_current (photo_id, field, value, is_pending)
                     VALUES (?1, ?2, ?3, 0)
                     ON CONFLICT(photo_id, field)
                     DO UPDATE SET value = excluded.value, is_pending = 0",
                    params![photo_id, field, before],
                )
                .map_err(|e| format!("restore metadata_current: {}", e))?;

                conn.execute(
                    "INSERT INTO metadata_original (photo_id, field, value)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(photo_id, field)
                     DO UPDATE SET value = excluded.value",
                    params![photo_id, field, before],
                )
                .map_err(|e| format!("restore metadata_original: {}", e))?;
            }
        }
    }

    conn.execute(
        "DELETE FROM apply_history WHERE apply_id = ?1",
        params![apply_id],
    )
    .map_err(|e| format!("delete apply_history: {}", e))?;

    conn.execute("DELETE FROM apply_ops WHERE id = ?1", params![apply_id])
        .map_err(|e| format!("delete apply_ops: {}", e))?;

    let remaining: i64 = conn
        .query_row("SELECT COUNT(*) FROM apply_ops", [], |r| r.get(0))
        .unwrap_or(0);

    Ok(RollbackResult {
        can_rollback: remaining > 0,
        failed_files,
    })
}

#[tauri::command]
pub async fn reset_photos(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<ResetResult, String> {
    if ids.is_empty() {
        return Ok(ResetResult { failed_files: vec![] });
    }

    // Load original metadata + file paths
    let by_photo: HashMap<String, (String, Vec<(String, Option<String>)>)> = {
        let conn = state.db.lock().map_err(|e| format!("db lock: {}", e))?;
        let mut result = HashMap::new();
        for photo_id in &ids {
            let file_path: String = conn
                .query_row(
                    "SELECT file_path FROM photos WHERE id = ?1",
                    params![photo_id],
                    |r| r.get(0),
                )
                .unwrap_or_default();

            let fields: Vec<(String, Option<String>)> = {
                let mut stmt = conn
                    .prepare(
                        "SELECT field, value FROM metadata_original WHERE photo_id = ?1",
                    )
                    .map_err(|e| format!("prepare reset: {}", e))?;
                let rows: Vec<_> = stmt.query_map(params![photo_id], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, Option<String>>(1)?,
                    ))
                })
                .map_err(|e| format!("query reset: {}", e))?
                .filter_map(|r| r.ok())
                .collect();
                rows
            };

            result.insert(photo_id.clone(), (file_path, fields));
        }
        result
    };

    let mut failed_files: Vec<FailedFile> = Vec::new();

    for photo_id in &ids {
        if let Some((file_path, fields)) = by_photo.get(photo_id) {
            let reset_write = history_to_photo_write(photo_id, file_path, fields);
            let result = {
                let mut et = state
                    .exiftool
                    .lock()
                    .map_err(|e| format!("exiftool lock: {}", e))?;
                crate::write_metadata::write_metadata(&mut et, &reset_write)
            };
            match result {
                Ok(()) => {
                    let conn = state.db.lock().map_err(|e| format!("db lock: {}", e))?;
                    for (field, value) in fields {
                        let _ = conn.execute(
                            "INSERT INTO metadata_current (photo_id, field, value, is_pending)
                             VALUES (?1, ?2, ?3, 0)
                             ON CONFLICT(photo_id, field)
                             DO UPDATE SET value = excluded.value, is_pending = 0",
                            params![photo_id, field, value],
                        );
                    }
                }
                Err(e) => {
                    failed_files.push(FailedFile {
                        photo_id: photo_id.clone(),
                        file_path: file_path.clone(),
                        error: e,
                    });
                }
            }
        }
    }

    Ok(ResetResult { failed_files })
}
