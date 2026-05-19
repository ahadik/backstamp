# Technical Architecture

## 0. Platform Support

**Target platform:** macOS only.

**Minimum macOS version:** macOS 14 (Sonoma). The app targets the macOS 26 design language (liquid glass, SF Pro) and is developed and tested on macOS 26 (Darwin 25). macOS 14 is the practical minimum given Tauri v2's WKWebView requirements and the system Perl dependency.

**Architecture:** Apple Silicon (arm64) is the primary target. Intel (x86_64) Macs are supported — ExifTool's library files are pure Perl and architecture-neutral; the Tauri build system handles the binary side.

**System Perl dependency:** ExifTool is a Perl script that requires `/usr/bin/perl`. System Perl ships with all macOS versions 12–16 (current). Apple deprecated it in macOS 12.3 with a warning that it may be removed in a future release, but has not removed it as of macOS 26. This is a known risk with no fixed mitigation timeline. A future hardening option is to use `pp` (PAR::Packer) to compile ExifTool + its library + a minimal Perl runtime into a single self-contained Mach-O binary, eliminating the system Perl dependency entirely.

---

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
backstamp/
├── src/                          # React/TypeScript frontend
│   ├── components/
│   │   ├── TopBar/               # Apply, Roll Back, Reset
│   │   ├── ApplyModal/           # Two-phase apply progress overlay (applying → undoing)
│   │   ├── ImportModal/          # Import progress overlay (progress bar, error list)
│   │   ├── SettingsModal/        # API key management (Mapbox, Google Maps, Anthropic)
│   │   ├── common/
│   │   │   ├── CameraConflictDialog/  # Gap-drop camera data conflict resolution
│   │   │   ├── ConfirmDialog/         # Generic confirmation overlay
│   │   │   ├── CorpusComboBox/        # Searchable corpus-backed dropdown
│   │   │   ├── DevLogModal/           # Dev-mode error log viewer
│   │   │   └── ErrorModal/            # User-facing error display
│   │   ├── PhotoManager/
│   │   │   ├── FloatingControls/ # Import Photos, Remove, Grid Size +/-
│   │   │   ├── SubBar/           # Secondary action bar
│   │   │   └── PhotoGrid/        # Tile grid; PhotoTile per photo
│   │   │       ├── PhotoTile/    # Thumbnail img, pending-change dot, missing-file state
│   │   │       ├── DayBlockHeader/  # Sticky day group headers
│   │   │       ├── GapDropZone/     # Drag-and-drop insertion targets
│   │   │       └── GpxTile/         # GPX file tile with route thumbnail
│   │   ├── InspectorPanel/
│   │   │   ├── DateTimeSection/  # Date, time, timezone, hour-increment controls
│   │   │   ├── LocationSection/  # Mapbox mini-map + geocoding search + timezone mismatch alert
│   │   │   ├── CameraSection/    # Make, Model, Lens, Film corpus comboboxes
│   │   │   └── VibeTagSection/   # Claude chat interface for natural-language tagging
│   │   └── MapPanel/             # Full-width bottom map overlay with clustering + GPX routes
│   ├── state/
│   │   ├── SessionContext.tsx    # useReducer + Context: photos, selection, pending, undo history, GPX
│   │   ├── CorpusContext.tsx     # useReducer + Context: camera/lens/film options with vendor support
│   │   ├── UIContext.tsx         # useReducer + Context: grid columns, map height, timezone, API keys
│   │   ├── DevLogContext.tsx     # Dev-mode console error/warning capture
│   │   └── selectors.ts         # groupPhotosByDay(), flatOrderedPhotos()
│   ├── hooks/
│   │   ├── useDragDrop.ts
│   │   └── useMetadataInheritance.ts
│   ├── styles/
│   │   ├── tokens.css            # CSS custom properties: color, spacing, typography, radius
│   │   ├── layout.css            # Layered overlay layout
│   │   ├── typography.css        # SF Pro font stack + type scale
│   │   └── components.css        # Liquid glass button, input, dropdown base styles
│   └── lib/
│       ├── tauri.ts              # Typed wrappers for all Tauri IPC commands
│       ├── applyUtils.ts         # Builds ApplyPayload with UTC offset computation
│       ├── gpxMatching.ts        # Track-point matching + GPS interpolation
│       ├── inspectorUtils.ts     # deriveFieldValue(), buildPendingChange()
│       ├── timezone.ts           # DST-correct UTC offset calculation
│       ├── timezones.ts          # IANA timezone list
│       └── vibeTag.ts            # Claude API client + tool-use loop + proposal validation
│
└── src-tauri/
    ├── resources/                # Bundled assets (not committed to git)
    │   ├── exiftool              # ExifTool CLI script (from official macOS .pkg)
    │   └── lib/                  # ExifTool Perl library (Image/ and File/ subdirectories)
    ├── tests/
    │   └── import_integration.rs # Integration tests (DB schema, path key stability)
    ├── src/
    │   ├── lib.rs                # AppState, plugin wiring, command registration
    │   ├── commands/             # Tauri IPC commands (called from frontend)
    │   │   ├── session.rs        # load_session, clear_session
    │   │   ├── photos.rs         # import_photos, find_xmp_sidecars, remove_photos, reorder_photos
    │   │   ├── metadata.rs       # apply_changes, apply_cancel, rollback, reset_photos, set/clear_pending_changes
    │   │   ├── thumbnails.rs     # get_thumbnail
    │   │   ├── corpus.rs         # load/add/remove/record corpus entries
    │   │   ├── gpx.rs            # import_gpx, remove_gpx, save_gpx_thumbnail
    │   │   ├── timezone.rs       # resolve_timezone (via tzf-rs)
    │   │   ├── context_menu.rs   # show_photo_context_menu (native macOS)
    │   │   └── settings.rs       # get_setting, set_setting (SQLite-backed)
    │   ├── exiftool.rs           # ExiftoolProcess: -stay_open mode, run_command, extract_preview, read_metadata
    │   ├── write_metadata.rs     # Field-to-ExifTool tag translation, inline + XMP sidecar writes
    │   ├── thumbnail.rs          # SHA-256 keyed thumbnail generation (Lanczos3)
    │   ├── session.rs            # SQLite schema, migrations (v0–v7), init_db, apply_schema
    │   ├── gpx.rs                # GPX file parsing and track-point extraction
    │   ├── corpus_seed.rs        # Seeded camera/lens/film data
    │   └── main.rs               # Tauri CLI entry point
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
  thumbnail: { small: string; large: string };  // asset:// URLs via convertFileSrc
  originalMetadata: Metadata;  // snapshot at import, never mutated
  currentMetadata: Metadata;   // includes applied + pending changes
  pendingChanges: Partial<Metadata> | null;
}

