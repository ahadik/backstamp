# Phase 9: GPX Import and Auto-Tagging

**Goal:** Enable drag-and-drop import of `.gpx` files; parse track points in Rust; display GPX tiles at the bottom of the photo grid with route thumbnails; render routes in the Map Panel (already wired in Phase 8); and provide "Locate Photos on GPX" auto-tagging in the Inspector Panel Location section.

**Prerequisites:** Phase 8 complete. `GpxFile` interface is defined in `SessionContext.tsx`. `ADD_GPX` / `REMOVE_GPX` reducer actions exist and are handled. `gpxFiles` array is in `SessionState`. Map Panel's `syncGpxLayers` reads `session.gpxFiles`. `gpx_files` SQLite table exists (with `id`, `file_path`, `added_at` columns). `gpx.rs` is a stub.

---

## Step 1 — Rust: GPX Parsing

**Deliverable:** `gpx.rs` parses a GPX file to a `Vec` of track points with lat, lng, and UTC epoch. A second function checks whether a new file's timestamp range overlaps any stored file.

### Add dependency

**File:** `src-tauri/Cargo.toml`

```toml
gpx = "0.9"
```

The `gpx` crate parses GPX XML with full support for `<trkseg>`, `<trkpt>`, and the `<time>` element. It depends on `quick-xml` internally — no additional dependencies needed.

### `src-tauri/src/gpx.rs`

Replace the stub entirely:

```rust
use gpx::{read, Gpx};
use std::io::BufReader;
use std::fs::File;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TrackPoint {
    pub lat: f64,
    pub lng: f64,
    /// Unix epoch seconds (UTC)
    pub timestamp: i64,
}

/// Parse a GPX file and return all track points sorted by timestamp.
/// Returns an error if the file cannot be read or parsed.
pub fn parse_gpx(path: &str) -> Result<Vec<TrackPoint>, String> {
    let file = File::open(path).map_err(|e| format!("open {path}: {e}"))?;
    let reader = BufReader::new(file);
    let gpx: Gpx = read(reader).map_err(|e| format!("parse {path}: {e}"))?;

    let mut points: Vec<TrackPoint> = gpx
        .tracks
        .iter()
        .flat_map(|t| t.segments.iter())
        .flat_map(|s| s.points.iter())
        .filter_map(|wp| {
            let lat = wp.point().y();
            let lng = wp.point().x();
            let ts = wp.time?.timestamp();
            Some(TrackPoint { lat, lng, timestamp: ts })
        })
        .collect();

    points.sort_by_key(|p| p.timestamp);
    Ok(points)
}

/// Return the [min_ts, max_ts] range for a set of track points, or None if empty.
pub fn timestamp_range(points: &[TrackPoint]) -> Option<(i64, i64)> {
    if points.is_empty() {
        return None;
    }
    let min = points.first().unwrap().timestamp;
    let max = points.last().unwrap().timestamp;
    Some((min, max))
}

/// Returns true if [a_min, a_max] and [b_min, b_max] overlap (inclusive).
pub fn ranges_overlap(a: (i64, i64), b: (i64, i64)) -> bool {
    a.0 <= b.1 && b.0 <= a.1
}

/// Find the closest track point to `target_utc_secs`.
/// Returns interpolated lat/lng if `target_utc_secs` falls between two points;
/// returns exact point if it falls on or within `tolerance_secs` of a point.
/// Returns None if no point is within tolerance.
pub fn match_to_track(
    points: &[TrackPoint],
    target_utc_secs: i64,
    tolerance_secs: i64,
) -> Option<(f64, f64)> {
    if points.is_empty() {
        return None;
    }

    // Binary search for insertion position
    let idx = points.partition_point(|p| p.timestamp <= target_utc_secs);

    // Candidates: the point just before and just after
    let before = idx.checked_sub(1).map(|i| &points[i]);
    let after = points.get(idx);

    match (before, after) {
        (None, Some(p)) => {
            if (p.timestamp - target_utc_secs).abs() <= tolerance_secs {
                Some((p.lat, p.lng))
            } else {
                None
            }
        }
        (Some(p), None) => {
            if (target_utc_secs - p.timestamp).abs() <= tolerance_secs {
                Some((p.lat, p.lng))
            } else {
                None
            }
        }
        (Some(b), Some(a)) => {
            let dist_b = (target_utc_secs - b.timestamp).abs();
            let dist_a = (a.timestamp - target_utc_secs).abs();

            if dist_b <= tolerance_secs || dist_a <= tolerance_secs {
                // Interpolate between b and a proportional to time delta
                let total = (a.timestamp - b.timestamp) as f64;
                if total == 0.0 {
                    return Some((b.lat, b.lng));
                }
                let t = (target_utc_secs - b.timestamp) as f64 / total;
                let lat = b.lat + t * (a.lat - b.lat);
                let lng = b.lng + t * (a.lng - b.lng);
                Some((lat, lng))
            } else {
                None
            }
        }
        (None, None) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pts(data: &[(i64, f64, f64)]) -> Vec<TrackPoint> {
        data.iter()
            .map(|&(ts, lat, lng)| TrackPoint { lat, lng, timestamp: ts })
            .collect()
    }

    #[test]
    fn exact_match() {
        let p = pts(&[(100, 37.0, -122.0)]);
        assert_eq!(match_to_track(&p, 100, 60), Some((37.0, -122.0)));
    }

    #[test]
    fn within_tolerance() {
        let p = pts(&[(100, 37.0, -122.0)]);
        assert_eq!(match_to_track(&p, 145, 60), Some((37.0, -122.0)));
        assert_eq!(match_to_track(&p, 161, 60), None);
    }

    #[test]
    fn interpolation() {
        let p = pts(&[(0, 0.0, 0.0), (100, 10.0, 10.0)]);
        let result = match_to_track(&p, 50, 60);
        assert!(result.is_some());
        let (lat, lng) = result.unwrap();
        assert!((lat - 5.0).abs() < 0.001);
        assert!((lng - 5.0).abs() < 0.001);
    }

    #[test]
    fn overlap_detection() {
        assert!(ranges_overlap((0, 100), (50, 150)));
        assert!(ranges_overlap((0, 100), (100, 200)));
        assert!(!ranges_overlap((0, 99), (100, 200)));
    }

    #[test]
    fn empty_points() {
        assert_eq!(match_to_track(&[], 50, 60), None);
        assert_eq!(timestamp_range(&[]), None);
    }
}
```

