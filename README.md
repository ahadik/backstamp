# Photo Manager

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

## Build

```sh
npm run tauri build
```

Produces a signed `.app` bundle in `src-tauri/target/release/bundle/`. The `src-tauri/resources/` directory (ExifTool script + library) is included in the bundle automatically via `tauri.conf.json`.

## Project structure

```
photo-manager/
├── src/                            # React + TypeScript frontend
│   ├── components/
│   │   ├── TopBar/                 # Apply, Roll Back, Reset buttons
│   │   ├── ImportModal/            # Import progress overlay
│   │   ├── PhotoManager/
│   │   │   ├── FloatingControls/   # Import Photos, Remove, Grid Size, Working TZ
│   │   │   └── PhotoGrid/          # Thumbnail grid (PhotoTile per photo)
│   │   ├── InspectorPanel/         # Date & Time, Camera, Location, Vibe Tag sections
│   │   └── MapPanel/               # Full-width bottom map overlay
│   ├── state/
│   │   ├── SessionContext.tsx      # Photos, selection, pending changes
│   │   ├── CorpusContext.tsx       # Camera / lens / film option lists
│   │   └── UIContext.tsx           # Working timezone, grid size, map height
│   ├── lib/
│   │   └── tauri.ts                # Typed wrappers for all Tauri IPC commands
│   └── styles/                     # Global CSS design system (tokens, layout, typography, components)
│
└── src-tauri/                      # Rust backend
    ├── resources/
    │   ├── exiftool                # ExifTool CLI script (not committed — see setup)
    │   └── lib/                    # ExifTool Perl library (not committed — see setup)
    └── src/
        ├── commands/               # Tauri IPC handlers (session, photos, metadata, thumbnails)
        ├── exiftool.rs             # ExifTool subprocess (-stay_open mode)
        ├── thumbnail.rs            # Thumbnail generation (image crate + ExifTool for RAW/HEIC)
        ├── session.rs              # SQLite schema + init
        ├── lib.rs                  # AppState, plugin wiring, command registration
        ├── gpx.rs                  # GPX parsing (stub)
        └── corpus.rs               # Camera/lens/film corpus (stub)
```

## Architecture

See [`product-requirements/technical-architecture.md`](product-requirements/technical-architecture.md) for the full technical design. Key decisions:

- **Tauri v2** — native macOS window via WKWebView; Rust handles all file I/O
- **ExifTool** (bundled) — the only tool with full coverage of all target RAW formats and EXIF/XMP/IPTC standards
- **SQLite** (`rusqlite` with bundled feature) — session persistence, rollback history, corpus storage
- **Mapbox** — map rendering, geocoding, and reverse geocoding (user-supplied API key)
- **Claude API** (`claude-sonnet-4-6`) — natural language metadata entry via the Vibe Tag panel (user-supplied API key)
- No external state library — React `useReducer` + `useContext` only

## Product requirements

See [`product-requirements/prd.md`](product-requirements/prd.md).

## Implementation plan

Phased plans live in [`product-requirements/planning/`](product-requirements/planning/).

| Phase | Plan | Status |
|---|---|---|
| 0 — Scaffold | [00-scaffold.md](product-requirements/planning/00-scaffold.md) | Complete |
| 1 — Thumbnail generation & display | [01-thumbnails.md](product-requirements/planning/01-thumbnails.md) | Complete |
| 2 — Full import pipeline + metadata reading | — | Planned |
| 3 — Photo grid: day blocks, selection, drag-and-drop | — | Planned |
| 4 — Inspector Panel fields with live editing | — | Planned |
| 5 — Apply / Rollback / Reset pipeline | — | Planned |
| 6 — Map Panel (Mapbox) + Location section | — | Planned |
| 7 — GPX import and auto-tagging | — | Planned |
| 8 — Camera/Lens/Film corpus UI | — | Planned |
| 9 — Vibe Tag / Claude integration | — | Planned |
| 10 — Session persistence and restore | — | Planned |
