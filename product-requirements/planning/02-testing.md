# Phase 2: Testing Infrastructure

Goal: establish a two-layer test suite — Vitest + React Testing Library for the frontend, Cargo's built-in harness for the Rust backend — with meaningful coverage of the logic that has been implemented so far (scaffold + thumbnail import pipeline). No E2E or visual regression tests yet; those belong to a later phase after the feature surface stabilizes.

---

## Step 1 — Frontend: Install and Configure Vitest

**Deliverable:** `npm test` runs and exits cleanly. A single smoke-test file passes.

Install dev dependencies:

```
npm install --save-dev vitest @vitest/ui jsdom \
  @testing-library/react @testing-library/user-event \
  @testing-library/jest-dom
```

In `vite.config.ts`, add a `test` block inside the existing `defineConfig`:

```typescript
test: {
  environment: 'jsdom',
  globals: true,
  setupFiles: ['./src/test/setup.ts'],
  include: ['src/**/*.{test,spec}.{ts,tsx}'],
  coverage: {
    provider: 'v8',
    include: ['src/**/*.{ts,tsx}'],
    exclude: ['src/test/**', 'src/main.tsx'],
  },
},
```

Create `src/test/setup.ts`:

```typescript
import '@testing-library/jest-dom';
```

Add scripts to `package.json`:

```json
"test":        "vitest run",
"test:watch":  "vitest",
"test:ui":     "vitest --ui",
"test:coverage": "vitest run --coverage"
```

Create `src/test/smoke.test.ts` with a single assertion (`expect(true).toBe(true)`) and confirm `npm test` passes.

---

## Step 2 — Frontend: State Reducer Tests

**Deliverable:** All three context reducers are tested against their defined action types; edge cases for `UIContext` bounds clamping are verified.

### `src/state/SessionContext.test.ts`

Test the `sessionReducer`:

- `CLEAR_SESSION` returns the initial state.
- `IMPORT_PHOTO_PROGRESS` appends the photo to `state.photos` and does not mutate the original array.
- A second `IMPORT_PHOTO_PROGRESS` with the same `id` as an existing photo does not deduplicate — the reducer appends; deduplication is the caller's responsibility.
- An unknown action type returns the state unchanged.

Construct `Photo` fixtures as plain objects matching the `Photo` interface. Do not import from Tauri — all reducer tests are pure TypeScript, no DOM, no Tauri IPC.

### `src/state/UIContext.test.ts`

Test the `uiReducer`:

- `SET_GRID_TILE_SIZE` with a value of `0.3` sets `gridTileSize` to `0.3`.
- `SET_GRID_TILE_SIZE` with a value below `0.05` clamps to `0.05`.
- `SET_GRID_TILE_SIZE` with a value above `1.0` clamps to `1.0`.
- `SET_MAP_PANEL_HEIGHT` (if present) stores the value in `mapPanelHeight`.
- Unknown action returns state unchanged.

### `src/state/CorpusContext.test.ts`

Test that the initial state has empty arrays for `cameraOptions`, `lensOptions`, `filmOptions`. Test any reducer actions implemented at the time this phase is executed.

---

## Step 3 — Frontend: Utility Tests

**Deliverable:** The Tauri command wrapper utility and any pure helper functions are tested without invoking real Tauri IPC.

### Mocking Tauri

Create `src/test/mocks/tauri.ts`:

```typescript
export const invoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
}));
```

Import and reset this mock in any test that touches `src/lib/tauri.ts`.

### `src/lib/tauri.test.ts`

- Calling `tauriCommands.loadSession()` invokes `invoke` with the string `'load_session'` and no extra arguments.
- Calling `tauriCommands.importPhotos(['/a.jpg', '/b.jpg'])` invokes `invoke` with `'import_photos'` and `{ paths: ['/a.jpg', '/b.jpg'] }`.
- Calling `tauriCommands.getThumbnail('uuid-123')` invokes `invoke` with `'get_thumbnail'` and `{ photoId: 'uuid-123' }`.

These tests verify the argument shapes that the Rust backend depends on. If a command's argument name changes on the TypeScript side, these tests catch it immediately.

---

## Step 4 — Frontend: Component Tests (Phase 1 Components)