interface Metadata {
  captureDate: string | null;  // ISO 8601 date-only "YYYY-MM-DD"
  captureTime: string | null;  // "HH:MM:SS"
  utcOffset: string | null;    // e.g. "-07:00"; computed and written separately from timezone
  timezone: string | null;     // IANA name e.g. "America/Los_Angeles"
  gpsLat: number | null;
  gpsLng: number | null;
  cameraMake: string | null;   // e.g. "Canon"
  cameraModel: string | null;  // e.g. "EOS R5"; null when cameraMake is null
  lens: string | null;
  filmVendor: string | null;   // e.g. "Kodak"
  filmType: string | null;     // e.g. "Portra 400"; null when filmVendor is null
}

interface SessionState {
  photos: Photo[];
  selectedIds: Set<string>;
  gpxFiles: GpxFile[];
  selectedGpxId: string | null;    // mutually exclusive with photo selection
  applyInProgress: boolean;
  canRollback: boolean;
  metadataHistory: MetadataSnapshot[];  // max 50 snapshots; supports UNDO_LAST_EDIT
}

type SessionAction =
  | { type: 'IMPORT_PHOTOS'; photos: Photo[] }
  | { type: 'IMPORT_PHOTO_PROGRESS'; photo: Photo | null; error: string | null }
  | { type: 'SELECT'; id: string; mode: 'single' | 'shift' | 'cmd' }
  | { type: 'SELECT_SINGLE'; id: string }
  | { type: 'TOGGLE_SELECT'; id: string }
  | { type: 'SELECT_RANGE'; id: string }
  | { type: 'SELECT_ALL' }
  | { type: 'DESELECT_ALL' }
  | { type: 'SELECT_GPX'; id: string }
  | { type: 'SET_PENDING'; ids: string[]; changes: Partial<Metadata> }
  | { type: 'SET_PENDING_BATCH'; updates: Array<{ id: string; changes: Partial<Metadata> }> }
  | { type: 'CLEAR_PENDING'; ids: string[] }
  | { type: 'APPLY_START' }
  | { type: 'APPLY_COMPLETE'; updatedPhotos: Photo[] }
  | { type: 'ROLLBACK_COMPLETE'; restoredPhotos: Photo[] }
  | { type: 'RESET_PHOTOS'; restoredPhotos: Photo[] }
  | { type: 'REMOVE_PHOTOS'; ids: string[] }
  | { type: 'MARK_MISSING'; ids: string[] }
  | { type: 'ADD_GPX'; gpxFile: GpxFile }
  | { type: 'REMOVE_GPX'; id: string }
  | { type: 'UPDATE_GPX_THUMBNAIL'; id: string; thumbnailPath: string }
  | { type: 'REORDER_PHOTOS'; orderedIds: string[] }
  | { type: 'RESTORE_SESSION'; photos: Photo[]; gpxFiles: GpxFile[]; canRollback: boolean }
  | { type: 'CLEAR_SESSION' }
  | { type: 'UNDO_LAST_EDIT' }
