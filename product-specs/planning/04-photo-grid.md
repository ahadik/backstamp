# Phase 4: Photo Grid — Day Blocks, Selection, Drag-and-Drop

Goal: transform the flat photo grid into a fully interactive, chronologically organized layout. Photos are grouped into day blocks sorted by capture date in the working timezone. Clicking selects photos (single, shift-range, cmd-toggle). Dragging a photo or selection onto another photo or into a gap applies metadata inheritance rules. Dragging from Finder triggers the existing import pipeline.

---

## Step 1 — Chronological Sorting and Day Block Grouping

**Deliverable:** Photos are sorted and rendered in date-grouped sections with a sticky day header. Photos without a capture date appear in a "No Date" block at the top.

### Sorting logic

Add a `sortedAndGroupedPhotos` selector (a plain function, not a hook) to `src/state/selectors.ts`:

```ts
export type DayBlock = {
  dateKey: string;        // "YYYY-MM-DD" or "no-date"
  label: string;          // "Wednesday, April 30, 2025" or "No Date"
  photos: Photo[];
};

export function groupPhotosByDay(photos: Photo[], workingTimezone: string): DayBlock[]
```

Rules:
- A photo belongs to the day of its `captureDate` in `workingTimezone`. Because `captureDate` is already a calendar date string from EXIF (`"YYYY-MM-DD"`), timezone conversion is only needed when a UTC offset is present and differs from the working timezone — adjust the date if the local calendar date differs.
- Photos without `captureDate` → `dateKey: "no-date"`.
- Sort order: `"no-date"` block first, then day blocks ascending by date.
- Within each block: ascending by `captureTime` (nulls last), then by `filePath` as tiebreak.

### PhotoGrid changes

Replace the flat `photos.map(...)` in `PhotoGrid.tsx` with `groupPhotosByDay(photos, workingTimezone)` and render:

```
DayBlockHeader (sticky within scroll container)
  photo tiles in grid layout
DayBlockHeader
  photo tiles ...
```

### `DayBlockHeader` component (`src/components/PhotoManager/PhotoGrid/DayBlockHeader.tsx`)

- Styled with `DayBlockHeader.module.css`. `.dayBlockHeader` uses `position: sticky; top: <TopBar height>` so the label stays visible as the user scrolls through a long day.
- Layout: date string left-aligned, photo count right-aligned via flexbox class `.row`.
- Inner label uses `.section-label`; a `.divider` renders below the header row.

### Grid layout adjustment

Each day block is its own CSS grid container (same `grid-template-columns` rule as today). The block header spans full width above its grid. This means tiles do not flow across day boundaries, which is intentional.

### State wiring

`UIContext` already holds `workingTimezone`. Read it in `PhotoGrid` via `useUI()`.

---

## Step 2 — Photo Selection

**Deliverable:** Clicking a tile selects it (highlighted border). Shift-click extends a range. Cmd/Ctrl-click toggles. Clicking the grid background deselects all.

### Click handling on `PhotoTile`

`PhotoTile` already receives `photo` and `isSelected` props. Add:
- `onClick: (e: React.MouseEvent) => void`

The handler lives in `PhotoGrid` (it has the full ordered list needed for shift-range logic):

```ts
function handleTileClick(photo: Photo, e: React.MouseEvent) {
  if (e.shiftKey && lastClickedId) {
    // build range across the flat ordered list
    dispatch({ type: 'SELECT_RANGE', fromId: lastClickedId, toId: photo.id });
  } else if (e.metaKey || e.ctrlKey) {
    dispatch({ type: 'TOGGLE_SELECT', id: photo.id });
  } else {
    dispatch({ type: 'SELECT_SINGLE', id: photo.id });
  }
  setLastClickedId(photo.id);
}
```

`lastClickedId` is local `useState` in `PhotoGrid` — it does not need to be global state.

### `SELECT_RANGE` reducer action