---

## Step 2 — Database Migration: Track Points + Thumbnail Path

The existing `gpx_files` table lacks `track_points` and `thumbnail_path` columns. Add a migration.

**File:** `src-tauri/src/session.rs` — in `run_migrations`:

```rust
if version < 5 {
    // Add track_points (JSON) and thumbnail_path columns to gpx_files
    let has_track_pts: bool = conn
        .prepare("SELECT 1 FROM pragma_table_info('gpx_files') WHERE name = 'track_points'")?
        .exists([])?;
    if !has_track_pts {
        conn.execute_batch(
            "ALTER TABLE gpx_files ADD COLUMN track_points TEXT;
             ALTER TABLE gpx_files ADD COLUMN thumbnail_path TEXT;"
        )?;
    }
    conn.pragma_update(None, "user_version", 5i64)?;
}
```

---

## Step 3 — Rust: GPX Commands

Create `src-tauri/src/commands/gpx.rs`.

```rust
use crate::gpx::{match_to_track, parse_gpx, ranges_overlap, timestamp_range, TrackPoint};
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

    // Load existing GPX track_points to check for overlap
    let existing: Vec<(String, Option<String>)> = {
        let mut stmt = conn
            .prepare("SELECT id, track_points FROM gpx_files")
            .map_err(|e| e.to_string())?;
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect()
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

    Ok(GpxFileData {
        id,
        file_path: path,
        added_at,
        track_points: points,
        thumbnail_path: None,
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

/// Save a GPX route thumbnail (raw JPEG bytes from Mapbox Static Images API)
/// to the thumbnails directory and record the path in the database.
/// Returns the absolute path of the saved file.
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
```

Register all three in `commands/mod.rs` and `tauri::generate_handler![]` in `lib.rs`:

**File:** `src-tauri/src/commands/mod.rs` — add:
```rust
pub mod gpx;
```

**File:** `src-tauri/src/lib.rs` — import and register:
```rust
use commands::gpx as gpx_commands;
// ...
.invoke_handler(tauri::generate_handler![
    // ... existing handlers ...
    gpx_commands::import_gpx,
    gpx_commands::remove_gpx,
    gpx_commands::save_gpx_thumbnail,
])
```