```

```typescript
// state/UIContext.tsx
interface UIState {
  workingTimezone: string;       // IANA name, display-only
  gridColumns: number;           // target number of columns in the photo grid
  panelWidth: number;            // px width of the PhotoManager panel (set by ResizeObserver)
  mapPanelHeight: number;        // px height of the floating map overlay
  mapboxToken: string | null;    // loaded from SQLite settings on app start
  googleMapsKey: string | null;  // loaded from SQLite settings on app start
  claudeApiKey: string | null;   // loaded from SQLite settings on app start
  error: string | null;          // surface non-fatal errors in the UI
}
```

Changes to `workingTimezone`, `gridColumns`, and `mapPanelHeight` are auto-saved to the Rust backend via `set_setting` (with a 500 ms debounce on `mapPanelHeight`) so they survive app restarts.

```typescript
// state/DevLogContext.tsx  (development only)
// Patches console.warn, console.error, window.onerror, unhandledrejection, and fetch
// responses at module load time to capture a DevLogEntry[] ring buffer. A DevLogModal
// component (visible only in dev builds) surfaces the buffer for debugging Tauri IPC issues.
```

```typescript
// state/CorpusContext.tsx
// Make and Model maintain separate corpora. Model entries are associated with a
// Make at creation time; the Model dropdown is disabled until a Make is selected
// and shows only models previously used with that Make. Removing a film vendor
// cascades to delete all its associated film types.
interface CorpusEntry {
  value: string;
  isBuiltin: boolean;
  lastUsed: number | null;
  useCount: number;
  vendor?: string | null;  // camera make for camera_model entries; film vendor for film_type entries
}

interface CorpusState {
  cameraMakeOptions: CorpusEntry[];   // e.g. "Canon", "Nikon"
  cameraModelOptions: CorpusEntry[];  // vendor = associated make; filtered by selected Make at render time
  lensOptions: CorpusEntry[];
  filmVendors: CorpusEntry[];         // e.g. "Kodak", "Fujifilm"
  filmTypes: CorpusEntry[];           // vendor = associated film vendor; filtered by selected vendor at render time
}
```

`RECORD_USE` promotes legacy null-vendor entries to vendor-specific entries when the selected Make or film vendor is known at time of use. `REMOVE_ENTRY` for a `film_vendor` cascades to remove all `film_type` entries whose `vendor` matches. Sorting: recently-used entries (non-null `lastUsed`) appear first, ordered by `lastUsed` descending; never-used entries follow alphabetically.

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

No CSS framework or utility library is used. Styling is handled through a small set of plain CSS files loaded globally, plus per-component CSS Modules for component-specific styles. The visual language follows **macOS 26**: SF Pro typography, system semantic colors, liquid glass controls, and a consistent border-radius scale.

### File structure

```
src/styles/
├── tokens.css        # All design tokens as CSS custom properties on :root
├── layout.css        # Layered layout: photo grid base + floating overlay positioning
├── typography.css    # SF Pro font stack and type scale
└── components.css    # Base styles: liquid glass button, input, dropdown, divider
```

Each component directory contains a `ComponentName.module.css` for styles specific to that component. Only tokens and layout helpers cross module boundaries — no global class soup.

### tokens.css

All values are defined as CSS custom properties on `:root`. Components reference tokens directly; no magic numbers in component stylesheets.

**Color** — macOS 26 system semantic colors via CSS `color-mix` and `-apple-system` keywords where supported, with explicit fallbacks for WKWebView. All color tokens are defined for both light and dark mode. Dark mode activates automatically via `@media (prefers-color-scheme: dark)` — there is no in-app toggle.

Light mode defaults (on `:root`):
- `--color-bg`: primary window background
- `--color-surface`: secondary fill (inspector panel cards)
- `--color-border`: separator / divider
- `--color-text`: primary label
- `--color-text-secondary`: secondary label
- `--color-accent`: tint color (system blue)
- `--color-danger`: destructive action (system red)
- `--color-glass-bg`: `rgba(255,255,255,0.08)` — liquid glass fill
- `--color-glass-border`: `rgba(255,255,255,0.14)` — liquid glass stroke

Dark mode overrides (inside `@media (prefers-color-scheme: dark)` on `:root`): all of the above tokens are re-declared with darker values. `--color-glass-bg` and `--color-glass-border` use a white-tinted alpha fill in both modes because liquid glass relies on the content behind it; only the alpha values shift slightly darker.

**Spacing** — 4px base unit: `--space-1` (4px) through `--space-8` (32px).

**Border radius** — multiples of the 4px base unit:
- `--radius-sm`: 4px
- `--radius-md`: 8px
- `--radius-lg`: 12px
- `--radius-xl`: 16px
- `--radius-2xl`: 24px

**Typography** — see `typography.css`.

**Blur** — `--blur-glass: 20px` — used for all liquid glass backdrop filters.

**Z-index layers** — explicit layer tokens keep overlay stacking deterministic:
- `--z-photos`: 0 — photo grid base
- `--z-map`: 10 — map overlay
- `--z-inspector`: 20 — inspector panel
- `--z-floating-controls`: 30 — import/timezone/grid-size controls floating over grid
- `--z-topbar`: 40 — top bar

### layout.css

The app uses a **layered overlay** model rather than a strict CSS Grid with fixed rows. The photo grid fills the entire content area and scrolls; all other UI elements float above it at defined z-index levels.

```
┌─────────────────────────────────────────────┐  ← TopBar (z:40, backdrop-blur, position:sticky)
│  [Import Photos]          [US Pacific] [⊞]  │  ← floating controls (z:30, absolute)
│  ┌──────────────────────┐ ┌────────────────┐ │
│  │                      │ │ Inspector      │ │  ← Inspector (z:20, absolute right, backdrop-blur)
│  │   photo grid         │ │ Panel          │ │
│  │   (scrolls behind    │ │                │ │
│  │   all overlays)      │ │                │ │
│  │                      │ └────────────────┘ │
│  │  ┌────────────────┐  │                    │
│  │  │   Map overlay  │  │                    │  ← Map (z:10, absolute bottom, backdrop-blur)
│  │  └────────────────┘  │                    │
│  └──────────────────────┘                    │
└─────────────────────────────────────────────┘
```

- **App shell** — `position: relative; overflow: hidden` container filling the viewport.
- **Photo grid** — `position: absolute; inset: 0; overflow-y: auto; z-index: var(--z-photos)`. Scrolls independently.
- **TopBar** — `position: sticky; top: 0; z-index: var(--z-topbar)` with `backdrop-filter: blur(var(--blur-glass))`.
- **Floating controls** — `position: absolute; top: ...; left: ...; z-index: var(--z-floating-controls)`.
- **Inspector panel** — `position: absolute; top: 0; right: 0; bottom: 0; z-index: var(--z-inspector)` with `backdrop-filter: blur(var(--blur-glass))`.
- **Map panel** — `position: absolute; bottom: 0; left: 0; right: var(--inspector-width); z-index: var(--z-map)` with `backdrop-filter: blur(var(--blur-glass))`. Height is controlled by a CSS variable updated on drag.

### typography.css

macOS 26 SF Pro font stack applied to `body`:

```css
font-family: -apple-system, "SF Pro Display", "SF Pro Text",
             BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