The existing `SessionContext` reducer should handle `SELECT_RANGE` using the flat ordered photo list. The flat ordered list is derived from `groupPhotosByDay` — produce it in the reducer by iterating the current `photos` array with the same sort (the reducer has access to `state.photos`). Add a `REORDER_PHOTOS` action that stores the canonical sorted order in state so that range selection and drag-drop both reference the same order.

Alternatively (simpler): compute the flat sorted order in `PhotoGrid` and pass it to both the click handler and the range dispatch as a payload:

```ts
dispatch({ type: 'SELECT_RANGE', fromId, toId, orderedIds: flatOrderedIds });
```

The reducer then just slices `orderedIds` between the two anchors and adds them all to `selectedIds`.

### Visual selection state on `PhotoTile`

When `isSelected`:
- `outline: 2px solid var(--color-accent); outline-offset: -2px` (inset so layout doesn't shift).
- A semi-transparent accent overlay (`rgba(accent, 0.15)`) covers the tile.
- A checkmark badge (SF Symbols–style, or a simple ✓) appears in the top-left corner.

### Background click to deselect

Attach an `onClick` on the `.photo-grid-layer` div that fires `DESELECT_ALL` when the click target is the layer itself (check `e.target === e.currentTarget`).

### Keyboard shortcuts

Handle in `PhotoGrid` via `useEffect` + `document.addEventListener`:
- `Cmd+A` → `SELECT_ALL`
- `Escape` → `DESELECT_ALL`
- `Delete` / `Backspace` → dispatch a `REQUEST_REMOVE_SELECTED` action (or directly call `removePhotos`; details in Phase 5)

---

## Step 3 — In-Grid Drag-and-Drop for Reordering

**Deliverable:** A photo (or a selected group) can be dragged to a new position within the grid. Gap drop zones render a blue insertion line. Photo drop zones render a darkened overlay. Dropping triggers metadata inheritance.

### Drop zone architecture

Two kinds of drop targets:

**Gap drop zones** — thin invisible `<div>` elements placed between every pair of adjacent tiles within a day block (and before the first tile and after the last). On `dragover`, the nearest gap shows a blue 2px vertical line. On `drop`, the dragged photos are inserted at that position and their timestamps are interpolated between the gap's neighbors.

**Photo drop zones** — the tile itself. On `dragover`, a darkened overlay appears. On `drop`, the dragged photos inherit all metadata from the target photo.

**"No Date" block** — accepts drops from other blocks (clears captureDate/captureTime) and allows reordering within the block (no metadata change).

### `useDragDrop` hook (`src/hooks/useDragDrop.ts`)

Manages drag state for the entire grid (not per-tile):

```ts
type DragState = {
  draggingIds: string[];          // the photo(s) being dragged
  overGap: GapTarget | null;      // { beforeId: string | null, afterId: string | null, dayKey: string }
  overPhotoId: string | null;
};

export function useDragDrop(
  orderedIds: string[],
  onDrop: (draggingIds: string[], target: DropTarget) => void
): {
  dragHandlers: (photoId: string) => DragHandlers;
  gapProps: (gap: GapTarget) => GapProps;
  tileDropProps: (photoId: string) => TileDropProps;
  dragState: DragState;
}
```

The hook is instantiated once in `PhotoGrid` and props are spread onto each tile and gap element.

**Drag start:** set `draggingIds` = `selectedIds` if the dragged photo is selected, else `[photo.id]` (and temporarily select just that photo).

**Drag image:** use `setDragImage` to show a stacked thumbnail preview. If multiple photos, show up to 3 slightly offset thumbnails using a hidden off-screen canvas or absolutely positioned element clipped outside the viewport.

**Drag over gap:** calculate which gap is nearest using `getBoundingClientRect` comparison. Set `overGap`. Prevent default to allow drop.

**Drag over photo:** set `overPhotoId`. Prevent default.

**Drag leave:** clear `overGap` / `overPhotoId` when leaving the grid container entirely.

**Drop:** call `onDrop(draggingIds, target)`.

**Drag end:** always clear all drag state (handles the case where drop occurs outside a valid zone).

### `useMetadataInheritance` hook (`src/hooks/useMetadataInheritance.ts`)

Given the drop event, computes the `pendingChanges` to apply to each dragged photo:

```ts
export function computeInheritance(
  draggingPhotos: Photo[],
  target: DropTarget,
  neighborBefore: Photo | null,
  neighborAfter: Photo | null,
): Map<string, Partial<Metadata>>
```

Rules:

| Drop target | captureDate / captureTime | gpsLat / gpsLng | cameraBody / lens / film |
|---|---|---|---|
| **On a photo** | copy from target | copy from target | copy from target |
| **Gap between two dated photos** | interpolate timestamp linearly between neighbors; same date if same day | interpolate GPS linearly if both have coordinates; else copy from closer neighbor | copy from closer neighbor (by time) |
| **Gap at start of dated block** | copy captureDate from block; set captureTime to first photo's time minus 1 min | copy from first neighbor if present | copy from first neighbor |
| **Gap at end of dated block** | copy captureDate from block; set captureTime to last photo's time plus 1 min | copy from last neighbor if present | copy from last neighbor |
| **"No Date" block (anywhere)** | set captureDate and captureTime to null | no change | no change |

Interpolation for timestamps: linear between `neighborBefore` and `neighborAfter` using the position (index) of each dragged photo within the dragged group.

Interpolation for GPS: linear spherical interpolation (lerp on lat/lng is fine for distances < 100km; note this in a comment).

The result is dispatched as `SET_PENDING_CHANGES` for each affected photo. No metadata is written to disk here — that happens in Phase 6 (Apply pipeline).

### Reordering within the grid

After a drop, update photo order in `SessionState.photos` by dispatching `REORDER_PHOTOS` with the new ordered IDs array. The reducer replaces the array while keeping all photo objects unchanged. The new order is the persisted display order — save it to SQLite (`photos.sort_order` column, added in this phase).

Add `sort_order INTEGER` to the `photos` table. `init_db()` migration: `ALTER TABLE photos ADD COLUMN sort_order INTEGER DEFAULT 0` wrapped in a `PRAGMA user_version` migration guard.

### Rust command: `reorder_photos`

```rust
// commands/photos.rs
#[tauri::command]
pub async fn reorder_photos(ordered_ids: Vec<String>, state: ...) -> Result<(), String>
```

Writes the new `sort_order` values to SQLite in a single transaction. Called after every drop.

---

## Step 4 — Finder Drag-and-Drop Import

**Deliverable:** Dragging image files from Finder onto the app window triggers the import pipeline from Phase 3. A drop overlay appears on hover.

### Drop overlay

A full-viewport overlay styled with a `.dropImportOverlay` class (in a new `DropImportOverlay.module.css`: `position: fixed; inset: 0; z-index: 100`, dashed border, centered label). Rendered when Tauri's `onDragDropEvent` fires `DragDropEvent::Hover`. Hidden otherwise.

### Tauri event wiring

In Phase 3, `import_photos` is already wired. In `src-tauri/src/lib.rs`, register a `on_drag_drop_event` handler:

```rust
.on_drag_drop_event(|event| {
  if let DragDropEvent::Drop { paths, .. } = event.payload() {
    // filter to supported extensions, then invoke import pipeline
    let image_paths: Vec<String> = paths.iter()
      .filter(|p| is_supported_extension(p))
      .map(|p| p.to_string_lossy().to_string())
      .collect();
    if !image_paths.is_empty() {
      // emit import:start event — frontend already handles it
      event.window().emit("import:start", json!({ "total": image_paths.len() })).ok();
      // trigger import in background task
      tokio::spawn(async move { import_photos_internal(image_paths, ...).await });
    }
  }
})
```

Frontend: listen for `DragDropEvent::Hover` to show the overlay, `DragDropEvent::Leave` / `DragDropEvent::Drop` to hide it.

---

## Step 5 — FloatingControls and TopBar Wiring

**Deliverable:** Button labels and enabled states update based on selection. "Remove Selected Photos" / "Remove All Photos" route to the correct action.

### FloatingControls (`src/components/PhotoManager/FloatingControls/FloatingControls.tsx`)

- **Import Photos** button: always enabled. On click: open native file dialog (already wired in Phase 3 scaffold step).
- **Remove Selected Photos** button: enabled only when `selectedIds.size > 0`. Label: "Remove Selected (N)" when N > 0. On click: confirm dialog → `removePhotos(Array.from(selectedIds))`.

### TopBar (`src/components/TopBar/TopBar.tsx`)

- **Apply**: enabled when any photo has `pendingChanges !== null`. (Phase 6 will implement the action; here just wire the enabled state.)
- **Roll Back**: enabled when any `apply_history` record exists. (Same — Phase 6 implements the action; wire enabled state now.)
- **Reset All Photos**: always enabled when photos exist. Label stays "Reset All Photos" regardless of selection — per design, Reset is a separate bulk action from Remove.

---

## Step 6 — Grid Size Control

**Deliverable:** The grid size slider in FloatingControls updates tile size in real time.

### UIContext

`gridColumns` (existing) drives tile size via `tilePx = (panelWidth - gaps) / gridColumns`. The slider adjusts `gridColumns` between 2 and 12.

### GridSizeControl component (`src/components/PhotoManager/FloatingControls/GridSizeControl.tsx`)

An `<input type="range" min={2} max={12} step={1}>` styled as a liquid glass pill. On change: `dispatch({ type: 'SET_GRID_COLUMNS', value: n })`. The value is not persisted — resets to default (5) on session load.

---

## Component and File Checklist

| File | Status | Change |
|---|---|---|
| `src/state/selectors.ts` | **New** | `groupPhotosByDay`, `flatOrderedIds` |
| `src/state/SessionContext.tsx` | Modify | Add `SELECT_RANGE`, `REORDER_PHOTOS` reducer cases; add `orderedIds` payload support |
| `src/hooks/useDragDrop.ts` | **New** | Full drag-drop state machine |
| `src/hooks/useMetadataInheritance.ts` | **New** | Metadata inheritance computation |
| `src/components/PhotoManager/PhotoGrid/PhotoGrid.tsx` | Modify | Day block rendering, click handlers, drag-drop integration |
| `src/components/PhotoManager/PhotoGrid/DayBlockHeader.tsx` | **New** | Sticky date header |
| `src/components/PhotoManager/PhotoGrid/PhotoTile.tsx` | Modify | Selection highlight, drag source, photo drop target |
| `src/components/PhotoManager/PhotoGrid/GapDropZone.tsx` | **New** | Gap insertion target with blue line indicator |
| `src/components/PhotoManager/PhotoGrid/PhotoGrid.module.css` | Modify | Day block layout, selection styles, drop zone styles |
| `src/components/PhotoManager/FloatingControls/GridSizeControl.tsx` | **New** | Column count range slider |
| `src/components/PhotoManager/FloatingControls/FloatingControls.tsx` | Modify | Wire remove button, add GridSizeControl |
| `src/components/TopBar/TopBar.tsx` | Modify | Wire enabled states |
| `src-tauri/src/commands/photos.rs` | Modify | Add `reorder_photos` command |
| `src-tauri/src/session.rs` | Modify | Add `sort_order` column migration |
| `src-tauri/src/lib.rs` | Modify | Register `on_drag_drop_event`, register `reorder_photos` |
| `src/lib/tauri.ts` | Modify | Add `reorderPhotos` typed wrapper |

---

## What This Phase Does NOT Include

- Applying pending changes to disk (Phase 6 — Apply pipeline)
- Inspector panel fields populated from selection (Phase 5)
- Map panel pin rendering for selected photos (Phase 7)
- GPX-based timestamp auto-tagging (Phase 8)
- Working timezone picker UI (referenced in FloatingControls; the data model exists but the picker is Phase 5 or later)