**Deliverable:** The three most logic-bearing Phase 1 components render correctly under their key states.

### `src/components/PhotoManager/PhotoGrid/PhotoTile.test.tsx`

Construct a `Photo` fixture with `fileStatus: 'ok'` and a mock `thumbnail.small` URL.

- Renders an `<img>` element when `fileStatus === 'ok'`.
- The `<img>` `src` is the `thumbnail.small` URL when `tilePx <= 400`.
- The `<img>` `src` is the `thumbnail.large` URL when `tilePx > 400`.
- Renders the "File not found" text (not an `<img>`) when `fileStatus === 'missing'`.
- Renders the pending dot element when `photo.pendingChanges` is non-null.
- Does not render the pending dot when `photo.pendingChanges` is null.

### `src/components/PhotoManager/PhotoGrid/PhotoGrid.test.tsx`

Wrap renders in a `SessionProvider` and `UIProvider` (or provide context values directly via a test helper wrapper). Use a `ResizeObserver` mock (jsdom does not implement it):

```typescript
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
```

- Renders "No photos imported" when `photos` is empty.
- Renders one `PhotoTile` per photo when `photos` has entries.
- Does not render "No photos imported" when photos are present.

### `src/components/ImportModal/ImportModal.test.tsx`

- Renders nothing (or is hidden) when `isOpen` is false.
- Renders a progress bar when `isOpen` is true.
- The progress bar inner width reflects the `done / total` ratio.
- Renders error strings when `errors` is non-empty.
- The Done button is not visible while `done < total`.
- The Done button is visible when `done === total` and errors are present.
- Calls `onDismiss` after 600ms when `done === total` and `errors` is empty (use `vi.useFakeTimers()`).

---

## Step 5 — Rust: Unit Tests for Core Logic

**Deliverable:** `cargo test` in `src-tauri/` runs and the critical pure-logic paths in `thumbnail.rs` and the metadata parser are covered.

### Test module setup

Rust tests live in `#[cfg(test)]` blocks at the bottom of each file — no extra test runner required.

For any test that needs a SQLite database, add a helper in `src-tauri/src/test_helpers.rs` (gated with `#[cfg(test)]`):

```rust
#[cfg(test)]
pub fn in_memory_db() -> rusqlite::Connection {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    crate::session::apply_schema(&conn).unwrap();
    conn
}
```

Refactor `init_db()` in `session.rs` to call a separate `apply_schema(conn: &Connection)` function so the schema logic is testable without touching the filesystem.

### `src-tauri/src/thumbnail.rs` tests

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_is_deterministic() { /* same path → same hex key on two calls */ }

    #[test]
    fn small_path_uses_key_suffix() { /* ends with "_small.jpg" */ }

    #[test]
    fn large_path_uses_key_suffix() { /* ends with "_large.jpg" */ }

    #[test]
    fn no_upscale_when_image_smaller_than_target() {
        // If source longest edge is 200px and target is 400px,
        // the output dimensions must equal the source (no upscaling).
    }

    #[test]
    fn resize_preserves_aspect_ratio() {
        // A 1200×800 source resized to fit 400 longest edge
        // must produce a 400×266 (or 266×400 if portrait) result.
    }
}
```

Test `no_upscale` and `resize_preserves_aspect_ratio` against in-memory images created with `image::RgbImage::new(w, h)` — no real files needed.

### `src-tauri/src/session.rs` tests

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::in_memory_db;

    #[test]
    fn schema_creates_photos_table() {
        let conn = in_memory_db();
        // INSERT a row and SELECT it back — proves the table and columns exist.
        conn.execute(
            "INSERT INTO photos (id, file_path, added_at) VALUES (?1, ?2, ?3)",
            ("test-id", "/tmp/a.jpg", "2024-01-01T00:00:00Z"),
        ).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM photos", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn schema_creates_metadata_tables() { /* repeat for metadata_original, metadata_current */ }
}
```

### `src-tauri/src/commands/photos.rs` metadata parsing tests