```

Four-step type scale (xs / sm / base / lg), weight utilities, and line-height variants. Applied to `body`; component stylesheets compose from these.

### components.css

Base styles for shared interactive primitives. The primary button style is **liquid glass**:

```css
.btn-glass {
  background: var(--color-glass-bg);
  border: 1px solid var(--color-glass-border);
  border-radius: var(--radius-lg);
  backdrop-filter: blur(var(--blur-glass));
  -webkit-backdrop-filter: blur(var(--blur-glass));
  color: var(--color-text);
}
```

Standard system-tinted buttons (Apply, Roll Back) use macOS 26 system button colors via `-apple-system-*` color keywords with explicit hex fallbacks. Inspector panel section cards use `--color-surface` with `--radius-xl` and a 1px `--color-border` stroke.

### CSS Modules

Each component imports its own `.module.css`. Component styles use tokens directly (e.g. `border-radius: var(--radius-lg)`) and do not hardcode values. This keeps component styles self-contained and avoids specificity conflicts.

---

## 3. Metadata I/O

### ExifTool (bundled)

**ExifTool** is the only library that reliably handles all of the PRD's target file formats (CR3, NEF, ARW, RAF, etc.) and all three metadata standards (EXIF, XMP, IPTC). No pure-Rust or pure-JS alternative comes close in format coverage.

ExifTool is a Perl script (`#!/usr/bin/env perl`) distributed with a companion Perl library. The official macOS `.pkg` installer places the script at `/usr/local/bin/exiftool` and its library tree (`Image/` and `File/` subdirectories) at `/usr/local/bin/lib/`. The script's own `BEGIN` block adds `lib/` relative to its own location to `@INC`, so script and library just need to be siblings — no hardcoded system paths.

Both are bundled inside the Tauri app's resources directory (`src-tauri/resources/`) and invoked as a subprocess. The only remaining runtime dependency is system Perl at `/usr/bin/perl` — see §0 for the status and risk assessment of that dependency.

**Setup (developer):** Install the ExifTool `.pkg` from exiftool.org, then:
```sh
cp /usr/local/bin/exiftool src-tauri/resources/exiftool
cp -r /usr/local/bin/lib/ src-tauri/resources/lib/
```
These files are excluded from git (`.gitignore`). The `tauri.conf.json` `bundle.resources` field includes them in production builds.

**Runtime state:** The Rust backend holds a single `AppState` managed by Tauri:
```rust
pub struct AppState {
    pub db: Arc<Mutex<rusqlite::Connection>>,
    pub exiftool: Arc<Mutex<ExiftoolProcess>>,
    pub thumbnails_dir: PathBuf,
}
```
`ExiftoolProcess` is started once at app launch and shared across all commands via `Arc<Mutex<...>>`. SQLite operations and ExifTool commands are serialised through their respective mutexes. Background import threads clone the `Arc` handles rather than holding `State<'_>` references across thread boundaries.

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
- **Large** (2560px longest edge) — used when the tile renders large enough to benefit. 2560px covers a full-panel tile on a 4K display when `gridColumns = 1`.

