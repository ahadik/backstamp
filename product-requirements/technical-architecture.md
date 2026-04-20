# Technical Architecture

## 1. Platform & Framework

### Recommendation: Tauri + React + TypeScript

**Tauri** is a framework for building native desktop apps with a web-based UI layer backed by a Rust process. On macOS it uses the system's WKWebView (Safari engine) rather than bundling a full browser, producing a significantly smaller and more performant app than Electron.

| Concern | Tauri | Electron |
|---|---|---|
| Bundle size | ~10MB | ~150MB+ |
| Memory footprint | Low (system WebView) | High (bundled Chromium) |
| File system access | Rust (safe, fast) | Node.js |
| Image processing | Rust crates (fast) | JS/native modules (slower) |
| UI language | React/TypeScript | React/TypeScript |
| Modifiable by owner | Frontend: yes; Backend: Rust | All TypeScript |

The PRD asks for code that can be "inspected and adjusted manually." The React/TypeScript frontend — where all UI logic, layout, and interaction lives — is the layer most frequently modified. The Rust backend handles file I/O, thumbnail generation, and subprocess management: operations that are written once and rarely touched. This split is acceptable.

**Frontend stack:**
- React 18 + TypeScript
- React's built-in `useReducer` + `useContext` for state management — no external state library
- Custom CSS design system (see §2a)

**Backend (Rust, via Tauri commands):**
- File system access
- ExifTool subprocess management
- Thumbnail generation
- SQLite session persistence
- GPX parsing

### Single-instance enforcement

The PRD requires that the app cannot be opened in multiple windows or instances simultaneously. This is enforced at the OS level using Tauri's `tauri-plugin-single-instance` plugin. When a second launch is attempted, the plugin brings the existing window to the foreground and the second process exits immediately. A file lock in the app data directory serves as a secondary guard during Tauri's own startup before the plugin activates.

---

## 2. Codebase Architecture

```
photo-manager/
├── src/                          # React/TypeScript frontend
│   ├── components/
│   │   ├── TopBar/               # Apply, Roll Back, Reset
│   │   ├── PhotoManager/
│   │   │   ├── SubBar/           # Select Photos, Remove, Grid slider, Working TZ
│   │   │   ├── PhotoGrid/        # Day blocks, No Date block, drag-and-drop
│   │   │   └── PhotoTile/        # Thumbnail, pending-change dot, missing-file state
│   │   ├── InspectorPanel/
│   │   │   ├── DateTimeSection/
│   │   │   ├── LocationSection/  # Mini-map + search
│   │   │   ├── CameraSection/
│   │   │   └── VibeTagSection/
│   │   └── MapPanel/             # Full-width bottom map
│   ├── state/
│   │   ├── SessionContext.tsx     # useReducer + Context: photos, selection, pending changes
│   │   ├── CorpusContext.tsx      # useReducer + Context: camera/lens/film options
│   │   └── UIContext.tsx          # useReducer + Context: panel sizes, working timezone, grid size
│   ├── hooks/
│   │   ├── useDragDrop.ts
│   │   └── useMetadataInheritance.ts
│   ├── styles/
│   │   ├── tokens.css             # CSS custom properties: color, spacing, typography, radius
│   │   ├── layout.css             # Grid and flex utility classes
│   │   ├── typography.css         # Type scale and font-family definitions
│   │   └── components.css         # Shared component base styles (button, input, dropdown)
│   └── lib/
│       ├── tauri.ts              # Typed wrappers for Tauri commands
│       ├── interpolation.ts      # Timestamp/GPS midpoint calculations
│       └── vibeTag.ts            # Claude API client + prompt builder
│
└── src-tauri/
    ├── src/
    │   ├── commands/             # Tauri IPC commands (called from frontend)
    │   │   ├── session.rs        # Load/save/clear session
    │   │   ├── photos.rs         # Import, remove, get metadata
    │   │   ├── metadata.rs       # Apply changes, rollback
    │   │   └── thumbnails.rs     # Generate and fetch thumbnails
    │   ├── exiftool.rs           # ExifTool subprocess pool (-stay_open mode)
    │   ├── thumbnail.rs          # Extract embedded previews, resize
    │   ├── session.rs            # SQLite schema and queries
    │   ├── gpx.rs                # GPX file parsing and time matching
    │   └── corpus.rs             # Camera/lens/film option management
    └── Cargo.toml
```

