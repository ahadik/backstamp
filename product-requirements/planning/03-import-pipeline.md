# Phase 2: Full Import Pipeline with Metadata Reading

Goal: extend the Phase 1 thumbnail-import foundation into a complete, production-ready pipeline. After this phase, the app reads every supported metadata field accurately (including UTC offset and film stock from XMP), photos persist across app restarts via a working session load, and photos can be removed individually or in bulk. A user can import a folder of photos, quit the app, reopen it, and find their session intact.

---

## Step 1 — File Content Hashing

**Deliverable:** Every imported photo records a SHA-256 hash of its file bytes in the `file_hash` column of the `photos` table.

The `file_hash` column exists in the schema but Phase 1 left it `NULL`. Add a helper in `src-tauri/src/commands/photos.rs`:

```rust
fn compute_file_hash(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(hex::encode(Sha256::digest(&bytes)))
}
```

Call this in the import loop and pass the result into the `INSERT INTO photos` statement. Reading the full file for hashing is acceptable: SHA-256 over a 50MB RAW file completes in ~40ms on Apple Silicon. The hash is computed once at import time and never recomputed.

**Note on two distinct hashes used in this codebase:**

- **Thumbnail key** = `sha256(file_path bytes)` — used to name thumbnail files on disk (established in Phase 1, never changes).
- **`file_hash`** = `sha256(file content bytes)` — stored in the `photos` table, used for content-based deduplication.

These serve different purposes and must not be conflated. The thumbnail key is always rederivable from `file_path`; no separate column is needed for it.

---

## Step 2 — Extended Metadata Extraction

**Deliverable:** All metadata fields are populated on import: `capture_date`, `capture_time`, `utc_offset` (new field), `gps_lat`, `gps_lng`, `camera_body`, `lens`, `film`. The `timezone` IANA field remains `None` — GPS-to-IANA lookup requires `tzf-rs` and is Phase 6.

### New field: `utc_offset`

Add `utc_offset: Option<String>` to the `Metadata` struct in `src-tauri/src/commands/photos.rs`. This stores the raw UTC offset string from EXIF/XMP (e.g. `"+09:00"`, `"-07:00"`, `"+00:00"`). It is distinct from `timezone` (an IANA name) and requires no GPS lookup.

Update the TypeScript `Metadata` interface in `src/state/SessionContext.tsx`:

```typescript
interface Metadata {
  captureDate: string | null;
  captureTime: string | null;
  utcOffset: string | null;   // raw offset from EXIF OffsetTimeOriginal, e.g. "+09:00"
  timezone: string | null;    // IANA name — resolved from GPS in Phase 6
  gpsLat: number | null;
  gpsLng: number | null;
  cameraBody: string | null;
  lens: string | null;
  film: string | null;
}
```

Update all downstream TypeScript references: `src/lib/tauri.ts` (`ApplyPayload`, `SessionLoadResult`), and any component that reads from `Metadata`.

### Updated ExifTool invocation

Extend the tag list in `exiftool.rs`'s `read_metadata` call:

```
-json -coordFormat "%.6f"
-DateTimeOriginal -OffsetTimeOriginal
-GPSLatitude -GPSLongitude
-Make -Model -LensModel
-XMP:DateTimeOriginal
-XMP:Film -XMP:FilmStock
```

New tags and their parsing rules in `parse_exiftool_output`:

- **`OffsetTimeOriginal`** — Take the raw string verbatim (e.g. `"+09:00"`). Normalize the literal string `"Z"` → `"+00:00"`. Store as `utc_offset`. If absent, fall back to extracting the offset portion from `XMP:DateTimeOriginal` when it is a full ISO 8601 string with offset (e.g. `"2024-03-15T14:30:00+09:00"` → `"+09:00"`).
- **`XMP:FilmStock`** — Preferred source for `film`. Take the raw string, trim whitespace.
- **`XMP:Film`** — Fallback if `XMP:FilmStock` is absent. Trim whitespace. If both are absent, `film` remains `None`.

### Schema extension: keywords table

Add a `photo_keywords` table to `apply_schema` in `src-tauri/src/session.rs` for future use by the Inspector Panel (Phase 4) and Vibe Tag (Phase 9):

