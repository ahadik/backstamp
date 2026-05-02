# Phase 0: App Scaffold

Goal: a buildable, installable Tauri app with the correct file structure, working UI shell, state management wiring, and stubbed Rust commands. No real metadata I/O, no thumbnails, no maps. Every major subsystem has a starting point that later phases can flesh out.

---

## Step 1 — Project Bootstrap

**Deliverable:** `npm run tauri dev` launches a blank window with no errors.

- Ensure NVM is installed. Run `nvm install --lts` to install the latest LTS Node release, then `nvm use --lts` to activate it.
- Create a `.nvmrc` file at the repo root containing the resolved LTS version (e.g. `v22.14.0`) so that `nvm use` with no arguments pins the project to the same version for all contributors and future sessions.
- Scaffold the project files manually (Tauri's CLI requires an interactive TTY and cannot run non-interactively in all environments). The required files are: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`.
- Add Cargo dependencies to `src-tauri/Cargo.toml`:
  - `rusqlite` + `rusqlite_bundled` feature
  - `serde` + `serde_json`
  - `tauri-plugin-single-instance`
  - `tauri-plugin-dialog`
  - `tauri-plugin-fs`
  - `uuid`
  - `tokio` (async runtime)
- Add npm dependencies:
  - `mapbox-gl` + `@types/mapbox-gl`
  - `@anthropic-ai/sdk`
- Register `tauri-plugin-single-instance` in `src-tauri/src/lib.rs`.
- **Icons:** Tauri's `generate_context!()` proc macro requires at least one valid PNG icon at compile time. Place a source icon at `src-tauri/icons/icon.png` and use `sips` to resize it to `32x32.png`, `128x128.png`, and `128x128@2x.png`. A proper icon set will be created in a later phase; the placeholder is enough to build.
- Confirm `cargo check` and `npm run build` both pass with no errors (blank window is fine).

---

## Step 2 — Design System

**Deliverable:** CSS tokens and layout primitives are importable; the app window renders with macOS 26 typography, liquid glass controls, and the correct z-index layer tokens in place.

Create the following files under `src/styles/`:

### `tokens.css`
Define CSS custom properties on `:root`:
- **Color**: macOS 26 semantic palette — `--color-bg`, `--color-surface`, `--color-border`, `--color-text`, `--color-text-secondary`, `--color-accent`, `--color-danger`. Liquid glass variants: `--color-glass-bg` (`rgba(255,255,255,0.08)`), `--color-glass-border` (`rgba(255,255,255,0.14)`).
- **Dark mode**: immediately after the `:root` light-mode block, add a `@media (prefers-color-scheme: dark)` block on `:root` that overrides all color tokens with dark-appropriate values. No in-app toggle — the app always follows the system setting. Example dark values: `--color-bg: #1c1c1e`, `--color-surface: #2c2c2e`, `--color-border: rgba(255,255,255,0.12)`, `--color-text: #f5f5f7`, `--color-text-secondary: rgba(245,245,247,0.55)`, `--color-glass-bg: rgba(255,255,255,0.06)`, `--color-glass-border: rgba(255,255,255,0.10)`. Accent and danger colors can remain the same system values in both modes.
- **Spacing**: `--space-1` (4px) through `--space-8` (32px) on a 4px base unit.
- **Typography**: see `typography.css`.
- **Radius** — 4px base unit multiples: `--radius-sm` (4px), `--radius-md` (8px), `--radius-lg` (12px), `--radius-xl` (16px), `--radius-2xl` (24px).
- **Blur**: `--blur-glass: 20px`.
- **Z-index layers**: `--z-photos: 0`, `--z-map: 10`, `--z-inspector: 20`, `--z-floating-controls: 30`, `--z-topbar: 40`.
- **Transition**: `--transition-fast` (`150ms ease`).
- **Layout**: `--inspector-width: 320px`, `--map-panel-height: 220px`.

### `layout.css`
The layout uses a **layered overlay** model — the photo grid fills the full viewport and all other UI floats above it:
- `.app-shell` — `position: relative; width: 100vw; height: 100vh; overflow: hidden`.
- `.photo-grid-layer` — `position: absolute; inset: 0; overflow-y: auto; z-index: var(--z-photos)`.
- `.photo-grid` — `display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--tile-size, 160px), 1fr))`.
- `.map-overlay` — `position: absolute; bottom: 0; left: 0; right: var(--inspector-width); z-index: var(--z-map); height: var(--map-panel-height); backdrop-filter: blur(var(--blur-glass))`.
- `.inspector-overlay` — `position: absolute; top: 0; right: 0; bottom: 0; width: var(--inspector-width); z-index: var(--z-inspector); backdrop-filter: blur(var(--blur-glass))`.
- `.floating-controls` — `position: absolute; z-index: var(--z-floating-controls)`.
- Flex helpers: `.row`, `.col`, `.row-center`, `.gap-1` through `.gap-4`, `.flex-1`.

### `typography.css`
- macOS 26 SF Pro font stack on `body`: `-apple-system, "SF Pro Display", "SF Pro Text", BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif`.
- Type scale classes: `.text-xs` (11px), `.text-sm` (12px), `.text-base` (14px), `.text-lg` (16px).
- Weight utilities: `.font-medium`, `.font-bold`.

### `components.css`
- `.btn` base — shared padding, font, cursor, transition.
- `.btn-glass` — liquid glass: `background: var(--color-glass-bg); border: 1px solid var(--color-glass-border); border-radius: var(--radius-lg); backdrop-filter: blur(var(--blur-glass)); -webkit-backdrop-filter: blur(var(--blur-glass))`.
- `.btn-primary` — system accent color fill (Apply button).
- `.btn-ghost` — transparent with border.
- `.btn-danger` — system red.
- `.input` base style.
- `.section-label` — small caps, secondary color, used in Inspector section headers.
- `.divider` — 1px rule using `--color-border`.
- `.inspector-card` — `background: var(--color-surface); border-radius: var(--radius-xl); border: 1px solid var(--color-border)`.

Import all four files in `src/main.tsx` (global scope).

---

## Step 3 — App Shell Layout

**Deliverable:** The app window shows the layered shell — photo grid as base layer, TopBar sticky at top, floating controls over the grid, Inspector overlay on the right, Map overlay at the bottom — with correct proportions and no functionality.

### `src/components/TopBar/TopBar.tsx`
Sticky bar at the top (`position: sticky; top: 0; z-index: var(--z-topbar)`). Uses `backdrop-filter: blur(var(--blur-glass))` so photos scroll behind it. Contains three disabled buttons using macOS 26 system styling: **Apply** (`.btn-primary`), **Roll Back** (`.btn-glass`), **Reset All Photos** (`.btn-glass`). No logic. Styled with `TopBar.module.css`.

### `src/components/PhotoManager/PhotoManager.tsx`
The photo grid base layer. Fills the full available area (`position: absolute; inset: 0; overflow-y: auto; z-index: var(--z-photos)`). Contains:
- `FloatingControls` — a `.floating-controls` div pinned to the top-left of the grid. Contains an **Import Photos** button and a disabled **Remove Selected Photos** button (both `.btn-glass`). A **Working Time Zone** pill and **Grid Size** control float top-right (but still within the photo manager area, left of the inspector).
- `PhotoGrid` — the scrollable grid container. Shows a placeholder "No photos imported" message when empty.

### `src/components/InspectorPanel/InspectorPanel.tsx`
Right-side overlay (`position: absolute; top: 0; right: 0; bottom: 0; width: var(--inspector-width); z-index: var(--z-inspector)`). Has `backdrop-filter: blur(var(--blur-glass))`. Contains four section stubs, each rendered as an `.inspector-card` with a `.section-label` heading and an empty body:
- **Date & Time**
- **Location**
- **Camera Details**
- **Vibe Tag**

### `src/components/MapPanel/MapPanel.tsx`
Bottom overlay (`position: absolute; bottom: 0; left: 0; right: var(--inspector-width); height: var(--map-panel-height); z-index: var(--z-map)`). Has `backdrop-filter: blur(var(--blur-glass))` and `border-radius: var(--radius-xl) var(--radius-xl) 0 0` on the top edge. Contains only a placeholder label. A drag handle at the top edge is rendered but not yet functional.

### `src/App.tsx`
Compose the shell:
```tsx
<div className="app-shell">
  <TopBar />
  <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
    <PhotoManager />   {/* base layer, fills and scrolls */}
    <InspectorPanel /> {/* absolute right overlay */}
    <MapPanel />       {/* absolute bottom overlay */}
  </div>
</div>
```

---

## Step 4 — State Management Scaffolding

**Deliverable:** Three context providers wrap the app; components can call `useSession`, `useCorpus`, `useUI` without errors; the reducer handles a placeholder no-op action.

### `src/state/SessionContext.tsx`
- Define `Metadata`, `Photo`, `GpxFile`, `SessionState` interfaces matching the architecture doc.
- Implement a `sessionReducer` with cases for every `SessionAction` type from the architecture doc; most can be stubs that return `state` unchanged for now, except `CLEAR_SESSION` (returns `initialState`).
- Export `SessionProvider` and `useSession` hook.

### `src/state/CorpusContext.tsx`
- Define `CorpusEntry`, `CorpusState` interfaces.
- Stub reducer and provider. `cameraOptions`, `lensOptions`, `filmOptions` all start as empty arrays.
- Export `CorpusProvider` and `useCorpus` hook.

### `src/state/UIContext.tsx`
- Define `UIState`: `workingTimezone` (default `"America/Los_Angeles"`), `gridTileSize` (default `0.2`), `mapPanelHeight` (default `200`).
- Stub reducer and provider.
- Export `UIProvider` and `useUI` hook.

Wrap all three providers around `<App />` in `src/main.tsx`.

---

## Step 5 — Rust Backend Scaffolding

**Deliverable:** The Rust side compiles with stub commands; the frontend can `invoke` each command and receive a typed response (even if it's a no-op).

### File layout under `src-tauri/src/`:
```
commands/
  session.rs     — load_session, clear_session
  photos.rs      — import_photos, remove_photos
  metadata.rs    — apply_changes, rollback, reset_photos
  thumbnails.rs  — get_thumbnail
exiftool.rs      — ExiftoolProcess struct (empty, starts/stops a subprocess placeholder)
session.rs       — SQLite init, schema creation
gpx.rs           — parse_gpx stub
corpus.rs        — load_corpus, save_corpus stubs
main.rs          — register all commands
```

Each command stub returns `Ok(())` or a minimal typed value (e.g. `Ok(Vec::<String>::new())`). The goal is that the frontend's `invoke` calls type-check against these signatures.

### SQLite initialization
In `session.rs`, implement `init_db()`: opens (or creates) `session.db` in the Tauri app data directory and runs the full `CREATE TABLE IF NOT EXISTS` schema from the architecture doc (all tables: `photos`, `metadata_original`, `metadata_current`, `apply_ops`, `apply_history`, `gpx_files`, `corpus`).

Call `init_db()` on app startup in `main.rs`.

### `src/lib/tauri.ts`
Typed wrappers for every Tauri command using `invoke`:
```typescript
export const tauriCommands = {
  loadSession: () => invoke<SessionState>('load_session'),
  clearSession: () => invoke<void>('clear_session'),
  importPhotos: (paths: string[]) => invoke<void>('import_photos', { paths }),
  removePhotos: (ids: string[]) => invoke<void>('remove_photos', { ids }),
  applyChanges: (payload: ApplyPayload) => invoke<void>('apply_changes', { payload }),
  rollback: () => invoke<void>('rollback'),
  resetPhotos: (ids: string[]) => invoke<void>('reset_photos', { ids }),
  getThumbnail: (photoId: string) => invoke<string>('get_thumbnail', { photoId }),
};
```

---

## Step 6 — File Import Entry Point

**Deliverable:** Clicking "Select Photos" opens a native file picker; selected paths are logged to the console (no import logic yet). This validates the Tauri dialog plugin is wired up correctly.

- In `SubBar`, wire the **Select Photos** button to `@tauri-apps/plugin-dialog`'s `open()` with `multiple: true` and a file filter for all supported extensions.
- On selection, `console.log` the returned paths for now.
- Confirm the file picker opens and returns paths on macOS.

---

## What this scaffold does NOT include

Each of the following is a separate planning phase to be written and implemented after the scaffold is confirmed working:

- Thumbnail generation and display (Phase 1)
- Testing infrastructure (Phase 2)
- Full import pipeline with metadata reading (Phase 3)
- Photo grid with day blocks, selection, drag-and-drop (Phase 4)
- Inspector Panel fields with live editing (Phase 5)
- Apply / Rollback / Reset pipeline (Phase 6)
- Map Panel (Mapbox) + Location section (Phase 7)
- GPX import and auto-tagging (Phase 8)
- Camera/Lens/Film corpus UI (Phase 9)
- Vibe Tag / Claude integration (Phase 10)
- Session persistence and restore (Phase 11)
