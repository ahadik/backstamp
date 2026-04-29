use crate::thumbnail;
use crate::AppState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

const SUPPORTED_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "tif", "tiff", "heic", "dng", "cr3", "cr2", "nef", "arw", "raf", "orf",
    "rw2", "pef",
];

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    pub capture_date: Option<String>,
    pub capture_time: Option<String>,
    pub timezone: Option<String>,
    pub gps_lat: Option<f64>,
    pub gps_lng: Option<f64>,
    pub camera_body: Option<String>,
    pub lens: Option<String>,
    pub film: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PhotoData {
    id: String,
    file_path: String,
    thumbnail_small: String,
    thumbnail_large: String,
    file_status: String,
    metadata: Metadata,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ImportStartPayload {
    total: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ImportProgressPayload {
    done: usize,
    total: usize,
    photo: Option<PhotoData>,
    error: Option<String>,
}

fn is_supported(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| SUPPORTED_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn already_imported(
    db: &Arc<Mutex<rusqlite::Connection>>,
    file_path: &str,
) -> bool {
    db.lock()
        .ok()
        .and_then(|conn| {
            conn.query_row(
                "SELECT 1 FROM photos WHERE file_path = ?1",
                params![file_path],
                |_| Ok(true),
            )
            .ok()
        })
        .unwrap_or(false)
}

fn parse_metadata(json: &serde_json::Value) -> Metadata {
    let xmp_dt = json
        .get("XMP:DateTimeOriginal")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty());

    let exif_dt = json
        .get("DateTimeOriginal")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty());

    // Prefer XMP (ISO 8601 with offset), fall back to EXIF
    let (capture_date, capture_time) = if let Some(xmp) = xmp_dt {
        parse_xmp_datetime(xmp)
    } else if let Some(exif) = exif_dt {
        parse_exif_datetime(exif)
    } else {
        (None, None)
    };

    let gps_lat = parse_gps_coord(
        json.get("GPSLatitude").and_then(|v| v.as_str()),
        json.get("GPSLatitudeRef").and_then(|v| v.as_str()),
    );
    let gps_lng = parse_gps_coord(
        json.get("GPSLongitude").and_then(|v| v.as_str()),
        json.get("GPSLongitudeRef").and_then(|v| v.as_str()),
    );

    let make = json
        .get("Make")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let model = json
        .get("Model")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let camera_body = if make.is_empty() && model.is_empty() {
        None
    } else {
        Some(format!("{} {}", make, model).trim().to_string())
    };

    let lens = json
        .get("LensModel")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.trim().to_string());

    Metadata {
        capture_date,
        capture_time,
        timezone: None,
        gps_lat,
        gps_lng,
        camera_body,
        lens,
        film: None,
    }
}

/// Parse EXIF datetime "YYYY:MM:DD HH:MM:SS" into (date, time).
fn parse_exif_datetime(s: &str) -> (Option<String>, Option<String>) {
    let parts: Vec<&str> = s.splitn(2, ' ').collect();
    if parts.len() < 2 {
        return (None, None);
    }
    let date = parts[0].replace(':', "-");
    let time = parts[1].to_string();
    if date.len() == 10 && time.len() >= 8 {
        (Some(date), Some(time[..8].to_string()))
    } else {
        (None, None)
    }
}

/// Parse XMP ISO 8601 datetime "YYYY-MM-DDTHH:MM:SS±HH:MM" into (date, time).
fn parse_xmp_datetime(s: &str) -> (Option<String>, Option<String>) {
    if let Some(t_pos) = s.find('T') {
        let date = &s[..t_pos];
        let rest = &s[t_pos + 1..];
        // Strip timezone offset
        let time = rest.split(['+', '-', 'Z']).next().unwrap_or(rest);
        if date.len() == 10 && time.len() >= 8 {
            return (Some(date.to_string()), Some(time[..8].to_string()));
        }
    }
    (None, None)
}

/// Parse GPS coordinate "37.769422" with a direction ref "N"/"S"/"E"/"W".
fn parse_gps_coord(value: Option<&str>, reference: Option<&str>) -> Option<f64> {
    let s = value?.trim();
    // ExifTool coordFormat "%.6f" returns "37.769422 N" or just "37.769422"
    let (num_str, dir_from_value) = if let Some(sp) = s.find(' ') {
        (&s[..sp], Some(s[sp + 1..].trim()))
    } else {
        (s, None)
    };
    let value: f64 = num_str.parse().ok()?;
    let dir = dir_from_value.or(reference)?;
    if dir == "S" || dir == "W" {
        Some(-value)
    } else {
        Some(value)
    }
}

