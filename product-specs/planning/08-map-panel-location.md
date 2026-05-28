# Phase 8: Map Panel (Mapbox) + Location Section

**Goal:** The bottom Map Panel becomes a fully functional Mapbox GL JS map showing photo location pins with clustering and GPX route overlays. The drag handle resizes the panel by updating `UIContext`. The Location section of the Inspector Panel — which is already substantially implemented — is verified, completed where gaps exist, and tested. Mapbox token storage via macOS Keychain is wired up. GPX data rendered here is read from session state but import/auto-tagging is deferred to Phase 9.

**Prerequisites:** Phase 7 complete. `AppState` is fully wired. `LocationSection` skeleton exists. `resolve_timezone` Tauri command is registered. `mapPanelHeight` is in `UIContext` with `SET_MAP_PANEL_HEIGHT`. GPS fields (`gpsLat`, `gpsLng`) exist in `Metadata` and are written via `apply_changes`.

---

## Step 1 — Mapbox Token: Keychain Storage + Settings

**Deliverable:** The Mapbox API token is stored in macOS Keychain via Tauri's secure storage plugin and is accessible throughout the frontend. A settings entry point allows the user to add or update the token.

### Rust: `tauri-plugin-stronghold` vs `keytar`

Use Tauri's `tauri-plugin-stronghold` or the simpler `tauri-plugin-store` with macOS Keychain delegation. Given the existing architecture (no stronghold dependency), use **`tauri-plugin-store`** to persist non-secret settings (mapbox token, claude API key) in the app data directory, keeping the integration simple and consistent. Token is not a user credential — it is a developer API key; writing it to the app store (not the system Keychain) is acceptable.

If `tauri-plugin-store` is not yet in `Cargo.toml`, add it. Otherwise, check whether a `settings` store already exists from Phase 5 and extend it.

**File:** `src-tauri/Cargo.toml` — add if missing:
```toml
tauri-plugin-store = "2"
```

**File:** `src-tauri/src/lib.rs` — register in setup:
```rust
app.plugin(tauri_plugin_store::Builder::default().build())?;
```

**File:** `src-tauri/tauri.conf.json` — add store capability if needed:
```json
"plugins": {
  "store": {}
}
```

### Tauri Commands: `get_setting` / `set_setting`

**File:** `src-tauri/src/commands/settings.rs` (extend existing if present)

```rust
#[tauri::command]
pub async fn get_setting(
    app: tauri::AppHandle,
    key: String,
) -> Result<Option<String>, String> {
    let store = tauri_plugin_store::StoreBuilder::new(&app, "settings.json")
        .build()
        .map_err(|e| e.to_string())?;
    Ok(store.get(&key).and_then(|v| v.as_str().map(String::from)))
}

#[tauri::command]
pub async fn set_setting(
    app: tauri::AppHandle,
    key: String,
    value: String,
) -> Result<(), String> {
    let mut store = tauri_plugin_store::StoreBuilder::new(&app, "settings.json")
        .build()
        .map_err(|e| e.to_string())?;
    store.insert(key, serde_json::Value::String(value))
        .map_err(|e| e.to_string())?;
    store.save().map_err(|e| e.to_string())
}
```

Register both in `tauri::generate_handler![]` and `commands/mod.rs`.

### Frontend: `src/lib/tauri.ts`

Add to `tauriCommands`:
```typescript
getSetting: (key: string) => invoke<string | null>('get_setting', { key }),
setSetting: (key: string, value: string) => invoke<void>('set_setting', { key, value }),
```

### UIContext: `mapboxToken`

**File:** `src/state/UIContext.tsx`

Add to `UIState`:
```typescript
mapboxToken: string | null;
```

Add action:
```typescript
| { type: 'SET_MAPBOX_TOKEN'; token: string }
```

Reducer case:
```typescript
case 'SET_MAPBOX_TOKEN':
  return { ...state, mapboxToken: action.token };
```

On app startup (`App.tsx`), load the stored token:
```typescript
useEffect(() => {
  tauriCommands.getSetting('mapbox_token').then(token => {
    if (token) uiDispatch({ type: 'SET_MAPBOX_TOKEN', token });
  });
}, []);
```

### Settings Drawer Entry

**File:** `src/components/TopBar/TopBar.tsx` (or a dedicated `SettingsDrawer` component)

Add a small gear icon button in the TopBar. Clicking it opens an inline settings panel (not a modal — a slide-in drawer using `position: absolute; right: 0; top: var(--topbar-height)` at `z-index: var(--z-topbar)`). The drawer contains:
- A labeled text input for **Mapbox Token** with a Save button
- A labeled text input for **Claude API Key** (if not already in Phase 5)