```sql
CREATE TABLE IF NOT EXISTS photo_keywords (
  photo_id TEXT NOT NULL,
  keyword  TEXT NOT NULL,
  PRIMARY KEY (photo_id, keyword),
  FOREIGN KEY (photo_id) REFERENCES photos(id)
);
```

Extend the ExifTool tag list with `-IPTC:Keywords -XMP:Subject`. On import, parse whichever is present (both may be populated; deduplicate by lowercased value), split by semicolon/comma, trim each token, and insert non-empty values into `photo_keywords`. The table is populated silently; no frontend action is needed in this phase.

---

## Step 3 — Hash-Based Import Deduplication

**Deliverable:** A file whose content hash (`file_hash`) already exists in the `photos` table is skipped on import, even when imported from a different path. Skipped duplicates are counted and reported in the `import:complete` event.

Phase 1 deduplicates only by `file_path`. Phase 2 adds a second check after the path check:

```rust
// Existing path check (keep — fast, no file I/O)
let path_exists: bool = conn.query_row(
    "SELECT COUNT(*) FROM photos WHERE file_path = ?1",
    [path_str], |r| r.get::<_, i64>(0),
)? > 0;
if path_exists { skipped += 1; continue; }

// New content-hash check (after computing hash for this file)
let hash = compute_file_hash(&file_path).map_err(|e| e.to_string())?;
let hash_exists: bool = conn.query_row(
    "SELECT COUNT(*) FROM photos WHERE file_hash = ?1",
    [&hash], |r| r.get::<_, i64>(0),
)? > 0;
if hash_exists { skipped += 1; continue; }
```

Update the `import:complete` event payload to include a `skipped` count:

```json
{ "total": 12, "succeeded": 11, "failed": 0, "skipped": 1 }
```

The frontend ImportModal renders `"1 duplicate skipped"` in the completion state when `skipped > 0`. Add `skipped: number` to the local state that tracks import progress in `PhotoManager.tsx`.

---

## Step 4 — Remove Photos Command

**Deliverable:** `invoke('remove_photos', { ids })` fully removes the specified photos from SQLite and deletes their thumbnail files from disk.

Implement `remove_photos` in `src-tauri/src/commands/photos.rs`:

```rust
#[tauri::command]
pub async fn remove_photos(
    ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    for id in &ids {
        // Retrieve file_path to compute thumbnail key
        let file_path: Option<String> = conn.query_row(
            "SELECT file_path FROM photos WHERE id = ?1",
            [id], |r| r.get(0),
        ).ok();
        if let Some(path) = file_path {
            let key = hex::encode(Sha256::digest(path.as_bytes()));
            let _ = std::fs::remove_file(
                state.thumbnails_dir.join(format!("{}_small.jpg", key))
            );
            let _ = std::fs::remove_file(
                state.thumbnails_dir.join(format!("{}_large.jpg", key))
            );
        }
        conn.execute("DELETE FROM metadata_current  WHERE photo_id = ?1", [id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM metadata_original WHERE photo_id = ?1", [id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM photo_keywords    WHERE photo_id = ?1", [id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM photos            WHERE id = ?1",       [id])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

Thumbnail key derivation mirrors Phase 1's `generate_thumbnails`: `sha256(file_path_bytes)` encoded as hex. Thumbnail file deletion uses `let _ = remove_file(...)` — a missing thumbnail is not an error (e.g. if only one size was generated before a previous crash).

`apply_history` rows referencing removed photos are left in place; orphaned history rows cause no harm and are cleaned up by `clear_session` (which drops and recreates all tables).

---

## Step 5 — Session Load

**Deliverable:** `invoke('load_session')` reads all photos and metadata from SQLite, checks each file for existence on disk, and returns a typed `SessionLoadResult`.

Add a typed `PhotoRow` struct to `src-tauri/src/commands/session.rs`:

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PhotoRow {
    id: String,
    file_path: String,
    file_status: String,         // "ok" | "missing"
    thumbnail_small: String,     // absolute path
    thumbnail_large: String,     // absolute path
    original_metadata: Metadata,
    current_metadata: Metadata,
    pending_changes: Option<()>, // always None at load time
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionLoadResult {
    photos: Vec<PhotoRow>,
    gpx_files: Vec<serde_json::Value>, // empty until Phase 7
}
```

