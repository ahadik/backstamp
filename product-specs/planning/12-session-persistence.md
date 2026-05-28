# Phase 12: Session Persistence and Restore

**Goal:** The full session state (imported photos with pending metadata changes, GPX files, rollback history, and UI settings) survives app restarts. On launch, the prior session is restored with no user action required. Clear Session discards the working session behind a confirmation dialog. Missing files on restore are surfaced with a click-to-remove control.

**Prerequisites:** All prior phases complete. The SQLite schema is in place. `load_session`, `clear_session`, `get_setting`, and `set_setting` Tauri commands exist as partial implementations. The `SessionContext` `CLEAR_SESSION` action returns `initialState`. Pending changes live only in memory — they are not written to `metadata_current` with `is_pending=1` outside of the mid-apply cancel flow.

---

## Current state audit

| Item | Status | Notes |
|---|---|---|
| `load_session` Rust command | ⚠️ Partial | Returns photos/GPX/`canRollback` but `pending_changes` is hardcoded `null`; no UI settings returned |
| `clear_session` Rust command | ⚠️ Bug | Deletes `corpus WHERE is_builtin = 0` — must preserve all corpus entries across clear |
| `get_setting` / `set_setting` commands | ✅ Done | Used by SettingsModal for API keys |
| `RESTORE_SESSION` action in `SessionContext` | ❌ Missing | No action type or reducer case |
| `RESTORE_UI` action in `UIContext` | ❌ Missing | No action type or reducer case |
| App startup calls `loadSession` | ❌ Missing | App.tsx only loads API keys on mount; photos not restored |
| Pending changes persisted to SQLite | ❌ Missing | `SET_PENDING` updates memory only; `is_pending=1` rows never written from Inspector changes |
| `set_pending_changes` Tauri command | ❌ Missing | No command to write `is_pending=1` rows |
| UI settings persisted to SQLite | ❌ Missing | `workingTimezone`, `gridTileSize`, `mapPanelHeight` not written to `settings` table |
| `load_session` returns UI settings | ❌ Missing | Response shape does not include UI settings |
| Clear Session UI | ❌ Missing | No button/flow in the app |
| Missing file click-to-remove | ❌ Missing | `fileStatus: 'missing'` renders greyed out but has no remove affordance |
| Tests | ❌ Missing | |

Phase 12 delivers all missing items above as five steps.

---

## Step 1 — Pending Changes Persistence

**Deliverable:** Whenever Inspector Panel changes are queued (`SET_PENDING`), the corresponding `metadata_current` rows with `is_pending=1` are written to SQLite. When pending changes are cleared without Apply (e.g. Reset, or photo removal), those rows revert. On the next app launch, `load_session` reconstructs `pendingChanges` from these rows.

### 1a. New Tauri command: `set_pending_changes`

**`src-tauri/src/commands/metadata.rs`** — add:

```rust
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingField {
    pub field: String,
    pub value: Option<String>,
}

#[tauri::command]
pub async fn set_pending_changes(
    photo_ids: Vec<String>,
    fields: Vec<PendingField>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| format!("db lock: {}", e))?;
    for photo_id in &photo_ids {
        for f in &fields {
            conn.execute(
                "INSERT INTO metadata_current (photo_id, field, value, is_pending)
                 VALUES (?1, ?2, ?3, 1)
                 ON CONFLICT(photo_id, field)
                 DO UPDATE SET value = excluded.value, is_pending = 1",
                rusqlite::params![photo_id, f.field, f.value],
            )
            .map_err(|e| format!("set_pending: {}", e))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn clear_pending_changes(
    photo_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| format!("db lock: {}", e))?;
    for photo_id in &photo_ids {
        conn.execute(
            "UPDATE metadata_current SET is_pending = 0 WHERE photo_id = ?1",
            rusqlite::params![photo_id],
        )
        .map_err(|e| format!("clear_pending: {}", e))?;
    }
    Ok(())
}
```

Register both in `src-tauri/src/lib.rs` alongside the existing command list.

### 1b. Typed wrappers in `src/lib/tauri.ts`