Both are stored as JPEG at 85% quality. The grid loads the small version by default; the large version is swapped in when the tile's rendered width exceeds 400px (computed from `panelWidth` and `gridColumns` in `UIContext`).

**Source by file type:**

- **JPEG / TIFF** — decoded and resized directly using the Rust `image` crate.
- **HEIC and all RAW formats** — the `image` crate does not support HEIC or proprietary RAW formats natively. ExifTool extracts the largest available embedded JPEG preview (`-b -PreviewImage`; fallback: `-b -JpgFromRaw`) to a tempfile, which is then decoded and resized by the `image` crate. No full RAW decode is required. If no embedded preview is available, the file is reported as a failed import for that step.

Thumbnails are keyed by SHA-256 of the source file's absolute path. If both sizes already exist on disk when `import_photos` is called (e.g. re-importing after a restart), generation is skipped — the existing files are returned immediately.

Thumbnails are stored in the session's app data directory (see §5) keyed by a hash of the absolute file path. They survive app restarts (they are part of the session) and are discarded when the session is cleared.

### Import pipeline

Import is asynchronous. When files are added (via file picker, Finder drop, or directory walk), the Rust backend processes them in a background thread and streams progress to the frontend via Tauri events:

```
Frontend                          Rust backend
   │                                   │
   │── invoke('import_photos', paths) ──►│  (returns Ok immediately)
   │                                   │  spawns background thread
   │◄── emit('import:start', {total})──│
   │                                   │  for each file:
   │◄── emit('import:progress', {      │    generate thumbnails (image crate / ExifTool)
   │      done: N, total: M,           │    read metadata (ExifTool -json)
   │      photo: PhotoData | null,     │    insert to SQLite
   │      error: string | null         │    emit progress event
   │    }) ────────────────────────────│
   │                                   │
   │◄── emit('import:complete') ───────│
```

`PhotoData` in the progress payload carries `thumbnailSmall` and `thumbnailLarge` as absolute file paths. The frontend converts them to `asset://localhost/...` URLs via `convertFileSrc` from `@tauri-apps/api/core` before storing them in `SessionContext`. The asset protocol is enabled in `tauri.conf.json` with `security.assetProtocol.enable = true` and scoped to the app data directory.

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
~/Library/Application Support/backstamp/
├── session.db              # SQLite — session state, history, corpus, settings
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
  nodateorder INTEGER,           -- display order within the No Date block
  sort_order  INTEGER DEFAULT 0  -- explicit user-controlled ordering (set by reorder_photos)
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
  id             TEXT PRIMARY KEY,
  file_path      TEXT NOT NULL,
  added_at       INTEGER NOT NULL,
  track_points   TEXT,            -- JSON-serialized TrackPoint[] (lat, lng, timestamp_utc)
  thumbnail_path TEXT             -- absolute path to the PNG route thumbnail
);

-- Camera/lens/film corpus (persists across session clears)
-- Each category is a distinct corpus; entries are not shared across categories.
-- Make and Model are stored separately. Model entries are associated with a Make
-- at creation time via the 'vendor' column (vendor = make value for camera_model rows).
-- Film types are associated with a film vendor similarly (vendor = film vendor value).
-- The Model dropdown in the UI filters to only show models whose vendor matches the
-- currently selected Make; selecting a different Make clears the Model selection.
CREATE TABLE corpus (
  category    TEXT NOT NULL,   -- 'camera_make' | 'camera_model' | 'lens' | 'film_vendor' | 'film_type'
  value       TEXT NOT NULL,   -- e.g. "Canon", "EOS R5", "Canon RF 50mm f/1.8", "Kodak", "Portra 400"
  vendor      TEXT,            -- non-NULL for 'camera_model' (= the make) and 'film_type' (= the film vendor)
  is_builtin  INTEGER NOT NULL DEFAULT 0,
  last_used   INTEGER,         -- epoch ms, for "recently used" sorting
  use_count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (category, value)
);

-- Per-photo keyword tags (reserved for future use)
CREATE TABLE photo_keywords (
  photo_id TEXT NOT NULL,
  keyword  TEXT NOT NULL,
  PRIMARY KEY (photo_id, keyword),
  FOREIGN KEY (photo_id) REFERENCES photos(id)
);

