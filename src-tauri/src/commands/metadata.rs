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
    // Phase 1: load history from DB (fast, synchronous)
    let (apply_id, by_photo) = {
        let conn = state.db.lock().map_err(|e| format!("db lock: {}", e))?;

        let apply_id: String = conn
            .query_row(
                "SELECT id FROM apply_ops ORDER BY applied_at DESC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .map_err(|_| "No apply history to roll back".to_string())?;

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

        let mut by_photo: HashMap<String, (String, Vec<(String, Option<String>)>)> = HashMap::new();
        for (photo_id, file_path, field, before) in &entries {
            let entry = by_photo
                .entry(photo_id.clone())
                .or_insert_with(|| (file_path.clone(), vec![]));
            entry.1.push((field.clone(), before.clone()));
        }

        println!("[rollback] apply_id={} photos={}", apply_id, by_photo.len());

        (apply_id, by_photo)
    };

    // Phase 2: write to disk via ExifTool (blocking — run off the async thread pool)
    let exiftool = std::sync::Arc::clone(&state.exiftool);
    let db = std::sync::Arc::clone(&state.db);

    let (failed_files, restored_ids) = tokio::task::spawn_blocking(move || {
        let mut failed_files: Vec<FailedFile> = Vec::new();
        let mut restored_ids: Vec<String> = Vec::new();

        for (photo_id, (file_path, fields)) in &by_photo {
            let undo_write = history_to_photo_write(photo_id, file_path, fields);
            let tag_args = crate::write_metadata::build_exiftool_args(&undo_write);
            println!(
                "[rollback] photo={} fields={} tag_args={}",
                photo_id,
                undo_write.fields.len(),
                tag_args.len()
            );

            if tag_args.is_empty() {
                println!("[rollback] skipping photo {} — no writable fields", photo_id);
                restored_ids.push(photo_id.clone());
                continue;
            }

            let result = {
                match exiftool.lock() {
                    Ok(mut et) => crate::write_metadata::write_metadata(&mut et, &undo_write),
                    Err(e) => Err(format!("exiftool lock: {}", e)),
                }
            };
            match result {
                Ok(()) => {
                    println!("[rollback] restored {}", photo_id);
                    restored_ids.push(photo_id.clone());
                }
                Err(e) => {
                    println!("[rollback] failed {}: {}", photo_id, e);
                    failed_files.push(FailedFile {
                        photo_id: photo_id.clone(),
                        file_path: file_path.clone(),
                        error: e,
                    });
                }
            }
        }

        // Restore SQLite for successfully written photos
        if let Ok(conn) = db.lock() {
            for photo_id in &restored_ids {
                if let Some((_, fields)) = by_photo.get(photo_id) {
                    for (field, before) in fields {
                        let _ = conn.execute(
                            "INSERT INTO metadata_current (photo_id, field, value, is_pending)
                             VALUES (?1, ?2, ?3, 0)
                             ON CONFLICT(photo_id, field)
                             DO UPDATE SET value = excluded.value, is_pending = 0",
                            params![photo_id, field, before],
                        );
                        let _ = conn.execute(
                            "INSERT INTO metadata_original (photo_id, field, value)
                             VALUES (?1, ?2, ?3)
                             ON CONFLICT(photo_id, field)
                             DO UPDATE SET value = excluded.value",
                            params![photo_id, field, before],
                        );
                    }
                }
            }
        }

        (failed_files, restored_ids)
    })
    .await
    .map_err(|e| format!("rollback task: {}", e))?;

    // Phase 3: clean up apply history
    let conn = state.db.lock().map_err(|e| format!("db lock: {}", e))?;

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

    println!(
        "[rollback] done: {} restored, {} failed, {} apply_ops remaining",
        restored_ids.len(),
        failed_files.len(),
        remaining
    );

    Ok(RollbackResult {
        can_rollback: remaining > 0,
        failed_files,
    })
}