### State model (frontend)

State is managed with React's built-in `useReducer` + `useContext`. There are three contexts, each with its own reducer, provider, and typed action union. No external state library is used.

```typescript
// state/SessionContext.tsx
interface Photo {
  id: string;
  filePath: string;
  fileStatus: 'ok' | 'missing';
  thumbnail: string;           // object URL
  originalMetadata: Metadata;  // snapshot at import, never mutated
  currentMetadata: Metadata;   // includes applied + pending changes
  pendingChanges: Partial<Metadata> | null;
}

interface Metadata {
  captureDate: string | null;  // ISO 8601 date-only "YYYY-MM-DD"
  captureTime: string | null;  // "HH:MM:SS"
  timezone: string | null;     // IANA name e.g. "America/Los_Angeles"
  gpsLat: number | null;
  gpsLng: number | null;
  cameraBody: string | null;
  lens: string | null;
  film: string | null;
}

interface SessionState {
  photos: Photo[];
  selectedIds: Set<string>;
  gpxFiles: GpxFile[];
  applyInProgress: boolean;
}

type SessionAction =
  | { type: 'IMPORT_PHOTOS'; photos: Photo[] }
  | { type: 'SELECT'; id: string; mode: 'single' | 'shift' | 'cmd' }
  | { type: 'SET_PENDING'; ids: string[]; changes: Partial<Metadata> }
  | { type: 'CLEAR_PENDING'; ids: string[] }
  | { type: 'APPLY_COMPLETE'; updatedPhotos: Photo[] }
  | { type: 'ROLLBACK_COMPLETE'; restoredPhotos: Photo[] }
  | { type: 'REMOVE_PHOTOS'; ids: string[] }
  | { type: 'CLEAR_SESSION' }
  // ...
```

```typescript
// state/UIContext.tsx
interface UIState {
  workingTimezone: string;     // IANA name, display-only
  gridTileSize: number;        // 0–1, fraction of Photo Manager panel width per tile including padding
  mapPanelHeight: number;      // 0–1, fraction of window height
}
```

```typescript
// state/CorpusContext.tsx
// Each corpus is independent — entries from one cannot be assigned to another.
// All entries are stored and used as combined strings at runtime.
// Structured input is enforced only in the creation UI.
interface CorpusState {
  cameraOptions: CorpusEntry[];  // combined string: "Manufacturer Model"
  lensOptions: CorpusEntry[];    // combined string: "Manufacturer Length"
  filmOptions: CorpusEntry[];    // combined string: "Brand Type ISO"
}
```

Pending changes accumulate in `pendingChanges` and are merged into `currentMetadata` for display. On Apply, the Rust backend writes changes to disk and the `APPLY_COMPLETE` action updates state. On Rollback, `ROLLBACK_COMPLETE` restores the pre-apply metadata from SQLite history.

### Drag-and-drop implementation

Two distinct drag-and-drop interactions require different implementations:

**File drop from Finder into the app window** — Tauri exposes a `onDragDropEvent` listener on the window that fires with the dropped file paths before the browser's native drop event. The app registers this listener on startup. Dropped paths are filtered by supported extension (see §3), directories are walked recursively on the Rust side, and the resulting file list is fed into the import pipeline.

