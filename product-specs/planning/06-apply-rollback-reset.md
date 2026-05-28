# Phase 6: Apply / Rollback / Reset Pipeline

**Goal:** Pending metadata changes are committed to disk via ExifTool writes, rolled back field-by-field from apply history, or reset to import-time values — all with correct handling for both inline formats (JPEG, TIFF, HEIC) and RAW sidecar files. The TopBar ControlBar is fully wired with correct enable/disable state, an ApplyModal tracks per-file progress with a two-phase cancel/undo flow, and every write is atomic and non-destructive.

**Prerequisites:** Phase 5 inspector panel complete. SessionContext `APPLY_START`, `APPLY_COMPLETE`, `ROLLBACK_COMPLETE`, `SET_PENDING`, and `CLEAR_PENDING` reducer cases exist. `apply_changes`, `apply_cancel`, `rollback`, and `reset_photos` are registered Tauri commands that update SQLite state and emit progress events, but do not yet write to disk via ExifTool. The ExifTool subprocess (`ExiftoolProcess`) is initialized in `AppState`.

---

## Step 1 — ExifTool Write Layer

**Deliverable:** A `write_metadata` module translates internal field/value pairs into ExifTool commands and executes them atomically — inline formats via temp-file-rename, RAW formats via XMP sidecar. This is the single source of truth for all disk writes in the apply, rollback, and reset flows.

### `src-tauri/src/write_metadata.rs`

**Field-to-ExifTool mapping:**

| Internal field | ExifTool argument(s) | Notes |
|---|---|---|
| `captureDate` + `captureTime` | `-DateTimeOriginal=YYYY:MM:DD HH:MM:SS` | Merged from both fields; time defaults to `00:00:00` when only date is set |
| `utcOffset` (pre-computed frontend) | `-OffsetTimeOriginal=-07:00` | Passed in payload alongside captureDate/captureTime; only written when date is also present |
| `gpsLat` | `-GPSLatitude=<decimal>` `-GPSLatitudeRef=<N\|S>` | Always unsigned decimal; Ref derived from sign (positive = N, negative = S) |
| `gpsLng` | `-GPSLongitude=<decimal>` `-GPSLongitudeRef=<E\|W>` | Always unsigned decimal; Ref derived from sign (positive = E, negative = W) |
| `cameraMake` | `-Make=<value>` | Stored as a separate field in `Metadata`; written directly, no splitting |
| `cameraModel` | `-Model=<value>` | Stored as a separate field in `Metadata`; written directly |
| `lens` | `-LensModel=<value>` | |
| `film` | `-XMP-pm:FilmStock=<value>` | Custom XMP namespace `http://ns.photo-manager.app/1.0/` (prefix `pm`); requires bundled ExifTool config file |
| any field with `value: None` | `-<Tag>=` | Empty-value clears the tag; used by Reset when the original value was absent |

GPS coordinates must be converted to absolute (unsigned) decimal before writing. `captureDate` and `captureTime` must be merged into ExifTool's `YYYY:MM:DD HH:MM:SS` format before writing; if only `captureDate` is present, time defaults to `00:00:00` as per the PRD requirement that a photo with only date set has time written as 12:00 AM.

**Metadata model update — `cameraMake` + `cameraModel`:** The `Metadata` interface (in `SessionContext.tsx`) must replace the single `cameraBody: string | null` field with two separate fields:

```typescript
cameraMake: string | null;   // e.g. "Canon"
cameraModel: string | null;  // e.g. "EOS R5"
```

The corpus still stores combined entries (e.g. "Canon EOS R5") for display and selection. Selecting a corpus entry in the CameraSection inspector populates both fields. The CameraSection component shows two distinct inputs: a **Make** free-text field and a **Model** combobox backed by the corpus, matching what ExifTool expects as separate EXIF tags. This is a Phase 5 amendment — update `CameraSection.tsx`, the `Metadata` interface, and any reducer cases that reference `cameraBody`.

**Film XMP namespace — ExifTool config:** ExifTool requires a config file to define custom XMP namespaces. Bundle `src-tauri/resources/exiftool.config` with the following content:

```perl
%Image::ExifTool::UserDefined = (
    'Image::ExifTool::XMP::Main' => {
        pm => {
            SubDirectory => {
                TagTable => 'Image::ExifTool::UserDefined::pm',
            },
        },
    },
);

%Image::ExifTool::UserDefined::pm = (
    GROUPS      => { 0 => 'XMP', 1 => 'XMP-pm', 2 => 'Image' },
    NAMESPACE   => { 'pm' => 'http://ns.photo-manager.app/1.0/' },
    WRITABLE    => 'string',
    FilmStock   => { },
);

1;
```

Pass `-config <path/to/exiftool.config>` as the first argument to every ExifTool invocation in `-stay_open` mode. Add `exiftool.config` to `tauri.conf.json` `bundle.resources` alongside the ExifTool binary and library. `XMP-pm:FilmStock` is preserved by Lightroom and Apple Photos as an unknown XMP field, satisfying the round-trip requirement without polluting keywords.

**Write target by file type:**

```rust
pub enum WriteTarget {
    Inline(PathBuf),   // JPEG, TIFF, HEIC: atomic temp-file + rename
    Sidecar(PathBuf),  // all RAW formats: write to <original>.xmp
}

pub fn write_target(path: &Path) -> WriteTarget {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()) {
        Some(e) if matches!(e.as_str(), "jpg" | "jpeg" | "tif" | "tiff" | "heic") => {
            WriteTarget::Inline(path.to_path_buf())
        }
        _ => WriteTarget::Sidecar(path.with_extension("xmp")),
    }
}
```

**Inline format atomic write (JPEG, TIFF, HEIC):**

1. Construct temp path: `<stem>_pmtmp.<ext>` in the same directory as the original.
2. Build the ExifTool command with `-o <temppath>` to write the modified copy without touching the original.
3. Execute via the ExiftoolProcess `-stay_open` stdin channel, await the response.
4. On success (no error in ExifTool output): call `std::fs::rename(temp, original)`. POSIX rename is atomic on the same filesystem.
5. On ExifTool failure or rename failure: delete the temp file, return `Err(stderr_string)`.

**RAW/sidecar write:**

1. If `<original>.xmp` already exists: run ExifTool with `-tagsfromfile <original>.xmp -o <original>.xmp` combined with the new tag flags, merging changes into the sidecar in-place.
2. If no sidecar exists: run ExifTool with `-o <original>.xmp` to create a new sidecar from the RAW file's embedded metadata plus the new tags.
3. Sidecar writes are idempotent — repeated Apply is safe.

**Module public interface:**

```rust
pub struct FieldWrite {
    pub field: String,          // internal field name, e.g. "captureDate"
    pub value: Option<String>,  // None = clear the tag from the file
}

pub struct PhotoWrite {
    pub photo_id: String,
    pub file_path: PathBuf,
    pub fields: Vec<FieldWrite>,
    pub utc_offset: Option<String>,  // pre-computed by frontend, e.g. "-07:00"
}

/// Write metadata for a single photo. Returns Ok on success, Err with ExifTool
/// stderr on failure. Caller is responsible for SQLite state updates.
pub fn write_metadata(
    exiftool: &mut ExiftoolProcess,
    write: &PhotoWrite,
) -> Result<(), String>
```

`write_metadata` assembles the full ExifTool argument list from `PhotoWrite.fields`, determines the write target, and dispatches through ExiftoolProcess. If the file is missing when the command runs, ExifTool returns a non-zero exit and the error is surfaced via `Err`.

---

## Step 2 — Apply Command: ExifTool Integration

**Deliverable:** `apply_changes` writes pending metadata to disk for each photo, emits per-file success/failure progress, and fully reverses already-written files if the user cancels mid-apply.

### `src-tauri/src/commands/metadata.rs` — `apply_changes` update

The existing command creates `apply_ops` and `apply_history` records, updates `metadata_current` in SQLite, and emits progress events. Phase 6 wraps ExifTool writes around those SQLite writes:

```
for each photo with pending changes:
    1. read current values from metadata_current (needed for value_before in apply_history)
    2. call write_metadata(exiftool, &photo_write)          ← NEW
    3. on ExifTool success:
           insert apply_history rows (value_before, value_after) for each field
           update metadata_current is_pending = 0 in SQLite
    4. on ExifTool failure:
           add to failed_files list; do NOT write apply_history for this photo
           leave is_pending = 1 so user can retry
    5. check apply_cancel_flag
    6. emit apply:progress { done, total, photo_id, success, error }

if cancel flag set mid-apply:
    for each already-successfully-written photo (reverse order):
        build undo_write from apply_history value_before rows
        call write_metadata(exiftool, &undo_write)          ← NEW
        emit apply:undo_progress { done, total, photo_id, success }
    delete partial apply_ops + apply_history records from SQLite
    restore metadata_current is_pending = 1 for undone photos
    emit apply:cancelled

else (normal completion):
    emit apply:complete { failed_files }
```

The `apply_ops` record is only written if at least one file succeeds. A complete failure (all files fail) does not produce an apply_ops entry and does not affect rollback history.

**Updated `apply:progress` event payload:**
```typescript
interface ApplyProgressEvent {
  done: number;
  total: number;
  photoId: string;
  success: boolean;
  error: string | null;   // ExifTool stderr when success = false
}
```

**Updated `apply:complete` payload:**
```typescript
interface ApplyCompleteEvent {
  failedFiles: Array<{ photoId: string; error: string }>;
}
```

**Apply payload from the frontend — `ApplyPayload` type:**

The frontend pre-computes `utcOffset` before invoking the command. Add this type to `src/lib/tauri.ts`:

```typescript
export interface PhotoApplyChanges {
  captureDate?: string | null;   // "YYYY-MM-DD", null = clear
  captureTime?: string | null;   // "HH:MM:SS", null = clear
  utcOffset?: string | null;     // "-07:00" computed from timezone + captureDate
  gpsLat?: number | null;
  gpsLng?: number | null;
  cameraMake?: string | null;
  cameraModel?: string | null;
  lens?: string | null;
  film?: string | null;
}

export interface ApplyPayload {
  changes: Record<string, PhotoApplyChanges>;  // photoId → pending fields
}
```

### `src/lib/applyUtils.ts` (new file)

```typescript
import { getUtcOffset } from './timezone';
import type { Photo } from '../state/SessionContext';
import type { ApplyPayload } from './tauri';

export function buildApplyPayload(photos: Photo[]): ApplyPayload {
  const changes: ApplyPayload['changes'] = {};
  for (const photo of photos) {
    if (!photo.pendingChanges) continue;
    const p = photo.pendingChanges;
    const utcOffset =
      p.timezone && p.captureDate
        ? getUtcOffset(p.timezone, new Date(p.captureDate))
        : null;
    changes[photo.id] = { ...p, utcOffset };
  }
  return { changes };
}
```

`getUtcOffset` is the DST-correct UTC offset utility specified in the architecture doc (uses `Intl.DateTimeFormat` with `timeZoneName: 'shortOffset'`). Add this function to `src/lib/timezone.ts` if it does not already exist:

```typescript
export function getUtcOffset(ianaTimezone: string, date: Date): string {
  const fmt = new Intl.DateTimeFormat('en', {
    timeZone: ianaTimezone,
    timeZoneName: 'shortOffset',
  });
  const parts = fmt.formatToParts(date);
  const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value ?? '';
  // offsetPart is e.g. "GMT-7" or "GMT+5:30" — convert to "-07:00" form
  const match = offsetPart.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!match) return '+00:00';
  const sign = match[1];
  const hours = match[2].padStart(2, '0');
  const minutes = (match[3] ?? '00').padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}
```

---

## Step 3 — Rollback Command: ExifTool Integration

**Deliverable:** `rollback` restores the previous on-disk metadata by re-writing `value_before` values from `apply_history` via ExifTool, then clears the apply record from SQLite.

### `src-tauri/src/commands/metadata.rs` — `rollback` update