On Save, call `tauriCommands.setSetting('mapbox_token', value)` and dispatch `SET_MAPBOX_TOKEN`.

If a settings drawer was built in Phase 5 for the Claude API key, extend it here rather than creating a new one.

---

## Step 2 — MapPanel: Full Mapbox Implementation

**Deliverable:** The bottom map overlay renders a live Mapbox GL JS map. Photo pins update reactively. Nearby pins cluster into count bubbles. GPX route `LineString` layers are rendered when GPX data is present in session state. The drag handle updates panel height.

### `src/components/MapPanel/MapPanel.tsx`

Replace the current placeholder entirely.

**Responsibilities:**
1. Initialize a Mapbox GL JS map in a `useEffect` when `mapboxToken` is available.
2. Keep a GeoJSON `FeatureCollection` source in sync with session photos that have `gpsLat`/`gpsLng`.
3. Render photo pins with Mapbox's built-in clustering (`cluster: true` on the source).
4. Render individual pins as small circles; clusters as circles with a count label.
5. Render GPX route `LineString`s as `LineLayer` sources when `state.gpxFiles` is non-empty.
6. The drag handle at the top edge calls `uiDispatch({ type: 'SET_MAP_PANEL_HEIGHT', height })`.

**Full component structure:**

```tsx
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useRef, useEffect, useCallback } from 'react';
import { useSession } from '../../state/SessionContext';
import { useUI } from '../../state/UIContext';
import styles from './MapPanel.module.css';

export function MapPanel() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const { state: session } = useSession();
  const { state: ui, dispatch: uiDispatch } = useUI();

  // Initialize map
  useEffect(() => {
    if (!ui.mapboxToken || !mapContainer.current || map.current) return;
    mapboxgl.accessToken = ui.mapboxToken;
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      zoom: 1,
      center: [0, 20],
    });
    map.current.on('load', () => {
      setupSources(map.current!);
    });
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, [ui.mapboxToken]);

  // Sync photo pins
  useEffect(() => {
    if (!map.current?.isStyleLoaded()) return;
    const source = map.current.getSource('photos') as mapboxgl.GeoJSONSource;
    if (!source) return;
    source.setData(buildPhotoGeoJSON(session.photos));
  }, [session.photos]);

  // Drag handle
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    const startY = e.clientY;
    const startHeight = ui.mapPanelHeight;
    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      uiDispatch({ type: 'SET_MAP_PANEL_HEIGHT', height: startHeight + delta });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [ui.mapPanelHeight, uiDispatch]);

  if (!ui.mapboxToken) {
    return (
      <div className={styles.panel} style={{ height: ui.mapPanelHeight }}>
        <div className={styles.dragHandle} onMouseDown={handleDragStart} />
        <div className={styles.tokenPrompt}>
          Add a Mapbox token in Settings to enable the map.
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel} style={{ height: ui.mapPanelHeight }}>
      <div className={styles.dragHandle} onMouseDown={handleDragStart} />
      <div ref={mapContainer} className={styles.map} />
    </div>
  );
}
```

**`setupSources` (inside same file, not exported):**

```typescript
function setupSources(map: mapboxgl.Map) {
  map.addSource('photos', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    cluster: true,
    clusterMaxZoom: 14,
    clusterRadius: 50,
  });

  // Cluster circles
  map.addLayer({
    id: 'clusters',
    type: 'circle',
    source: 'photos',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#007AFF',
      'circle-radius': ['step', ['get', 'point_count'], 16, 10, 22, 30, 28],
      'circle-opacity': 0.85,
    },
  });

  // Cluster count labels
  map.addLayer({
    id: 'cluster-count',
    type: 'symbol',
    source: 'photos',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': '{point_count_abbreviated}',
      'text-size': 12,
      'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
    },
    paint: { 'text-color': '#ffffff' },
  });

  // Individual photo pins
  map.addLayer({
    id: 'unclustered-point',
    type: 'circle',
    source: 'photos',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': '#007AFF',
      'circle-radius': 6,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#ffffff',
    },
  });
}
```

**`buildPhotoGeoJSON` (inside same file, not exported):**

```typescript
function buildPhotoGeoJSON(photos: Photo[]): GeoJSON.FeatureCollection {
  const features = photos
    .filter(p => p.currentMetadata.gpsLat != null && p.currentMetadata.gpsLng != null)
    .map(p => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [p.currentMetadata.gpsLng!, p.currentMetadata.gpsLat!],
      },
      properties: { id: p.id },
    }));
  return { type: 'FeatureCollection', features };
}
```

### GPX Route Rendering