**In-grid photo reordering** — HTML5 drag-and-drop is used. Drop zones are explicit DOM elements: each photo tile is a `draggable` element, and thin invisible elements are rendered between every pair of adjacent tiles (and at the start/end of each row) to act as gap drop targets. The No Date block and day block edges are similarly explicit drop targets. The `useDragDrop` hook manages `dragstart`, `dragover`, `dragleave`, and `drop` handlers and tracks which drop target is currently active to drive the visual indicators (darkened tile overlay for on-photo drops, blue vertical line for gap drops). The resolved drop target is passed to `useMetadataInheritance`, which applies the appropriate date/time, GPS, and camera inheritance rules.

### Timezone utilities

**IANA timezone list** — Both the Working Time Zone dropdown and the Inspector Panel Time Zone control are populated using `Intl.supportedValuesOf('timeZone')`, available natively in all modern browsers including Safari (WKWebView). No library or bundled list is needed.

**DST-correct UTC offset computation** — The `OffsetTimeOriginal` value is computed on the frontend using the `Intl.DateTimeFormat` API:

```typescript
function getUtcOffset(ianaTimezone: string, date: Date): string {
  const fmt = new Intl.DateTimeFormat('en', {
    timeZone: ianaTimezone,
    timeZoneName: 'shortOffset',
  });
  // parse the resolved offset string e.g. "GMT-7" → "-07:00"
}
```

This is zero-dependency, runs entirely in the browser engine, and correctly resolves DST for any IANA timezone and date combination. The computed offset string is passed to the Rust backend as part of the Apply payload; the Rust side writes it verbatim to `OffsetTimeOriginal`.

---

## 2a. Design System

No CSS framework or utility library is used. Styling is handled through a small set of plain CSS files loaded globally, plus per-component CSS Modules for component-specific styles.

### File structure

```
src/styles/
├── tokens.css        # All design tokens as CSS custom properties on :root
├── layout.css        # Grid and flex helpers for the three structural patterns
├── typography.css    # Type scale and font-family definitions
└── components.css    # Base styles for shared elements: button, input, dropdown, divider
```

Each component directory contains a `ComponentName.module.css` for styles specific to that component. Only tokens and layout helpers cross module boundaries — no global class soup.

### tokens.css

All values — color, spacing, typography, radius, shadow, transition — are defined as CSS custom properties on `:root`. Components reference tokens directly; no magic numbers in component stylesheets. The color palette is dark-mode-first, matching the app's intended aesthetic. Spacing follows a 4px base unit.

### layout.css

Covers the three structural patterns the app uses:
- **App shell** — CSS Grid `grid-template-rows: auto 1fr auto` for top bar / content / map panel
- **Content area** — CSS Grid horizontal split between photo manager and inspector panel
- **Photo grid** — `auto-fill` grid with `minmax(var(--tile-size), 1fr)` so the grid tile size slider drives column count without JavaScript

A small set of flex row/column helpers and gap utilities round this out.

### typography.css

Defines the system font stack, a four-step type scale (xs / sm / base / lg), weight utilities, and line-height variants. Applied to `body`; component stylesheets compose from these.

### components.css

Base styles for shared interactive primitives: primary button, ghost button, text input, section label, and divider. Components extend these via CSS Modules rather than re-implementing them.

### CSS Modules

Each component imports its own `.module.css`. Component styles use tokens directly (e.g. `color: var(--color-accent)`) and do not hardcode values. This keeps component styles self-contained and avoids specificity conflicts.

---

## 3. Metadata I/O

### ExifTool (bundled)

**ExifTool** is the only library that reliably handles all of the PRD's target file formats (CR3, NEF, ARW, RAF, etc.) and all three metadata standards (EXIF, XMP, IPTC). No pure-Rust or pure-JS alternative comes close in format coverage.

ExifTool is distributed as a standalone macOS executable (no Perl installation required). It will be bundled inside the Tauri app's resources directory and invoked as a subprocess.

**Performance: `-stay_open` batch mode.** ExifTool has a mode where it starts once and accepts multiple commands over stdin without the per-invocation startup cost (~200ms). On import and Apply, all files are processed through a single persistent ExifTool process.