Implement `load_session`:

```rust
#[tauri::command]
pub async fn load_session(
    state: State<'_, AppState>,
) -> Result<SessionLoadResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, file_path FROM photos ORDER BY added_at ASC"
    ).map_err(|e| e.to_string())?;

    let photos = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })
    .map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .map(|(id, file_path)| {
        let file_status = if Path::new(&file_path).exists() { "ok" } else { "missing" };
        let key = hex::encode(Sha256::digest(file_path.as_bytes()));
        let thumb_dir = &state.thumbnails_dir;
        PhotoRow {
            file_status: file_status.to_string(),
            thumbnail_small: thumb_dir.join(format!("{}_small.jpg", key))
                                      .to_string_lossy().into_owned(),
            thumbnail_large: thumb_dir.join(format!("{}_large.jpg", key))
                                      .to_string_lossy().into_owned(),
            original_metadata: load_metadata_for(&conn, &id, false),
            current_metadata:  load_metadata_for(&conn, &id, true),
            pending_changes: None,
            id,
            file_path,
        }
    })
    .collect();

    Ok(SessionLoadResult { photos, gpx_files: vec![] })
}
```

Add a private helper `load_metadata_for(conn, photo_id, use_current) -> Metadata` that reads either `metadata_original` or `metadata_current` and reconstructs a `Metadata` struct from the key-value rows.

Update `src/lib/tauri.ts`:

```typescript
export interface SessionLoadResult {
  photos: Array<{
    id: string;
    filePath: string;
    fileStatus: 'ok' | 'missing';
    thumbnailSmall: string;
    thumbnailLarge: string;
    originalMetadata: Metadata;
    currentMetadata: Metadata;
    pendingChanges: null;
  }>;
  gpxFiles: GpxFile[];
}

export const tauriCommands = {
  loadSession: () => invoke<SessionLoadResult>('load_session'),
  // ... rest unchanged
};
```

---

## Step 6 — Frontend: Session Restore on Startup

**Deliverable:** When the app opens, existing photos load from SQLite and populate the grid before the user can interact with it.

In `src/components/PhotoManager/PhotoManager.tsx`, add a startup effect that runs before the import event listeners are registered:

```typescript
useEffect(() => {
  async function restoreSession() {
    try {
      const result = await tauriCommands.loadSession();
      if (result.photos.length > 0) {
        const photos: Photo[] = result.photos.map(p => ({
          id: p.id,
          filePath: p.filePath,
          fileStatus: p.fileStatus,
          thumbnail: {
            small: convertFileSrc(p.thumbnailSmall),
            large: convertFileSrc(p.thumbnailLarge),
          },
          originalMetadata: p.originalMetadata,
          currentMetadata: p.currentMetadata,
          pendingChanges: null,
        }));
        dispatch({ type: 'IMPORT_PHOTOS', photos });
      }
    } catch (err) {
      console.error('Session restore failed:', err);
    }
  }
  restoreSession();
}, []);
```

The existing `IMPORT_PHOTOS` bulk action replaces the photos array:
```typescript
case 'IMPORT_PHOTOS':
  return { ...state, photos: action.photos };
```

This is correct for session restore: the store starts empty, then is replaced with the loaded set. Subsequent `IMPORT_PHOTO_PROGRESS` actions from a new import will append to this array.

Photos with `fileStatus: 'missing'` will render the existing missing-file tile state from Phase 1 (the `?` placeholder). No additional reducer action is needed.

---

## Step 7 — Frontend: Remove Photos (FloatingControls)

**Deliverable:** The remove button in FloatingControls is always enabled and removes either the selected photos or all photos depending on selection state.

Per the PRD (§Photo Management, rule 11): when no photos are selected the button reads **"Clear Session"** and removes every photo in the session; when one or more photos are selected it reads **"Remove Photos"** and removes only those.

In `src/components/PhotoManager/FloatingControls/FloatingControls.tsx`:

```typescript
const { state, dispatch } = useSession();
const selectedIds = state.selectedIds;

async function handleRemove() {
  const ids = selectedIds.size > 0
    ? Array.from(selectedIds)
    : state.photos.map(p => p.id);
  if (ids.length === 0) return;
  await tauriCommands.removePhotos(ids);
  dispatch({ type: 'REMOVE_PHOTOS', ids });
}
```

