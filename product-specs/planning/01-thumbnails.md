# Phase 1: Thumbnail Generation and Display

Goal: Clicking "Import Photos" opens the file picker, selected files are processed by the Rust backend (thumbnails generated, basic metadata read), an Import Modal shows progress, and thumbnails appear in the photo grid progressively. No day blocks, no selection, no drag-and-drop yet — just photos visible in the grid as a flat tile set.

---

## Step 1 — Bundle ExifTool

**Deliverable:** The Rust backend can locate and invoke the ExifTool binary bundled with the app.

- Download the ExifTool macOS standalone executable from the official distribution. Place the binary at `src-tauri/resources/exiftool` and ensure it is executable (`chmod +x`).
- Add `"resources": ["resources/exiftool"]` to the `bundle` section in `src-tauri/tauri.conf.json` so Tauri includes it in the app package.
- In `src-tauri/src/exiftool.rs`, implement `ExiftoolProcess`:
  - `fn binary_path(app_handle: &AppHandle) -> PathBuf` — resolves the bundled resource path using `app_handle.path().resource_dir()`.
  - `fn start(app_handle: &AppHandle) -> Result<ExiftoolProcess>` — spawns the process via `std::process::Command` with `-stay_open True -@ /dev/stdin` and keeps `stdin`/`stdout` handles open.
  - `fn run_command(&mut self, args: &[&str]) -> Result<String>` — writes the args to stdin (one per line, each arg on its own line, terminated by `-execute\n`), reads stdout until the `{ready}\n` sentinel, and returns the output.
  - `fn stop(&mut self)` — writes `-stay_open\nFalse\n` to stdin and waits for the process to exit.
- Define `AppState` in `main.rs` as:
  ```rust
  pub struct AppState {
      pub exiftool: Mutex<ExiftoolProcess>,
      pub db: Mutex<Connection>,
  }
  ```
  Call `ExiftoolProcess::start()` once during app initialization in `main.rs` and store the handle in `AppState`.
- Add the following to `src-tauri/Cargo.toml`:
  ```toml
  image = { version = "0.25", default-features = false, features = ["jpeg", "tiff", "png"] }
  sha2 = "0.10"
  hex = "0.4"
  tempfile = "3"
  ```
- Confirm `cargo check` passes.

---

## Step 2 — Enable Asset Protocol for Thumbnails

**Deliverable:** The WebView can load thumbnail images served from the app data directory.

In `src-tauri/tauri.conf.json`, enable the asset protocol scoped to the app data directory:
```json
"security": {
  "assetProtocol": {
    "enable": true,
    "scope": ["$APPDATA/photo-manager/thumbnails/**"]
  }
}
```

In `src-tauri/capabilities/default.json`, add `"core:asset:allow-fetch-asset"` to the permissions array.

In `src-tauri/src/session.rs`, extend `init_db()` to also create the `thumbnails/` subdirectory inside the app data dir using `std::fs::create_dir_all` if it does not exist.

---

## Step 3 — Thumbnail Generation

**Deliverable:** Given a file path, the Rust backend generates and stores small (400px) and large (2560px) JPEG thumbnails in the app data thumbnails directory.

### `src-tauri/src/thumbnail.rs`

```rust
pub struct ThumbnailPaths {
    pub small: PathBuf,   // 400px longest edge
    pub large: PathBuf,   // 2560px longest edge
}

pub fn generate_thumbnails(
    file_path: &Path,
    thumbnails_dir: &Path,
    exiftool: &mut ExiftoolProcess,
) -> Result<ThumbnailPaths>
```

**Key and path derivation:**
- `key = sha256(file_path.to_string_lossy().as_bytes())` encoded as lowercase hex.
- `small_path = thumbnails_dir/<key>_small.jpg`
- `large_path = thumbnails_dir/<key>_large.jpg`
- If both files already exist on disk, return early (idempotent — re-importing the same path skips regeneration).

**Source image by file type** (match on the lowercased extension):
- **`.jpg` / `.jpeg` / `.tif` / `.tiff`**: load directly with `image::open(file_path)`.
- **`.heic` / `.dng` / `.cr3` / `.cr2` / `.nef` / `.arw` / `.raf` / `.orf` / `.rw2` / `.pef`**: use ExifTool to extract the largest embedded JPEG preview to a `tempfile::NamedTempFile`:
  ```
  -b -PreviewImage <file_path>
  ```
  Write the raw bytes ExifTool returns on stdout to the temp file, then load the temp file with `image::open`. If ExifTool returns empty output for `-PreviewImage`, retry with `-b -JpgFromRaw`. If both yield empty output, return `Err("No embedded preview available")`.

  > Note: The architecture doc lists HEIC under the `image` crate path, but the `image` crate does not support HEIC natively on all targets. Using ExifTool's embedded preview extraction is simpler and consistent with the RAW approach.

