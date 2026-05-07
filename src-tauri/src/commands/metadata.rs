use crate::AppState;
use rusqlite::params;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    done: usize,
    total: usize,
}

fn camel_to_snake(key: &str) -> &str {
    match key {
        "captureDate" => "capture_date",
        "captureTime" => "capture_time",
        "utcOffset" => "utc_offset",
        "timezone" => "timezone",
        "gpsLat" => "gps_lat",
        "gpsLng" => "gps_lng",
        "cameraBody" => "camera_body",
        "lens" => "lens",
        "film" => "film",
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

    // Reset cancel flag
    state.apply_cancel_flag.store(false, Ordering::Relaxed);

    // Record apply_ops and apply_history in SQLite
    {
        let conn = state.db.lock().map_err(|e| format!("db lock: {}", e))?;

        conn.execute(
            "INSERT INTO apply_ops (id, applied_at, file_count) VALUES (?1, ?2, ?3)",
            params![apply_id, now, total as i64],
        )
        .map_err(|e| format!("insert apply_ops: {}", e))?;

        for (photo_id, fields) in &changes_map {
            for (field_camel, new_val) in fields {
                let field = camel_to_snake(field_camel);
                let new_str = value_to_string(new_val);

                // Read current value as "before"
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
    let cancel_flag = std::sync::Arc::clone(&state.apply_cancel_flag);
    let app_clone = app.clone();

    // Process each photo in a blocking task
    let photo_ids: Vec<(String, HashMap<String, Value>)> = changes_map.into_iter().collect();

    tokio::task::spawn_blocking(move || {
        let mut done = 0usize;
        let mut cancelled_at: Option<usize> = None;

        for (i, (photo_id, fields)) in photo_ids.iter().enumerate() {
            if cancel_flag.load(Ordering::Relaxed) {
                cancelled_at = Some(i);
                break;
            }

            // Update metadata_current in SQLite (mark as applied)
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
                    // Also update metadata_original so Reset works correctly after Apply
                    let _ = conn.execute(
                        "INSERT INTO metadata_original (photo_id, field, value)
                         VALUES (?1, ?2, ?3)
                         ON CONFLICT(photo_id, field)
                         DO UPDATE SET value = excluded.value",
                        params![photo_id, field, new_str],
                    );
                }
            }

            done += 1;
            let _ = app_clone.emit("apply:progress", ProgressEvent { done, total });
        }

        if let Some(cancelled_idx) = cancelled_at {
            // Undo already-written changes by restoring apply_history value_before
            let applied_ids: Vec<&str> = photo_ids[..cancelled_idx]
                .iter()
                .map(|(id, _)| id.as_str())
                .collect();

            // Re-read apply_history for undo
            let undo_entries: Vec<(String, String, Option<String>)> = if let Ok(conn) = db.lock() {
                let mut stmt = match conn.prepare(
                    "SELECT photo_id, field, value_before FROM apply_history WHERE apply_id = ?1",
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

            // Only undo the applied ones
            let undo_set: std::collections::HashSet<&str> =
                applied_ids.iter().copied().collect();
            let to_undo: Vec<_> = undo_entries
                .iter()
                .filter(|(pid, _, _)| undo_set.contains(pid.as_str()))
                .collect();
            let undo_total = to_undo.len();
            let mut undo_done = 0;

            for (photo_id, field, before) in &to_undo {
                if let Ok(conn) = db.lock() {
                    let _ = conn.execute(
                        "INSERT INTO metadata_current (photo_id, field, value, is_pending)
                         VALUES (?1, ?2, ?3, 0)
                         ON CONFLICT(photo_id, field)
                         DO UPDATE SET value = excluded.value, is_pending = 0",
                        params![photo_id, field, before],
                    );
                    // Restore original too
                    let _ = conn.execute(
                        "INSERT INTO metadata_original (photo_id, field, value)
                         VALUES (?1, ?2, ?3)
                         ON CONFLICT(photo_id, field)
                         DO UPDATE SET value = excluded.value",
                        params![photo_id, field, before],
                    );
                }
                undo_done += 1;
                let _ = app_clone.emit(
                    "apply:undo_progress",
                    ProgressEvent { done: undo_done, total: undo_total },
                );
            }

            // Clean up the partial apply_ops record
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
            let _ = app_clone.emit("apply:complete", ());
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
pub async fn rollback(state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| format!("db lock: {}", e))?;

    // Find the most recent apply_ops entry
    let apply_id: String = conn
        .query_row(
            "SELECT id FROM apply_ops ORDER BY applied_at DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .map_err(|_| "No apply history to roll back".to_string())?;

    // Read the apply_history entries for this apply
    let entries: Vec<(String, String, Option<String>)> = {
        let mut stmt = conn
            .prepare(
                "SELECT photo_id, field, value_before FROM apply_history WHERE apply_id = ?1",
            )
            .map_err(|e| format!("prepare rollback: {}", e))?;
        let rows = stmt.query_map(params![apply_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|e| format!("query rollback: {}", e))?
        .filter_map(|r| r.ok())
        .collect();
        rows
    };

    // Restore metadata_current to value_before
    for (photo_id, field, before) in &entries {
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

    // Delete the apply_history and apply_ops for this operation
    conn.execute(
        "DELETE FROM apply_history WHERE apply_id = ?1",
        params![apply_id],
    )
    .map_err(|e| format!("delete apply_history: {}", e))?;

    conn.execute("DELETE FROM apply_ops WHERE id = ?1", params![apply_id])
        .map_err(|e| format!("delete apply_ops: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn reset_photos(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    let conn = state.db.lock().map_err(|e| format!("db lock: {}", e))?;

    for photo_id in &ids {
        // Read metadata_original fields
        let fields: Vec<(String, Option<String>)> = {
            let mut stmt = conn
                .prepare("SELECT field, value FROM metadata_original WHERE photo_id = ?1")
                .map_err(|e| format!("prepare reset: {}", e))?;
            let rows = stmt.query_map(params![photo_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
            })
            .map_err(|e| format!("query reset: {}", e))?
            .filter_map(|r| r.ok())
            .collect();
            rows
        };

        // Restore metadata_current from original
        for (field, value) in &fields {
            conn.execute(
                "INSERT INTO metadata_current (photo_id, field, value, is_pending)
                 VALUES (?1, ?2, ?3, 0)
                 ON CONFLICT(photo_id, field)
                 DO UPDATE SET value = excluded.value, is_pending = 0",
                params![photo_id, field, value],
            )
            .map_err(|e| format!("reset metadata_current: {}", e))?;
        }
    }

    Ok(())
}