```typescript
setPendingChanges: (photoIds: string[], fields: Array<{ field: string; value: string | null }>) =>
  invoke<void>('set_pending_changes', { photoIds, fields }),

clearPendingChanges: (photoIds: string[]) =>
  invoke<void>('clear_pending_changes', { photoIds }),
```

### 1c. Frontend: call `set_pending_changes` after `SET_PENDING`

`SET_PENDING` is dispatched by the Inspector Panel sections after the user edits a field. Add a side-effect call in `SessionContext`'s provider (or wherever `SET_PENDING` is dispatched) to sync the change to SQLite.

The cleanest place is a `useEffect` in `SessionProvider` that watches `state.photos` and fires whenever a photo's `pendingChanges` changes. However, a targeted call at the dispatch site is more efficient and avoids diffing all photos. Use the dispatch-site approach:

Everywhere `dispatch({ type: 'SET_PENDING', ids, changes })` is called (Inspector Panel section components), immediately follow with a fire-and-forget:

```typescript
// after dispatch
const fields = Object.entries(changes).map(([field, value]) => ({
  field,
  value: value == null ? null : String(value),
}));
tauriCommands.setPendingChanges(ids, fields).catch(console.error);
```

Similarly, after `dispatch({ type: 'RESET_PHOTOS', ids })`, follow with:

```typescript
tauriCommands.clearPendingChanges(ids).catch(console.error);
```

This keeps the in-memory SessionContext as the single source of truth for rendering; SQLite is a persistence mirror.

### 1d. Fix `load_session` to return pending changes

In `src-tauri/src/commands/session.rs`, the `load_metadata_for` helper currently reads from either `metadata_current` or `metadata_original`. Update `load_session` to also query `is_pending=1` rows per photo and return them as `pending_changes`:

```rust
fn load_pending_for(conn: &rusqlite::Connection, photo_id: &str) -> Option<serde_json::Value> {
    let query = "SELECT field, value FROM metadata_current WHERE photo_id = ?1 AND is_pending = 1";
    let pairs: Vec<(String, Option<String>)> = conn
        .prepare(query)
        .ok()?
        .query_map(rusqlite::params![photo_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })
        .ok()?
        .filter_map(|r| r.ok())
        .collect();

    if pairs.is_empty() {
        return None;
    }
    let mut map = serde_json::Map::new();
    for (field, value) in pairs {
        map.insert(
            field,
            value.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null),
        );
    }
    Some(serde_json::Value::Object(map))
}
```

In the photo-construction loop inside `load_session`, replace `pending_changes: None` with:

```rust
pending_changes: load_pending_for(&conn, &id),
```

### 1e. Frontend: deserialize `pending_changes` on restore

The `mapLoadedPhoto` function in `App.tsx` currently ignores `pendingChanges` (hardcoded `null`). Update it to deserialize the returned JSON value:

```typescript
function mapLoadedPhoto(p: {
  id: string;
  filePath: string;
  fileStatus: "ok" | "missing";
  thumbnailSmall: string;
  thumbnailLarge: string;
  originalMetadata: Metadata;
  currentMetadata: Metadata;
  pendingChanges: Partial<Metadata> | null;
}): Photo {
  return {
    id: p.id,
    filePath: p.filePath,
    fileStatus: p.fileStatus,
    thumbnail: {
      small: convertFileSrc(p.thumbnailSmall),
      large: convertFileSrc(p.thumbnailLarge),
    },
    originalMetadata: p.originalMetadata,
    currentMetadata: p.currentMetadata,
    pendingChanges: p.pendingChanges ?? null,
  };
}
```

The `pendingChanges` field from the Rust side is already camelCase-serialized as a JSON object matching `Partial<Metadata>`. No further mapping is needed.

---

## Step 2 — UI Settings Persistence

**Deliverable:** `workingTimezone`, `gridTileSize`, and `mapPanelHeight` are written to the `settings` table when changed, and restored from SQLite on launch.

### 2a. Persist UI settings on change

In `src/state/UIContext.tsx`, add a `useEffect` in the `UIProvider` that watches the three values and calls `setSetting`:

```typescript
// inside UIProvider, after the useReducer call:
const prevRef = useRef(state);
useEffect(() => {
  const prev = prevRef.current;
  if (prev.workingTimezone !== state.workingTimezone) {
    tauriCommands.setSetting('ui.workingTimezone', state.workingTimezone).catch(console.error);
  }
  if (prev.gridTileSize !== state.gridTileSize) {
    tauriCommands.setSetting('ui.gridTileSize', String(state.gridTileSize)).catch(console.error);
  }
  // mapPanelHeight is debounced to avoid writes on every drag pixel
  prevRef.current = state;
}, [state.workingTimezone, state.gridTileSize]);
```

For `mapPanelHeight`, use a debounce: write to SQLite only after the user stops dragging (500 ms idle). The `SET_MAP_PANEL_HEIGHT` action fires on every `mousemove` during resize; a `useEffect` with `setTimeout` avoids excessive writes:

```typescript
useEffect(() => {
  const id = setTimeout(() => {
    tauriCommands.setSetting('ui.mapPanelHeight', String(state.mapPanelHeight)).catch(console.error);
  }, 500);
  return () => clearTimeout(id);
}, [state.mapPanelHeight]);
```

### 2b. `RESTORE_UI` action in `UIContext`

Add the action type and reducer case:

```typescript
// in UIAction union:
| { type: 'RESTORE_UI'; workingTimezone: string; gridTileSize: number; mapPanelHeight: number }

// in reducer:
case 'RESTORE_UI':
  return {
    workingTimezone: action.workingTimezone,
    gridTileSize: action.gridTileSize,
    mapPanelHeight: action.mapPanelHeight,
  };
```

### 2c. Extend `load_session` return type to include UI settings

In `src-tauri/src/commands/session.rs`, extend `SessionLoadResult`:

```rust
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionLoadResult {
    pub photos: Vec<PhotoRow>,
    pub gpx_files: Vec<GpxRow>,
    pub can_rollback: bool,
    pub working_timezone: String,
    pub grid_tile_size: f64,
    pub map_panel_height: f64,
}
```

At the end of `load_session`, before returning, read these from the `settings` table:

```rust
let working_timezone = conn
    .query_row("SELECT value FROM settings WHERE key = 'ui.workingTimezone'", [], |r| r.get(0))
    .unwrap_or_else(|_| "America/Los_Angeles".to_string());

let grid_tile_size: f64 = conn
    .query_row("SELECT value FROM settings WHERE key = 'ui.gridTileSize'", [], |r| r.get::<_, String>(0))
    .ok()
    .and_then(|v| v.parse().ok())
    .unwrap_or(0.2);

let map_panel_height: f64 = conn
    .query_row("SELECT value FROM settings WHERE key = 'ui.mapPanelHeight'", [], |r| r.get::<_, String>(0))
    .ok()
    .and_then(|v| v.parse().ok())
    .unwrap_or(200.0);
```

---

## Step 3 — App Startup Session Restore

**Deliverable:** On mount, `App.tsx` calls `loadSession`, dispatches `RESTORE_SESSION` to `SessionContext` and `RESTORE_UI` to `UIContext`, and renders a loading state while the session is being fetched.

### 3a. `RESTORE_SESSION` action in `SessionContext`

Add to `SessionAction`:

```typescript
| { type: 'RESTORE_SESSION'; photos: Photo[]; gpxFiles: GpxFile[]; canRollback: boolean }
```

Add reducer case:

```typescript
case 'RESTORE_SESSION':
  return {
    ...state,
    photos: action.photos,
    gpxFiles: action.gpxFiles,
    canRollback: action.canRollback,
    selectedIds: new Set(),
  };
```

Selection is not persisted — it is always empty on restore. This is intentional: restoring a prior selection would be confusing UX.

### 3b. App.tsx — session hydration on mount

Replace the existing on-mount `useEffect` that only loads API keys with a combined effect that loads the full session first, then API keys:

```typescript
const [sessionLoading, setSessionLoading] = useState(true);

useEffect(() => {
  async function hydrateSession() {
    try {
      // Load session state
      const session = await tauriCommands.loadSession();
      dispatch({
        type: 'RESTORE_SESSION',
        photos: session.photos.map(mapLoadedPhoto),
        gpxFiles: session.gpxFiles.map(mapLoadedGpxFile),
        canRollback: session.canRollback,
      });
      uiDispatch({
        type: 'RESTORE_UI',
        workingTimezone: session.workingTimezone,
        gridTileSize: session.gridTileSize,
        mapPanelHeight: session.mapPanelHeight,
      });
    } catch (err) {
      console.error('[App] session restore failed:', err);
    } finally {
      setSessionLoading(false);
    }

    // Load API keys (independent of session)
    tauriCommands.getSetting('mapbox_token').then((token) => {
      if (token) uiDispatch({ type: 'SET_MAPBOX_TOKEN', token });
    });
    tauriCommands.getSetting('claude_api_key').then((key) => {
      if (key) uiDispatch({ type: 'SET_CLAUDE_API_KEY', key });
    });
  }

  hydrateSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

`mapLoadedGpxFile` converts raw GPX rows to `GpxFile` objects:

```typescript
function mapLoadedGpxFile(g: {
  id: string;
  filePath: string;
  addedAt: number;
  trackPoints: TrackPoint[];
  thumbnailPath: string | null;
}): GpxFile {
  return {
    id: g.id,
    filePath: g.filePath,
    addedAt: g.addedAt,
    trackPoints: g.trackPoints,
    thumbnailUrl: g.thumbnailPath ? convertFileSrc(g.thumbnailPath) : null,
  };
}
```

### 3c. Loading state

While `sessionLoading` is true, render a minimal loading view over the app shell to prevent a flash of empty state. A simple centered spinner using existing design tokens is sufficient — no new component needed:

```tsx
{sessionLoading ? (
  <div className={styles.sessionLoader}>
    <div className={styles.spinner} />
  </div>
) : (
  /* normal app content */
)}
```

In `App.module.css`:

```css
.sessionLoader {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg);
  z-index: 200;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

---

## Step 4 — Clear Session

**Deliverable:** A "Clear Session" button in the TopBar, behind a confirmation dialog, clears all session state from SQLite and resets the app to empty. The corpus and API key settings are preserved. The bug in the existing `clear_session` command that deletes custom corpus entries is fixed.

### 4a. Fix `clear_session` corpus bug

The current implementation includes `DELETE FROM corpus WHERE is_builtin = 0` which contradicts the PRD: "The full option corpus (pre-loaded defaults, custom additions, and recently-used ordering) is stored persistently and survives session clears."

In `src-tauri/src/commands/session.rs`, remove that line from the `execute_batch`:

```rust
conn.execute_batch(
    "DELETE FROM apply_history;
     DELETE FROM apply_ops;
     DELETE FROM photo_keywords;
     DELETE FROM metadata_current;
     DELETE FROM metadata_original;
     DELETE FROM photos;
     DELETE FROM gpx_files;",
)
.map_err(|e| format!("clear session: {}", e))?;
```

The `corpus` and `settings` tables are intentionally excluded — corpus survives clears; settings holds API keys and UI preferences that should persist. After clearing, UI settings (workingTimezone, gridTileSize, mapPanelHeight) will be re-read from SQLite on the next `loadSession` call. Since we want UI settings to also reset on clear (so the user gets a fresh default state), explicitly reset them in the settings table as part of the clear:

```rust
conn.execute_batch(
    "DELETE FROM apply_history;
     DELETE FROM apply_ops;
     DELETE FROM photo_keywords;
     DELETE FROM metadata_current;
     DELETE FROM metadata_original;
     DELETE FROM photos;
     DELETE FROM gpx_files;
     DELETE FROM settings WHERE key LIKE 'ui.%';",
)
.map_err(|e| format!("clear session: {}", e))?;
```

This resets UI preferences to defaults on session clear while preserving API keys (which use non-`ui.` keys like `mapbox_token` and `claude_api_key`).

### 4b. Clear Session UI in TopBar

Add a "Clear Session" button to `src/components/TopBar/TopBar.tsx`:

```tsx
<button
  className="btn btn-glass"
  onClick={handleClearSession}
  disabled={state.photos.length === 0 && state.gpxFiles.length === 0}
  title="Clear Session"
>
  Clear Session
</button>
```