The existing command reads `apply_history` and restores `metadata_current` / `metadata_original` in SQLite, then deletes the apply record. Phase 6 adds ExifTool writes before the SQLite restoration:

```
1. load most recent apply_ops record — return Err if none
2. load all apply_history rows for that apply_id, grouped by photo_id
3. for each photo:
       build PhotoWrite from { field, value = value_before } rows
       call write_metadata(exiftool, &photo_write)
       on success: record photo as restored
       on failure: add to failed_files, continue (partial rollback is reported but not blocked)
4. update metadata_current and metadata_original in SQLite for successfully restored photos
5. delete apply_history rows and apply_ops record for this apply_id
6. query remaining apply_ops count to determine can_rollback
7. return RollbackResult { restored_photos, failed_files, can_rollback }
```

Rollback does not present a progress modal — it is expected to be fast (re-applying known values). The frontend shows a spinner on the Roll Back button and surfaces failures as an inline error in the TopBar.

**Updated return type (Rust → frontend):**
```typescript
interface RollbackResult {
  restoredPhotos: PhotoData[];                         // updated metadata for SessionContext
  failedFiles: Array<{ photoId: string; error: string }>;
  canRollback: boolean;
}
```

Update the `ROLLBACK_COMPLETE` SessionContext action to carry this shape. The `canRollback` field on `SessionState` must be updated from the result, not assumed to be false after a single rollback.

---

## Step 4 — Reset Photos Command: ExifTool Integration

**Deliverable:** `reset_photos` reads `metadata_original` for the specified photos, writes those values back to disk (clearing tags whose original value was null), then restores SQLite `metadata_current` to the original snapshot.

### `src-tauri/src/commands/metadata.rs` — `reset_photos` update

The existing command already resets `metadata_current` to `metadata_original` in SQLite. Phase 6 adds file writes and gates the SQLite update on file-write success:

```
1. load metadata_original for each photo_id in ids
2. for each photo:
       build PhotoWrite where value = original value, None if field was absent at import
       call write_metadata(exiftool, &photo_write)
       on success: update metadata_current to match metadata_original in SQLite
                   set is_pending = 0 for all fields of this photo
       on failure: add to failed_files; leave metadata_current unchanged for this photo
3. return ResetResult { failed_files }
```

**Null original values → tag deletion:** If `metadata_original` has no row for a given field (the field was absent on import), the PhotoWrite includes `FieldWrite { field, value: None }` for that field, which generates the ExifTool clear flag (`-DateTimeOriginal=`). This restores the file to a clean state.

**Reset does not touch apply_history.** Reset is not an "undo" of an Apply — it is an independent write of the original values. The rollback chain remains intact after a Reset. If the user Applies after a Reset, that new Apply's history is recorded normally.

**Return type:**
```typescript
interface ResetResult {
  failedFiles: Array<{ photoId: string; error: string }>;
}
```

### SessionContext — `RESET_PHOTOS` action

Add this action type to the reducer (replacing the current pattern of dispatching `CLEAR_PENDING` from the frontend after reset):

```typescript
// In SessionAction union:
| { type: 'RESET_PHOTOS'; ids: string[] }

// In reducer:
case 'RESET_PHOTOS': {
  const idSet = new Set(action.ids);
  return {
    ...state,
    photos: state.photos.map(p =>
      idSet.has(p.id)
        ? { ...p, currentMetadata: { ...p.originalMetadata }, pendingChanges: null }
        : p
    ),
  };
}
```

---

## Step 5 — TopBar Component

**Deliverable:** The TopBar renders Apply, Roll Back, and Reset All / Reset Selected buttons with correct enable/disable state derived from SessionContext. A photo count is displayed. The component uses the macOS 26 design language.

### `src/components/TopBar/TopBar.tsx`