**Resize logic:**
- For each target longest edge `T` in `[400, 2560]`:
  - If the source image's longest edge is already ≤ `T`, save the source as-is for that size (no upscaling).
  - Otherwise: compute `(w, h)` that fit the image within `T × T` while preserving aspect ratio. Call `img.resize(w, h, image::imageops::FilterType::Lanczos3)`.
- Encode both outputs as JPEG at 85% quality using `image::codecs::jpeg::JpegEncoder::new_with_quality`.

---

## Step 4 — Metadata Read on Import

**Deliverable:** During import, ExifTool reads the core metadata fields from each file; the result is stored in SQLite and included in the `PhotoData` emitted to the frontend.

Define the internal metadata struct in `src-tauri/src/commands/photos.rs` (or a shared `types.rs`):

```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Metadata {
    pub capture_date: Option<String>,   // "YYYY-MM-DD"
    pub capture_time: Option<String>,   // "HH:MM:SS"
    pub timezone:     Option<String>,   // always None in Phase 1; resolved from GPS in Phase 6
    pub gps_lat:      Option<f64>,
    pub gps_lng:      Option<f64>,
    pub camera_body:  Option<String>,   // "{Make} {Model}"
    pub lens:         Option<String>,   // LensModel
    pub film:         Option<String>,   // always None in Phase 1
}
```

**ExifTool invocation** (run once per file, in the same `-stay_open` session as thumbnail extraction):
```
-json -coordFormat "%.6f" -DateTimeOriginal -OffsetTimeOriginal
-GPSLatitude -GPSLongitude -Make -Model -LensModel -XMP:DateTimeOriginal
```