Disable when no photos or GPX files are loaded (nothing to clear).

**Handler:**

```typescript
async function handleClearSession() {
  const confirmed = await showConfirm({
    title: 'Clear Session?',
    message:
      'This will remove all imported photos, GPX files, and pending changes. ' +
      'Photos already written to disk via Apply are not affected.',
    confirmLabel: 'Clear Session',
    cancelLabel: 'Cancel',
    destructive: true,
  });
  if (!confirmed) return;

  await tauriCommands.clearSession();
  dispatch({ type: 'CLEAR_SESSION' });
  uiDispatch({ type: 'RESTORE_UI', workingTimezone: 'America/Los_Angeles', gridTileSize: 0.2, mapPanelHeight: 200 });
}
```

`showConfirm` is the promise-based dialog helper already used in the Reset flow (built in Phase 6). `CLEAR_SESSION` already returns `initialState` in the reducer.

---

## Step 5 — Missing File Remove Affordance

**Deliverable:** When a photo's `fileStatus` is `'missing'`, the PhotoTile renders an overlay with a remove button. Clicking it dispatches `REMOVE_PHOTOS` for that photo without a confirmation dialog.

Per the PRD: *"its thumbnail is greyed out and a visual indicator communicates that the file cannot be found. The user can click to clear that photo from the session."* No confirmation is needed — this is an explicit remove of a single missing photo.

### `src/components/PhotoManager/PhotoGrid/PhotoTile/PhotoTile.tsx`

The tile already applies a `missing` CSS class when `photo.fileStatus === 'missing'`. Add an overlay button inside that condition:

```tsx
{photo.fileStatus === 'missing' && (
  <div className={styles.missingOverlay}>
    <span className={styles.missingLabel}>File not found</span>
    <button
      className={styles.missingRemoveBtn}
      onClick={(e) => {
        e.stopPropagation();
        dispatch({ type: 'REMOVE_PHOTOS', ids: [photo.id] });
        tauriCommands.removePhotos([photo.id]).catch(console.error);
      }}
      title="Remove from session"
    >
      ✕
    </button>
  </div>
)}
```

### `PhotoTile.module.css` additions

```css
.missingOverlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  background: rgba(0, 0, 0, 0.55);
  border-radius: inherit;
}

.missingLabel {
  color: rgba(255, 255, 255, 0.7);
  font-size: 11px;
  text-align: center;
  padding: 0 var(--space-1);
}

.missingRemoveBtn {
  background: var(--color-danger);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  padding: var(--space-1) var(--space-2);
  font-size: 11px;
  cursor: pointer;
}

.missingRemoveBtn:hover {
  opacity: 0.85;
}
```

---

## Step 6 — Tests

### Frontend (Vitest)

**`SessionContext` reducer**

| Test | Assertion |
|---|---|
| `RESTORE_SESSION` populates `photos` | Photo array length and ids match input |
| `RESTORE_SESSION` with `fileStatus: 'missing'` | Photo has `fileStatus: 'missing'` |
| `RESTORE_SESSION` sets `canRollback` | `state.canRollback` matches input |
| `RESTORE_SESSION` with `pendingChanges` present | Photo has non-null `pendingChanges` |
| `RESTORE_SESSION` always clears `selectedIds` | `state.selectedIds.size === 0` regardless of input |
| `RESTORE_SESSION` sets `gpxFiles` | GPX file list matches input |
| `CLEAR_SESSION` returns initial state | `photos = []`, `gpxFiles = []`, `selectedIds` empty, `canRollback = false` |

**`UIContext` reducer**

| Test | Assertion |
|---|---|
| `RESTORE_UI` sets `workingTimezone` | Restored to provided value |
| `RESTORE_UI` sets `gridTileSize` | Restored to provided value |
| `RESTORE_UI` sets `mapPanelHeight` | Restored to provided value |

**`App.tsx` hydration (component test)**

Mock `tauriCommands.loadSession` to return a session with one photo. Mount `App` wrapped in providers. Assert:
- `RESTORE_SESSION` is dispatched with the mapped photo
- `RESTORE_UI` is dispatched with the session's UI settings
- Loading spinner disappears after the promise resolves