```tsx
export function TopBar() {
  const { state, dispatch } = useSession();
  const { photos, selectedIds, canRollback, applyInProgress } = state;

  const hasPending = photos.some(p => p.pendingChanges !== null);
  const hasSelected = selectedIds.size > 0;
  const hasPhotos = photos.length > 0;
  const busy = applyInProgress;

  return (
    <header className={styles.topBar}>
      <div className={styles.meta}>
        <span className={`text-sm ${styles.count}`}>
          {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
        </span>
      </div>
      <div className={styles.controls}>
        <button className="btn btn-primary" disabled={!hasPending || busy} onClick={handleApply}>
          Apply
        </button>
        <button className="btn btn-glass" disabled={!canRollback || busy || isRollingBack} onClick={handleRollback}>
          {isRollingBack ? <Spinner /> : 'Roll Back'}
        </button>
        <button className="btn btn-glass" disabled={!hasPhotos || busy} onClick={handleReset}>
          {hasSelected ? 'Reset Selected' : 'Reset All'}
        </button>
      </div>
      {rollbackError && (
        <div className={styles.errorBanner}>
          {rollbackError}
          <button className="btn btn-ghost" onClick={() => setRollbackError(null)}>Dismiss</button>
        </div>
      )}
    </header>
  );
}
```

`handleApply`, `handleRollback`, and `handleReset` are defined inline in the component (see Step 7). `isRollingBack` and `rollbackError` are local component state.

### `src/components/TopBar/TopBar.module.css`

```css
.topBar {
  position: sticky;
  top: 0;
  z-index: var(--z-topbar);
  display: flex;
  flex-direction: column;
  padding: var(--space-2) var(--space-4);
  gap: var(--space-2);
  backdrop-filter: blur(var(--blur-glass));
  -webkit-backdrop-filter: blur(var(--blur-glass));
  border-bottom: 1px solid var(--color-border);
}

.meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.controls {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.count {
  color: var(--color-text-secondary);
}

.errorBanner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-1) var(--space-2);
  background: var(--color-danger);
  border-radius: var(--radius-md);
  color: #fff;
  font-size: 12px;
}
```

---

## Step 6 — ApplyModal Component

**Deliverable:** A full-screen blocking modal appears during Apply. Phase 1 (applying) shows per-file progress with a Cancel button. Phase 2 (undoing) shows undo progress without cancel. On completion, errors are listed and the modal is dismissible; it auto-dismisses after 1.5 s when there are no errors.

### `src/components/ApplyModal/ApplyModal.tsx`

**Phase state machine (local to the modal, driven by Tauri events in App.tsx):**

```typescript
export type ApplyPhase =
  | { type: 'idle' }
  | { type: 'applying'; done: number; total: number; errors: ApplyError[] }
  | { type: 'undoing';  done: number; total: number }
  | { type: 'complete'; errors: ApplyError[] }
  | { type: 'cancelled' };

export interface ApplyError {
  photoId: string;
  filePath: string;  // resolved from SessionContext for display
  error: string;
}
```

**Props:**

```typescript
interface ApplyModalProps {
  phase: ApplyPhase;
  onCancel: () => void;   // invokes apply_cancel; only available in 'applying' phase
  onDismiss: () => void;  // only available in 'complete' and 'cancelled' phases
}
```

**Phase rendering table:**

| Phase | Progress bar | Label | Primary action |
|---|---|---|---|
| `applying` | `done / total` | "Writing N of M photos…" | Cancel button (`.btn-glass`) |
| `undoing` | `done / total` | "Undoing N of M photos… (cannot cancel)" | — |
| `complete`, 0 errors | 100% filled | "All photos written successfully." | Dismiss (`.btn-primary`), auto after 1.5 s |
| `complete`, N errors | partial | "N file(s) could not be written." | Dismiss (`.btn-primary`) |
| `cancelled` | — | "Changes cancelled." | Dismiss (`.btn-glass`) |

**Auto-dismiss:** In a `useEffect` watching `phase.type === 'complete' && phase.errors.length === 0`, call `setTimeout(onDismiss, 1500)`. Return a cleanup function to clear the timeout if the modal unmounts early.

**Error list rendering (complete phase with errors):**