-- Persistent app settings including API keys and UI state
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
  -- keys: mapbox_token, google_maps_key, claude_api_key,
  --       ui.workingTimezone, ui.gridColumns, ui.mapPanelHeight
);
```

**Session clear** drops and recreates all tables except `corpus` and `settings`. The corpus and settings are intentionally decoupled so they survive clears.

### Schema migrations

`session.rs` ships a sequential migration system. On startup `init_db` reads the current `PRAGMA user_version`, then applies any pending migrations up to the latest version:

| Version | Change |
|---|---|
| v1 | Add `sort_order` column to `photos` |
| v2 | Create `settings` table |
| v3 | Add `vendor` column to `corpus`; migrate legacy `"film"` rows into `film_vendor` + `film_type` pairs |
| v4 | Seed film corpus (Kodak, Fujifilm, Ilford, Cinestill) |
| v5 | Add `track_points` and `thumbnail_path` columns to `gpx_files` |
| v6 | Seed camera make/model corpus (Canon, Nikon, Sony, Fujifilm, Leica, Olympus/OM System, Hasselblad) |
| v7 | Split legacy `camera_body` corpus rows (`"Make Model"` strings) into separate `camera_make` + `camera_model` entries using a known-makes priority list |

---

## 6. Camera / Lens / Film Corpus

Stored in the `corpus` SQLite table (see §5). The pre-loaded built-in options are bundled as a JSON file in the app resources and seeded into the database on first launch.

### Bundled defaults

All three corpuses share the same SQLite table and `CorpusEntry` runtime type. They are distinguished by the `category` column and are never mixed — the UI enforces that only camera body entries appear in the camera body dropdown, etc.

When a user creates a new entry, the UI presents structured input fields specific to that category:
- **Camera body**: Manufacturer + Model → combined display string `"Canon EOS R5"`
- **Lens**: Manufacturer + Focal Length → combined display string `"Canon RF 50mm f/1.8"`
- **Film**: Two-level selection — Vendor (e.g. `"Kodak"`) then Type (e.g. `"Portra 400"`). Vendor and Type are stored separately as `film_vendor` and `film_type` corpus entries. The display string `"Kodak Portra 400"` is derived at render time. New film entries are created by selecting or creating a Vendor, then adding a Type under it.

This structured entry form prevents free-form strings and keeps the corpus clean.

**Camera bodies** — major mirrorless and film camera brands/models covering the likely user base: Canon (EOS R-series, older film bodies), Nikon (Z-series, F-series film bodies), Sony (A7-series), Fujifilm (X-series, GFX), Leica (M-series), Olympus/OM System, Hasselblad.

**Lenses** — a sparse set of canonical examples. Users will primarily add their own.

**Film stocks** — pre-loaded as Vendor → Type pairs covering commonly shot films:
- Kodak: Portra 160, Portra 400, Portra 800, Gold 200, UltraMax 400, Ektar 100, ColorPlus 200, Tri-X 400, T-MAX 100, T-MAX 400
- Fujifilm: Superia X-TRA 400, Pro 400H, Velvia 50, Velvia 100, Provia 100F, Acros 100
- Ilford: HP5 Plus 400, Delta 100, Delta 400, FP4 Plus 125, XP2 Super 400
- Cinestill: 800T, 400D, 50D

### Matching rules

All lookups are case-insensitive after Unicode NFC normalization and whitespace trimming. The `value` column stores the canonical casing; search and deduplication compare the lowercase-trimmed form. For film, matching is applied independently to Vendor and Type — "KODAK" and "kodak" resolve to the same vendor; "PORTRA 400" and "portra 400" resolve to the same type under that vendor.

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
- camera_make: string  (manufacturer, e.g. "Canon")
- camera_model: string  (body name, e.g. "EOS R5"; only valid when camera_make is also provided)
- lens: string
- film: string
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
  camera_make?: string;
  camera_model?: string;  // only set when camera_make is also provided
  lens?: string;
  film?: string;
  location?: { lat: number; lng: number; display_name: string };
}
```

The frontend validates this schema on receipt. If validation fails or the response is the error string, it shows the error message. If valid, it renders a preview of the proposed changes in the Vibe Tag section before the user accepts.

---

## 9. Testing

### Strategy

Two independent test suites run without a live Tauri process or ExifTool binary. The split follows the language boundary: TypeScript tests use Vitest, Rust tests use Cargo's built-in harness.

**What is deliberately excluded from CI:**
- E2E / Tauri driver tests — require a compiled `.app` bundle and a display server. Deferred until the feature surface stabilizes (Phase 8+).
- Visual regression — screenshot diffing is not worth the maintenance cost while the design is actively evolving.
- Benchmark tests — Rust's `criterion` crate can be added later if thumbnail throughput becomes a concern.

### Frontend: Vitest + React Testing Library

**Config:** `vite.config.ts` (shared with the build, no separate Vitest config file). `jsdom` is the test environment. `globals: true` injects `describe`/`it`/`expect`/`vi` without explicit imports. `src/test/setup.ts` imports `@testing-library/jest-dom` and stubs `ResizeObserver` (not implemented in jsdom).

**Tauri IPC mock:** Tests that import `src/lib/tauri.ts` mock `@tauri-apps/api/core` via `vi.mock()`. This verifies the argument shapes passed to `invoke` without requiring a running Tauri backend.