---

## Step 4 — Rust: `load_session` Returns GPX Files

**File:** `src-tauri/src/commands/session.rs`

Update `SessionLoadResult` and `load_session` to include GPX files:

```rust
use crate::gpx::TrackPoint;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpxRow {
    pub id: String,
    pub file_path: String,
    pub added_at: i64,
    pub track_points: Vec<TrackPoint>,
    pub thumbnail_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionLoadResult {
    photos: Vec<PhotoRow>,
    gpx_files: Vec<GpxRow>,   // ← change from Vec<serde_json::Value>
    can_rollback: bool,
}
```

In `load_session`, after building `photos`, query GPX files:

```rust
let gpx_files: Vec<GpxRow> = {
    let mut stmt = conn
        .prepare(
            "SELECT id, file_path, added_at, track_points, thumbnail_path
             FROM gpx_files ORDER BY added_at ASC",
        )
        .map_err(|e| e.to_string())?;
    stmt.query_map([], |row| {
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
    .map(|(id, file_path, added_at, tp_json, thumbnail_path)| {
        let track_points: Vec<TrackPoint> = tp_json
            .as_deref()
            .and_then(|j| serde_json::from_str(j).ok())
            .unwrap_or_default();
        GpxRow { id, file_path, added_at, track_points, thumbnail_path }
    })
    .collect()
};

Ok(SessionLoadResult { photos, gpx_files, can_rollback })
```

---

## Step 5 — Frontend: `tauriCommands` Additions

**File:** `src/lib/tauri.ts`

Add the `TrackPoint` type and three new commands:

```typescript
export interface TrackPoint {
  lat: number;
  lng: number;
  timestamp: number; // Unix epoch seconds (UTC)
}

export interface GpxImportResult {
  id: string;
  filePath: string;
  addedAt: number;
  trackPoints: TrackPoint[];
  thumbnailPath: string | null;
}
```

```typescript
importGpx: (path: string) => invoke<GpxImportResult>('import_gpx', { path }),

removeGpx: (id: string) => invoke<void>('remove_gpx', { id }),

saveGpxThumbnail: (id: string, data: number[]) =>
  invoke<string>('save_gpx_thumbnail', { id, data }),
```

Also update `SessionLoadResult` so `gpxFiles` carries track points:

```typescript
export interface SessionLoadResult {
  photos: Array<{ /* ... existing ... */ }>;
  gpxFiles: Array<{
    id: string;
    filePath: string;
    addedAt: number;
    trackPoints: TrackPoint[];
    thumbnailPath: string | null;
  }>;
  canRollback: boolean;
}
```

---

## Step 6 — Frontend: GPX Matching Utility

**File:** `src/lib/gpxMatching.ts` (new)

Pure functions for converting timestamps and matching photos to track points. Keeping this separate from components makes it easily testable.

```typescript
import type { TrackPoint } from './tauri';

/**
 * Convert a wall-clock date + time string interpreted in a given IANA timezone
 * to a Unix epoch in seconds (UTC).
 *
 * Uses the Intl offset trick: treat the input as UTC to get a candidate,
 * determine the TZ offset at that candidate, and subtract. One iteration
 * is sufficient for all non-transition ambiguity cases (DST transitions
 * have at most 1 hour of ambiguity, acceptable for 60s GPX matching).
 */
export function wallClockToUtcSecs(
  date: string, // "YYYY-MM-DD"
  time: string, // "HH:MM:SS"
  timezone: string
): number {
  // Treat input as UTC to get a starting estimate
  const candidateMs = new Date(`${date}T${time}Z`).getTime();

  // What does this UTC moment look like in the target timezone?
  const fmt = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(candidateMs)).reduce<Record<string, string>>(
    (acc, p) => { acc[p.type] = p.value; return acc; },
    {}
  );
  // Reconstruct local time at the candidate as a UTC timestamp (for offset computation)
  const localAtCandidateMs = new Date(
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`
  ).getTime();

  // offset = local - UTC (ms)
  const offsetMs = localAtCandidateMs - candidateMs;

  // UTC = wall-clock - offset
  return Math.round((candidateMs - offsetMs) / 1000);
}