```tsx
<ul className={styles.errorList}>
  {phase.errors.map(e => (
    <li key={e.photoId} className={styles.errorItem}>
      <span className={`text-sm ${styles.filePath}`}>{e.filePath}</span>
      <span className={`text-xs ${styles.errorMsg}`}>{e.error}</span>
    </li>
  ))}
</ul>
```

### `src/components/ApplyModal/ApplyModal.module.css`

```css
.overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
}

.card {
  width: 480px;
  max-height: 60vh;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  overflow: hidden;
}

.progressTrack {
  height: 6px;
  border-radius: var(--radius-sm);
  background: var(--color-border);
  overflow: hidden;
}

.progressFill {
  height: 100%;
  background: var(--color-accent);
  transition: width var(--transition-fast);
}

.errorList {
  flex: 1;
  overflow-y: auto;
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.errorItem {
  display: flex;
  flex-direction: column;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
}

.filePath {
  color: var(--color-text);
  word-break: break-all;
}

.errorMsg {
  color: var(--color-danger);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
```

---

## Step 7 — Frontend Wiring

**Deliverable:** Apply, Roll Back, and Reset buttons invoke the correct Tauri commands; Tauri events drive the ApplyModal phase machine; Reset shows a confirmation dialog; SessionContext is updated on completion.

### `src/App.tsx` — event listeners and modal state

Mount Tauri event listeners once in `App.tsx`. The `applyPhase` state lives at the App level (transient UI state, not in SessionContext):

```typescript
const [applyPhase, setApplyPhase] = useState<ApplyPhase>({ type: 'idle' });
const { dispatch } = useSession();

useEffect(() => {
  const pending: Promise<UnlistenFn>[] = [
    listen<ApplyProgressEvent>('apply:progress', ({ payload }) => {
      setApplyPhase(prev => {
        if (prev.type !== 'applying') return prev;
        const errors = payload.success
          ? prev.errors
          : [...prev.errors, { photoId: payload.photoId, filePath: '', error: payload.error! }];
        return { ...prev, done: payload.done, errors };
      });
    }),

    listen<{ done: number; total: number }>('apply:undo_progress', ({ payload }) => {
      setApplyPhase({ type: 'undoing', done: payload.done, total: payload.total });
    }),

    listen<ApplyCompleteEvent>('apply:complete', ({ payload }) => {
      // Reload session state from Tauri to get updated metadata
      tauriCommands.loadSession().then(session => {
        dispatch({ type: 'APPLY_COMPLETE', updatedPhotos: session.photos, canRollback: true });
      });
      setApplyPhase({ type: 'complete', errors: resolveFilePaths(payload.failedFiles) });
    }),

    listen<void>('apply:cancelled', () => {
      dispatch({ type: 'APPLY_COMPLETE', updatedPhotos: [], canRollback: false }); // revert applyInProgress
      setApplyPhase({ type: 'cancelled' });
    }),
  ];

  return () => { pending.forEach(p => p.then(u => u())); };
}, [dispatch]);
```

`resolveFilePaths` maps `photoId` → `filePath` using `state.photos` for display in the error list.

### TopBar handlers

**Apply:**
```typescript
async function handleApply() {
  const payload = buildApplyPayload(state.photos);
  if (Object.keys(payload.changes).length === 0) return;
  const total = Object.keys(payload.changes).length;
  dispatch({ type: 'APPLY_START' });
  setApplyPhase({ type: 'applying', done: 0, total, errors: [] });
  await tauriCommands.applyChanges(payload);
  // subsequent state driven by apply:complete / apply:cancelled events
}
```

**Roll Back:**
```typescript
async function handleRollback() {
  setIsRollingBack(true);
  try {
    const result = await tauriCommands.rollback();
    dispatch({ type: 'ROLLBACK_COMPLETE', restoredPhotos: result.restoredPhotos, canRollback: result.canRollback });
    if (result.failedFiles.length > 0) {
      setRollbackError(`Roll Back failed for ${result.failedFiles.length} file(s).`);
    }
  } catch (err) {
    setRollbackError(String(err));
  } finally {
    setIsRollingBack(false);
  }
}
```

