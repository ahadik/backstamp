use crate::thumbnail;
use crate::AppState;
use hex;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

const SUPPORTED_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "tif", "tiff", "heic", "dng", "cr3", "cr2", "nef", "arw", "raf", "orf",
    "rw2", "pef",
];

/// RAW formats whose metadata may live in an XMP sidecar next to the file.
/// Mirrors the frontend's RAW_EXTENSIONS, which decides sidecar pairing at import.
const RAW_EXTENSIONS: &[&str] = &["dng", "cr3", "cr2", "nef", "arw", "raf", "orf", "rw2", "pef"];

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    pub capture_date: Option<String>,
    pub capture_time: Option<String>,
    pub utc_offset: Option<String>,
    pub timezone: Option<String>,
    pub gps_lat: Option<f64>,
    pub gps_lng: Option<f64>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub lens: Option<String>,
    pub film_vendor: Option<String>,
    pub film_type: Option<String>,
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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ImportCompletePayload {
    total: usize,
    skipped: usize,
    /// True when the user cancelled before every file was processed. Every
    /// photo this import had already added is removed again, and the ids of
    /// those photos are listed in `removed_ids` so the frontend can drop them.
    cancelled: bool,
    removed_ids: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RefreshStartPayload {
    total: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RefreshProgressPayload {
    done: usize,
    total: usize,
    error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RefreshCompletePayload {
    total: usize,
    refreshed: usize,
    cancelled: bool,
}

fn is_raw(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| RAW_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn is_supported(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| SUPPORTED_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Extensions worth surfacing when expanding a dropped/selected directory:
/// importable photos plus XMP sidecars and GPX tracks, which the frontend
/// routes through their own import flows.
fn is_importable(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            let ext = e.to_lowercase();
            SUPPORTED_EXTENSIONS.contains(&ext.as_str()) || ext == "xmp" || ext == "gpx"
        })
        .unwrap_or(false)
}

fn collect_importable_files(dir: &Path, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.path());
    for entry in entries {
        // Skip hidden files and directories (.DS_Store, .Trashes, …)
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        // file_type() does not follow symlinks, so a symlinked directory is
        // never recursed into — avoids cycles from links back up the tree.
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if file_type.is_dir() {
            collect_importable_files(&path, out);
        } else if file_type.is_file() && is_importable(&path) {
            out.push(path.to_string_lossy().into_owned());
        }
    }
}

/// Expand any directories among `paths` into the importable files they contain
/// (recursively). Non-directory paths pass through unchanged.
#[tauri::command]
pub async fn expand_import_paths(paths: Vec<String>) -> Vec<String> {
    let mut out = Vec::new();
    for p in paths {
        let path = PathBuf::from(&p);
        if path.is_dir() {
            collect_importable_files(&path, &mut out);
        } else {
            out.push(p);
        }
    }
    out
}

fn already_imported_by_path(db: &Arc<Mutex<rusqlite::Connection>>, path: &str) -> bool {
    db.lock()
        .ok()
        .and_then(|conn| {
            conn.query_row(
                "SELECT 1 FROM photos WHERE file_path = ?1",
                params![path],
                |_| Ok(true),
            )
            .ok()
        })
        .unwrap_or(false)
}

fn already_imported_by_hash(db: &Arc<Mutex<rusqlite::Connection>>, hash: &str) -> bool {
    db.lock()
        .ok()
        .and_then(|conn| {
            conn.query_row(
                "SELECT 1 FROM photos WHERE file_hash = ?1",
                params![hash],
                |_| Ok(true),
            )
            .ok()
        })
        .unwrap_or(false)
}

fn compute_file_hash(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(hex::encode(Sha256::digest(&bytes)))
}

/// Extract the UTC offset string from a datetime string, e.g.
/// "2024-03-15T14:30:00+09:00" → "+09:00", "2024:03:15 14:30:00-08:00" → "-08:00".
/// Handles both ISO 8601 ('T' separator) and EXIF-hybrid (' ' separator) formats.
fn extract_utc_offset_from_xmp(xmp_dt: &str) -> Option<String> {
    let sep_pos = xmp_dt.find('T').or_else(|| xmp_dt.find(' '))?;
    let time_part = &xmp_dt[sep_pos + 1..];
    if time_part.ends_with('Z') {
        return Some("+00:00".to_string());
    }
    // get() rather than indexing: these strings come from photo metadata, and a
    // multibyte character at the wrong byte position must yield None, not a panic.
    let after_hms = time_part.get(8..)?; // skip "HH:MM:SS"
    for sep in ['+', '-'] {
        if let Some(off_pos) = after_hms.find(sep) {
            if let Some(offset) = after_hms[off_pos..].get(..6) {
                return Some(offset.to_string());
            }
        }
    }
    None
}

/// Collect keywords from IPTC:Keywords and XMP:Subject, deduplicated by lowercase.
fn extract_keywords(json: &serde_json::Value) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut keywords: Vec<String> = Vec::new();
    for key in &["IPTC:Keywords", "XMP:Subject"] {
        match json.get(key) {
            Some(serde_json::Value::Array(arr)) => {
                for v in arr {
                    if let Some(s) = v.as_str() {
                        let kw = s.trim().to_lowercase();
                        if !kw.is_empty() && seen.insert(kw.clone()) {
                            keywords.push(kw);
                        }
                    }
                }
            }
            Some(serde_json::Value::String(s)) => {
                for part in s.split([',', ';']) {
                    let kw = part.trim().to_lowercase();
                    if !kw.is_empty() && seen.insert(kw.clone()) {
                        keywords.push(kw);
                    }
                }
            }
            _ => {}
        }
    }
    keywords
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

    let utc_offset = {
        let from_offset_tag = json
            .get("OffsetTimeOriginal")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| if s == "Z" { "+00:00".to_string() } else { s.to_string() });
        from_offset_tag
            .or_else(|| xmp_dt.and_then(extract_utc_offset_from_xmp))
            .or_else(|| exif_dt.and_then(extract_utc_offset_from_xmp))
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
    let camera_make = if make.is_empty() { None } else { Some(make) };
    let camera_model = if model.is_empty() { None } else { Some(model) };

    let lens = json
        .get("LensModel")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.trim().to_string());

    let film_str = json
        .get("FilmStock")
        .or_else(|| json.get("Film"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.trim().to_string());

    let (film_vendor, film_type) = match film_str {
        None => (None, None),
        Some(ref s) => match s.find(' ') {
            Some(pos) => (
                Some(s[..pos].to_string()),
                Some(s[pos + 1..].to_string()),
            ),
            None => (Some(s.clone()), None),
        },
    };

    Metadata {
        capture_date,
        capture_time,
        // `timezone` holds an IANA zone name; EXIF only carries a fixed ±HH:MM
        // offset, which is not one. Leaving it unset keeps the offset available
        // for display while letting the location-based suggestion fill in the
        // real zone, rather than storing a value that resolves to nothing.
        timezone: None,
        utc_offset,
        gps_lat,
        gps_lng,
        camera_make,
        camera_model,
        lens,
        film_vendor,
        film_type,
    }
}

/// Parse EXIF datetime "YYYY:MM:DD HH:MM:SS" into (date, time).
fn parse_exif_datetime(s: &str) -> (Option<String>, Option<String>) {
    let parts: Vec<&str> = s.splitn(2, ' ').collect();
    if parts.len() < 2 {
        return (None, None);
    }
    let date = parts[0].replace(':', "-");
    match parts[1].get(..8) {
        Some(hms) if date.len() == 10 => (Some(date), Some(hms.to_string())),
        _ => (None, None),
    }
}

/// Parse XMP ISO 8601 datetime "YYYY-MM-DDTHH:MM:SS±HH:MM" into (date, time).
fn parse_xmp_datetime(s: &str) -> (Option<String>, Option<String>) {
    if let Some(t_pos) = s.find('T') {
        let date = &s[..t_pos];
        let rest = &s[t_pos + 1..];
        // Strip timezone offset
        let time = rest.split(['+', '-', 'Z']).next().unwrap_or(rest);
        if let Some(hms) = time.get(..8) {
            if date.len() == 10 {
                return (Some(date.to_string()), Some(hms.to_string()));
            }
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

/// Parse the raw JSON string returned by ExifTool (an array with one object per file).
#[allow(dead_code)]
pub(crate) fn parse_exiftool_output(json: &str) -> Result<Metadata, String> {
    let arr: Vec<serde_json::Value> =
        serde_json::from_str(json).map_err(|e| format!("parse JSON: {}", e))?;
    let first = arr
        .into_iter()
        .next()
        .ok_or_else(|| "empty ExifTool output".to_string())?;
    Ok(parse_metadata(&first))
}

fn insert_photo(
    db: &Arc<Mutex<rusqlite::Connection>>,
    id: &str,
    file_path: &str,
    file_hash: Option<&str>,
    metadata: &Metadata,
    keywords: &[String],
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| format!("db lock: {}", e))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    let rows_inserted = conn.execute(
        "INSERT OR IGNORE INTO photos (id, file_path, file_hash, added_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, file_path, file_hash, now],
    )
    .map_err(|e| format!("insert photo: {}", e))?;

    // If the photo was already in the database (INSERT was ignored due to a duplicate
    // file_path), skip all metadata inserts — they reference `id` which was never stored,
    // and would trigger a foreign-key constraint failure.
    if rows_inserted == 0 {
        return Ok(());
    }

    insert_metadata_rows(&conn, id, metadata, keywords)
}

/// Write a photo's import baseline: one `metadata_original` row and one
/// non-pending `metadata_current` row per populated field, plus its keywords.
/// Absent fields get no row at all, which is what `reset_photos_in_db` relies
/// on to tell "absent at import" from "present but empty".
fn insert_metadata_rows(
    conn: &rusqlite::Connection,
    id: &str,
    metadata: &Metadata,
    keywords: &[String],
) -> Result<(), String> {
    let fields: Vec<(&str, Option<String>)> = vec![
        ("capture_date", metadata.capture_date.clone()),
        ("capture_time", metadata.capture_time.clone()),
        ("utc_offset", metadata.utc_offset.clone()),
        ("timezone", metadata.timezone.clone()),
        ("gps_lat", metadata.gps_lat.map(|v| v.to_string())),
        ("gps_lng", metadata.gps_lng.map(|v| v.to_string())),
        ("camera_make", metadata.camera_make.clone()),
        ("camera_model", metadata.camera_model.clone()),
        ("lens", metadata.lens.clone()),
        ("film_vendor", metadata.film_vendor.clone()),
        ("film_type", metadata.film_type.clone()),
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

    for keyword in keywords {
        conn.execute(
            "INSERT OR IGNORE INTO photo_keywords (photo_id, keyword) VALUES (?1, ?2)",
            params![id, keyword],
        )
        .map_err(|e| format!("insert keyword: {}", e))?;
    }

    Ok(())
}

/// Replace a photo's session metadata with freshly read on-disk values, as if
/// it had just been imported: the baseline and current values both become the
/// disk values, every pending edit is dropped, and fields no longer present on
/// disk lose their rows. Atomic per photo.
pub(crate) fn replace_photo_metadata(
    conn: &rusqlite::Connection,
    id: &str,
    metadata: &Metadata,
    keywords: &[String],
) -> Result<(), String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("refresh transaction: {}", e))?;
    for table in ["photo_keywords", "metadata_current", "metadata_original"] {
        tx.execute(
            &format!("DELETE FROM {} WHERE photo_id = ?1", table),
            params![id],
        )
        .map_err(|e| format!("refresh clear {}: {}", table, e))?;
    }
    insert_metadata_rows(&tx, id, metadata, keywords)?;
    tx.commit().map_err(|e| format!("refresh commit: {}", e))
}

/// Forget every recorded Apply. Used when the session baseline is re-read from
/// disk: the recorded before/after values describe files as they were at the
/// old baseline, so rolling them back could clobber changes made elsewhere.
pub(crate) fn clear_apply_history(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch("DELETE FROM apply_history; DELETE FROM apply_ops;")
        .map_err(|e| format!("clear apply history: {}", e))
}

/// XMP extensions to check, in order of preference.
const XMP_EXTENSIONS: &[&str] = &["xmp", "XMP"];

fn find_sidecar_for(raw_path: &Path) -> Option<PathBuf> {
    let stem = raw_path.file_stem()?;
    let dir = raw_path.parent()?;
    for ext in XMP_EXTENSIONS {
        let candidate = dir.join(stem).with_extension(ext);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarSearchResult {
    found: HashMap<String, String>,
    missing: Vec<String>,
}

/// Check whether XMP sidecar files exist alongside each RAW path.
#[tauri::command]
pub async fn find_xmp_sidecars(raw_paths: Vec<String>) -> SidecarSearchResult {
    let mut found = HashMap::new();
    let mut missing = Vec::new();
    for raw_path in raw_paths {
        match find_sidecar_for(Path::new(&raw_path)) {
            Some(xmp) => {
                found.insert(raw_path, xmp.to_string_lossy().into_owned());
            }
            None => missing.push(raw_path),
        }
    }
    SidecarSearchResult { found, missing }
}

#[tauri::command]
pub async fn import_photos(
    paths: Vec<String>,
    sidecar_map: HashMap<String, String>,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let db = Arc::clone(&state.db);
    let exiftool = Arc::clone(&state.exiftool);
    let thumbnails_dir = state.thumbnails_dir.clone();
    let cancel_flag = Arc::clone(&state.import_cancel_flag);
    cancel_flag.store(false, Ordering::Relaxed);

    std::thread::spawn(move || {
        // Phase 1: extension filter
        let extension_ok: Vec<String> = paths
            .into_iter()
            .filter(|p| is_supported(Path::new(p)))
            .collect();

        // Phase 2: path dedup only (fast — DB lookups, no disk I/O).
        // Hash dedup is deferred to per-file so import:start fires immediately.
        let mut to_import: Vec<String> = Vec::new();
        let mut skipped: usize = 0;

        for path_str in extension_ok {
            if already_imported_by_path(&db, &path_str) {
                skipped += 1;
            } else {
                to_import.push(path_str);
            }
        }

        let total = to_import.len();
        println!("[import] {} to consider, {} already imported by path", total, skipped);
        let _ = app_handle.emit("import:start", ImportStartPayload { total });

        // Ids of photos this import has inserted so far. If the user cancels,
        // all of them are removed again so a cancelled import leaves no trace.
        let mut imported_ids: Vec<String> = Vec::new();
        let mut cancelled = false;

        for (i, path_str) in to_import.iter().enumerate() {
            // Checked between files: the in-flight file always finishes (it
            // holds the exiftool lock), and is cleaned up below if cancelled.
            if cancel_flag.load(Ordering::Relaxed) {
                cancelled = true;
                println!("[import] cancelled after {} of {}", i, total);
                break;
            }

            let file_path = Path::new(path_str);
            let sidecar_path = sidecar_map.get(path_str.as_str()).map(PathBuf::from);
            let done = i + 1;

            // Hash dedup per-file: read once here, reuse the hash in process_one_file.
            let file_hash = match compute_file_hash(file_path) {
                Ok(hash) => {
                    if already_imported_by_hash(&db, &hash) {
                        skipped += 1;
                        println!("[import] ({}/{}) skipping hash duplicate: {}", done, total, path_str);
                        let _ = app_handle.emit(
                            "import:progress",
                            ImportProgressPayload { done, total, photo: None, error: None },
                        );
                        continue;
                    }
                    Some(hash)
                }
                // Unreadable file — attempt import anyway; error surfaces in process_one_file
                Err(_) => None,
            };

            println!("[import] ({}/{}) starting: {}", done, total, path_str);

            let result = process_one_file(
                file_path,
                file_hash.as_deref(),
                sidecar_path.as_deref(),
                &thumbnails_dir,
                &db,
                &exiftool,
            );

            match result {
                Ok(photo) => {
                    println!("[import] ({}/{}) done: {}", done, total, path_str);
                    imported_ids.push(photo.id.clone());
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
                    println!("[import] ({}/{}) error: {} — {}", done, total, path_str, e);
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

        // A cancel that lands while the last file is being processed still
        // counts: the user asked for nothing from this import to remain.
        if !cancelled && cancel_flag.load(Ordering::Relaxed) {
            cancelled = true;
            println!("[import] cancelled after final file");
        }

        let removed_ids = if cancelled {
            println!("[import] removing {} photos from cancelled import", imported_ids.len());
            match db.lock() {
                Ok(conn) => {
                    if let Err(e) = remove_photo_records(&conn, &thumbnails_dir, &imported_ids) {
                        println!("[import] error removing cancelled photos: {}", e);
                    }
                }
                Err(e) => println!("[import] db lock failed during cancel cleanup: {}", e),
            }
            std::mem::take(&mut imported_ids)
        } else {
            Vec::new()
        };

        println!("[import] complete ({} skipped, cancelled: {})", skipped, cancelled);
        let _ = app_handle.emit(
            "import:complete",
            ImportCompletePayload { total, skipped, cancelled, removed_ids },
        );
    });

    Ok(())
}

/// Ask a running import to stop. The import thread checks the flag between
/// files, removes every photo it had added, and emits `import:complete` with
/// `cancelled: true`.
#[tauri::command]
pub async fn import_cancel(state: State<'_, AppState>) -> Result<(), String> {
    state.import_cancel_flag.store(true, Ordering::Relaxed);
    Ok(())
}

/// Re-read metadata from disk for every photo in the session and adopt it as
/// the new import baseline, without re-importing (ids, order, and thumbnails
/// are kept). Pending edits are discarded and Apply history is cleared. Runs
/// on a background thread and reports through `refresh:start`,
/// `refresh:progress`, and `refresh:complete` events.
#[tauri::command]
pub async fn refresh_photos(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let db = Arc::clone(&state.db);
    let exiftool = Arc::clone(&state.exiftool);
    let cancel_flag = Arc::clone(&state.refresh_cancel_flag);
    cancel_flag.store(false, Ordering::Relaxed);

    let photos: Vec<(String, String)> = {
        let conn = db.lock().map_err(|e| format!("db lock: {}", e))?;
        let mut stmt = conn
            .prepare("SELECT id, file_path FROM photos ORDER BY sort_order ASC, added_at ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };

    std::thread::spawn(move || {
        let total = photos.len();
        println!("[refresh] {} photos to refresh", total);
        let _ = app_handle.emit("refresh:start", RefreshStartPayload { total });

        let mut refreshed = 0usize;
        let mut cancelled = false;

        for (i, (id, path_str)) in photos.iter().enumerate() {
            if cancel_flag.load(Ordering::Relaxed) {
                cancelled = true;
                println!("[refresh] cancelled after {} of {}", i, total);
                break;
            }
            let done = i + 1;
            let error = match refresh_one_photo(id, Path::new(path_str), &db, &exiftool) {
                Ok(()) => {
                    refreshed += 1;
                    println!("[refresh] ({}/{}) done: {}", done, total, path_str);
                    None
                }
                Err(e) => {
                    println!("[refresh] ({}/{}) error: {} — {}", done, total, path_str, e);
                    Some(format!("{}: {}", path_str, e))
                }
            };
            let _ = app_handle.emit(
                "refresh:progress",
                RefreshProgressPayload { done, total, error },
            );
        }

        // Any refreshed photo has moved the baseline out from under the
        // recorded Apply history, so the history is unsafe to roll back.
        if refreshed > 0 {
            match db.lock() {
                Ok(conn) => {
                    if let Err(e) = clear_apply_history(&conn) {
                        println!("[refresh] {}", e);
                    }
                }
                Err(e) => println!("[refresh] db lock failed clearing history: {}", e),
            }
        }

        println!("[refresh] complete ({} refreshed, cancelled: {})", refreshed, cancelled);
        let _ = app_handle.emit(
            "refresh:complete",
            RefreshCompletePayload { total, refreshed, cancelled },
        );
    });

    Ok(())
}

/// Ask a running refresh to stop after the in-flight photo. Photos already
/// refreshed keep their new baseline.
#[tauri::command]
pub async fn refresh_cancel(state: State<'_, AppState>) -> Result<(), String> {
    state.refresh_cancel_flag.store(true, Ordering::Relaxed);
    Ok(())
}

fn refresh_one_photo(
    id: &str,
    file_path: &Path,
    db: &Arc<Mutex<rusqlite::Connection>>,
    exiftool: &Arc<Mutex<crate::exiftool::ExiftoolProcess>>,
) -> Result<(), String> {
    if !file_path.exists() {
        return Err("file not found".to_string());
    }
    // Import merges a sidecar for RAW files when the user opts in to a disk
    // search; refresh does the same lookup so a sidecar edited elsewhere is
    // picked up.
    let sidecar = if is_raw(file_path) { find_sidecar_for(file_path) } else { None };

    let metadata_json = {
        let mut et = exiftool.lock().map_err(|e| format!("exiftool lock: {}", e))?;
        match &sidecar {
            Some(xmp) => et.read_metadata_with_sidecar(file_path, xmp)?,
            None => et.read_metadata(file_path)?,
        }
    };

    let metadata = parse_metadata(&metadata_json);
    let keywords = extract_keywords(&metadata_json);
    let conn = db.lock().map_err(|e| format!("db lock: {}", e))?;
    replace_photo_metadata(&conn, id, &metadata, &keywords)
}

fn process_one_file(
    file_path: &Path,
    file_hash: Option<&str>,
    sidecar_path: Option<&Path>,
    thumbnails_dir: &std::path::Path,
    db: &Arc<Mutex<rusqlite::Connection>>,
    exiftool: &Arc<Mutex<crate::exiftool::ExiftoolProcess>>,
) -> Result<PhotoData, String> {
    let mut et = exiftool.lock().map_err(|e| format!("exiftool lock: {}", e))?;

    println!("[import]   generating thumbnails...");
    let thumb_paths = thumbnail::generate_thumbnails(file_path, thumbnails_dir, &mut et)?;

    println!("[import]   reading metadata...");
    let metadata_json = if let Some(xmp) = sidecar_path {
        println!("[import]   merging XMP sidecar: {}", xmp.display());
        et.read_metadata_with_sidecar(file_path, xmp)?
    } else {
        et.read_metadata(file_path)?
    };
    drop(et);

    println!("[import]   inserting into db...");
    let metadata = parse_metadata(&metadata_json);
    let keywords = extract_keywords(&metadata_json);
    let id = Uuid::new_v4().to_string();
    let path_str = file_path.to_string_lossy().to_string();

    insert_photo(db, &id, &path_str, file_hash, &metadata, &keywords)?;

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
pub async fn reorder_photos(
    ordered_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| format!("db lock: {}", e))?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (i, id) in ordered_ids.iter().enumerate() {
        tx.execute(
            "UPDATE photos SET sort_order = ?1 WHERE id = ?2",
            params![i as i64, id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete photos (and their thumbnails and metadata rows) by id. Ids that no
/// longer exist are skipped. Shared by the user-facing remove command and by
/// import cancellation.
fn remove_photo_records(
    conn: &rusqlite::Connection,
    thumbnails_dir: &Path,
    ids: &[String],
) -> Result<(), String> {
    for id in ids {
        let file_path: Option<String> = conn
            .query_row(
                "SELECT file_path FROM photos WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .ok();
        if let Some(path) = file_path {
            let key = thumbnail::path_key(Path::new(&path));
            let _ = std::fs::remove_file(thumbnails_dir.join(format!("{}_small.jpg", key)));
            let _ = std::fs::remove_file(thumbnails_dir.join(format!("{}_large.jpg", key)));
        }
        conn.execute("DELETE FROM photo_keywords WHERE photo_id = ?1", params![id])
            .map_err(|e| format!("delete keywords: {}", e))?;
        conn.execute(
            "DELETE FROM metadata_current WHERE photo_id = ?1",
            params![id],
        )
        .map_err(|e| format!("delete metadata_current: {}", e))?;
        conn.execute(
            "DELETE FROM metadata_original WHERE photo_id = ?1",
            params![id],
        )
        .map_err(|e| format!("delete metadata_original: {}", e))?;
        conn.execute("DELETE FROM photos WHERE id = ?1", params![id])
            .map_err(|e| format!("delete photo: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn remove_photos(
    ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| format!("db lock: {}", e))?;
    remove_photo_records(&conn, &state.thumbnails_dir, &ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seeded_db(ids: &[&str]) -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::session::apply_schema(&conn).unwrap();
        for (i, id) in ids.iter().enumerate() {
            conn.execute(
                "INSERT INTO photos (id, file_path, added_at) VALUES (?1, ?2, ?3)",
                params![id, format!("/photos/{}.jpg", id), i as i64],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO metadata_original (photo_id, field, value) VALUES (?1, 'lens', 'x')",
                params![id],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO metadata_current (photo_id, field, value, is_pending) VALUES (?1, 'lens', 'x', 0)",
                params![id],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO photo_keywords (photo_id, keyword) VALUES (?1, 'kw')",
                params![id],
            )
            .unwrap();
        }
        conn
    }

    fn count(conn: &rusqlite::Connection, table: &str, id_col: &str, id: &str) -> i64 {
        conn.query_row(
            &format!("SELECT COUNT(*) FROM {} WHERE {} = ?1", table, id_col),
            params![id],
            |r| r.get(0),
        )
        .unwrap()
    }

    /// Cancelling an import removes exactly the photos that import added,
    /// including their metadata and keyword rows, and leaves others untouched.
    #[test]
    fn remove_photo_records_removes_only_given_ids() {
        let conn = seeded_db(&["keep", "gone-1", "gone-2"]);
        let dir = tempfile::TempDir::new().unwrap();

        remove_photo_records(
            &conn,
            dir.path(),
            &["gone-1".to_string(), "gone-2".to_string()],
        )
        .unwrap();

        for id in ["gone-1", "gone-2"] {
            assert_eq!(count(&conn, "photos", "id", id), 0);
            assert_eq!(count(&conn, "metadata_original", "photo_id", id), 0);
            assert_eq!(count(&conn, "metadata_current", "photo_id", id), 0);
            assert_eq!(count(&conn, "photo_keywords", "photo_id", id), 0);
        }
        assert_eq!(count(&conn, "photos", "id", "keep"), 1);
        assert_eq!(count(&conn, "metadata_current", "photo_id", "keep"), 1);
    }

    #[test]
    fn remove_photo_records_deletes_thumbnails_and_tolerates_unknown_ids() {
        let conn = seeded_db(&["gone-1"]);
        let dir = tempfile::TempDir::new().unwrap();
        let key = thumbnail::path_key(Path::new("/photos/gone-1.jpg"));
        let small = dir.path().join(format!("{}_small.jpg", key));
        let large = dir.path().join(format!("{}_large.jpg", key));
        std::fs::write(&small, b"s").unwrap();
        std::fs::write(&large, b"l").unwrap();

        remove_photo_records(
            &conn,
            dir.path(),
            &["gone-1".to_string(), "never-existed".to_string()],
        )
        .unwrap();

        assert!(!small.exists());
        assert!(!large.exists());
        assert_eq!(count(&conn, "photos", "id", "gone-1"), 0);
    }

    const SAMPLE_JSON: &str = r#"[{
        "SourceFile": "/photos/test.jpg",
        "DateTimeOriginal": "2024:03:15 14:30:00",
        "GPSLatitude": "37.774929",
        "GPSLatitudeRef": "N",
        "GPSLongitude": "122.419416",
        "GPSLongitudeRef": "W",
        "Make": "Canon",
        "Model": "EOS R5",
        "LensModel": "RF 50mm F1.2 L USM"
    }]"#;

    #[test]
    fn parses_date_and_time() {
        let m = parse_exiftool_output(SAMPLE_JSON).unwrap();
        assert_eq!(m.capture_date.as_deref(), Some("2024-03-15"));
        assert_eq!(m.capture_time.as_deref(), Some("14:30:00"));
    }

    // Metadata strings come from arbitrary photo files; multibyte characters at
    // awkward byte positions must degrade to None, never panic (byte-index
    // slicing here aborted the whole app under panic = "abort").
    #[test]
    fn multibyte_datetime_strings_do_not_panic() {
        for garbage in [
            "2024-03-15Tあいうえおかき",
            "2024:03:15 あいうえおかき",
            "2024-03-15Tああ:あ:ああ+09:00",
            "あいうえおかきくけこ",
            "2024-03-15T14:30:00+あい:うえ",
        ] {
            let _ = extract_utc_offset_from_xmp(garbage);
            let _ = parse_exif_datetime(garbage);
            let _ = parse_xmp_datetime(garbage);
        }
    }

    #[test]
    fn multibyte_time_part_yields_none() {
        assert_eq!(extract_utc_offset_from_xmp("2024-03-15Tあいうえおかき"), None);
        assert_eq!(parse_exif_datetime("2024:03:15 あいうえおかき"), (None, None));
        assert_eq!(parse_xmp_datetime("2024-03-15Tあいうえおかき"), (None, None));
    }

    #[test]
    fn valid_offset_still_extracted_after_boundary_fix() {
        assert_eq!(
            extract_utc_offset_from_xmp("2024-03-15T14:30:00+09:00").as_deref(),
            Some("+09:00")
        );
        assert_eq!(
            extract_utc_offset_from_xmp("2024:03:15 14:30:00-08:00").as_deref(),
            Some("-08:00")
        );
    }

    #[test]
    fn splits_make_and_model() {
        let m = parse_exiftool_output(SAMPLE_JSON).unwrap();
        assert_eq!(m.camera_make.as_deref(), Some("Canon"));
        assert_eq!(m.camera_model.as_deref(), Some("EOS R5"));
    }

    #[test]
    fn parses_lens() {
        let m = parse_exiftool_output(SAMPLE_JSON).unwrap();
        assert_eq!(m.lens.as_deref(), Some("RF 50mm F1.2 L USM"));
    }

    #[test]
    fn parses_gps_lat_positive_for_north() {
        let m = parse_exiftool_output(SAMPLE_JSON).unwrap();
        let lat = m.gps_lat.unwrap();
        assert!((lat - 37.774929).abs() < 1e-5, "lat was {}", lat);
    }

    #[test]
    fn parses_gps_lng_negative_for_west() {
        let m = parse_exiftool_output(SAMPLE_JSON).unwrap();
        let lng = m.gps_lng.unwrap();
        assert!((lng - (-122.419416)).abs() < 1e-5, "lng was {}", lng);
    }

    #[test]
    fn returns_none_for_missing_fields() {
        let m = parse_exiftool_output(r#"[{}]"#).unwrap();
        assert!(m.capture_date.is_none());
        assert!(m.capture_time.is_none());
        assert!(m.utc_offset.is_none());
        assert!(m.camera_make.is_none());
        assert!(m.camera_model.is_none());
        assert!(m.lens.is_none());
        assert!(m.gps_lat.is_none());
        assert!(m.gps_lng.is_none());
        assert!(m.film_vendor.is_none());
        assert!(m.film_type.is_none());
    }

    #[test]
    fn film_is_none_when_no_xmp_film_tags() {
        let m = parse_exiftool_output(SAMPLE_JSON).unwrap();
        assert!(m.film_vendor.is_none());
        assert!(m.film_type.is_none());
    }

    #[test]
    fn parses_film_from_xmp_filmstock_splits_vendor_and_type() {
        let json = r#"[{"FilmStock": "Kodak Portra 400"}]"#;
        let m = parse_exiftool_output(json).unwrap();
        assert_eq!(m.film_vendor.as_deref(), Some("Kodak"));
        assert_eq!(m.film_type.as_deref(), Some("Portra 400"));
    }

    #[test]
    fn parses_film_from_xmp_film_when_filmstock_absent() {
        let json = r#"[{"Film": "Fujifilm Velvia 50"}]"#;
        let m = parse_exiftool_output(json).unwrap();
        assert_eq!(m.film_vendor.as_deref(), Some("Fujifilm"));
        assert_eq!(m.film_type.as_deref(), Some("Velvia 50"));
    }

    #[test]
    fn prefers_xmp_filmstock_over_xmp_film() {
        let json = r#"[{"FilmStock": "Kodak Portra 400", "Film": "other"}]"#;
        let m = parse_exiftool_output(json).unwrap();
        assert_eq!(m.film_vendor.as_deref(), Some("Kodak"));
        assert_eq!(m.film_type.as_deref(), Some("Portra 400"));
    }

    #[test]
    fn utc_offset_is_none_when_no_offset_tags() {
        let m = parse_exiftool_output(SAMPLE_JSON).unwrap();
        assert!(m.utc_offset.is_none());
    }

    #[test]
    fn parses_utc_offset_from_offset_time_original() {
        let json = r#"[{"OffsetTimeOriginal": "+09:00"}]"#;
        let m = parse_exiftool_output(json).unwrap();
        assert_eq!(m.utc_offset.as_deref(), Some("+09:00"));
    }

    #[test]
    fn normalises_z_offset_to_plus_zero() {
        let json = r#"[{"OffsetTimeOriginal": "Z"}]"#;
        let m = parse_exiftool_output(json).unwrap();
        assert_eq!(m.utc_offset.as_deref(), Some("+00:00"));
    }

    #[test]
    fn parses_utc_offset_from_xmp_datetime_fallback() {
        let json = r#"[{"XMP:DateTimeOriginal": "2024-06-15T09:45:30+02:00"}]"#;
        let m = parse_exiftool_output(json).unwrap();
        assert_eq!(m.utc_offset.as_deref(), Some("+02:00"));
    }

    #[test]
    fn timezone_is_always_none() {
        let m = parse_exiftool_output(SAMPLE_JSON).unwrap();
        assert!(m.timezone.is_none());
    }

    #[test]
    fn prefers_xmp_datetime_over_exif() {
        let json = r#"[{
            "DateTimeOriginal": "2020:01:01 00:00:00",
            "XMP:DateTimeOriginal": "2024-06-15T09:45:30+02:00"
        }]"#;
        let m = parse_exiftool_output(json).unwrap();
        assert_eq!(m.capture_date.as_deref(), Some("2024-06-15"));
        assert_eq!(m.capture_time.as_deref(), Some("09:45:30"));
    }

    #[test]
    fn camera_make_and_model_are_none_when_both_missing() {
        let json = r#"[{"LensModel": "some lens"}]"#;
        let m = parse_exiftool_output(json).unwrap();
        assert!(m.camera_make.is_none());
        assert!(m.camera_model.is_none());
    }

    #[test]
    fn returns_error_on_empty_array() {
        let result = parse_exiftool_output(r#"[]"#);
        assert!(result.is_err());
    }

    #[test]
    fn returns_error_on_invalid_json() {
        let result = parse_exiftool_output("not json");
        assert!(result.is_err());
    }

    #[test]
    fn extracts_keywords_from_iptc_array() {
        let json = serde_json::json!({
            "IPTC:Keywords": ["Travel", "Japan", "travel"]
        });
        let kws = extract_keywords(&json);
        assert!(kws.contains(&"travel".to_string()));
        assert!(kws.contains(&"japan".to_string()));
        assert_eq!(kws.len(), 2); // "Travel" and "travel" deduplicated
    }

    #[test]
    fn extracts_keywords_from_xmp_subject_string() {
        let json = serde_json::json!({"XMP:Subject": "cats, dogs"});
        let kws = extract_keywords(&json);
        assert!(kws.contains(&"cats".to_string()));
        assert!(kws.contains(&"dogs".to_string()));
    }

    // ── directory expansion ──────────────────────────────────────────────────

    fn touch(path: &Path) {
        std::fs::write(path, b"").unwrap();
    }

    #[test]
    fn collect_importable_files_recurses_and_filters() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        touch(&root.join("a.jpg"));
        touch(&root.join("a.xmp"));
        touch(&root.join("track.gpx"));
        touch(&root.join("notes.txt"));
        touch(&root.join(".DS_Store"));
        std::fs::create_dir(root.join("nested")).unwrap();
        touch(&root.join("nested/b.CR3"));
        std::fs::create_dir(root.join(".hidden")).unwrap();
        touch(&root.join(".hidden/c.jpg"));

        let mut out = Vec::new();
        collect_importable_files(root, &mut out);
        let names: Vec<&str> = out
            .iter()
            .map(|p| Path::new(p).strip_prefix(root).unwrap().to_str().unwrap())
            .collect();
        assert_eq!(names, vec!["a.jpg", "a.xmp", "nested/b.CR3", "track.gpx"]);
    }

    #[test]
    fn expand_import_paths_passes_files_through_and_expands_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        touch(&root.join("inside.jpg"));
        let loose = root.join("loose.nef");
        touch(&loose);

        let result = tauri::async_runtime::block_on(expand_import_paths(vec![
            loose.to_string_lossy().into_owned(),
            root.to_string_lossy().into_owned(),
        ]));
        assert_eq!(result.len(), 3); // loose.nef passed through + inside.jpg + loose.nef found in dir
        assert_eq!(result[0], loose.to_string_lossy());
    }

    // ── insert_photo duplicate-path guard ────────────────────────────────────
    // Reproduces the FK constraint failure that occurred when INSERT OR IGNORE
    // silently skipped a photo row that already existed (e.g. same file dropped
    // twice), while the metadata INSERT still used the fresh UUID that was never
    // stored, violating the FK on metadata_original.photo_id → photos.id.

    fn make_db() -> Arc<Mutex<rusqlite::Connection>> {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::session::apply_schema(&conn).unwrap();
        // Enable FK enforcement so the bug is detectable in tests even if the
        // production connection happens to have it off.
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        Arc::new(Mutex::new(conn))
    }

    fn empty_meta() -> Metadata {
        Metadata {
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
        }
    }

    #[test]
    fn insert_photo_succeeds_for_new_photo() {
        let db = make_db();
        let result = insert_photo(&db, "id-1", "/photos/a.jpg", None, &empty_meta(), &[]);
        assert!(result.is_ok(), "expected Ok, got {:?}", result);
    }

    #[test]
    fn insert_photo_duplicate_path_does_not_error() {
        let db = make_db();
        // First insert — must succeed
        insert_photo(&db, "id-1", "/photos/a.jpg", None, &empty_meta(), &[]).unwrap();
        // Second insert with same path but a fresh UUID — previously caused a FK
        // violation because the photo row was ignored while metadata rows referenced
        // the new id that was never inserted.
        let result = insert_photo(&db, "id-2", "/photos/a.jpg", None, &empty_meta(), &[]);
        assert!(result.is_ok(), "duplicate path must be silently skipped, got {:?}", result);
    }

    #[test]
    fn insert_photo_with_metadata_duplicate_path_does_not_error() {
        let db = make_db();
        let meta = Metadata {
            capture_date: Some("2024-03-15".to_string()),
            capture_time: Some("14:30:00".to_string()),
            utc_offset: Some("+09:00".to_string()),
            ..empty_meta()
        };
        insert_photo(&db, "id-1", "/photos/b.jpg", None, &meta, &[]).unwrap();
        // Same path, same metadata, different id — must not fail with FK error
        let result = insert_photo(&db, "id-2", "/photos/b.jpg", None, &meta, &[]);
        assert!(result.is_ok(), "duplicate with metadata must be silently skipped, got {:?}", result);
    }

    #[test]
    fn insert_photo_different_paths_both_succeed() {
        let db = make_db();
        insert_photo(&db, "id-1", "/photos/a.jpg", None, &empty_meta(), &[]).unwrap();
        let result = insert_photo(&db, "id-2", "/photos/b.jpg", None, &empty_meta(), &[]);
        assert!(result.is_ok());
    }
    // ── refresh from disk ────────────────────────────────────────────────────

    fn meta_rows(conn: &rusqlite::Connection, table: &str, id: &str) -> Vec<(String, Option<String>)> {
        let mut stmt = conn
            .prepare(&format!("SELECT field, value FROM {} WHERE photo_id = ?1 ORDER BY field", table))
            .unwrap();
        stmt.query_map(params![id], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
    }

    /// Refresh adopts the disk values as both baseline and current, drops the
    /// pending edit, removes fields that are gone from disk, and replaces
    /// keywords — all without touching the photo row itself.
    #[test]
    fn replace_photo_metadata_resets_baseline_and_drops_pending() {
        let db = make_db();
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO photos (id, file_path, file_hash, added_at, sort_order) VALUES ('p', '/photos/p.jpg', 'h', 1, 7)",
            [],
        )
        .unwrap();
        // Import baseline: date + lens; a pending edit on the date; GPS added
        // as a pending edit that was never on disk.
        for (field, value) in [("capture_date", "2024-01-01"), ("lens", "old lens")] {
            conn.execute(
                "INSERT INTO metadata_original (photo_id, field, value) VALUES ('p', ?1, ?2)",
                params![field, value],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO metadata_current (photo_id, field, value, is_pending) VALUES ('p', 'capture_date', '2020-05-05', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO metadata_current (photo_id, field, value, is_pending) VALUES ('p', 'lens', 'old lens', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO metadata_current (photo_id, field, value, is_pending) VALUES ('p', 'gps_lat', '1.5', 1)",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO photo_keywords (photo_id, keyword) VALUES ('p', 'stale')", []).unwrap();

        // Disk now says: a different date, no lens, a camera make.
        let fresh = Metadata {
            capture_date: Some("2024-06-15".to_string()),
            camera_make: Some("Leica".to_string()),
            ..empty_meta()
        };
        replace_photo_metadata(&conn, "p", &fresh, &["fresh".to_string()]).unwrap();

        let expected = vec![
            ("camera_make".to_string(), Some("Leica".to_string())),
            ("capture_date".to_string(), Some("2024-06-15".to_string())),
        ];
        assert_eq!(meta_rows(&conn, "metadata_original", "p"), expected);
        assert_eq!(meta_rows(&conn, "metadata_current", "p"), expected);

        let pending: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM metadata_current WHERE photo_id = 'p' AND is_pending = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(pending, 0, "refresh leaves nothing pending");

        let keywords: Vec<String> = {
            let mut stmt = conn.prepare("SELECT keyword FROM photo_keywords WHERE photo_id = 'p'").unwrap();
            stmt.query_map([], |r| r.get(0)).unwrap().filter_map(|r| r.ok()).collect()
        };
        assert_eq!(keywords, vec!["fresh".to_string()]);

        // Identity, ordering, and dedup hash are untouched: this is not a re-import.
        let (hash, sort_order): (Option<String>, i64) = conn
            .query_row("SELECT file_hash, sort_order FROM photos WHERE id = 'p'", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(hash.as_deref(), Some("h"));
        assert_eq!(sort_order, 7);
    }

    #[test]
    fn replace_photo_metadata_leaves_other_photos_alone() {
        let db = make_db();
        let conn = db.lock().unwrap();
        for id in ["a", "b"] {
            conn.execute(
                "INSERT INTO photos (id, file_path, added_at) VALUES (?1, ?2, 1)",
                params![id, format!("/photos/{}.jpg", id)],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO metadata_current (photo_id, field, value, is_pending) VALUES (?1, 'lens', 'x', 1)",
                params![id],
            )
            .unwrap();
        }

        replace_photo_metadata(&conn, "a", &empty_meta(), &[]).unwrap();

        assert_eq!(meta_rows(&conn, "metadata_current", "a"), vec![]);
        assert_eq!(
            meta_rows(&conn, "metadata_current", "b"),
            vec![("lens".to_string(), Some("x".to_string()))]
        );
    }

    #[test]
    fn clear_apply_history_removes_ops_and_entries() {
        let db = make_db();
        let conn = db.lock().unwrap();
        conn.execute("INSERT INTO photos (id, file_path, added_at) VALUES ('p', '/p.jpg', 1)", []).unwrap();
        conn.execute("INSERT INTO apply_ops (id, applied_at, file_count) VALUES ('op', 1, 1)", []).unwrap();
        conn.execute(
            "INSERT INTO apply_history (apply_id, photo_id, field, value_before, value_after) VALUES ('op', 'p', 'lens', 'a', 'b')",
            [],
        )
        .unwrap();

        clear_apply_history(&conn).unwrap();

        let ops: i64 = conn.query_row("SELECT COUNT(*) FROM apply_ops", [], |r| r.get(0)).unwrap();
        let hist: i64 = conn.query_row("SELECT COUNT(*) FROM apply_history", [], |r| r.get(0)).unwrap();
        assert_eq!((ops, hist), (0, 0));
    }

    #[test]
    fn is_raw_matches_raw_extensions_case_insensitively() {
        assert!(is_raw(Path::new("/a/b.CR3")));
        assert!(is_raw(Path::new("/a/b.dng")));
        assert!(!is_raw(Path::new("/a/b.jpg")));
        assert!(!is_raw(Path::new("/a/b")));
    }
}