/// Reset the given photos' session metadata back to the values present at
/// import. This is a session-only operation: it does NOT write to disk.
///
/// For each field we recompute `is_pending` against the *current on-disk state*
/// so that Apply becomes available exactly when disk is out of sync with the
/// import values (i.e. changes were written to disk earlier this session):
///   - `is_pending = 0` on a field means `metadata_current` already matches disk.
///   - otherwise disk holds the most recent applied value (`apply_history`), or
///     the import value if this field was never applied.
/// A field that only ever existed as a pending edit (absent at import, never
/// applied) is dropped entirely; one that was applied but is absent at import
/// (e.g. GPS added then applied) is queued as a pending clear.
#[tauri::command]
pub async fn reset_photos(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<ResetResult, String> {
    if ids.is_empty() {
        return Ok(ResetResult { failed_files: vec![] });
    }

    let conn = state.db.lock().map_err(|e| format!("db lock: {}", e))?;
    reset_photos_in_db(&conn, &ids)?;
    Ok(ResetResult { failed_files: vec![] })
}

/// Session-only reset of `metadata_current` back to import values, with
/// `is_pending` recomputed against actual disk state. Pure DB work — no disk
/// writes — so it is safe to run against any connection (see `reset_photos`).
pub(crate) fn reset_photos_in_db(
    conn: &rusqlite::Connection,
    ids: &[String],
) -> Result<(), String> {
    for photo_id in ids {
        // Import-time values, keyed by field. Presence of the key means the
        // field existed at import (value may still be NULL).
        let original: HashMap<String, Option<String>> = {
            let mut stmt = conn
                .prepare("SELECT field, value FROM metadata_original WHERE photo_id = ?1")
                .map_err(|e| format!("prepare original: {}", e))?;
            let rows = stmt
                .query_map(params![photo_id], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
                })
                .map_err(|e| format!("query original: {}", e))?;
            rows.filter_map(|r| r.ok()).collect()
        };

        // Latest value written to disk per field, if any Apply ever touched it.
        // Ascending order means the final entry per field wins (the newest).
        let applied: HashMap<String, Option<String>> = {
            let mut stmt = conn
                .prepare(
                    "SELECT ah.field, ah.value_after
                     FROM apply_history ah
                     JOIN apply_ops ao ON ao.id = ah.apply_id
                     WHERE ah.photo_id = ?1
                     ORDER BY ao.applied_at ASC",
                )
                .map_err(|e| format!("prepare applied: {}", e))?;
            let rows = stmt
                .query_map(params![photo_id], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
                })
                .map_err(|e| format!("query applied: {}", e))?;
            rows.filter_map(|r| r.ok()).collect()
        };

        // The current session rows are the set of fields we must reconcile.
        let current: Vec<(String, Option<String>, i64)> = {
            let mut stmt = conn
                .prepare("SELECT field, value, is_pending FROM metadata_current WHERE photo_id = ?1")
                .map_err(|e| format!("prepare current: {}", e))?;
            let rows = stmt
                .query_map(params![photo_id], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, Option<String>>(1)?,
                        r.get::<_, i64>(2)?,
                    ))
                })
                .map_err(|e| format!("query current: {}", e))?;
            rows.filter_map(|r| r.ok()).collect()
        };

        for (field, cur_value, is_pending) in &current {
            // The value actually on disk right now for this field.
            let disk_value: Option<String> = if *is_pending == 0 {
                // Not pending => metadata_current already reflects disk.
                cur_value.clone()
            } else if let Some(v) = applied.get(field) {
                // Pending edit over a previously-applied value.
                v.clone()
            } else {
                // Pending edit that was never applied => disk holds import value.
                original.get(field).cloned().flatten()
            };

            if !original.contains_key(field) {
                // Field did not exist at import (e.g. GPS added later).
                if disk_value.is_none() {
                    // Never written to disk -> discard the pending value entirely.
                    conn.execute(
                        "DELETE FROM metadata_current WHERE photo_id = ?1 AND field = ?2",
                        params![photo_id, field],
                    )
                    .map_err(|e| format!("reset delete: {}", e))?;
                } else {
                    // On disk -> queue a pending clear so Apply removes it.
                    conn.execute(
                        "UPDATE metadata_current SET value = NULL, is_pending = 1
                         WHERE photo_id = ?1 AND field = ?2",
                        params![photo_id, field],
                    )
                    .map_err(|e| format!("reset clear: {}", e))?;
                }
                continue;
            }

            // Field existed at import: restore its value and mark it pending
            // only when disk differs from that import value.
            let target_value: Option<String> = original.get(field).cloned().flatten();
            let pending = if target_value == disk_value { 0 } else { 1 };
            conn.execute(
                "UPDATE metadata_current SET value = ?3, is_pending = ?4
                 WHERE photo_id = ?1 AND field = ?2",
                params![photo_id, field, target_value, pending],
            )
            .map_err(|e| format!("reset restore: {}", e))?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod reset_tests {
    use super::reset_photos_in_db;
    use crate::session::apply_schema;
    use rusqlite::{params, Connection};

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        apply_schema(&conn).unwrap();
        conn
    }

    fn seed_photo(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO photos (id, file_path, added_at) VALUES (?1, ?2, ?3)",
            params![id, format!("/photos/{id}.jpg"), 1_700_000_000i64],
        )
        .unwrap();
    }

    fn orig(conn: &Connection, id: &str, field: &str, value: Option<&str>) {
        conn.execute(
            "INSERT INTO metadata_original (photo_id, field, value) VALUES (?1, ?2, ?3)",
            params![id, field, value],
        )
        .unwrap();
    }

    fn cur(conn: &Connection, id: &str, field: &str, value: Option<&str>, is_pending: i64) {
        conn.execute(
            "INSERT INTO metadata_current (photo_id, field, value, is_pending) VALUES (?1, ?2, ?3, ?4)",
            params![id, field, value, is_pending],
        )
        .unwrap();
    }

    /// Records an Apply of `field` on disk: creates an apply_op + history row and
    /// marks the current value as synced (is_pending = 0), exactly as the real
    /// apply_changes path does.
    fn apply_to_disk(conn: &Connection, id: &str, field: &str, before: Option<&str>, after: Option<&str>) {
        let apply_id = format!("apply-{id}-{field}");
        conn.execute(
            "INSERT INTO apply_ops (id, applied_at, file_count) VALUES (?1, ?2, 1)",
            params![apply_id, 1_700_000_100i64],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO apply_history (apply_id, photo_id, field, value_before, value_after)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![apply_id, id, field, before, after],
        )
        .unwrap();
    }

    fn read(conn: &Connection, id: &str, field: &str) -> Option<(Option<String>, i64)> {
        conn.query_row(
            "SELECT value, is_pending FROM metadata_current WHERE photo_id = ?1 AND field = ?2",
            params![id, field],
            |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, i64>(1)?)),
        )
        .ok()
    }

    // Golden path: user applied a date change to disk, then Reset All. Session
    // reverts to the import value AND stays out of sync with disk, so the field
    // must be pending (Apply re-enabled to write import values back).
    #[test]
    fn applied_then_reset_leaves_pending_so_apply_reenables() {
        let conn = db();
        seed_photo(&conn, "p1");
        orig(&conn, "p1", "capture_date", Some("2024-06-01"));
        // After apply: current == disk == 2020-01-01, synced.
        cur(&conn, "p1", "capture_date", Some("2020-01-01"), 0);
        apply_to_disk(&conn, "p1", "capture_date", Some("2024-06-01"), Some("2020-01-01"));

        reset_photos_in_db(&conn, &["p1".to_string()]).unwrap();

        let (value, pending) = read(&conn, "p1", "capture_date").unwrap();
        assert_eq!(value.as_deref(), Some("2024-06-01"), "reverted to import value");
        assert_eq!(pending, 1, "disk (2020) != import (2024) -> pending -> Apply enabled");
    }

    // Edit-only (never applied) then Reset: session matches disk (both import),
    // so the field is NOT pending (Apply stays disabled).
    #[test]
    fn edited_never_applied_then_reset_has_no_pending() {
        let conn = db();
        seed_photo(&conn, "p2");
        orig(&conn, "p2", "capture_date", Some("2024-06-01"));
        cur(&conn, "p2", "capture_date", Some("2020-01-01"), 1); // pending edit, never applied

        reset_photos_in_db(&conn, &["p2".to_string()]).unwrap();

        let (value, pending) = read(&conn, "p2", "capture_date").unwrap();
        assert_eq!(value.as_deref(), Some("2024-06-01"));
        assert_eq!(pending, 0, "disk == import -> no pending -> Apply disabled");
    }

    // Field added after import (e.g. GPS), never applied: reset drops it entirely.
    #[test]
    fn added_field_never_applied_is_dropped() {
        let conn = db();
        seed_photo(&conn, "p3");
        // no metadata_original for gps_lat
        cur(&conn, "p3", "gps_lat", Some("37.5"), 1);

        reset_photos_in_db(&conn, &["p3".to_string()]).unwrap();

        assert!(read(&conn, "p3", "gps_lat").is_none(), "added-then-reset field removed");
    }

    // Field added after import AND applied to disk: reset queues a pending clear
    // (value NULL, pending) so Apply removes it from disk.
    #[test]
    fn added_field_applied_then_reset_queues_pending_clear() {
        let conn = db();
        seed_photo(&conn, "p4");
        // no metadata_original for gps_lat; applied to disk, so current synced.
        cur(&conn, "p4", "gps_lat", Some("37.5"), 0);
        apply_to_disk(&conn, "p4", "gps_lat", None, Some("37.5"));

        reset_photos_in_db(&conn, &["p4".to_string()]).unwrap();

        let (value, pending) = read(&conn, "p4", "gps_lat").unwrap();
        assert_eq!(value, None, "queued clear -> NULL");
        assert_eq!(pending, 1, "on disk -> pending clear -> Apply enabled");
    }
}