**Reset:**
```typescript
async function handleReset() {
  const ids = hasSelected ? [...state.selectedIds] : state.photos.map(p => p.id);
  const label = hasSelected ? `${ids.length} selected photo(s)` : 'all photos';

  const confirmed = await showConfirm({
    title: 'Reset Photos',
    message: `Reset metadata for ${label} to original imported values? Applied writes on disk will be overwritten. This cannot be undone.`,
    confirmLabel: 'Reset',
    destructive: true,
  });
  if (!confirmed) return;

  const result = await tauriCommands.resetPhotos(ids);
  dispatch({ type: 'RESET_PHOTOS', ids });
  if (result.failedFiles.length > 0) {
    // surface inline error (pattern TBD by component; e.g. a toast or TopBar errorBanner)
  }
}
```

`showConfirm` is an imperative wrapper around the existing `ConfirmDialog` component (built in Phase 5). Implement it as a promise-based helper in `src/lib/confirm.ts` using a render-to-portal pattern or a React ref.

**Cancel (inside ApplyModal):**
```typescript
async function handleApplyCancel() {
  setApplyPhase(prev =>
    prev.type === 'applying' ? { type: 'undoing', done: 0, total: prev.done } : prev
  );
  await tauriCommands.applyCancel();
}
```

### `src/App.tsx` — render the modal

```tsx
{applyPhase.type !== 'idle' && (
  <ApplyModal
    phase={applyPhase}
    onCancel={handleApplyCancel}
    onDismiss={() => setApplyPhase({ type: 'idle' })}
  />
)}
```

---

## Step 8 — Tests

### Frontend (Vitest)

**`TopBar`**

| Test | Assertion |
|---|---|
| Apply disabled when no pending changes | `hasPending = false` → Apply button is `disabled` |
| Apply enabled with pending changes | At least one photo has `pendingChanges !== null` → Apply not disabled |
| Apply disabled when `applyInProgress = true` | Button is disabled even if pending changes exist |
| Roll Back enabled when `canRollback = true` | Roll Back button is not disabled |
| Roll Back disabled when `canRollback = false` | Button is disabled |
| Reset label with no selection | Button text is "Reset All" |
| Reset label with selection | Button text is "Reset Selected" |
| Reset disabled when no photos | Button is disabled |
| Photo count singular | "1 photo" for one photo |
| Photo count plural | "3 photos" for three photos |
| Error banner appears after rollback failure | Set `rollbackError` state → `.errorBanner` renders |
| Error banner dismissed | Clicking Dismiss clears the banner |

**`ApplyModal`**

| Test | Assertion |
|---|---|
| `applying` phase: progress bar width | `done / total` ratio drives inline `width` style |
| `applying` phase: Cancel button rendered | Button is present and not disabled |
| `undoing` phase: Cancel button absent | No Cancel button in DOM |
| `undoing` phase: label text | "Undoing…" copy is present |
| `complete`, 0 errors: auto-dismiss | `vi.useFakeTimers()`; advance 1 500 ms; `onDismiss` called once |
| `complete`, 0 errors: Dismiss button | Dismiss button renders |
| `complete` with errors: error list | Each `ApplyError` produces a list item with file path and error text |
| `complete` with errors: no auto-dismiss | Advance timers; `onDismiss` is NOT called automatically |
| `cancelled` phase: label text | "Changes cancelled." renders |
| `cancelled` phase: Dismiss button | Dismiss button renders |
| `cancelled` phase: Cancel absent | No Cancel button |

**SessionContext reducer (additions)**

| Action | Assertion |
|---|---|
| `RESET_PHOTOS` with ids | Named photos: `currentMetadata = originalMetadata`, `pendingChanges = null` |
| `RESET_PHOTOS` leaves other photos unchanged | Photos not in `ids` are unmodified |
| `APPLY_COMPLETE` with failed files | Successful photos: `pendingChanges = null`; failed photos: `pendingChanges` unchanged |
| `ROLLBACK_COMPLETE` with `canRollback = false` | `state.canRollback` is `false` after action |

**`applyUtils.ts`**