```
exiftool -stay_open True -@ /dev/stdin
# then write commands to stdin, terminate each with -execute
```

**Reading metadata on import:**
```
exiftool -json -DateTimeOriginal -OffsetTimeOriginal -GPSLatitude -GPSLongitude \
         -Make -Model -LensModel -XMP:all <file>
```

**Writing metadata on Apply:**
- For inline formats (JPEG, TIFF, HEIC): write directly with `-overwrite_original_in_place` plus temp-file fallback
- For RAW formats: write to `.xmp` sidecar via `-o <file>.xmp` or updating the existing sidecar in-place

**Atomic write strategy for inline formats:**
1. Write to `<original-name>_pmtmp.<ext>` in the same directory
2. On success, rename over the original (POSIX rename is atomic on the same filesystem)
3. On failure, delete the temp file and surface an error for that file

### Thumbnail generation

Two thumbnail sizes are generated per photo at import time and stored in the app data thumbnails directory keyed by a hash of the file path. Storing them locally means the frontend always loads thumbnails from the same place regardless of source file type — no per-load ExifTool calls needed.

- **Small** (400px longest edge) — used for grid display at typical tile sizes.
- **Large** (2560px longest edge) — used when the tile renders large enough to benefit. 2560px covers a full-panel tile on a 4K display, since `gridTileSize = 1.0` means one photo fills the Photo Manager panel width.

Both are stored as JPEG at 85% quality. The grid loads the small version by default; the large version is swapped in when the tile's rendered width exceeds 400px (`gridTileSize × panelWidth > 400`).

**Source by file type:**

- **JPEG / HEIC / TIFF** — decoded and resized directly using the Rust `image` crate.
- **RAW formats** — modern cameras embed JPEG previews at multiple sizes inside the RAW file. ExifTool extracts the largest available preview (`-b -PreviewImage`), which is then used as the source image. The extracted preview is copied into the app data thumbnails directory and resized to the two target sizes using the `image` crate — no full RAW decode is required. If the embedded preview is smaller than a target size, it is used as-is for that size without upscaling.

Thumbnails are stored in the session's app data directory (see §5) keyed by a hash of the absolute file path. They survive app restarts (they are part of the session) and are discarded when the session is cleared.

### Import pipeline

Import is asynchronous. When files are added (via file picker, Finder drop, or directory walk), the Rust backend processes them in a background thread and streams progress to the frontend via Tauri events:

```
Frontend                          Rust backend
   │                                   │
   │── invoke('import_photos', paths) ──►│
   │                                   │  for each file:
   │◄── emit('import:progress', {      │    read metadata (ExifTool)
   │      done: N, total: M,           │    generate thumbnail
   │      photo: PhotoData | null,     │    emit progress event
   │      error: string | null         │
   │    }) ────────────────────────────│
   │                                   │
   │◄── emit('import:complete') ───────│
```

The frontend listens for `import:progress` events and dispatches `IMPORT_PHOTO_PROGRESS` actions to `SessionContext` as each photo arrives, so thumbnails appear in the grid progressively rather than all at once. A photo that fails (unreadable file, unsupported format that slipped past the extension filter) emits a progress event with `error` set and `photo: null`; it is shown as a failed import entry in the modal and skipped. The modal is dismissed automatically when `import:complete` fires, or manually by the user after reviewing errors.

### GPX route thumbnail

GPX tiles in the photo grid show a miniature image of the route. This is generated using the Mapbox Static Images API after a GPX file is imported:

1. Parse all track points from the GPX file on the Rust side
2. Construct a Mapbox Static Images API request with the track points encoded as a GeoJSON `LineString` overlay, auto-fitted to the route's bounding box
3. Fetch the image from the frontend using the user's Mapbox access token
4. Save the returned image to the app data thumbnails directory alongside photo thumbnails