fn insert_photo(
    db: &Arc<Mutex<rusqlite::Connection>>,
    id: &str,
    file_path: &str,
    metadata: &Metadata,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| format!("db lock: {}", e))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    conn.execute(
        "INSERT OR IGNORE INTO photos (id, file_path, added_at) VALUES (?1, ?2, ?3)",
        params![id, file_path, now],
    )
    .map_err(|e| format!("insert photo: {}", e))?;

    let fields: Vec<(&str, Option<String>)> = vec![
        ("capture_date", metadata.capture_date.clone()),
        ("capture_time", metadata.capture_time.clone()),
        ("timezone", metadata.timezone.clone()),
        (
            "gps_lat",
            metadata.gps_lat.map(|v| v.to_string()),
        ),
        (
            "gps_lng",
            metadata.gps_lng.map(|v| v.to_string()),
        ),
        ("camera_body", metadata.camera_body.clone()),
        ("lens", metadata.lens.clone()),
        ("film", metadata.film.clone()),
    ];

    for (field, value) in &fields {
        if let Some(v) = value {
            conn.execute(
                "INSERT OR REPLACE INTO metadata_original (photo_id, field, value) VALUES (?1, ?2, ?3)",
                params![id, field, v],
            )
            .map_err(|e| format!("insert metadata_original: {}", e))?;
            conn.execute(
                "INSERT OR REPLACE INTO metadata_current (photo_id, field, value, is_pending) VALUES (?1, ?2, ?3, 0)",
                params![id, field, v],
            )
            .map_err(|e| format!("insert metadata_current: {}", e))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn import_photos(
    paths: Vec<String>,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let db = Arc::clone(&state.db);
    let exiftool = Arc::clone(&state.exiftool);
    let thumbnails_dir = state.thumbnails_dir.clone();

    std::thread::spawn(move || {
        let filtered: Vec<String> = paths
            .into_iter()
            .filter(|p| is_supported(Path::new(p)) && !already_imported(&db, p))
            .collect();

        let total = filtered.len();
        let _ = app_handle.emit("import:start", ImportStartPayload { total });

        for (i, path_str) in filtered.iter().enumerate() {
            let file_path = Path::new(path_str);
            let done = i + 1;

            let result = process_one_file(file_path, &thumbnails_dir, &db, &exiftool);

            match result {
                Ok(photo) => {
                    let _ = app_handle.emit(
                        "import:progress",
                        ImportProgressPayload {
                            done,
                            total,
                            photo: Some(photo),
                            error: None,
                        },
                    );
                }
                Err(e) => {
                    let _ = app_handle.emit(
                        "import:progress",
                        ImportProgressPayload {
                            done,
                            total,
                            photo: None,
                            error: Some(format!("{}: {}", path_str, e)),
                        },
                    );
                }
            }
        }

        let _ = app_handle.emit("import:complete", ());
    });

    Ok(())
}

fn process_one_file(
    file_path: &Path,
    thumbnails_dir: &std::path::Path,
    db: &Arc<Mutex<rusqlite::Connection>>,
    exiftool: &Arc<Mutex<crate::exiftool::ExiftoolProcess>>,
) -> Result<PhotoData, String> {
    let mut et = exiftool.lock().map_err(|e| format!("exiftool lock: {}", e))?;

    let thumb_paths =
        thumbnail::generate_thumbnails(file_path, thumbnails_dir, &mut et)?;

    let metadata_json = et.read_metadata(file_path)?;
    drop(et);

    let metadata = parse_metadata(&metadata_json);
    let id = Uuid::new_v4().to_string();
    let path_str = file_path.to_string_lossy().to_string();

    insert_photo(db, &id, &path_str, &metadata)?;

    Ok(PhotoData {
        id,
        file_path: path_str,
        thumbnail_small: thumb_paths.small.to_string_lossy().to_string(),
        thumbnail_large: thumb_paths.large.to_string_lossy().to_string(),
        file_status: "ok".to_string(),
        metadata,
    })
}

#[tauri::command]
pub async fn remove_photos(
    ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| format!("db lock: {}", e))?;
    for id in &ids {
        conn.execute("DELETE FROM photos WHERE id = ?1", params![id])
            .map_err(|e| format!("delete photo: {}", e))?;
        conn.execute(
            "DELETE FROM metadata_original WHERE photo_id = ?1",
            params![id],
        )
        .map_err(|e| format!("delete metadata: {}", e))?;
        conn.execute(
            "DELETE FROM metadata_current WHERE photo_id = ?1",
            params![id],
        )
        .map_err(|e| format!("delete metadata: {}", e))?;
    }
    Ok(())
}