**Context hook mock:** Component tests that render components using `useSession` or `useUI` mock those hooks directly via `vi.mock()` and `vi.mocked(...).mockReturnValue(...)`, injecting arbitrary state without mounting providers.

**Coverage:**

| File | What is tested |
|---|---|
| `state/SessionContext.tsx` | All reducer actions: selection modes, `IMPORT_PHOTO_PROGRESS`, `SET_PENDING`/`CLEAR_PENDING`, `APPLY_START`/`APPLY_COMPLETE`, `ROLLBACK_COMPLETE`, `REMOVE_PHOTOS`, `MARK_MISSING`, `ADD_GPX`/`REMOVE_GPX`, `REORDER_PHOTOS`, `UNDO_LAST_EDIT`, `CLEAR_SESSION`, `RESTORE_SESSION` |
| `state/UIContext.tsx` | `SET_WORKING_TIMEZONE`, `SET_GRID_COLUMNS`, `SET_MAP_PANEL_HEIGHT`, `SET_MAPBOX_TOKEN`, `SET_GOOGLE_MAPS_KEY`, `SET_CLAUDE_API_KEY`; auto-save side effects |
| `state/CorpusContext.tsx` | `LOAD_CORPUS`, `ADD_ENTRY` (deduplication, trimming, vendor association), `REMOVE_ENTRY` (case-insensitive, cascading film type delete), `RECORD_USE` (legacy entry promotion) |
| `state/selectors.ts` | `groupPhotosByDay()` grouping and ordering; `flatOrderedPhotos()` |
| `lib/tauri.ts` | All IPC command wrappers — correct `invoke` command string and argument shape |
| `lib/applyUtils.ts` | `buildApplyPayload()` with UTC offset computation for DST edge cases |
| `lib/gpxMatching.ts` | `matchToTrack()` within/outside tolerance, linear interpolation between track points |
| `lib/inspectorUtils.ts` | `deriveFieldValue()` for all field types; `buildPendingChange()` |
| `lib/timezone.ts` | `getUtcOffset()` — DST-correct offset for summer/winter dates, multiple timezones |
| `lib/vibeTag.ts` | `validateProposal()` — valid/invalid date, time, timezone, camera, lens, film, location shapes |
| `hooks/useDragDrop.ts` | Drag state machine: dragstart, dragover, dragleave, drop; gap vs. photo-tile targets |
| `hooks/useMetadataInheritance.ts` | GPS interpolation; timestamp inheritance from adjacent photos; GPX matching |
| `components/.../PhotoTile` | `ok` / `missing` file states, pending dot visibility, context menu trigger |
| `components/.../PhotoGrid` | Day block grouping, empty state, `ResizeObserver` integration, gap drop zone rendering |
| `components/.../ImportModal` | Progress rendering, error list, skip count, Done button visibility |
| `components/.../ApplyModal` | Progress bar, cancel button, undo progress phase, error display |
| `components/.../SettingsModal` | Key input masking, show/hide toggle, test button, remove action |
| `components/.../TopBar` | Apply/Rollback/Reset button enabled states |
| `components/.../DateTimeSection` | Date/time input, timezone dropdown, hour-increment control |
| `components/.../CameraSection` | Corpus dropdown filtering by selected Make; new entry flow |
| `components/.../VibeTagSection` | Claude proposal rendering, accept/follow-up actions, empty-key prompt |
| `components/.../MapPanel` | Map rendering guard (no key), photo cluster count |
| `components/.../CameraConflictDialog` | Conflict prompt rendering, keep/replace actions |

### Rust: Cargo

**Unit tests** live in `#[cfg(test)]` modules at the bottom of each source file. They have access to private functions within the same module.

**Integration tests** live in `src-tauri/tests/`. They compile the library crate as a normal dependency (without `#[cfg(test)]` on the lib side) and only access `pub` items. `session` and `thumbnail` are declared `pub mod` in `lib.rs` for this reason.

**In-memory database:** `session::apply_schema(&conn)` is extracted from `init_db` as a `pub fn` so tests can call it on a `rusqlite::Connection::open_in_memory()` without touching the filesystem.

**Coverage:**

| File | What is tested |
|---|---|
| `session.rs` | Schema creates all tables; round-trip insert/select for `photos`, `metadata_original`, `metadata_current`; `apply_schema` idempotency |
| `thumbnail.rs` | `path_key` determinism, hex format, uniqueness; `save_thumbnail` no-upscale (source ≤ target), landscape resize, portrait resize |
| `commands/photos.rs` | `parse_exiftool_output`: date/time parsing, Make+Model join, GPS sign (N/S/W/E), XMP preference over EXIF, missing-field `None`, film always `None`, error on empty/invalid JSON |
| `tests/import_integration.rs` | DB schema round-trips for all three relevant tables; thumbnail path key stability (pre-existing stubs trigger early return) |

**Tests requiring ExifTool** are gated with `#[ignore]` and excluded from the default `cargo test` run. Run them with `cargo test -- --ignored` in an environment where `src-tauri/resources/exiftool` is present.