This produces a properly rendered map with the route overlaid, with no custom rasterization code required. The Mapbox API key must be configured before GPX files can be imported; if it is not set, the app prompts the user to add it in settings before proceeding. The resulting image is referenced by the GPX tile exactly as a photo thumbnail is.

---

## 4. File Handling

### Directory layout (macOS app data)

```
~/Library/Application Support/photo-manager/
├── session.db              # SQLite — session state, history, corpus
└── thumbnails/
    ├── <sha256-of-path>.jpg
    └── ...
```

### What is never touched on the user's disk (without explicit Apply)

- Original photo files
- XMP sidecar files

The only files the app modifies are those explicitly targeted during an Apply operation. Thumbnails and session state are written only to the app data directory.

### Apply pipeline and mid-apply cancellation

Apply is blocking from the user's perspective (the UI is locked during the operation) but runs on a Rust background thread, streaming progress to the frontend via Tauri events. Before writing any file, the full pre-apply metadata state is committed to the `apply_history` table in SQLite. Then files are written one at a time:

```
Frontend                             Rust backend
   │                                      │
   │── invoke('apply_changes') ──────────►│
   │                                      │  1. write apply_history to SQLite
   │◄── emit('apply:progress', {          │  2. for each file:
   │      done: N, total: M,              │     write metadata (ExifTool)
   │      filePath: string,               │     emit progress event
   │      success: bool                   │
   │    }) ─────────────────────────────  │
   │                                      │
   │── invoke('apply_cancel')  ──────────►│  (if user cancels)
   │                                      │  begin undo (see below)
   │◄── emit('apply:undo_progress', ...) ─│
   │◄── emit('apply:cancelled') ──────────│
   │                                      │
   │◄── emit('apply:complete') ───────────│  (if all files succeed)
```

**Mid-apply cancellation** — When the user cancels, the backend receives `apply_cancel` and immediately stops writing new files. It then re-writes already-modified files by re-applying the `value_before` entries from `apply_history` for the current apply operation. This undo pass also streams `apply:undo_progress` events so the frontend can show a secondary progress bar. The undo pass cannot itself be cancelled. On completion, the partial `apply_ops` record is deleted from SQLite so it does not appear in rollback history.

### Rollback storage

Before each Apply, the full pre-apply metadata state is committed to `apply_history` in SQLite. To roll back:
- **RAW files**: the `value_before` for the XMP content field is written back to the sidecar file verbatim.
- **Inline formats (JPEG/TIFF/HEIC)**: ExifTool re-applies the `value_before` field values. The app does not rely on ExifTool's `_original` backup files — field-level SQLite history is the authoritative source for rollback.

### File missing detection

On session load (app start or session restore from SQLite), the Rust backend checks the existence of every file path in the `photos` table in a single pass and marks any missing paths with `fileStatus: 'missing'` before returning the session to the frontend. No continuous file watching is used — the check happens only at session load. If a file disappears after the session is loaded, it will be detected as missing on the next app restart, or when the user attempts to Apply (Apply skips and reports an error for missing files).

---

## 5. Session Persistence

**SQLite via `rusqlite`** in the Rust backend. A single `session.db` file in the app data directory holds all session state. It is written incrementally as the user works (not only on app close).

### Schema