| Test | Assertion |
|---|---|
| Skips photos with no pending changes | Only photos with `pendingChanges !== null` appear in payload |
| Includes `utcOffset` when date + timezone present | Output has `utcOffset` field (e.g. `"-07:00"`) |
| Omits `utcOffset` when `captureDate` missing | `utcOffset` is `null` in output |
| Omits `utcOffset` when `timezone` missing | `utcOffset` is `null` in output |

**`timezone.ts` — `getUtcOffset`**

| Test | Assertion |
|---|---|
| Known PDT offset | `getUtcOffset("America/Los_Angeles", summerDate)` → `"-07:00"` |
| Known PST offset | `getUtcOffset("America/Los_Angeles", winterDate)` → `"-08:00"` |
| UTC | `getUtcOffset("UTC", anyDate)` → `"+00:00"` |
| Positive offset | `getUtcOffset("Asia/Tokyo", anyDate)` → `"+09:00"` |

### Rust (Cargo)

**`write_metadata.rs` unit tests**

| Test | Assertion |
|---|---|
| GPS ref: positive lat → "N" | |
| GPS ref: negative lat → "S" | |
| GPS ref: positive lng → "E" | |
| GPS ref: negative lng → "W" | |
| `cameraMake` written directly | `cameraMake = "Canon"` → `-Make=Canon` flag; no splitting |
| `cameraModel` written directly | `cameraModel = "EOS R5"` → `-Model=EOS R5` flag |
| `cameraMake` null → Make tag cleared | `cameraMake = None` → `-Make=` flag |
| DateTime merge | `captureDate + captureTime` → `"2024:03:15 14:30:00"` |
| DateTime date-only → default time | `captureDate` set, `captureTime` None → `"2024:03:15 00:00:00"` |
| Null field → clear flag | `FieldWrite { value: None }` produces `-DateTimeOriginal=` in argument list |
| Film XMP field | `film = "Kodak Portra 400"` → `-XMP-pm:FilmStock=Kodak Portra 400` flag |
| Film null → field cleared | `film = None` → `-XMP-pm:FilmStock=` flag |
| RAW extension → sidecar target | `.cr3`, `.nef`, `.arw`, `.raf`, `.dng` → `WriteTarget::Sidecar` |
| JPEG extension → inline target | `.jpg`, `.jpeg` → `WriteTarget::Inline` |

**`commands/metadata.rs` integration tests** (in `src-tauri/tests/`)

| Test | Assertion |
|---|---|
| `apply_changes` records apply_ops | One row in `apply_ops` after successful apply |
| `apply_changes` records apply_history | `value_before` and `value_after` rows for each changed field |
| `apply_changes` sets `is_pending = 0` | `metadata_current.is_pending = 0` for applied photos |
| `rollback` removes apply_ops | Table empty after rollback |
| `rollback` restores metadata_current | `value` in `metadata_current` equals `value_before` from history |
| `rollback` returns correct `canRollback` | `false` when no more apply history; `true` when a prior apply remains |
| `reset_photos` sets `is_pending = 0` | `metadata_current.is_pending = 0` for reset photos |
| `reset_photos` restores metadata_current to original | `metadata_current.value` equals `metadata_original.value` for reset photos |

ExifTool write tests are gated with `#[ignore]` and require `src-tauri/resources/exiftool` to be present. Run with `cargo test -- --ignored` in a prepared environment.

---

## What this phase does NOT include

- **Conflict detection** — if a photo file is modified on disk by another application between import and Apply, the discrepancy is not detected. A SHA-256 hash comparison at Apply time is a future hardening option.
- **Settings UI for API keys** — Mapbox and Claude API keys are set via the settings drawer built in Phase 5; Phase 6 does not add to this.
- **Session restore validation** — `load_session` restores SQLite state on app restart; validating that on-disk file metadata is still consistent with session state is deferred to Phase 11.
- **E2E / Tauri driver tests** — require a compiled `.app` bundle and a display server; deferred until Phase 8+.
- **Visual regression testing** — deferred until the design stabilizes.