Update the button:
- **Always enabled** as long as `state.photos.length > 0`; disabled only when the session is empty.
- **Label**: `"Remove All Photos"` when `selectedIds.size === 0`; `"Remove Selected Photos"` when `selectedIds.size > 0`.

The `REMOVE_PHOTOS` reducer case already exists in `sessionReducer` and handles both the photos array and the selectedIds set.

Note: photo selection is currently a stub (no click handlers on tiles). Until Phase 3 implements multi-select, the button will always act as "Remove All Photos". The branching logic is correct and will work without further changes when Phase 3 lands.

### Remove the dev-only "Clear DB" button

`FloatingControls.tsx` currently renders a dev-only **Clear DB** button (lines 49–53, guarded by `import.meta.env.DEV`) that calls `tauriCommands.clearSession()`. Once the "Remove All Photos" path above is wired up, this button is redundant and should be deleted — both the JSX block and the `handleClearDb` function. Delete both in the same pass that adds `handleRemove`.

---

## Step 8 — Frontend: TopBar Photo Count

**Deliverable:** The TopBar shows a live photo count. Apply, Roll Back, and Reset All/Selected remain stubs with correct label behavior wired up for Phase 5.

Per the PRD (§Photo Management, rule 20), the Control Bar (TopBar) contains **Apply**, **Roll Back**, and **Reset All / Reset Selected** — not a "clear session" action. Reset All/Selected reverts metadata to import-time values; it does not remove photos from the session. The full reset pipeline is implemented in Phase 5; this step only wires the count display and corrects the button labels.

In `src/components/TopBar/TopBar.tsx`:

```typescript
const { state } = useSession();

const count = state.photos.length;
const countLabel = count === 0 ? '' : `${count} photo${count !== 1 ? 's' : ''}`;
const hasSelection = state.selectedIds.size > 0;
const resetLabel = hasSelection ? 'Reset Selected' : 'Reset All';
```

- Display `countLabel` as secondary text in the TopBar (`.text-sm` secondary color). Hidden when `count === 0`.
- **Apply** button: disabled stub (`.btn-primary`, enabled state deferred to Phase 5).
- **Roll Back** button: disabled stub (`.btn-glass`, enabled state deferred to Phase 5).
- **Reset All / Reset Selected** button: label toggles based on `hasSelection`; disabled stub — full `reset_photos` implementation is Phase 5.

No `clearSession` call belongs in the TopBar. Session clearing is a separate operation (described in PRD §High-level, rule 7) whose UI placement and confirmation dialog are defined in Phase 5 alongside the full Apply / Rollback / Reset pipeline.

---

## What this phase does NOT include

The following are explicitly deferred to later phases:

- **IANA timezone resolution** — converting `utc_offset` or GPS coordinates to an IANA timezone name requires `tzf-rs`. Deferred to Phase 6 alongside the Map Panel and Location section.
- **Directory walking and Finder drag-and-drop** — deferred to Phase 3, which handles the full Finder file-drop interaction model and in-grid reordering.
- **Apply / Rollback / Reset pipeline** — the three TopBar action commands (`apply_changes`, `rollback`, `reset_photos`) remain stubs. Full implementation is Phase 5.
- **Photo selection UI** — shift-click range select and cmd-click toggle are Phase 3. The Remove button wired in Step 7 becomes functional when Phase 3 lands.
- **Day block grouping** — chronological ordering into labelled day blocks is Phase 3. Session load returns photos in `added_at` order for now.
- **Corpus load from SQLite** — `load_session` does not restore `CorpusContext` state. Corpus UI and persistence are Phase 8.
- **GPX file restore** — `load_session` returns `gpxFiles: []`. GPX import and persistence are Phase 7.
- **Advanced session history** — rollback history display, session export/import, and multiple sessions are Phase 10.
- **Keywords display** — keywords are stored in `photo_keywords` (Step 2) but not surfaced in the UI; Inspector Panel fields are Phase 4.
- **Thumbnail cache invalidation** — if a source file changes on disk after import, the existing thumbnails are served stale. Detecting this (via `file_hash` mismatch) is out of scope.