Extract the metadata-parsing logic (ExifTool JSON → `Metadata` struct) into a standalone function `parse_exiftool_output(json: &str) -> Result<Metadata>` so it can be tested without a live ExifTool process.

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_JSON: &str = r#"[{
        "DateTimeOriginal": "2024:03:15 14:30:00",
        "GPSLatitude": 37.774929,
        "GPSLongitude": -122.419416,
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

    #[test]
    fn joins_make_and_model() {
        let m = parse_exiftool_output(SAMPLE_JSON).unwrap();
        assert_eq!(m.camera_body.as_deref(), Some("Canon EOS R5"));
    }

    #[test]
    fn parses_gps_coordinates() {
        let m = parse_exiftool_output(SAMPLE_JSON).unwrap();
        assert!((m.gps_lat.unwrap() - 37.774929).abs() < 1e-5);
        assert!((m.gps_lng.unwrap() - (-122.419416)).abs() < 1e-5);
    }

    #[test]
    fn returns_none_for_missing_fields() {
        let m = parse_exiftool_output(r#"[{}]"#).unwrap();
        assert!(m.capture_date.is_none());
        assert!(m.camera_body.is_none());
        assert!(m.gps_lat.is_none());
    }

    #[test]
    fn film_is_always_none_in_phase_1() {
        let m = parse_exiftool_output(SAMPLE_JSON).unwrap();
        assert!(m.film.is_none());
    }
}
```

---

## Step 6 — Rust: Integration Tests for the Import Pipeline

**Deliverable:** `cargo test` includes an integration test that exercises the full import path against real files in a temp directory with an in-memory database.

Create `src-tauri/tests/import_integration.rs`. Integration tests in Rust's `tests/` directory are compiled as separate crates and have access to the crate's public API.

```rust
use photo_manager::{session, thumbnail, commands::photos};
use tempfile::TempDir;

fn make_test_jpeg(dir: &TempDir, name: &str, width: u32, height: u32) -> std::path::PathBuf {
    let path = dir.path().join(name);
    let img = image::RgbImage::new(width, height);
    img.save(&path).unwrap();
    path
}

#[test]
fn thumbnails_are_generated_on_import() {
    let src_dir = TempDir::new().unwrap();
    let thumb_dir = TempDir::new().unwrap();
    let src_path = make_test_jpeg(&src_dir, "test.jpg", 1200, 800);

    let paths = thumbnail::generate_thumbnails(&src_path, thumb_dir.path(), /* mock exiftool */ ...)
        .unwrap();

    assert!(paths.small.exists());
    assert!(paths.large.exists());
}

#[test]
fn reimporting_same_path_is_idempotent() {
    // Call generate_thumbnails twice for the same path.
    // Both calls should return Ok and the file should exist.
    // Verify the file's modified time does not change (early-return path was taken).
}

#[test]
fn import_inserts_photo_row_into_db() {
    let conn = photo_manager::test_helpers::in_memory_db();
    // Call the DB-insert logic directly with a known photo_id and path.
    // SELECT COUNT(*) from photos WHERE id = photo_id must return 1.
}
```

Note: tests that require a live ExifTool process should be gated with `#[ignore]` so they are skipped in CI environments where the binary is unavailable, and documented with a comment explaining how to run them locally: `cargo test -- --ignored`.

---

## What this phase does NOT include

The following testing concerns are deferred to later phases:

**E2E / Tauri driver tests** — Tauri's WebdriverIO integration requires a compiled desktop binary, a running display server, and stable command surface. These are expensive to maintain during early development. Defer until Phase 8 or later when the core feature surface is complete.

**Visual regression tests** — Screenshot diffing (e.g. Playwright, Percy) requires a stable design and is not worth the maintenance cost while the UI is actively changing. Defer to post-MVP.

**Performance / benchmark tests** — Thumbnail generation throughput, grid scroll performance at scale. Defer until baseline functionality is solid. Rust's `criterion` crate can be added then.

**Tauri command handler tests** — Testing `#[tauri::command]` handlers in isolation requires mocking `AppHandle` and `State<AppState>`, which involves significant test harness work. For now, the unit tests in Steps 5–6 cover the underlying logic; the command wrappers themselves are thin and lower priority.

**Photo selection, day blocks, drag-and-drop, Inspector Panel, Map Panel** — These components and interactions do not exist yet. Tests for them should be written as part of each feature's planning phase (Phase 3 onwards).