/**
 * Find the best lat/lng for a UTC timestamp from a sorted list of track points.
 * Returns null if no point is within toleranceSecs.
 * Interpolates when the target falls between two consecutive points.
 */
export function matchToTrack(
  points: TrackPoint[],
  targetUtcSecs: number,
  toleranceSecs = 60
): { lat: number; lng: number } | null {
  if (points.length === 0) return null;

  // Find insertion index (first point with timestamp > target)
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].timestamp <= targetUtcSecs) lo = mid + 1;
    else hi = mid;
  }
  const afterIdx = lo;
  const beforeIdx = afterIdx - 1;

  const before = beforeIdx >= 0 ? points[beforeIdx] : null;
  const after = afterIdx < points.length ? points[afterIdx] : null;

  if (!before && after) {
    return Math.abs(after.timestamp - targetUtcSecs) <= toleranceSecs
      ? { lat: after.lat, lng: after.lng }
      : null;
  }
  if (before && !after) {
    return Math.abs(targetUtcSecs - before.timestamp) <= toleranceSecs
      ? { lat: before.lat, lng: before.lng }
      : null;
  }
  if (before && after) {
    const distBefore = Math.abs(targetUtcSecs - before.timestamp);
    const distAfter = Math.abs(after.timestamp - targetUtcSecs);
    if (distBefore > toleranceSecs && distAfter > toleranceSecs) return null;
    const total = after.timestamp - before.timestamp;
    if (total === 0) return { lat: before.lat, lng: before.lng };
    const t = (targetUtcSecs - before.timestamp) / total;
    return {
      lat: before.lat + t * (after.lat - before.lat),
      lng: before.lng + t * (after.lng - before.lng),
    };
  }
  return null;
}

/**
 * Count how many photos from a list would match against a combined set of
 * track points (all GPX files merged). Used to populate confirmation dialogs.
 *
 * Only photos where all of captureDate, captureTime, and timezone are set
 * are candidates. Photos without any of these are skipped (counted as
 * non-matching in the Y denominator).
 */