GPX data is part of `SessionState.gpxFiles`. Each `GpxFile` carries parsed track points (added in Phase 9's import flow). For Phase 8, define the shape and render routes if the data is present — the import side is Phase 9.

Add to `GpxFile` interface in `SessionContext.tsx` (extend the existing stub):
```typescript
interface GpxFile {
  id: string;
  filePath: string;
  trackPoints: Array<{ lat: number; lng: number; timestamp: string }>;
  thumbnailPath: string | null;
}
```

In `MapPanel`, sync GPX layers alongside photo pins in a `useEffect` on `session.gpxFiles`:

```typescript
useEffect(() => {
  if (!map.current?.isStyleLoaded()) return;
  syncGpxLayers(map.current, session.gpxFiles);
}, [session.gpxFiles]);
```

**`syncGpxLayers` (inside same file, not exported):**

```typescript
function syncGpxLayers(map: mapboxgl.Map, gpxFiles: GpxFile[]) {
  // Remove stale GPX sources/layers no longer in session
  const currentIds = new Set(gpxFiles.map(g => g.id));
  for (const id of getExistingGpxIds(map)) {
    if (!currentIds.has(id)) {
      map.removeLayer(`gpx-line-${id}`);
      map.removeSource(`gpx-${id}`);
    }
  }
  // Add/update sources
  for (const gpx of gpxFiles) {
    const sourceId = `gpx-${gpx.id}`;
    const coords = gpx.trackPoints.map(p => [p.lng, p.lat]);
    const geojson: GeoJSON.Feature = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: {},
    };
    if (map.getSource(sourceId)) {
      (map.getSource(sourceId) as mapboxgl.GeoJSONSource).setData(geojson);
    } else {
      map.addSource(sourceId, { type: 'geojson', data: geojson });
      map.addLayer({
        id: `gpx-line-${gpx.id}`,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#FF9F0A',
          'line-width': 2,
          'line-opacity': 0.8,
        },
      });
    }
  }
}

function getExistingGpxIds(map: mapboxgl.Map): string[] {
  return map.getStyle().sources
    ? Object.keys(map.getStyle().sources).filter(k => k.startsWith('gpx-')).map(k => k.replace('gpx-', ''))
    : [];
}
```

### `src/components/MapPanel/MapPanel.module.css`

```css
.panel {
  position: absolute;
  bottom: 0;
  left: 0;
  right: var(--inspector-width);
  z-index: var(--z-map);
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  overflow: hidden;
  backdrop-filter: blur(var(--blur-glass));
  -webkit-backdrop-filter: blur(var(--blur-glass));
  border: 1px solid var(--color-glass-border);
  border-bottom: none;
}

.dragHandle {
  height: 8px;
  cursor: ns-resize;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  z-index: 1;
}

.dragHandle::before {
  content: '';
  width: 32px;
  height: 3px;
  border-radius: 2px;
  background: var(--color-border);
}

.map {
  flex: 1;
  min-height: 0;
}

.tokenPrompt {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  font-size: 12px;
  background: var(--color-glass-bg);
}
```

---

## Step 3 — LocationSection: Verification and Completion

**Deliverable:** The Location section of the Inspector Panel works end-to-end: geocoding search, map pin drag, timezone mismatch alert, and multi-photo confirmation. Any gaps from the existing implementation are closed.

### Audit existing `LocationSection.tsx`

Review the existing implementation against these PRD requirements and fix any gaps:

| Requirement | Check |
|---|---|
| Geocoding type-ahead search (Mapbox v6) | Verify `fetch` to `https://api.mapbox.com/search/geocode/v6/forward` with `autocomplete=true`; results shown in dropdown |
| Pressing Enter accepts top result | `onKeyDown` handler on search input |
| Map pan/drag updates the pin coordinates and queues `SET_PENDING` | `map.on('moveend')` or marker `dragend` event dispatches pending change |
| Timezone mismatch alert: IANA timezone implied by location differs from Inspector timezone | After resolving lat/lng → timezone via `resolve_timezone`, compare to `currentMetadata.timezone`; show inline alert if different |
| "Multiple Values" when selected photos have different coordinates | Same pattern as other Inspector fields |
| Confirmation dialog when overwriting different coordinates across multi-selection | Same `ConfirmDialog` pattern as Phase 5 |
| Token-missing state: show "Add Mapbox token in Settings" instead of map | Guard on `ui.mapboxToken` |

### `resolve_timezone` Tauri Command

Verify this command is registered and returns an IANA timezone string from `tzf-rs` v1 (not v0.6):

**File:** `src-tauri/Cargo.toml` — confirm:
```toml
tzf-rs = "1"
```

**File:** `src-tauri/src/commands/metadata.rs` (or a dedicated `timezone.rs`):
```rust
#[tauri::command]
pub async fn resolve_timezone(lat: f64, lng: f64) -> Result<String, String> {
    let finder = tzf_rs::DefaultFinder::new();
    finder.get_tz_name(lng, lat)
        .map(String::from)
        .ok_or_else(|| format!("No timezone found for {lat}, {lng}"))
}
```

Note: `tzf_rs::DefaultFinder::get_tz_name` takes `(lng, lat)` — longitude first — per the `tzf-rs` API convention.

Register in `tauri::generate_handler![]` if not already present.

### Frontend: `src/lib/tauri.ts`

Verify `resolveTimezone` wrapper exists; add if missing:
```typescript
resolveTimezone: (lat: number, lng: number) => invoke<string>('resolve_timezone', { lat, lng }),
```

---

## Step 4 — App.tsx: Wire MapPanel into the Shell

**Deliverable:** `MapPanel` appears in the app shell at the correct z-index and responds to session state.

**File:** `src/App.tsx`

The existing shell already has `<MapPanel />` stubbed in. Verify it is positioned correctly:

```tsx
<div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
  <PhotoManager />
  <InspectorPanel />
  <MapPanel />          {/* position: absolute; bottom: 0; left: 0; right: var(--inspector-width) */}
</div>
```

The `height` is driven by `ui.mapPanelHeight` inside `MapPanel` itself — no style prop needed at the App level.

**Resize conflict with photo grid:** The photo grid scrolls independently. The MapPanel floating over it is intentional per the PRD: "Making it taller covers more of the photo grid below, but does not reduce the total scroll height of the grid." No changes to the photo grid layout are needed.

---

## Step 5 — Tests

### Frontend (Vitest)

**`MapPanel`**

Mock `mapbox-gl` via `vi.mock('mapbox-gl', ...)` returning stub Map, Source, and Layer objects. This avoids WebGL context errors in jsdom.

| Test | Assertion |
|---|---|
| Token-missing state renders prompt | When `mapboxToken` is null, renders token prompt text; no map div |
| Token-present state renders map container | When `mapboxToken` is set, map container div is in DOM |
| Drag handle mouse interaction dispatches `SET_MAP_PANEL_HEIGHT` | Simulate mousedown + mousemove; verify `uiDispatch` called with new height |
| `SET_MAP_PANEL_HEIGHT` clamps at minimum (60px) | UIContext reducer: dispatch with `height: 20` → state is `60` |

**`buildPhotoGeoJSON` (unit test the pure function)**

Export `buildPhotoGeoJSON` for testing (or test via the component's GeoJSON source data).

| Test | Assertion |
|---|---|
| Photos without GPS are excluded | Photo with `gpsLat: null` not in output features |
| Photos with GPS are included | Photo with coords produces Point feature at correct `[lng, lat]` |
| `properties.id` is correct | Feature `properties.id` matches `photo.id` |

**UIContext additions**

| Test | Assertion |
|---|---|
| `SET_MAPBOX_TOKEN` stores token | State `mapboxToken` matches dispatched value |
| `getSetting` / `setSetting` tauri wrappers | Correct `invoke` command name and arg shape |

**`LocationSection`** (extend existing tests or add new)

| Test | Assertion |
|---|---|
| Token-missing renders fallback | Renders prompt when `mapboxToken` is null |
| Timezone mismatch alert appears | When resolved timezone ≠ `currentMetadata.timezone`, alert text is in DOM |
| Timezone mismatch alert absent when match | No alert when timezones match |
| "Multiple Values" shown for mixed coordinates | Two photos with different coords → inspector shows "Multiple Values" |

### Rust (Cargo)

**`resolve_timezone`**

| Test | Assertion |
|---|---|
| Known Pacific location | `resolve_timezone(37.7749, -122.4194)` → `"America/Los_Angeles"` |
| Known Tokyo location | `resolve_timezone(35.6762, 139.6503)` → `"Asia/Tokyo"` |
| Off-map coordinates return Err | No panic on e.g. `(0.0, 0.0)` (ocean) — returns `Err` gracefully |

---

## What this phase does NOT include

- **GPX import and auto-tagging** — Phase 9. The `GpxFile` interface is defined and route rendering is implemented, but the import flow, GPX tile in the photo grid, and "Locate Photos on GPX" button are Phase 9.
- **Location reverse geocoding for display** — Reverse geocoding a lat/lng to a place name for display in the Inspector Panel is a nice-to-have; Phase 8 only sets and displays coordinates.
- **Map Panel selection sync** — Clicking a pin on the map to select that photo in the grid is deferred.
- **Satellite layer toggle** — Single dark style only in Phase 8.
- **E2E tests** — Require a compiled `.app` bundle; deferred.
