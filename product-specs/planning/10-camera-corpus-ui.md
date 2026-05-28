# Phase 10: Camera/Lens/Film Corpus UI

## Current state audit

Most of the corpus infrastructure was built in earlier phases. Before implementing, confirm:

| Component | Status |
|---|---|
| `CorpusContext.tsx` — all 4 actions (LOAD, ADD, REMOVE, RECORD_USE) | ✅ Done |
| `CorpusComboBox.tsx` — search, add, remove, italics for unknown values | ✅ Done |
| `CameraSection.tsx` — Make/Model/Lens/Film Vendor/Film Type UI | ✅ Done |
| `commands/corpus.rs` — 4 Rust commands (load, add, remove, record_use) | ✅ Done |
| `corpus_seed.rs` — film vendors + types seeded (~19 vendors, ~198 types) | ✅ Done |
| `lib/tauri.ts` — corpus command wrappers | ✅ Done |
| Camera/lens seed data | ❌ Missing |
| Gap drop camera mismatch dialog | ❌ Missing |
| Dead stub in `src-tauri/src/corpus.rs` | 🧹 Cleanup |

Phase 10 has two deliverables, plus a cleanup item.

---

## Step 1 — Camera and Lens Seed Data

**Deliverable:** On first launch (and idempotently on every launch) the corpus table is pre-populated with camera makes, models, and a sparse lens set. The CameraSection dropdowns are non-empty out of the box.

### 1a. Add data to `src-tauri/src/corpus_seed.rs`

Add two new static arrays alongside the existing film arrays:

```rust
const CAMERA_MAKES: &[&str] = &[
    "Canon", "Fujifilm", "Hasselblad", "Leica", "Nikon",
    "Olympus", "OM System", "Sony",
];

/// (make, model)
const CAMERA_MODELS: &[(&str, &str)] = &[
    // Canon — digital mirrorless
    ("Canon", "EOS R5"),
    ("Canon", "EOS R5 Mark II"),
    ("Canon", "EOS R6 Mark II"),
    ("Canon", "EOS R8"),
    ("Canon", "EOS R50"),
    // Canon — film SLR
    ("Canon", "A-1"),
    ("Canon", "AE-1"),
    ("Canon", "AE-1 Program"),
    ("Canon", "F-1"),
    ("Canon", "New F-1"),

    // Fujifilm — digital X-series
    ("Fujifilm", "X-T5"),
    ("Fujifilm", "X-T4"),
    ("Fujifilm", "X100VI"),
    ("Fujifilm", "X100V"),
    ("Fujifilm", "X-Pro3"),
    ("Fujifilm", "X-S20"),
    // Fujifilm — digital GFX medium format
    ("Fujifilm", "GFX 100S"),
    ("Fujifilm", "GFX 100S II"),
    ("Fujifilm", "GFX 50S II"),

    // Hasselblad
    ("Hasselblad", "X2D 100C"),
    ("Hasselblad", "907X 50C"),

    // Leica — digital
    ("Leica", "M11"),
    ("Leica", "M11-P"),
    ("Leica", "Q3"),
    // Leica — film
    ("Leica", "M6"),
    ("Leica", "M7"),
    ("Leica", "M-A"),

    // Nikon — digital mirrorless
    ("Nikon", "Z6 III"),
    ("Nikon", "Z8"),
    ("Nikon", "Z9"),
    ("Nikon", "Z50 II"),
    ("Nikon", "Zf"),
    ("Nikon", "Zfc"),
    // Nikon — film SLR
    ("Nikon", "F3"),
    ("Nikon", "F100"),
    ("Nikon", "FM2"),
    ("Nikon", "FM2n"),
    ("Nikon", "FE2"),
    ("Nikon", "FA"),

    // Olympus / OM System
    ("Olympus", "OM-1"),
    ("Olympus", "OM-10"),
    ("OM System", "OM-1 Mark II"),
    ("OM System", "OM-5"),

    // Sony
    ("Sony", "A7R V"),
    ("Sony", "A7 IV"),
    ("Sony", "A7C II"),
    ("Sony", "A7C R"),
    ("Sony", "ZV-E10 II"),
];

const LENSES: &[&str] = &[
    // Canon RF
    "Canon RF 50mm f/1.8 STM",
    "Canon RF 35mm f/1.8 Macro IS STM",
    "Canon RF 85mm f/2 Macro IS STM",
    // Nikon Z
    "Nikon Z 50mm f/1.8 S",
    "Nikon Z 35mm f/1.8 S",
    // Sony FE
    "Sony FE 50mm f/1.8",
    "Sony FE 35mm f/1.8",
    // Fujifilm XF
    "Fujifilm XF 35mm f/1.4 R",
    "Fujifilm XF 23mm f/2 R WR",
    "Fujifilm XF 18-55mm f/2.8-4 R LM OIS",
    // Leica M
    "Leica Summicron-M 35mm f/2 ASPH",
    "Leica Summicron-M 50mm f/2",
    "Voigtländer Nokton 35mm f/1.4",
];
```