```sql
-- Photos imported into the current session
CREATE TABLE photos (
  id          TEXT PRIMARY KEY,
  file_path   TEXT NOT NULL UNIQUE,
  file_hash   TEXT,              -- SHA-256 of file at import time
  added_at    INTEGER NOT NULL,
  nodateorder INTEGER            -- display order within the No Date block
);

-- Metadata snapshot at import time (source of truth for Reset)
CREATE TABLE metadata_original (
  photo_id TEXT NOT NULL,
  field    TEXT NOT NULL,
  value    TEXT,
  PRIMARY KEY (photo_id, field),
  FOREIGN KEY (photo_id) REFERENCES photos(id)
);

-- Current in-session metadata state
-- is_pending=1: change queued but not yet written to disk
CREATE TABLE metadata_current (
  photo_id   TEXT NOT NULL,
  field      TEXT NOT NULL,
  value      TEXT,
  is_pending INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (photo_id, field),
  FOREIGN KEY (photo_id) REFERENCES photos(id)
);

-- One row per Apply operation
CREATE TABLE apply_ops (
  id          TEXT PRIMARY KEY,    -- UUID
  applied_at  INTEGER NOT NULL,
  file_count  INTEGER NOT NULL
);

-- Per-field, per-file before/after record for each Apply
CREATE TABLE apply_history (
  apply_id     TEXT NOT NULL,
  photo_id     TEXT NOT NULL,
  field        TEXT NOT NULL,
  value_before TEXT,
  value_after  TEXT,
  FOREIGN KEY (apply_id) REFERENCES apply_ops(id)
);

-- GPX files added to the session
CREATE TABLE gpx_files (
  id        TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  added_at  INTEGER NOT NULL
);

-- Camera/lens/film corpus (persists across session clears)
-- Each category is a distinct corpus; entries are not shared across categories.
-- 'value' is always the combined display string and is what gets written to metadata.
-- Structured input is enforced at creation time in the UI; the components are not
-- stored separately at runtime.
CREATE TABLE corpus (
  category    TEXT NOT NULL,   -- 'camera_body' | 'lens' | 'film'
  value       TEXT NOT NULL,   -- combined string: "Kodak Portra 400", "Canon EOS R5", "Canon RF 50mm f/1.8"
  is_builtin  INTEGER NOT NULL DEFAULT 0,
  last_used   INTEGER,         -- epoch ms, for "recently used" sorting
  use_count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (category, value)
);
```

**Session clear** drops and recreates all tables except `corpus`. The corpus is intentionally decoupled so it survives clears.

---

## 6. Camera / Lens / Film Corpus

Stored in the `corpus` SQLite table (see §5). The pre-loaded built-in options are bundled as a JSON file in the app resources and seeded into the database on first launch.

### Bundled defaults

All three corpuses share the same SQLite table and `CorpusEntry` runtime type. They are distinguished by the `category` column and are never mixed — the UI enforces that only camera body entries appear in the camera body dropdown, etc.

When a user creates a new entry, the UI presents structured input fields specific to that category and combines them into the stored string:
- **Camera body**: Manufacturer + Model → `"Canon EOS R5"`
- **Lens**: Manufacturer + Focal Length → `"Canon RF 50mm f/1.8"`
- **Film**: Brand + Type + ISO → `"Kodak Portra 400"`

This structured entry form prevents free-form strings and keeps the corpus clean. Once saved, only the combined string is stored and used.

**Camera bodies** — major mirrorless and film camera brands/models covering the likely user base: Canon (EOS R-series, older film bodies), Nikon (Z-series, F-series film bodies), Sony (A7-series), Fujifilm (X-series, GFX), Leica (M-series), Olympus/OM System, Hasselblad.

**Lenses** — a sparse set of canonical examples. Users will primarily add their own.

**Film stocks** — a complete set of commonly shot films:
- Kodak: Portra 160/400/800, Gold 200, UltraMax 400, Ektar 100, ColorPlus 200, Tri-X 400, T-MAX 100/400
- Fujifilm: Superia X-TRA 400, Pro 400H, Velvia 50/100, Provia 100F, Acros 100
- Ilford: HP5 Plus 400, Delta 100/400, FP4 Plus 125, XP2 Super 400
- Cinestill: 800T, 400D, 50D

### Matching rules

All lookups are case-insensitive after Unicode NFC normalization and whitespace trimming. The `value` column stores the canonical casing; search and deduplication compare the lowercase-trimmed form. "KODAK PORTRA 400" and "kodak portra 400" resolve to the same entry.

---

## 7. Mapping & Geocoding

### Recommendation: Mapbox