**Parsing rules:**
- `DateTimeOriginal` comes as `"YYYY:MM:DD HH:MM:SS"`. Split on the first space. Replace `:` with `-` in the date part → `capture_date: "YYYY-MM-DD"`, `capture_time: "HH:MM:SS"`.
- If XMP `DateTimeOriginal` is present and is an ISO 8601 string with an offset (e.g. `"2024-03-15T14:30:00-07:00"`), prefer it over the EXIF value. Parse the date and time portions; store the offset string in a scratch variable but do not resolve to IANA timezone in this phase.
- `camera_body`: `format!("{} {}", make.trim(), model.trim())`, or `None` if both are absent.
- `GPSLatitude` / `GPSLongitude`: parse the `-coordFormat "%.6f"` decimal output as `f64`. Positive = N/E, negative = S/W (ExifTool's default behavior with this coord format).
- Film: `None`.

**SQLite writes** (after generating thumbnails and parsing metadata):
1. `INSERT INTO photos (id, file_path, added_at)` with a freshly generated UUID for `id`.
2. `INSERT INTO metadata_original (photo_id, field, value)` for every non-None field.
3. `INSERT INTO metadata_current (photo_id, field, value, is_pending)` same rows with `is_pending = 0`.

---

## Step 5 — Import Command and Progress Events

**Deliverable:** `invoke('import_photos', { paths })` processes each file on a background thread, emitting `import:progress` and `import:complete` events. The frontend receives photos one at a time.

In `src-tauri/src/commands/photos.rs`:

```rust
#[tauri::command]
pub async fn import_photos(
    paths: Vec<String>,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String>
```

**Processing loop:**
1. Filter `paths` to supported extensions (case-insensitive): `.jpg`, `.jpeg`, `.tif`, `.tiff`, `.heic`, `.dng`, `.cr3`, `.cr2`, `.nef`, `.arw`, `.raf`, `.orf`, `.rw2`, `.pef`. Silently skip any other extension.
2. Deduplicate against the `photos` table: skip any path already present (no event emitted for skips).
3. `total = paths.len()` (after filtering and deduplication). Emit a single `import:start` event with `{ total }` before beginning.
4. For each remaining file:
   a. Generate thumbnails via `thumbnail::generate_thumbnails`.
   b. Read metadata via ExifTool.
   c. Insert into SQLite.
   d. Emit `import:progress`:
      ```json
      {
        "done": N,
        "total": M,
        "photo": {
          "id": "uuid",
          "filePath": "/abs/path/to/photo.jpg",
          "thumbnailSmall": "/abs/path/to/thumbnails/<key>_small.jpg",
          "thumbnailLarge": "/abs/path/to/thumbnails/<key>_large.jpg",
          "fileStatus": "ok",
          "metadata": { ...Metadata fields... }
        },
        "error": null
      }
      ```
   e. On failure (thumbnail generation or metadata read error): emit `import:progress` with `photo: null` and `error: "<message>"`.
5. Emit `import:complete` after all files are processed.

The `thumbnailSmall` / `thumbnailLarge` fields are **absolute file paths**. The frontend converts them to asset URLs with `convertFileSrc` from `@tauri-apps/api/core`.

---

## Step 6 — SessionContext: Progressive Import

**Deliverable:** Photos appear in the grid one at a time as they are imported.

In `src/state/SessionContext.tsx`, update the `Photo` interface thumbnail field:
```typescript
interface Photo {
  id: string;
  filePath: string;
  fileStatus: 'ok' | 'missing';
  thumbnail: { small: string; large: string };  // asset:// URLs
  originalMetadata: Metadata;
  currentMetadata: Metadata;
  pendingChanges: Partial<Metadata> | null;
}
```

Add a new reducer action:
```typescript
| { type: 'IMPORT_PHOTO_PROGRESS'; photo: Photo }
```

Case in `sessionReducer`:
```typescript
case 'IMPORT_PHOTO_PROGRESS':
  return { ...state, photos: [...state.photos, action.photo] };
```

The existing `IMPORT_PHOTOS` bulk action remains for session restore (Phase 10).

---

## Step 7 — Frontend: Import Modal

**Deliverable:** An Import Modal appears when import starts, shows per-file progress, and dismisses automatically when complete with no errors.

### `src/components/ImportModal/ImportModal.tsx`

Props: `{ isOpen: boolean; done: number; total: number; errors: string[]; onDismiss: () => void }`.

Layout:
- Full-screen overlay (`position: fixed; inset: 0; z-index: 100; background: rgba(0,0,0,0.4); backdrop-filter: blur(8px)`).
- Centered `.inspector-card` panel:
  - Title: **"Importing Photos"** (`.text-lg .font-medium`)
  - Progress bar: `<div>` track (full width, 6px height, `border-radius: var(--radius-sm)`, `background: var(--color-border)`) with an inner `<div>` whose `width` is `${Math.round((done / Math.max(total, 1)) * 100)}%`, `background: var(--color-accent)`, `transition: width var(--transition-fast)`.
  - Sub-label: `"${done} of ${total}"` in `.text-sm` secondary color.
  - Error list: if `errors.length > 0`, render each error in `.text-sm` with `color: var(--color-danger)`.
  - **Done** button (`.btn-glass`): hidden while `done < total`; visible when complete and errors exist, allowing manual dismiss.

Auto-dismiss: when `done === total && errors.length === 0`, call `onDismiss` after 600ms so the progress bar visibly reaches 100%.

### Event listeners in `src/components/PhotoManager/PhotoManager.tsx`

On mount, register Tauri event listeners (unlisten on unmount):
```typescript
import { listen } from '@tauri-apps/api/event';
import { convertFileSrc } from '@tauri-apps/api/core';

useEffect(() => {
  const unlisten = [
    listen('import:start', (e) => { /* set total, open modal */ }),
    listen('import:progress', (e) => {
      const { photo, error } = e.payload;
      if (photo) {
        const mapped: Photo = {
          ...photo,
          thumbnail: {
            small: convertFileSrc(photo.thumbnailSmall),
            large: convertFileSrc(photo.thumbnailLarge),
          },
        };
        dispatch({ type: 'IMPORT_PHOTO_PROGRESS', photo: mapped });
      }
      if (error) { /* append to errors list */ }
      /* increment done count */
    }),
    listen('import:complete', () => { /* mark complete */ }),
  ];
  return () => { unlisten.forEach(u => u.then(fn => fn())); };
}, []);
```

Store `{ isOpen, done, total, errors }` in local component state. Render `<ImportModal>` when `isOpen`.

---

## Step 8 — PhotoTile Component

**Deliverable:** Each photo renders as a thumbnail of the ratio as the original image with lazy loading, a missing-file indicator, and a pending-change dot.

### `src/components/PhotoManager/PhotoGrid/PhotoTile.tsx`

Props: `{ photo: Photo; tilePx: number }`.

```tsx
<div className={styles.tile} style={{ width: tilePx, height: tilePx }}>
  {photo.fileStatus === 'missing' ? (
    <div className={styles.missing}>
      <span className="text-lg" style={{ color: 'var(--color-text-secondary)' }}>?</span>
      <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>File not found</span>
    </div>
  ) : (
    <img
      src={tilePx > 400 ? photo.thumbnail.large : photo.thumbnail.small}
      className={styles.img}
      loading="lazy"
      draggable={false}
    />
  )}
  {photo.pendingChanges && <span className={styles.pendingDot} />}
</div>
```

**`PhotoTile.module.css`**:
```css
.tile {
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-md);
  background: var(--color-surface);
  cursor: pointer;
  flex-shrink: 0;
}
.img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.missing {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
}
.pendingDot {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-accent);
  box-shadow: 0 0 0 1.5px var(--color-bg);
}
```

---

## Step 9 — PhotoGrid: Flat Display

**Deliverable:** The photo grid renders imported photos as a responsive tile grid, respecting the Grid Size control, with an empty state when no photos exist.

### `src/components/PhotoManager/PhotoGrid/PhotoGrid.tsx`

- Read `photos` from `useSession()` and `gridTileSize` from `useUI()`.
- Track `panelWidth` via `ResizeObserver` on the grid container ref (update on each resize). Initialize to the element's `offsetWidth`.
- Compute `tilePx = Math.max(60, Math.round(gridTileSize * panelWidth))`.
- Set `--tile-size: ${tilePx}px` as an inline style on the `.photo-grid` container.
- Map `photos` to `<PhotoTile photo={p} tilePx={tilePx} key={p.id} />`.
- Empty state: when `photos.length === 0`, render a centered `<p className="text-base">"No photos imported"</p>` using `color: var(--color-text-secondary)`.

The `.photo-grid` class from `layout.css` already handles `grid-template-columns: repeat(auto-fill, minmax(var(--tile-size, 160px), 1fr))`.

### Grid Size control

In `src/components/PhotoManager/FloatingControls/FloatingControls.tsx`, wire the `+` / `–` buttons to dispatch `SET_GRID_TILE_SIZE` to `UIContext`:

Add to `UIContext`:
```typescript
| { type: 'SET_GRID_TILE_SIZE'; size: number }
```
```typescript
case 'SET_GRID_TILE_SIZE':
  return { ...state, gridTileSize: Math.min(1.0, Math.max(0.05, action.size)) };
```

`+` dispatches `{ type: 'SET_GRID_TILE_SIZE', size: gridTileSize + 0.05 }`.
`–` dispatches `{ type: 'SET_GRID_TILE_SIZE', size: gridTileSize - 0.05 }`.

---

## Step 10 — Wire Import Photos Button

**Deliverable:** Clicking "Import Photos" opens the file picker, passes selected paths to the `import_photos` command, and the Import Modal opens immediately.

In `src/components/PhotoManager/FloatingControls/FloatingControls.tsx`, replace the Phase 0 `console.log` stub:

```typescript
import { open } from '@tauri-apps/plugin-dialog';
import { tauriCommands } from '../../../lib/tauri';

async function handleImport() {
  const result = await open({
    multiple: true,
    filters: [{
      name: 'Photos',
      extensions: ['jpg','jpeg','tif','tiff','heic','dng','cr3','cr2','nef','arw','raf','orf','rw2','pef'],
    }],
  });
  if (!result) return;
  const paths = Array.isArray(result) ? result : [result];
  if (paths.length === 0) return;
  // fire-and-forget: progress arrives via Tauri events registered in PhotoManager
  tauriCommands.importPhotos(paths);
}
```

---

## What Phase 1 does NOT include

Each of the following belongs to a later phase:

- Day block grouping and chronological ordering by `DateTimeOriginal` (Phase 3)
- Photo selection and multi-select keyboard behavior (Phase 3)
- In-grid drag-and-drop reordering (Phase 3)
- Finder drag-and-drop import into the app window, including directory walking (Phase 3)
- Inspector Panel fields with live metadata display (Phase 4)
- Missing file detection at session load (Phase 10)
- Thumbnail cache invalidation if a source file changes on disk (out of scope)
- IANA timezone resolution from GPS coordinates (Phase 6, requires `tzf-rs`)
