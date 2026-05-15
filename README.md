# Backstamp

A native macOS app for bulk-editing photo metadata. Designed for film photographers and mirrorless camera users whose photos lack GPS, have wrong timestamps, or have no metadata at all. Built with Tauri + React + TypeScript.

## Prerequisites

- [NVM](https://github.com/nvm-sh/nvm) — Node version manager
- [Rust](https://rustup.rs) — via `rustup`
- Xcode Command Line Tools — `xcode-select --install`
- ExifTool — see **ExifTool setup** below

## ExifTool setup

ExifTool must be present in `src-tauri/resources/` before the app will build or run. It is not committed to the repository.

1. Download and run the **macOS Package** installer from [exiftool.org](https://exiftool.org). This installs the ExifTool script to `/usr/local/bin/exiftool` and its companion library to `/usr/local/bin/lib/`.

2. Copy both into the resources directory:

```sh
cp /usr/local/bin/exiftool src-tauri/resources/exiftool
chmod +x src-tauri/resources/exiftool
mkdir -p src-tauri/resources/lib
cp -r /usr/local/bin/lib/ src-tauri/resources/lib/
```

3. Verify:

```sh
src-tauri/resources/exiftool -ver
# should print: 13.55 (or current version)
```

ExifTool is a Perl script. It requires system Perl (`/usr/bin/perl`), which ships with all currently supported macOS versions. See the technical architecture doc for the full bundling story.

## API Keys

Backstamp uses three external API keys, all entered in **Settings** (gear icon in the top bar). Keys are stored in the system keychain and never written to disk in plaintext.

### Mapbox (required)

Required for map rendering, photo clustering, GPX route thumbnails, and location search fallback.

1. Sign up or log in at [mapbox.com](https://www.mapbox.com).
2. Go to **Account → Access tokens**.
3. Copy the **Default public token** (starts with `pk.`), or create a new public token.
4. Paste it into Backstamp → Settings → **Mapbox API Key**.

### Google Maps (optional)

When set, replaces Mapbox for location type-ahead search and coordinate lookup. Map rendering always uses Mapbox regardless.

1. Go to the [Google Cloud Console](https://console.cloud.google.com) and create or select a project.
2. Open **APIs & Services → Library** and enable **Places API (New)**.
   - Do not enable the legacy "Places API" — Backstamp uses the newer v1 API.
3. Open **APIs & Services → Credentials** and click **Create credentials → API key**.
4. Click the pencil icon to edit the new key, then under **API restrictions** choose **Restrict key** and select **Places API (New)**. Save.
   - HTTP referrer restrictions do not apply to a desktop app, so leave application restrictions set to **None**.
5. Paste the key (starts with `AIza`) into Backstamp → Settings → **Google Maps API Key**.

### Anthropic (required for Vibe Tag)

Required for the Vibe Tag natural-language metadata entry panel.

1. Go to [console.anthropic.com](https://console.anthropic.com) and create an API key.
2. Paste it into Backstamp → Settings → **Anthropic API Key**.

## Setup

```sh
nvm use          # picks up .nvmrc
npm install
```

Rust dependencies are fetched automatically by Cargo on first build.

## Development

```sh
npm run tauri dev
```

Starts the Vite dev server and the Tauri window together. Hot-module reload is active for the frontend; Rust changes require a recompile (Tauri handles this automatically).

If ExifTool is not found in `src-tauri/resources/`, the Rust backend falls back to `/opt/homebrew/bin/exiftool` and `/usr/local/bin/exiftool` for development convenience. The bundled copy is required for a production build.

## Testing

Two independent test suites cover the frontend and Rust backend.

**Frontend (Vitest + React Testing Library):**

```sh
npm test                # run once
npm run test:watch      # watch mode
npm run test:coverage   # coverage report
```

Tests live alongside the source they cover (e.g. `SessionContext.test.ts` next to `SessionContext.tsx`). The suite covers state reducers, Tauri IPC argument shapes, utility logic (apply payload building, GPX timestamp matching, timezone offset calculation, metadata field derivation, Claude proposal validation), and component rendering for `PhotoTile`, `PhotoGrid`, `ImportModal`, `ApplyModal`, `SettingsModal`, `DateTimeSection`, `CameraSection`, `MapPanel`, and `TopBar`. Tauri IPC calls are mocked — no running desktop app is required.

**Rust (Cargo):**

```sh
cd src-tauri
cargo test
```

Unit tests live in `#[cfg(test)]` modules inside each source file. Integration tests live in `src-tauri/tests/`. The suite covers thumbnail resize logic, path key derivation, SQLite schema correctness, and metadata parsing from ExifTool JSON output. All tests run without a live ExifTool process — tests that require it are gated with `#[ignore]` and can be run with `cargo test -- --ignored`.

## Build

```sh
npm run tauri build
```

Produces a signed `.app` bundle in `src-tauri/target/release/bundle/`. The `src-tauri/resources/` directory (ExifTool script + library) is included in the bundle automatically via `tauri.conf.json`.

## Project structure

```
backstamp/
├── src/                                    # React + TypeScript frontend
│   ├── components/
│   │   ├── TopBar/                         # Apply, Roll Back, Reset buttons + photo count
│   │   ├── ApplyModal/                     # Two-phase apply progress overlay (applying → undoing)
│   │   ├── ImportModal/                    # Import progress overlay with error list
│   │   ├── SettingsModal/                  # Mapbox & Claude API key management
│   │   ├── common/
│   │   │   ├── CameraConflictDialog/       # Gap-drop camera data conflict resolution
│   │   │   ├── ConfirmDialog/              # Generic confirmation overlay
│   │   │   └── CorpusComboBox/             # Searchable corpus-backed dropdown (make/model/lens/film)
│   │   ├── PhotoManager/
│   │   │   ├── FloatingControls/           # Import Photos, Remove, Grid Size controls
│   │   │   ├── SubBar/                     # Secondary action bar
│   │   │   └── PhotoGrid/                  # Thumbnail grid
│   │   │       ├── PhotoTile.tsx           # Individual photo tile with pending-change indicator
│   │   │       ├── DayBlockHeader.tsx      # Sticky day group headers
│   │   │       ├── GapDropZone.tsx         # Drag-and-drop insertion targets
│   │   │       └── GpxTile.tsx             # GPX file tile with route thumbnail
│   │   ├── InspectorPanel/
│   │   │   ├── DateTimeSection/            # Date, time, timezone, hour-increment controls
│   │   │   ├── CameraSection/              # Make, Model, Lens, Film corpus comboboxes
│   │   │   ├── LocationSection/            # Mapbox mini-map, geocoding search, timezone mismatch alert
│   │   │   └── VibeTagSection/             # Claude chat interface for natural-language tagging
│   │   └── MapPanel/                       # Full-width Mapbox panel with photo clusters + GPX routes
│   ├── hooks/
│   │   ├── useDragDrop.ts                  # Drag-reorder state machine
│   │   └── useMetadataInheritance.ts       # Gap-drop timestamp interpolation + GPS lerp
│   ├── state/
│   │   ├── SessionContext.tsx              # Photos, selection, pending changes, apply history
│   │   ├── CorpusContext.tsx               # Camera / lens / film option lists with recent-use tracking
│   │   ├── UIContext.tsx                   # Grid size, map height, working timezone, API keys
│   │   └── selectors.ts                    # groupPhotosByDay() and flat ordering helpers
│   ├── lib/
│   │   ├── tauri.ts                        # Typed wrappers for all Tauri IPC commands
│   │   ├── applyUtils.ts                   # Builds ApplyPayload with UTC offset computation
│   │   ├── gpxMatching.ts                  # Track-point matching with timestamp interpolation
│   │   ├── inspectorUtils.ts               # deriveFieldValue(), buildPendingChange()
│   │   ├── timezone.ts                     # DST-correct UTC offset calculation
│   │   ├── timezones.ts                    # IANA timezone list
│   │   └── vibeTag.ts                      # Claude API client with tool-use loop + proposal validation
│   ├── test/                               # Test harness setup
│   │   ├── setup.ts                        # jest-dom + ResizeObserver mock
│   │   └── smoke.test.ts
│   └── styles/                             # Global CSS design system (tokens, layout, typography, components)
│
└── src-tauri/                              # Rust backend
    ├── resources/
    │   ├── exiftool                        # ExifTool CLI script (not committed — see setup)
    │   └── lib/                            # ExifTool Perl library (not committed — see setup)
    ├── tests/
    │   └── import_integration.rs           # Integration tests (DB schema, path key stability)
    └── src/
        ├── commands/                       # Tauri IPC handlers
        │   ├── photos.rs                   # import_photos, remove_photos, reorder_photos
        │   ├── session.rs                  # load_session, clear_session
        │   ├── metadata.rs                 # apply_changes, apply_cancel, rollback, reset_photos
        │   ├── thumbnails.rs               # get_thumbnail
        │   ├── corpus.rs                   # load/add/remove/record corpus entries
        │   ├── gpx.rs                      # import_gpx, remove_gpx, save_gpx_thumbnail
        │   ├── timezone.rs                 # resolve_timezone (via tzf-rs v1)
        │   ├── context_menu.rs             # show_photo_context_menu (native macOS)
        │   └── settings.rs                 # get_setting, set_setting (SQLite-backed)
        ├── exiftool.rs                     # ExifTool subprocess (-stay_open mode)
        ├── write_metadata.rs               # Field-to-ExifTool tag translation, inline + XMP sidecar writes
        ├── thumbnail.rs                    # SHA-256 keyed thumbnail generation (Lanczos3)
        ├── session.rs                      # SQLite schema, migrations, init
        ├── gpx.rs                          # GPX parsing + track-point extraction
        ├── corpus_seed.rs                  # Seeded camera/lens/film data
        └── lib.rs                          # AppState, plugin wiring, command registration
```

## Architecture

See [`product-requirements/technical-architecture.md`](product-requirements/technical-architecture.md) for the full technical design. Key decisions:

- **Tauri v2** — native macOS window via WKWebView; Rust handles all file I/O
- **ExifTool** (bundled) — the only tool with full coverage of all target RAW formats and EXIF/XMP/IPTC standards; runs in `-stay_open` mode for low-latency reads; writes via inline temp-file-rename (JPEG/HEIC) or XMP sidecar (RAW)
- **SQLite** (`rusqlite` with bundled feature) — session persistence, rollback history, corpus storage, settings
- **tzf-rs v1** — fast timezone-from-coordinates lookup (no network required)
- **Mapbox GL JS** — map rendering, photo clustering, GPX route overlays, and location search fallback (user-supplied API key)
- **Google Maps Places API (New)** — optional; replaces Mapbox for location type-ahead search and coordinate lookup when a Google Maps key is configured (user-supplied API key)
- **Claude API** (`claude-sonnet-4-6`) — natural language metadata entry via the Vibe Tag panel, with tool use for geocoding (user-supplied API key)
- No external state library — React `useReducer` + `useContext` only

## Product requirements

See [`product-requirements/prd.md`](product-requirements/prd.md).

## Implementation plan

Phased plans live in [`product-requirements/planning/`](product-requirements/planning/).

| Phase | Plan | Status |
|---|---|---|
| 0 — Scaffold | [00-scaffold.md](product-requirements/planning/00-scaffold.md) | Complete |
| 1 — Thumbnail generation & display | [01-thumbnails.md](product-requirements/planning/01-thumbnails.md) | Complete |
| 2 — Full import pipeline + metadata reading | — | Complete |
| 3 — Photo grid: day blocks, selection, drag-and-drop | — | Complete |
| 4 — Inspector Panel fields with live editing | — | Complete |
| 5 — Apply / Rollback / Reset pipeline | — | In Progress |
| 6 — Native macOS context menu | — | Complete |
| 7 — Map Panel (Mapbox) + Location section | — | Complete |
| 8 — GPX import and auto-tagging | — | Complete |
| 9 — Camera/Lens/Film corpus UI | — | Complete |
| 10 — Vibe Tag / Claude integration | — | Complete |
| 11 — Session persistence and restore | — | Complete |