Mapbox provides all three required capabilities — map rendering, forward geocoding (search), and reverse geocoding (lat/lng → place name) — under a single API key with a generous free tier (50,000 geocoding requests/month free). The user supplies their own Mapbox API key in settings, consistent with the pattern already established for the Claude API key.

| Capability | Service | Notes |
|---|---|---|
| Map rendering (bottom panel + inspector mini-map) | Mapbox GL JS | Vector tiles, fast, good satellite layer |
| Location search (type-ahead in Inspector Panel) | Mapbox Geocoding API v6 | Returns ranked candidates, supports autocomplete mode |
| Reverse geocoding (lat/lng → place name for display) | Mapbox Geocoding API v6 | Used when setting location via pin drag or GPX auto-tag |
| Timezone lookup (lat/lng → IANA timezone) | **Local: `tzf` Rust crate** | Offline, no API call; embeds a compressed timezone polygon database (~5MB). No rate limit or API key needed. |

The timezone lookup is deliberately kept offline. The `tzf` crate (or its Rust port `tzf-rs`) bundles the timezone boundary polygons as a binary resource and resolves any lat/lng to an IANA timezone name in <1ms with no network call. This is used to power the location/timezone mismatch alert in the Inspector Panel and the Vibe Tag timezone inference.

### Map components

**Bottom Map Panel**: Full Mapbox GL JS map with clustering (via `mapbox-gl-js` built-in cluster source). Photos are represented as a GeoJSON `FeatureCollection` updated reactively as locations change. GPX routes are rendered as `LineLayer` sources.

**Inspector Panel mini-map**: A small, non-clustered Mapbox GL JS instance showing a single draggable marker. Pan or drag the marker to update the location. Kept intentionally minimal — no satellite layer, no controls except the marker.

Both map instances share the same Mapbox access token from app settings.

### GPX time matching

When "Locate Photos on GPX" is triggered, each photo's wall-clock timestamp (interpreted in the session's Working Time Zone) is compared against the UTC timestamps in the GPX track. The matching strategy:

"Locate Photos on GPX" is only enabled when all selected photos have a timezone set and all share the same timezone. If either condition is not met, clicking the button shows an informational dialog explaining the requirement rather than proceeding. This eliminates any ambiguity in the UTC conversion step.

When the conditions are met, matching proceeds as follows:

1. Convert each photo's wall-clock time to UTC using the shared timezone.
2. Find the nearest GPX track point to that UTC time.
3. If the nearest point is within a **60-second tolerance window**, assign its coordinates to the photo. If it falls outside the window, the photo is excluded from auto-tagging (counted in the "X out of Y" confirmation dialog but not tagged).
4. If a photo falls exactly between two track points, linearly interpolate the lat/lng between them proportional to the time delta.

The 60-second tolerance is fixed and not user-configurable in the first version.

---

## 8. Vibe Tag: Claude Integration

### Model: `claude-sonnet-4-6`

Sonnet is the right balance for this task. The operation is: parse natural language → extract structured field values → optionally call a geocoding tool. This does not require Opus-level reasoning. Sonnet produces reliable structured outputs via tool use and responds faster and at lower cost, which matters for an interactive chat-like UX.

### Architecture

The Vibe Tag runs entirely client-side (frontend TypeScript calling the Claude API directly via HTTPS). There is no server. The user's API key is stored in the macOS Keychain via Tauri's secure storage API and injected into API calls at request time — it is never written to disk in plaintext.

```
User input
    │
    ▼
Build prompt + conversation history (messages[])
    │
    ▼
Claude API (claude-sonnet-4-6, tool_use)
    │
    ├─► tool call: geocode_location(query)
    │       │
    │       ├─► Mapbox Geocoding API → { lat, lng, display_name }
    │       └─► tzf-rs (Rust) → iana_timezone
    │           (combined result returned to Claude as tool_result)
    │
    └─► final response: MetadataProposal JSON
            │
            ▼
    Display preview in UI
            │
    ┌───────┴────────┐
    │                │
"Accept"        "Follow Up"
    │                │
    ▼                ▼
Queue as         Append assistant proposal
pending          + user follow-up to messages[]
changes               │
                      └─► (back to Claude API with
                              full conversation history)
```