export function countMatches(
  photos: Array<{
    currentMetadata: { captureDate: string | null; captureTime: string | null; timezone: string | null };
  }>,
  allTrackPoints: TrackPoint[],
  toleranceSecs = 60
): { matching: number; total: number } {
  let matching = 0;
  let total = 0;
  for (const photo of photos) {
    const { captureDate, captureTime, timezone } = photo.currentMetadata;
    if (!captureDate || !captureTime || !timezone) continue;
    total++;
    const utcSecs = wallClockToUtcSecs(captureDate, captureTime, timezone);
    if (matchToTrack(allTrackPoints, utcSecs, toleranceSecs)) {
      matching++;
    }
  }
  return { matching, total };
}
```

---

## Step 7 — Frontend: Drop Handler for GPX Files

Extend `PhotoManager.tsx` to detect `.gpx` drops separately from photo files.

**File:** `src/components/PhotoManager/PhotoManager.tsx`

Add state for GPX confirmation dialog and the auto-tag dialog:

```typescript
const [pendingGpxImport, setPendingGpxImport] = useState<{
  gpxFile: GpxFile;
  matchCount: number;
  totalCount: number;
} | null>(null);
```

Update the `SUPPORTED_EXTENSIONS` constant — GPX files are handled separately, not included here. Add a separate constant:

```typescript
const GPX_EXTENSIONS = new Set(['gpx']);
```

In the `onDrop` handler, split dropped files into photo paths and GPX paths:

```typescript
function onDrop(e: DragEvent) {
  if (!isFileDrag) return;
  e.preventDefault();
  isFileDrag = false;
  setShowDropOverlay(false);

  const files = Array.from(e.dataTransfer?.files ?? []);
  const photoPaths: string[] = [];
  const gpxPaths: string[] = [];

  for (const f of files) {
    const path = (f as File & { path?: string }).path ?? '';
    if (!path) continue;
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    if (SUPPORTED_EXTENSIONS.has(ext)) photoPaths.push(path);
    else if (GPX_EXTENSIONS.has(ext)) gpxPaths.push(path);
  }

  if (photoPaths.length > 0) {
    tauriCommands.importPhotos(photoPaths).catch(console.error);
  }
  for (const gpxPath of gpxPaths) {
    handleGpxDrop(gpxPath);
  }
}
```

Add `handleGpxDrop` as a `useCallback`:

```typescript
const handleGpxDrop = useCallback(async (path: string) => {
  try {
    const result = await tauriCommands.importGpx(path);
    const gpxFile: GpxFile = {
      id: result.id,
      filePath: result.filePath,
      addedAt: result.addedAt,
      trackPoints: result.trackPoints,
      thumbnailPath: null,
    };
    sessionDispatch({ type: 'ADD_GPX', gpxFile });

    // Fetch route thumbnail if Mapbox token is set
    const mapboxToken = /* read from UIContext via ref or pass in */ null; // see note below
    if (mapboxToken && result.trackPoints.length > 0) {
      fetchAndSaveGpxThumbnail(result.id, result.trackPoints, mapboxToken);
    }

    // Count matches across all session photos for the confirmation dialog
    const allPoints = result.trackPoints; // just the new file's points for the import dialog
    const { matching, total } = countMatches(session.photos, allPoints);
    if (total > 0) {
      setPendingGpxImport({ gpxFile, matchCount: matching, totalCount: total });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Show error in a simple alert if overlap detected
    if (msg.includes('overlapping timestamps')) {
      alert(msg); // Replace with a styled dialog if ConfirmDialog supports info-only mode
    } else {
      console.error('[handleGpxDrop]', err);
    }
  }
}, [sessionDispatch, session.photos]);
```

**Note on Mapbox token:** `PhotoManager` doesn't currently receive `mapboxToken` from UIContext. Since `useUI` is already imported in `PhotoManager.tsx`, add:
```typescript
const { state: uiState } = useUI();
```
and use `uiState.mapboxToken` in `handleGpxDrop`.

Add `countMatches` import from `../../lib/gpxMatching`.

Render the auto-tag confirmation dialog when `pendingGpxImport` is set (see Step 8).

---

## Step 8 — Frontend: GPX Thumbnail Generation

**File:** `src/components/PhotoManager/PhotoManager.tsx` (same file, helper function)

Add `fetchAndSaveGpxThumbnail`:

```typescript
async function fetchAndSaveGpxThumbnail(
  gpxId: string,
  trackPoints: TrackPoint[],
  mapboxToken: string
): Promise<void> {
  try {
    // Build a GeoJSON LineString from track points
    const coords = trackPoints.map((p) => [p.lng, p.lat]).join(';');
    // Mapbox Static Images API with GeoJSON overlay
    const geojson = encodeURIComponent(
      JSON.stringify({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: trackPoints.map((p) => [p.lng, p.lat]),
        },
        properties: {},
      })
    );
    const url = `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/geojson(${geojson})/auto/400x200?access_token=${mapboxToken}&padding=20`;

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Mapbox Static Images: ${resp.status}`);
    const buffer = await resp.arrayBuffer();
    const data = Array.from(new Uint8Array(buffer));

    const savedPath = await tauriCommands.saveGpxThumbnail(gpxId, data);

    // Update the GPX file in session state with the thumbnail path
    sessionDispatch({
      type: 'UPDATE_GPX_THUMBNAIL',
      id: gpxId,
      thumbnailPath: savedPath,
    });
  } catch (err) {
    console.error('[fetchAndSaveGpxThumbnail]', err);
    // Non-fatal: tile renders without a thumbnail
  }
}
```

This requires a new `UPDATE_GPX_THUMBNAIL` session action.

**File:** `src/state/SessionContext.tsx`

Add to the action union:
```typescript
| { type: 'UPDATE_GPX_THUMBNAIL'; id: string; thumbnailPath: string }
```

Add to reducer:
```typescript
case 'UPDATE_GPX_THUMBNAIL':
  return {
    ...state,
    gpxFiles: state.gpxFiles.map((g) =>
      g.id === action.id ? { ...g, thumbnailPath: action.thumbnailPath } : g
    ),
  };
```

---

## Step 9 — Frontend: Auto-Tag Dialog on GPX Import

After a GPX import, if any session photos match the new GPX track, show a confirmation dialog asking if the user wants to auto-tag them now.

**File:** `src/components/PhotoManager/PhotoManager.tsx`

Add the dialog render (alongside the existing `ImportModal` and `DropImportOverlay`):

```tsx
{pendingGpxImport && (
  <ConfirmDialog
    title="Auto-Tag Locations from GPX?"
    message={`${pendingGpxImport.matchCount} photo${pendingGpxImport.matchCount === 1 ? '' : 's'} have timestamps that overlap with this GPX track. Auto-tag their locations now?`}
    confirmLabel="Yes"
    cancelLabel="No"
    onConfirm={() => {
      applyGpxAutoTag(
        session.photos,
        pendingGpxImport.gpxFile.trackPoints,
        sessionDispatch
      );
      setPendingGpxImport(null);
    }}
    onCancel={() => setPendingGpxImport(null)}
  />
)}
```

Add `applyGpxAutoTag` helper (can live in `gpxMatching.ts`):

**File:** `src/lib/gpxMatching.ts` — add:

```typescript
import type { Photo } from '../state/SessionContext';
import type { SessionAction } from '../state/SessionContext';

/**
 * For each photo in `photos` that has date, time, and timezone set,
 * find its matching GPS coordinates and dispatch SET_PENDING.
 * Photos with no timezone or no match within tolerance are skipped.
 */
export function applyGpxAutoTag(
  photos: Photo[],
  trackPoints: TrackPoint[],
  dispatch: React.Dispatch<SessionAction>,
  toleranceSecs = 60
): void {
  for (const photo of photos) {
    const { captureDate, captureTime, timezone } = photo.currentMetadata;
    if (!captureDate || !captureTime || !timezone) continue;

    const utcSecs = wallClockToUtcSecs(captureDate, captureTime, timezone);
    const match = matchToTrack(trackPoints, utcSecs, toleranceSecs);
    if (!match) continue;

    dispatch({
      type: 'SET_PENDING',
      ids: [photo.id],
      changes: { gpsLat: match.lat, gpsLng: match.lng },
    });
  }
}
```

Import `React` in `gpxMatching.ts` is needed for `React.Dispatch`. Alternatively, type as `(action: SessionAction) => void` to avoid the React import.

---

## Step 10 — Frontend: GpxSection and GpxTile in PhotoGrid

**File:** `src/components/PhotoManager/PhotoGrid/GpxTile.tsx` (new)

```tsx
import { useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { GpxFile } from '../../../state/SessionContext';
import styles from './GpxTile.module.css';

interface Props {
  gpxFile: GpxFile;
  onRemove: (id: string) => void;
}

export function GpxTile({ gpxFile, onRemove }: Props) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={styles.tile}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {gpxFile.thumbnailPath ? (
        <img
          className={styles.thumbnail}
          src={convertFileSrc(gpxFile.thumbnailPath)}
          alt="GPX route"
        />
      ) : (
        <div className={styles.placeholder}>
          <span className={styles.routeIcon}>〰</span>
        </div>
      )}
      <div className={styles.label}>
        {gpxFile.filePath.split('/').pop()}
      </div>
      {hovered && (
        <button
          className={styles.removeBtn}
          onClick={() => onRemove(gpxFile.id)}
          title="Remove GPX file"
        >
          ✕
        </button>
      )}
    </div>
  );
}
```

**File:** `src/components/PhotoManager/PhotoGrid/GpxTile.module.css` (new)

```css
.tile {
  position: relative;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  cursor: default;
}

.thumbnail {
  width: 100%;
  aspect-ratio: 2 / 1;
  object-fit: cover;
}

.placeholder {
  width: 100%;
  aspect-ratio: 2 / 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-glass-bg);
  font-size: 28px;
  color: var(--color-text-secondary);
}

.label {
  padding: var(--space-1) var(--space-2);
  font-size: 11px;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.removeBtn {
  position: absolute;
  top: var(--space-1);
  right: var(--space-1);
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.removeBtn:hover {
  background: var(--color-danger);
}
```

**File:** `src/components/PhotoManager/PhotoGrid/PhotoGrid.tsx` — add GPX section at the bottom.

At the end of the returned JSX, after the last day block, add:

```tsx
{session.gpxFiles.length > 0 && (
  <div className={styles.gpxSection}>
    <div className={styles.gpxSectionLabel}>GPX Files</div>
    <div className={styles.gpxTiles}>
      {session.gpxFiles.map((gpx) => (
        <GpxTile
          key={gpx.id}
          gpxFile={gpx}
          onRemove={(id) => {
            tauriCommands.removeGpx(id).catch(console.error);
            dispatch({ type: 'REMOVE_GPX', id });
          }}
        />
      ))}
    </div>
  </div>
)}
```

Add to `PhotoGrid.module.css`:

```css
.gpxSection {
  padding: var(--space-4) var(--space-4) var(--space-8);
}

.gpxSectionLabel {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-secondary);
  margin-bottom: var(--space-2);
}

.gpxTiles {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.gpxTiles > * {
  width: 180px;
}
```

---

## Step 11 — Frontend: "Locate Photos on GPX" in LocationSection

**File:** `src/components/InspectorPanel/LocationSection/LocationSection.tsx`

Add below the map and coordinate display, inside the `!isEmpty` block:

```tsx
// Imports needed at top of file
import { countMatches, applyGpxAutoTag } from '../../../lib/gpxMatching';
import { ConfirmDialog } from '../../common/ConfirmDialog/ConfirmDialog';
```

Add state for the GPX locate dialog:

```typescript
const [gpxLocateDialog, setGpxLocateDialog] = useState<{
  matchCount: number;
  totalCount: number;
  allPoints: import('../../../lib/tauri').TrackPoint[];
} | null>(null);
```

Read GPX files from session:

```typescript
const { state: session, dispatch } = useSession();
// ... existing code ...
const allTrackPoints = session.gpxFiles.flatMap((g) => g.trackPoints);
```

Compute whether the button is enabled:

```typescript
// All selected photos must have a timezone set, and all must share the same timezone
const timezones = new Set(
  selectedPhotos
    .map((p) => p.currentMetadata.timezone)
    .filter((tz): tz is string => tz != null)
);
const allHaveSameTimezone =
  selectedPhotos.length > 0 &&
  timezones.size === 1 &&
  selectedPhotos.every((p) => p.currentMetadata.timezone != null);

const gpxButtonEnabled =
  session.gpxFiles.length > 0 &&
  allHaveSameTimezone;
```

Add the button and dialog below the timezone mismatch alert:

```tsx
{session.gpxFiles.length > 0 && (
  <div className={styles.gpxLocate}>
    <button
      className="btn btn-secondary"
      disabled={!gpxButtonEnabled}
      title={
        !gpxButtonEnabled
          ? 'All selected photos must have the same timezone set'
          : undefined
      }
      onClick={() => {
        const { matching, total } = countMatches(selectedPhotos, allTrackPoints);
        setGpxLocateDialog({ matchCount: matching, totalCount: total, allPoints: allTrackPoints });
      }}
    >
      Locate Photos on GPX
    </button>
  </div>
)}

{gpxLocateDialog && (
  <ConfirmDialog
    title="Auto-Tag from GPX?"
    message={`${gpxLocateDialog.matchCount} out of ${gpxLocateDialog.totalCount} selected photo${gpxLocateDialog.totalCount === 1 ? '' : 's'} have timestamps that overlap with imported GPX tracks. Auto-tag their locations?`}
    confirmLabel="Yes"
    cancelLabel="No"
    onConfirm={() => {
      applyGpxAutoTag(selectedPhotos, gpxLocateDialog.allPoints, dispatch);
      setGpxLocateDialog(null);
    }}
    onCancel={() => setGpxLocateDialog(null)}
  />
)}
```

Add to `LocationSection.module.css`:

```css
.gpxLocate {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}
```

---

## Step 12 — Frontend: Session Load for GPX Files

**File:** `src/components/PhotoManager/PhotoManager.tsx`

In the `init()` `useEffect`, after dispatching `IMPORT_PHOTOS`, handle GPX files from the loaded session:

```typescript
if (result.gpxFiles.length > 0) {
  for (const g of result.gpxFiles) {
    sessionDispatch({
      type: 'ADD_GPX',
      gpxFile: {
        id: g.id,
        filePath: g.filePath,
        addedAt: g.addedAt,
        trackPoints: g.trackPoints,
        thumbnailPath: g.thumbnailPath,
      },
    });
  }
}
```

Note: GPX thumbnails restored from disk are referenced by absolute path. `convertFileSrc` is only needed for thumbnails in the app data `thumbnails/` directory, which is already granted by the asset protocol scope.

---

## Step 13 — Tests

### Rust (Cargo)

**File:** `src-tauri/src/gpx.rs` — unit tests are already defined in Step 1 (exact match, tolerance, interpolation, overlap detection, empty input).

Add integration tests in `src-tauri/tests/` for the commands (gated with `#[ignore]` if they require actual GPX files on disk):

| Test | Assertion |
|---|---|
| `parse_gpx` on a minimal valid GPX XML string | Returns correct lat/lng/timestamp values |
| `match_to_track` interpolation at midpoint | Lat/lng is exactly halfway between two points |
| `ranges_overlap` symmetric | `overlap(a,b)` == `overlap(b,a)` |
| `import_gpx` rejects overlapping file | Returns `Err` containing "overlapping timestamps" |
| `save_gpx_thumbnail` writes file to disk | File exists at returned path |

### Frontend (Vitest)

**File:** `src/lib/gpxMatching.test.ts` (new)

| Test | Assertion |
|---|---|
| `wallClockToUtcSecs` — Pacific Standard Time | `"2024-01-15"`, `"12:00:00"`, `"America/Los_Angeles"` → `1705341600` (noon PST = 20:00 UTC) |
| `wallClockToUtcSecs` — Pacific Daylight Time (summer) | `"2024-07-15"`, `"12:00:00"`, `"America/Los_Angeles"` → noon PDT = 19:00 UTC |
| `wallClockToUtcSecs` — Tokyo (no DST) | `"2024-03-15"`, `"09:00:00"`, `"Asia/Tokyo"` → 00:00 UTC |
| `matchToTrack` — no points returns null | `[]` → null |
| `matchToTrack` — exact match | ts=100 in `[{ts:100}]` → point coords |
| `matchToTrack` — within tolerance | ts=145 in `[{ts:100}]`, tolerance=60 → point coords |
| `matchToTrack` — outside tolerance returns null | ts=200 in `[{ts:100}]`, tolerance=60 → null |
| `matchToTrack` — interpolation at midpoint | ts=50 in `[{ts:0,lat:0,lng:0},{ts:100,lat:10,lng:10}]` → `{lat:5,lng:5}` |
| `countMatches` — counts photos with matching timestamps | 2 of 3 photos match → `{matching:2,total:3}` |
| `countMatches` — skips photos without timezone | Photo without timezone not counted in total |

**File:** `src/state/SessionContext.test.ts` — add:

| Test | Assertion |
|---|---|
| `ADD_GPX` appends to `gpxFiles` | State `gpxFiles.length` increments by 1 |
| `REMOVE_GPX` removes by id | State `gpxFiles` no longer contains removed id |
| `UPDATE_GPX_THUMBNAIL` updates thumbnailPath | Matching file has new `thumbnailPath` |

**File:** `src/lib/tauri.test.ts` — add:

| Test | Assertion |
|---|---|
| `importGpx` calls `invoke('import_gpx', { path })` | Correct command name and arg shape |
| `removeGpx` calls `invoke('remove_gpx', { id })` | Correct command name and arg shape |
| `saveGpxThumbnail` calls `invoke('save_gpx_thumbnail', { id, data })` | Correct command name and arg shape |

**GpxTile component tests** (`GpxTile.test.tsx`, new):

| Test | Assertion |
|---|---|
| Renders placeholder when `thumbnailPath` is null | Placeholder element in DOM; no `<img>` |
| Renders `<img>` when `thumbnailPath` is set | `<img>` has correct src from `convertFileSrc` |
| Remove button appears on hover | Button not in DOM before hover; visible after `mouseenter` |
| Remove button click calls `onRemove` with correct id | Mock `onRemove` called with `gpxFile.id` |

---

## What this phase does NOT include

- **GPX file picker** — The PRD only describes drag-and-drop for GPX import. A file picker for GPX is not required and is deferred.
- **GPX timezone offset correction UI** — The architecture doc mentions "a way to apply a timezone/offset correction before locating photos." This is deferred; the current implementation requires selected photos to already have the correct timezone set (which is the primary enablement condition for "Locate Photos on GPX").
- **Map Panel selection sync** — Clicking a GPX route or pin on the map to select photos is deferred.
- **GPX thumbnail when Mapbox token is added after import** — Thumbnails are only generated at import time. If the user adds their Mapbox token after importing a GPX file, the thumbnail remains a placeholder for that session.
- **E2E tests** — Require a compiled `.app` bundle; deferred.