### Conversation continuity (Follow Up)

The `messages` array is maintained in `SessionContext` state and scoped to the current photo selection. When the selected photo set changes, the conversation history is cleared — it is stale and irrelevant to a different set of photos. The history is also cleared when the Vibe Tag panel is closed or the session is cleared. It is never persisted to SQLite.

---

## 10. Settings & API Key Management

### Storage

**API keys** are stored in the macOS Keychain via the `keyring` crate (`com.alexhadik.backstamp` service). Keys are encrypted at rest by the OS, never appear in SQLite or any plaintext file, and are excluded from unencrypted backups.

**Non-sensitive UI preferences** persist in the `settings` SQLite table via the generic `get_setting` / `set_setting` commands.

Three keys are managed in the Keychain:

| Account name | Used by |
|---|---|
| `mapbox_token` | Map rendering, geocoding fallback, GPX route thumbnails (§7, §3) |
| `google_maps_key` | Location type-ahead and coordinate lookup when set; Mapbox used as fallback otherwise |
| `claude_api_key` | Vibe Tag natural-language metadata entry (§8) |

UI state that persists across restarts is stored in SQLite via `get_setting`/`set_setting`:

| Setting key | Default | Notes |
|---|---|---|
| `ui.workingTimezone` | system timezone | Updated immediately on change |
| `ui.gridColumns` | 6 | Updated immediately on change |
| `ui.mapPanelHeight` | — | Updated with 500 ms debounce |

### Tauri commands

```rust
// commands/api_keys.rs  — Keychain-backed
#[tauri::command] async fn get_api_key(account: String) -> Result<Option<String>, String>
#[tauri::command] async fn set_api_key(account: String, value: String) -> Result<(), String>
#[tauri::command] async fn delete_api_key(account: String) -> Result<(), String>
#[tauri::command] async fn test_api_key(account: String, key: String) -> Result<bool, String>

// commands/settings.rs  — SQLite-backed (non-sensitive preferences only)
#[tauri::command] async fn get_setting(key: String) -> Result<Option<String>, String>
#[tauri::command] async fn set_setting(key: String, value: String) -> Result<(), String>
```

`get_api_key` / `set_api_key` / `delete_api_key` are thin wrappers over the `keyring` crate. On startup, `migrate_keys_from_sqlite` runs once: any API key values still in the `settings` table (from the earlier SQLite-only implementation) are moved to the Keychain and deleted from the database.

Validation is performed on the Rust side via `test_api_key` using `reqwest` — the key is never passed through a JS network call. The frontend calls `tauriCommands.testApiKey(account, key)` and receives a `boolean`. The Rust implementation makes the cheapest possible probe request per service:
- **Anthropic** — `POST /v1/messages` with `max_tokens: 1`. A non-`401` status confirms the key (rate-limit and other non-auth errors still mean the key itself is valid).
- **Mapbox** — `GET /geocoding/v5/mapbox.places/test.json?access_token=<key>&limit=1`. HTTP `200` confirms the key.
- **Google Maps** — `POST /v1/places:autocomplete` with `X-Goog-Api-Key` header. A successful response containing a `suggestions` array (and no `error` field) confirms the key (requires Places API (New) enabled in Google Cloud Console).

### Settings UI

The Settings panel is a full-window modal overlay (`SettingsModal` component) — a distinct component from `InspectorPanel`, not a conditional state of it. It is opened from a gear icon in the top bar and rendered above all other UI layers at a `z-index` above `--z-topbar`. Closing it returns the app to exactly the state it was in before opening; API key values in `UIContext` are refreshed from SQLite when the modal closes.

```
src/components/
└── SettingsModal/
    ├── SettingsModal.tsx
    └── SettingsModal.module.css
```

Each key field follows this pattern:
1. Labelled `<input type="password">` pre-filled with the masked value (e.g. `pk.ey••••••••XXXX`) on load if a key is stored.
2. **Show / Hide** toggle (`type="text"` ↔ `type="password"`) reveals the full key.
3. **Test** button calls the appropriate service endpoint and shows an inline success/error badge.
4. **Remove** button clears the field and deletes the value from SQLite.
5. Changes are saved automatically on blur (no explicit Save button).

### Feature gating

Key presence is read from `UIContext` (`mapboxToken`, `googleMapsKey`, `claudeApiKey`), which loads all three from SQLite on app start. Components consuming these values:
- `VibeTagSection` — renders a "Set Anthropic API key in Settings" prompt when `claudeApiKey` is `null`.
- `LocationSection` (mini-map), `MapPanel`, and location type-ahead — render a "Set Mapbox API key in Settings" prompt when `mapboxToken` is `null`.
- `LocationSection` type-ahead — uses Google Maps Places API when `googleMapsKey` is set; falls back to Mapbox Geocoding otherwise.
- GPX import handler — surfaces a Settings prompt before opening the file picker when `mapboxToken` is `null`.