### System prompt

The system prompt is assembled fresh for each conversation. It includes:

1. **Role and constraints** — the model's only job is to return a structured metadata proposal or a single error string. No prose, no explanation.
2. **Current date** — injected so relative dates ("Christmas last year", "last Tuesday") can be resolved correctly.
3. **Selected photo count** — so the model understands scale ("these 12 photos").
4. **Current metadata state** — the existing values for selected photos (or "multiple values" for fields that differ across selection), so the model can reason about partial updates.
5. **Field definitions** — exactly what fields can be set and their expected formats.

```
You are a photo metadata assistant. Your only job is to interpret the user's 
description and return a JSON metadata proposal, or respond with the exact 
string "I couldn't figure out what you meant" if the input cannot be mapped 
to the available fields.

Today's date: {{ISO_DATE}}
Selected photos: {{COUNT}}
Current metadata: {{JSON_SUMMARY}}

Available fields:
- capture_date: ISO 8601 date (YYYY-MM-DD)
- capture_time: 24-hour time (HH:MM:SS)
- timezone: IANA timezone name
- camera_body: string
- lens: string
- film: { brand: string, type: string, iso: number }
- location: call the geocode_location tool to resolve a place name to coordinates

Rules:
- Only include fields the user's input explicitly addresses. Do not infer or 
  populate fields that were not mentioned.
- Do not include explanation or prose in your response.
- If any field value is ambiguous or unresolvable, omit that field rather 
  than guessing, unless you can ask a clarifying question (which is only 
  allowed if the response is a Follow Up turn).
```

### Tool definition

```json
{
  "name": "geocode_location",
  "description": "Resolve a place name or address to GPS coordinates and timezone. Call this whenever the user's input references a location.",
  "input_schema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "The place name or address to look up, as specific as possible."
      }
    },
    "required": ["query"]
  }
}
```

When Claude calls `geocode_location`, the frontend calls the Mapbox Geocoding API to resolve the place name to coordinates, then invokes the Rust backend's `resolve_timezone` command (backed by `tzf-rs`) to convert the coordinates to an IANA timezone. The combined result is returned to Claude as a `tool_result` block:

```json
{
  "lat": 37.7694,
  "lng": -122.4862,
  "display_name": "Golden Gate Park, San Francisco, CA, USA",
  "iana_timezone": "America/Los_Angeles"
}
```

Mapbox does not return timezone data; the `iana_timezone` field is always resolved offline via `tzf-rs` after the Mapbox call completes. Claude then includes the resolved coordinates in its final `MetadataProposal`. The `iana_timezone` is available for Claude to include in the proposal if the user's input implies a timezone (e.g., referencing a foreign city).

### Response schema

The model's final response (when successful) is a JSON object conforming to:

```typescript
interface MetadataProposal {
  capture_date?: string;       // "2025-03-15"
  capture_time?: string;       // "14:30:00"
  timezone?: string;           // "America/Los_Angeles"
  camera_body?: string;
  lens?: string;
  film?: { brand: string; type: string; iso: number };
  location?: { lat: number; lng: number; display_name: string };
}
```

The frontend validates this schema on receipt. If validation fails or the response is the error string, it shows the error message. If valid, it renders a preview of the proposed changes in the Vibe Tag section before the user accepts.

### Conversation continuity (Follow Up)

The `messages` array is maintained in `SessionContext` state and scoped to the current photo selection. When the selected photo set changes, the conversation history is cleared — it is stale and irrelevant to a different set of photos. The history is also cleared when the Vibe Tag panel is closed or the session is cleared. It is never persisted to SQLite.