**`TopBar` — Clear Session button**

| Test | Assertion |
|---|---|
| Button disabled when no photos | `photos = []`, `gpxFiles = []` → button `disabled` |
| Button enabled when photos exist | One photo in session → button not disabled |
| Button enabled when only GPX files exist | `photos = []`, one GPX → button not disabled |
| Clicking shows confirmation dialog | `ConfirmDialog` renders after click |
| Confirming calls `tauriCommands.clearSession` | Mock called once |
| Confirming dispatches `CLEAR_SESSION` | Reducer receives `CLEAR_SESSION` action |
| Canceling does NOT call `clearSession` | Mock not called |

**`PhotoTile` — missing file overlay**

| Test | Assertion |
|---|---|
| Missing overlay rendered for `missing` photos | `.missingOverlay` in DOM |
| Missing overlay absent for `ok` photos | `.missingOverlay` not in DOM |
| Clicking remove dispatches `REMOVE_PHOTOS` | Action dispatched with correct photo id |
| Clicking remove calls `tauriCommands.removePhotos` | Mock called with `[photo.id]` |
| Click does not bubble to tile selection | `e.stopPropagation` prevents tile click handler |

### Rust (Cargo)

**`commands/metadata.rs` — `set_pending_changes` / `clear_pending_changes`**

| Test | Assertion |
|---|---|
| `set_pending_changes` writes `is_pending=1` | Row in `metadata_current` with `is_pending=1` after call |
| `set_pending_changes` multiple fields | All fields written with `is_pending=1` |
| `set_pending_changes` null value | Row present with `NULL` value and `is_pending=1` |
| `set_pending_changes` upserts existing row | Re-calling with new value updates `value` and keeps `is_pending=1` |
| `clear_pending_changes` sets `is_pending=0` | Rows show `is_pending=0` after call |
| `clear_pending_changes` does not delete rows | Row count unchanged after clear |

**`commands/session.rs` — `load_session`**

| Test | Assertion |
|---|---|
| Empty DB returns empty arrays | `photos=[]`, `gpxFiles=[]`, `canRollback=false` |
| Photo inserted → appears in result | Photo id, file path in returned list |
| Photo with `is_pending=1` row → `pendingChanges` non-null | JSON object contains the pending field |
| Photo with no `is_pending=1` rows → `pendingChanges` null | `pending_changes` field is `null` |
| File path does not exist on disk → `fileStatus="missing"` | Use a temp path that is then deleted before `load_session` |
| File path exists → `fileStatus="ok"` | Use a real temp file |
| `apply_ops` row present → `canRollback=true` | |
| UI settings in `settings` table → returned in result | Custom timezone/gridTileSize reflected in output |
| Absent UI settings → defaults returned | `workingTimezone="America/Los_Angeles"`, `gridTileSize=0.2`, `mapPanelHeight=200.0` |

**`commands/session.rs` — `clear_session`**

| Test | Assertion |
|---|---|
| Photos cleared | `SELECT COUNT(*) FROM photos = 0` after clear |
| `metadata_current` cleared | Count = 0 |
| `metadata_original` cleared | Count = 0 |
| `apply_ops` cleared | Count = 0 |
| `apply_history` cleared | Count = 0 |
| `gpx_files` cleared | Count = 0 |
| Corpus preserved entirely | All corpus rows (builtin AND custom) survive |
| API key settings preserved | `mapbox_token` and `claude_api_key` rows survive |
| UI settings deleted | `ui.workingTimezone` row absent after clear |

---

## What this phase does NOT include

- **File-change detection at Apply time** — detecting that a photo file was modified on disk by another app between import and Apply (SHA-256 comparison at write time). Deferred.
- **Re-import / re-link of missing files** — the PRD explicitly states there is no re-linking flow. Missing photos can only be removed.
- **Session export / import** — there is no mechanism to back up or migrate a session to another machine.
- **Corpus-level persistence changes** — the corpus already persists across sessions. No changes needed here.
- **E2E tests** — require a compiled `.app` bundle; deferred to a future phase.