### 1b. Add `seed_camera_corpus()` in the same file

```rust
pub fn seed_camera_corpus(conn: &Connection) -> rusqlite::Result<()> {
    for make in CAMERA_MAKES {
        conn.execute(
            "INSERT OR IGNORE INTO corpus (category, value, is_builtin, use_count)
             VALUES ('camera_make', ?1, 1, 0)",
            params![make],
        )?;
    }
    for (make, model) in CAMERA_MODELS {
        conn.execute(
            "INSERT OR IGNORE INTO corpus (category, value, is_builtin, use_count, vendor)
             VALUES ('camera_model', ?1, 1, 0, ?2)",
            params![model, make],
        )?;
    }
    for lens in LENSES {
        conn.execute(
            "INSERT OR IGNORE INTO corpus (category, value, is_builtin, use_count)
             VALUES ('lens', ?1, 1, 0)",
            params![lens],
        )?;
    }
    Ok(())
}
```

### 1c. Call from `session.rs`

In `run_migrations()`, add after the `seed_film_corpus` call:

```rust
corpus_seed::seed_camera_corpus(&conn)?;
```

### 1d. Tests in `corpus_seed.rs`

Add a `#[cfg(test)]` block mirroring the film tests:
- `seeds_all_camera_makes` — count matches `CAMERA_MAKES.len()`
- `seeds_all_camera_models` — count matches `CAMERA_MODELS.len()`
- `seeds_all_lenses` — count matches `LENSES.len()`
- `all_models_have_vendor_set` — no `camera_model` row with `vendor IS NULL`
- `all_model_vendors_exist_in_makes` — referential check: every model's `vendor` maps to a `camera_make` entry
- `seed_camera_is_idempotent` — calling twice does not duplicate rows (uses `INSERT OR IGNORE`)

---

## Step 2 — Gap Drop Camera Data Mismatch Dialog

**Deliverable:** When photos are dropped into a gap and the two boundary neighbors have *different* camera data, a dialog appears asking the user to choose which neighbor's camera data to apply, or to leave camera data unchanged. When neighbors agree (or only one has data), the existing behavior is preserved.

### 2a. Enrich the `computeInheritance` return type

Rename `useMetadataInheritance.ts` exports to reflect the new shape. Change the return type of `computeInheritance`:

```typescript
export interface CameraData {
  cameraMake: string | null;
  cameraModel: string | null;
  lens: string | null;
  filmVendor: string | null;
  filmType: string | null;
}

export interface CameraConflict {
  draggingIds: string[];
  /** Camera data from the neighbor before the gap. null means "no camera data set". */
  optionBefore: CameraData | null;
  /** Camera data from the neighbor after the gap. null means "no camera data set". */
  optionAfter: CameraData | null;
  /** The photo order before the drop, used to undo the reorder if the user cancels. */
  preDropOrder: string[];
}

export interface InheritanceResult {
  /** Per-photo metadata changes — always contains timestamp and GPS assignments.
   *  Camera fields are ONLY included here when there is no conflict. */
  changes: Map<string, Partial<Metadata>>;
  /** Present only for gap drops when the two neighbors have different camera data. */
  cameraConflict: CameraConflict | null;
}
```

Update `computeInheritance` signature:
```typescript
export function computeInheritance(...): InheritanceResult
```

#### Camera data conflict logic (inside gap drop path)

Extract a helper:

```typescript
function extractCameraData(photo: Photo | null): CameraData | null {
  if (!photo) return null;
  const m = photo.currentMetadata;
  if (m.cameraMake == null && m.cameraModel == null && m.lens == null
      && m.filmVendor == null && m.filmType == null) return null;
  return {
    cameraMake: m.cameraMake,
    cameraModel: m.cameraModel,
    lens: m.lens,
    filmVendor: m.filmVendor,
    filmType: m.filmType,
  };
}

function cameraDataEqual(a: CameraData | null, b: CameraData | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.cameraMake === b.cameraMake
      && a.cameraModel === b.cameraModel
      && a.lens === b.lens
      && a.filmVendor === b.filmVendor
      && a.filmType === b.filmType;
}
```

In the gap drop path, replace `pickCloserNeighbor` camera assignment with:

```
cameraA = extractCameraData(neighborBefore)
cameraB = extractCameraData(neighborAfter)

if cameraDataEqual(cameraA, cameraB):
    # Both null → no change. Both equal → inherit (any of the two works).
    mergedCamera = cameraA  # null or the common value
    include camera fields in `changes` map (if mergedCamera != null)
    return { changes, cameraConflict: null }
else if cameraA == null:
    # Only after-neighbor has data → inherit it
    include cameraB fields in `changes` map
    return { changes, cameraConflict: null }
else if cameraB == null:
    # Only before-neighbor has data → inherit it
    include cameraA fields in `changes` map
    return { changes, cameraConflict: null }
else:
    # Both have data but differ → conflict
    return { changes (without camera fields), cameraConflict: { draggingIds, optionBefore: cameraA, optionAfter: cameraB } }
```

Photo drop (drop *on* a photo) is unchanged — it already copies all fields from the target. Return `{ changes, cameraConflict: null }`.

### 2b. `CameraConflictDialog` component

Create `src/components/common/CameraConflictDialog/`:

```
CameraConflictDialog.tsx
CameraConflictDialog.module.css
```

Props:
```typescript
interface CameraConflictDialogProps {
  conflict: CameraConflict;
  /** Called with the chosen camera data, or null to leave camera fields unchanged. */
  onResolve: (choice: CameraData | null) => void;
  /** Called when the user cancels — the drop should be fully undone. */
  onCancel: () => void;
}
```

Renders a modal dialog with:
- Title: "Which camera details should these photos inherit?"
- Two option buttons side-by-side, labelled "Before" and "After", each showing a summary of that neighbor's camera data (Make Model · Lens · Film Vendor Film Type, with nulls omitted).
- A "Don't set" option that calls `onResolve(null)` — applies the drop but leaves camera fields unchanged.
- A "Cancel" button that calls `onCancel()` — undoes the entire drop.

Style with liquid glass (`.btn-glass`) for the option buttons, `.btn-ghost` for "Don't set", `.btn-glass` for "Cancel".

### 2c. Wire the dialog in `PhotoGrid.tsx`

Add state for pending camera conflict:

```typescript
const [cameraConflict, setCameraConflict] = useState<CameraConflict | null>(null);
```

Update `handleDrop` to capture the pre-drop order and pass it into the conflict, then apply non-camera changes and the reorder immediately:

```typescript
const preDropOrder = orderedIds; // snapshot before mutating

const result = computeInheritance(draggingPhotos, target, targetPhoto, neighborBefore, neighborAfter);

for (const [id, meta] of result.changes) {
  dispatch({ type: "SET_PENDING", ids: [id], changes: meta });
}
// ... reorder logic unchanged, dispatches REORDER_PHOTOS ...

if (result.cameraConflict) {
  setCameraConflict({ ...result.cameraConflict, preDropOrder });
}
```

Render the dialog when `cameraConflict` is non-null:

```tsx
{cameraConflict && (
  <CameraConflictDialog
    conflict={cameraConflict}
    onResolve={(choice) => {
      if (choice !== null) {
        dispatch({ type: "SET_PENDING", ids: cameraConflict.draggingIds, changes: choice });
      }
      setCameraConflict(null);
    }}
    onCancel={() => {
      // Undo the reorder
      dispatch({ type: "REORDER_PHOTOS", orderedIds: cameraConflict.preDropOrder });
      tauriCommands.reorderPhotos(cameraConflict.preDropOrder).catch(console.error);
      // Undo the pending changes applied during the drop
      dispatch({ type: "CLEAR_PENDING", ids: cameraConflict.draggingIds });
      setCameraConflict(null);
    }}
  />
)}
```

### 2d. Tests

**`useMetadataInheritance.test.ts`** — add cases for gap drops:
- Both neighbors have same camera data → camera fields in `changes`, `cameraConflict: null`
- Before has camera data, after is null → camera fields from before in `changes`, no conflict
- After has camera data, before is null → camera fields from after in `changes`, no conflict
- Neither has camera data → no camera fields in `changes`, no conflict
- Both have different camera data → camera fields NOT in `changes`, `cameraConflict` set with correct `optionBefore`/`optionAfter`
- `cameraDataEqual` helper: equal, one null, both null, both different

**`CameraConflictDialog.test.tsx`** — basic rendering and interaction tests:
- Renders both option summaries
- "Don't set" calls `onResolve(null)`
- Clicking "Before" calls `onResolve` with optionBefore data
- Clicking "After" calls `onResolve` with optionAfter data
- "Cancel" calls `onCancel`

---

## Step 3 — Cleanup

**`src-tauri/src/corpus.rs`** contains two dead stub functions (`load_corpus`, `save_corpus`) that are never called — the actual implementation lives in `commands/corpus.rs`. Remove these stubs. Confirm `corpus.rs` is declared in `lib.rs` as `pub mod corpus` and remove the declaration too if the file becomes empty. (If `corpus.rs` is not declared in `lib.rs`, it is already dead — just delete the file.)

---

## What this phase does NOT include

- Vibe Tag integration with camera fields (Phase 11)
- EXIF write path for Camera Make/Model/Lens (deferred — ExifTool write pipeline)
- Film metadata EXIF/XMP write strategy (same deferral)
- A dedicated corpus management UI or settings panel — all management happens inline via the `CorpusComboBox` remove/add mechanic in the Inspector Panel
