# Phase 5: Inspector Panel — Live Editing

**Goal:** The Inspector Panel is fully interactive. Selecting one or more photos populates all four sections (Date & Time, Camera Details, Location, Vibe Tag) with live values — or "Multiple Values" where selections differ — and editing any field immediately queues a pending change visible as a blue dot on affected tiles. The ControlBar Apply / Roll Back / Reset pipeline is fully wired. Location and Vibe Tag sections gate on API keys stored via a lightweight settings layer.

**Prerequisites:** Phase 0 scaffold, Phase 1 thumbnail pipeline, Phase 2 testing infrastructure, Phase 3 import pipeline, Phase 4 photo grid with selection.

---

## Step 1 — Shared Inspector Infrastructure

**Deliverable:** Utilities and primitives used by all four sections are in place; the InspectorPanel component is refactored to import real section components instead of static stubs; a reusable ConfirmDialog is available.

### `src/lib/inspectorUtils.ts`

Utility functions shared by all Inspector sections:

```typescript
// Returns the field value if all selected photos agree, 'multiple' if they differ,
// or null if the selection is empty or the field is null for every photo.
export function deriveFieldValue<T>(
  photos: Photo[],
  getter: (m: Metadata) => T | null
): T | 'multiple' | null

// Build a SET_PENDING payload, dispatching only for the given field.
// Does NOT dispatch if the new value equals the current effective value on every photo.
export function buildPendingChange(
  field: keyof Metadata,
  value: Metadata[keyof Metadata]
): Partial<Metadata>
```

`deriveFieldValue` is the canonical way every section reads its current display value:
- Receives the `Photo[]` array for the current selection (derived in each section via `useSession`).
- Returns the shared value if all selected photos agree.
- Returns `'multiple'` if two or more distinct non-null values exist.
- Returns `null` if all values are null (or the selection is empty).

### `src/components/common/ConfirmDialog/ConfirmDialog.tsx`

A generic blocking modal used for multi-value overwrite confirmations, session clear, and rollback. Props:

```typescript
interface ConfirmDialogProps {
  title: string;
  message: string;           // Supports a plain string or ReactNode
  confirmLabel?: string;     // Default: "Confirm"
  cancelLabel?: string;      // Default: "Cancel"
  destructive?: boolean;     // Styles confirm button with --color-danger
  onConfirm: () => void;
  onCancel: () => void;
}
```

Rendered as a centered overlay with a `.inspector-card`-style card, backdrop, and two buttons (`.btn-glass` cancel, `.btn-primary` or `.btn-danger` confirm depending on `destructive`). Styled in `ConfirmDialog.module.css`.

### `src/components/InspectorPanel/InspectorPanel.tsx` — refactored

Replace the four static section stubs with real section component imports:

```tsx
<div className={styles.panel}>
  <DateTimeSection selectedPhotos={selectedPhotos} />
  <CameraSection   selectedPhotos={selectedPhotos} />
  <LocationSection selectedPhotos={selectedPhotos} />
  <VibeTagSection  selectedPhotos={selectedPhotos} />
</div>
```

`selectedPhotos` is derived inside `InspectorPanel`:

```typescript
const { state, dispatch } = useSession();
const selectedPhotos = state.photos.filter(p => state.selectedIds.has(p.id));
```

When `selectedPhotos.length === 0`, each section renders an empty/disabled state. The panel itself does not render any section-level copy — that is each section's responsibility.

### Section header pattern

Each section starts with a `<div className="section-label">Title</div>` (from `components.css`) followed by its content wrapped in an `.inspector-card`. No shared wrapper component is needed — each section is self-contained.

### Multi-value confirmation pattern

Before dispatching `SET_PENDING` for a field that currently returns `'multiple'` from `deriveFieldValue`, the section must show `ConfirmDialog` with the message:

> "You are about to overwrite **N** different values with a single value. Continue?"

where N is `new Set(selectedPhotos.map(p => getter(p.currentMetadata))).size`. The dispatch only fires on confirm.

---

## Step 2 — Date & Time Section

**Deliverable:** `DateTimeSection` reads capture date, time, and timezone from the current selection and queues pending changes immediately on edit.

### `src/components/InspectorPanel/DateTimeSection/DateTimeSection.tsx`

**Inputs:**

| Control | Type | Notes |
|---|---|---|
| Date | `<input type="date">` | Shows current value; empty if null; "—" placeholder when `'multiple'` |
| Time | `<input type="time">` | `HH:MM` step (no seconds); empty if null |
| Timezone | Searchable select (see below) | IANA name; "Multiple Values" option when `'multiple'` |
| Increment | `<input type="number">` + ± buttons | Disabled when any selected photo has no captureDate/Time |

**Reading values:**

```typescript
const captureDate = deriveFieldValue(selectedPhotos, m => m.captureDate);
const captureTime = deriveFieldValue(selectedPhotos, m => m.captureTime);
const timezone    = deriveFieldValue(selectedPhotos, m => m.timezone);
```

Display rules:
- If `null` → render placeholder text "Not set" in secondary color.
- If `'multiple'` → render the string "Multiple Values" in secondary color; the input is still editable. On edit, trigger the multi-value confirm dialog before dispatching.
- If a concrete value → display it.

**Dispatching pending changes:**

On any field change, call:
```typescript
dispatch({ type: 'SET_PENDING', ids: selectedPhotos.map(p => p.id), changes: { [field]: newValue } });
```

Individual fields are dispatched independently. Changing the date does not overwrite the time, and vice versa.

**PRD rule — time defaults to midnight when only date is set:**

When the user sets a date but no time exists on any of the selected photos, automatically include `captureTime: '00:00:00'` in the pending change payload alongside `captureDate`.

**Timezone dropdown:**

Populated with `Intl.supportedValuesOf('timeZone')` (all IANA names, ~600 values). Rendered as a searchable combobox: a text input that filters the list as the user types, with a scrollable dropdown. No external library. Implemented inline in `DateTimeSection` (not shared with the Working Timezone control in FloatingControls, which already has its own implementation). Style with `DateTimeSection.module.css`.

When the timezone changes:
1. Derive the UTC offset from the new timezone + the current capture date using `getUtcOffset` (the helper from the architecture doc using `Intl.DateTimeFormat`).
2. Dispatch `SET_PENDING` with `{ timezone: newTzName }`. The `utcOffset` field is not written to pending changes — it is computed at Apply time.

**Increment control:**

Enabled only when `captureDate !== null && captureDate !== 'multiple'` AND each selected photo individually has `captureDate` and `captureTime` set (grey out otherwise with a tooltip "Set date and time first").

```
[−]  [__2__ hours]  [+]
```

On ± click:
- For each selected photo independently, compute `newTime = captureTime ± (hours * 3600 seconds)`.
- If the result overflows midnight, carry over into `captureDate` (add/subtract days accordingly).
- Dispatch `SET_PENDING` with `{ captureDate: newDate, captureTime: newTime }` per photo using individual dispatches (or a bulk SET_PENDING that accepts per-photo changes — see note below).

**Note on per-photo time values for Increment:** The existing `SET_PENDING` action applies the same `Partial<Metadata>` to all given IDs. Increment produces a *different* value per photo (each photo shifts by the same delta but from a different starting point). Handle this by dispatching multiple `SET_PENDING` actions — one per photo — each with `ids: [photo.id]` and its individually computed new date/time. This is correct and efficient since `SET_PENDING` is a synchronous reducer action.

---

## Step 3 — Camera Details Section

**Deliverable:** `CameraSection` shows corpus-backed dropdowns for Camera Body, Lens, and Film, with recently-used ordering, custom entry creation, and custom entry removal.

### `src/components/common/CorpusComboBox/CorpusComboBox.tsx`

A reusable combobox used by all three camera fields. This is the most complex UI primitive in Phase 5. Props:

```typescript
interface CorpusComboBoxProps {
  label: string;                     // "Camera Body" | "Lens" | "Film"
  value: string | 'multiple' | null; // Derived value for the selection
  entries: CorpusEntry[];            // From CorpusContext, pre-sorted
  onSelect: (value: string) => void; // Called with chosen value
  onAddEntry: (value: string) => void;
  onRemoveEntry: (value: string) => void;
  placeholder?: string;
}
```

**Behavior:**

1. **Closed state:** Shows the current value, "Multiple Values", or a placeholder. A caret icon indicates it's openable.
2. **Open state:** A dropdown appears below the input. The input becomes a text filter.
3. **Dropdown list order:** Recently used first (sorted by `lastUsed` desc), then alphabetical. A faint divider separates recent from the rest.
4. **Filtering:** As the user types, the list filters case-insensitively (Unicode NFC normalized). The typed string is shown at the top of the list as an "Add '…'" option if it doesn't exactly match any existing entry (case-insensitive).
5. **Selecting an item:** Calls `onSelect(value)`, closes the dropdown.
6. **Adding a custom entry:** Clicking "Add '…'" calls `onAddEntry(typedValue)`, then `onSelect(typedValue)`.
7. **Removing a custom entry:** Each non-builtin entry has an ✕ icon on hover. Clicking it calls `onRemoveEntry(value)`. Builtin entries have no ✕.
8. **Value not in corpus:** If a photo already has a value set that doesn't match any corpus entry, the combobox shows it in italic text. An "(Add to list)" affordance appears in the dropdown for it.
9. **Multiple Values:** The input placeholder is "Multiple Values". Opening the dropdown and selecting a value triggers the multi-value confirm dialog before dispatching.

`CorpusComboBox.module.css` handles dropdown positioning (absolute, anchored below input), item hover states, and the ✕ icon visibility.

### `src/components/InspectorPanel/CameraSection/CameraSection.tsx`

Three `CorpusComboBox` instances — Camera Body, Lens, Film — stacked vertically with `.space-2` gaps.

**Reading values:**

```typescript
const cameraBody = deriveFieldValue(selectedPhotos, m => m.cameraBody);
const lens       = deriveFieldValue(selectedPhotos, m => m.lens);
const film       = deriveFieldValue(selectedPhotos, m => m.film);
```

**Corpus wiring:**

```typescript
const { state: corpusState, dispatch: corpusDispatch } = useCorpus();

// Sort entries: recently used first, then alphabetical
function sortedEntries(entries: CorpusEntry[]): CorpusEntry[] {
  return [...entries].sort((a, b) => {
    if (a.lastUsed && b.lastUsed) return b.lastUsed - a.lastUsed;
    if (a.lastUsed) return -1;
    if (b.lastUsed) return 1;
    return a.value.localeCompare(b.value);
  });
}
```

**On selection:**
1. Trigger multi-value confirm if applicable.
2. Dispatch `SET_PENDING` for the relevant field.
3. Dispatch `RECORD_USE` to the CorpusContext for the selected value.
4. Call the Rust backend to persist the use record: `tauriCommands.recordCorpusUse(category, value)` — see Tauri additions below.

**On add entry:**
1. Dispatch `ADD_ENTRY` to CorpusContext.
2. Call `tauriCommands.addCorpusEntry(category, value)` to persist to SQLite `corpus` table.

**On remove entry:**
1. Show `ConfirmDialog`: "Remove '**{value}**' from the list? Photos already tagged with this value are not affected."
2. On confirm: dispatch `REMOVE_ENTRY`, call `tauriCommands.removeCorpusEntry(category, value)`.

### New Tauri command wrappers in `src/lib/tauri.ts`

```typescript
addCorpusEntry:    (category: string, value: string) => invoke<void>('add_corpus_entry', { category, value }),
removeCorpusEntry: (category: string, value: string) => invoke<void>('remove_corpus_entry', { category, value }),
recordCorpusUse:   (category: string, value: string) => invoke<void>('record_corpus_use', { category, value }),
loadCorpus:        () => invoke<CorpusState>('load_corpus'),
```

`loadCorpus` is called once on app startup in `PhotoManager.tsx` (alongside `loadSession`) and its result dispatched as `LOAD_CORPUS` to CorpusContext.

---

## Step 4 — ControlBar Wiring & Apply Modal

**Deliverable:** Apply, Roll Back, and Reset All/Selected buttons are fully wired. An `ApplyModal` blocks the UI during apply and cancellation.

### Apply button

The Apply button in `ControlBar` is enabled when `state.photos.some(p => p.pendingChanges !== null)`.

On click:
1. Collect all photos with `pendingChanges !== null`.
2. Build `ApplyPayload`:
   ```typescript
   const changes: Record<string, Partial<Metadata>> = {};
   for (const photo of photosWithPending) {
     changes[photo.id] = photo.pendingChanges!;
   }
   ```
3. Dispatch `APPLY_START` to set `applyInProgress: true`.
4. Show `ApplyModal`.
5. Call `tauriCommands.applyChanges({ changes })`.

### `src/components/ApplyModal/ApplyModal.tsx`

A full-screen blocking overlay rendered only when `applyInProgress === true`. Props:

```typescript
interface ApplyModalProps {
  total: number;
  onCancel: () => void;  // Disabled once undo pass begins
}
```

**Internal state:**
```typescript
type Phase = 'applying' | 'undoing' | 'done';
const [phase, setPhase] = useState<Phase>('applying');
const [done, setDone]   = useState(0);
const [total, setTotal] = useState(props.total);
```

**Event listeners** (registered via `listen()` from `@tauri-apps/api/event` on mount, cleaned up on unmount):

| Event | Action |
|---|---|
| `apply:progress` | `{ done: number, total: number }` → update `done` and `total` |
| `apply:complete` | Call `tauriCommands.loadSession()`, dispatch `APPLY_COMPLETE` with reloaded photos, close modal |
| `apply:undo_progress` | `{ done: number, total: number }` → switch `phase` to `'undoing'`, update counters |
| `apply:cancelled` | Close modal, dispatch `APPLY_START` inverse (no state change needed since undo reverted changes) |

**Cancel button:**
- Visible and enabled during `'applying'` phase only.
- On click: calls `tauriCommands.applyCancel()`, disables the button, switches `phase` to `'undoing'`.

**Progress display:**
- During `'applying'`: "Writing changes… N / M files" with a progress bar.
- During `'undoing'`: "Reverting changes… N / M files" with a progress bar. No cancel button.

Add `applyCancel` to `src/lib/tauri.ts`:
```typescript
applyCancel: () => invoke<void>('apply_cancel'),
```

### Roll Back button

Enabled when the Rust session has at least one entry in `apply_ops`. The frontend tracks this via a `canRollback: boolean` field added to `SessionState` (set to `true` by `APPLY_COMPLETE`, set to `false` by `ROLLBACK_COMPLETE` if no further history remains).

On click:
1. Show `ConfirmDialog`: "Roll back the most recent Apply? This cannot be undone."
2. On confirm: call `tauriCommands.rollback()`.
3. On success: call `tauriCommands.loadSession()`, dispatch `ROLLBACK_COMPLETE` with reloaded photos.

Add `canRollback: boolean` to `SessionState` (default `false`). Set it `true` in `APPLY_COMPLETE`, and update it in `ROLLBACK_COMPLETE` based on whether the reloaded session still has apply history (the Rust `load_session` response should include a `canRollback: boolean` flag).

### Reset All / Reset Selected button

The button label and behavior:
- No selection → "Reset All Photos": resets every photo in the session.
- Selection active → "Reset Selected": resets only selected photos.

Both cases are enabled only when the relevant photos have `pendingChanges !== null` OR `currentMetadata !== originalMetadata`.

On click:
1. Show `ConfirmDialog`: "Reset N photo(s) to their original metadata? Pending changes will be discarded." (Use `.btn-danger` for confirm.)
2. On confirm: 
   - Call `tauriCommands.resetPhotos(ids)`.
   - Dispatch `CLEAR_PENDING` with the relevant IDs. The reducer already handles resetting `currentMetadata` to `originalMetadata` and clearing `pendingChanges`.

---

## Step 5 — API Key Settings

**Deliverable:** A settings store persists Mapbox and Claude API keys across sessions. A gear icon in the TopBar opens a settings drawer. Location and Vibe Tag sections gate on key presence.

### Settings storage: SQLite `settings` table

Add to the SQLite schema in `src-tauri/src/session.rs`:

```sql
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

This table survives session clears (like `corpus`). Keys: `mapbox_token`, `claude_api_key`.

### New Tauri command wrappers in `src/lib/tauri.ts`

```typescript
getSetting: (key: string) => invoke<string | null>('get_setting', { key }),
setSetting: (key: string, value: string) => invoke<void>('set_setting', { key, value }),
```

### Settings in UIContext

Add to `UIState`:
```typescript
mapboxToken: string | null;
claudeApiKey: string | null;
```

Add to `UIContext` reducer actions:
```typescript
| { type: 'SET_MAPBOX_TOKEN';  token: string | null }
| { type: 'SET_CLAUDE_API_KEY'; key: string | null }
```

On app startup (in `PhotoManager.tsx`), call `getSetting('mapbox_token')` and `getSetting('claude_api_key')` and dispatch the respective SET actions.

### `src/components/Settings/SettingsDrawer.tsx`

A drawer that slides in from the right (or a modal — whichever is simpler). Opened by a gear `⚙` icon added to the far right of `ControlBar`.

Contains:
- **Mapbox API Key** — password-type text input + Save button. Shows last 8 chars masked when a key is saved. Calls `setSetting('mapbox_token', value)` and dispatches `SET_MAPBOX_TOKEN`.
- **Claude API Key** — same pattern. Calls `setSetting('claude_api_key', value)` and dispatches `SET_CLAUDE_API_KEY`.

Styled with `SettingsDrawer.module.css`. Overlays the Inspector Panel at `z-index: var(--z-inspector)` + 1 (add `--z-settings: 25` to `tokens.css`).

---

## Step 6 — Location Section

**Deliverable:** `LocationSection` shows a Mapbox GL JS mini-map with a draggable pin, a type-ahead location search input, and a timezone mismatch alert.

### Prerequisites

- `mapbox-gl` npm package already installed (scaffold step).
- Mapbox token available via `useUI().state.mapboxToken`.

### `src/components/InspectorPanel/LocationSection/LocationSection.tsx`

**No-token state:** When `mapboxToken` is null, render an `.inspector-card` containing: "A Mapbox API key is required for location features." with a button "Open Settings" that opens `SettingsDrawer`.

**With-token state:**

```
┌──────────────────────┐
│  [Search field     ] │  ← type-ahead input
│  ┌────────────────┐  │
│  │                │  │
│  │  Mapbox map    │  │  ← 180px tall, no controls except marker
│  │    📍           │  │
│  │                │  │
│  └────────────────┘  │
│  37.7694°N 122.4862°W │  ← current coords (or "Not set")
│  ⚠ Timezone mismatch  │  ← conditional alert
└──────────────────────┘
```

**Map instance:**

Initialize via `new mapboxgl.Map({ container, style: 'mapbox://styles/mapbox/streets-v12', zoom: 12 })` inside a `useEffect`. Use `mapboxgl.accessToken = mapboxToken` before initialization.

If all selected photos share a non-null GPS location (`deriveFieldValue` returns a concrete `{lat, lng}`), center the map there and show a `Marker`. If `'multiple'`, show an informational message "Multiple locations" and no map pin. If `null`, center on a default location (e.g. world overview zoom 1) with no pin.

**Draggable marker:**

```typescript
const marker = new mapboxgl.Marker({ draggable: true }).setLngLat([lng, lat]).addTo(map);
marker.on('dragend', () => {
  const { lat, lng } = marker.getLngLat();
  dispatchPending({ gpsLat: lat, gpsLng: lng });
});
```

Map pan also updates location (use `map.on('click', ...)` as an alternative to dragging).

**Type-ahead search:**

A plain text `<input>` above the map. `onChange` (debounced 300ms) calls the Mapbox Geocoding API v6:

```
GET https://api.mapbox.com/search/geocode/v6/forward
  ?q={query}&access_token={token}&limit=5&autocomplete=true
```

Parse `features[]` from the response and show a dropdown list of `properties.full_address` strings. On selection:
1. Extract `geometry.coordinates` → `[lng, lat]`.
2. Fly the map to the coordinates.
3. Dispatch `SET_PENDING` with `{ gpsLat: lat, gpsLng: lng }`.
4. Call `tauriCommands.resolveTimezone(lat, lng)` → returns IANA timezone string.
5. Store the resolved timezone in local component state for mismatch detection (do not auto-set it as pending — that would override the user's timezone choice without consent).

**Timezone mismatch alert:**

After resolving the timezone from coordinates, compare it to the current Inspector Panel timezone value (from `deriveFieldValue(selectedPhotos, m => m.timezone)`). If they differ and both are non-null, show an inline warning:

> ⚠ Location suggests **{resolvedTimezone}** but timezone is set to **{photoTimezone}**.

This is advisory only. No action is forced.

**New Tauri command wrapper:**

```typescript
resolveTimezone: (lat: number, lng: number) => invoke<string>('resolve_timezone', { lat, lng }),
```

The Rust `resolve_timezone` command uses the `tzf-rs` crate (`tzf-rs = "0.6"` added to `Cargo.toml`).

**CSS:** `LocationSection.module.css`. The map container must have an explicit pixel height (e.g. `180px`) — Mapbox GL JS requires a non-zero height to initialize correctly.

---

## Step 7 — Vibe Tag Section

**Deliverable:** `VibeTagSection` presents a chat-style interface for natural-language metadata entry using Claude. The model returns a structured `MetadataProposal`; the user can Accept or Follow Up.

### Prerequisites

- `@anthropic-ai/sdk` npm package already installed (scaffold step).
- Claude API key available via `useUI().state.claudeApiKey`.

### `src/lib/vibeTag.ts`

```typescript
interface MetadataProposal {
  capture_date?: string;    // "YYYY-MM-DD"
  capture_time?: string;    // "HH:MM:SS"
  timezone?: string;        // IANA name
  camera_body?: string;
  lens?: string;
  film?: string;            // combined string e.g. "Kodak Portra 400"
  location?: { lat: number; lng: number; display_name: string };
}

interface VibeTagMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Calls Claude API with the full conversation history.
// Returns MetadataProposal on success, or throws with a user-facing error string.
export async function runVibeTag(
  apiKey: string,
  messages: VibeTagMessage[],
  selectedPhotoCount: number,
  currentMetadataSummary: object,  // Derived from selectedPhotos
  mapboxToken: string | null,
): Promise<MetadataProposal>
```

**System prompt** (assembled fresh per call, as per the architecture doc):

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
- camera_body: string
- lens: string
- film: combined string e.g. "Kodak Portra 400"
- location: call the geocode_location tool to resolve a place name to coordinates

Rules:
- Only include fields the user's input explicitly addresses.
- Do not include explanation or prose in your response.
- If any field value is ambiguous, omit that field rather than guessing.
```

**Geocoding tool definition** (passed as `tools` to the Claude API):

```json
{
  "name": "geocode_location",
  "description": "Resolve a place name or address to GPS coordinates and IANA timezone.",
  "input_schema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Place name or address to look up." }
    },
    "required": ["query"]
  }
}
```

When Claude calls `geocode_location`:
1. Call Mapbox Geocoding API with the query (same as Location section search).
2. Call `tauriCommands.resolveTimezone(lat, lng)` to get IANA timezone.
3. Return a `tool_result` block:
   ```json
   { "lat": 37.7694, "lng": -122.4862, "display_name": "...", "iana_timezone": "America/Los_Angeles" }
   ```
4. Continue the API call with the tool result in the messages array.

The final response is either a valid JSON `MetadataProposal` or the error string. Parse and validate on receipt.

**Model:** `claude-sonnet-4-6` (as specified in the architecture doc).

**`currentMetadataSummary`** is built from `selectedPhotos`:
```typescript
{
  capture_date: deriveFieldValue(photos, m => m.captureDate) ?? 'unset',
  capture_time: deriveFieldValue(photos, m => m.captureTime) ?? 'unset',
  timezone: deriveFieldValue(photos, m => m.timezone) ?? 'unset',
  camera_body: deriveFieldValue(photos, m => m.cameraBody) ?? 'unset',
  lens: deriveFieldValue(photos, m => m.lens) ?? 'unset',
  film: deriveFieldValue(photos, m => m.film) ?? 'unset',
  gps: deriveFieldValue(photos, m => m.gpsLat !== null ? `${m.gpsLat}, ${m.gpsLng}` : null) ?? 'unset',
}
```

### `src/components/InspectorPanel/VibeTagSection/VibeTagSection.tsx`

**No-key state:** Same pattern as LocationSection — "A Claude API key is required for Vibe Tag." with an "Open Settings" button.

**With-key state — conversation flow:**

```
┌──────────────────────────────────┐
│  assistant: "Capture time set    │  ← proposal preview card
│  to 12:00 PM for 4 photos."      │
│  [Accept]  [Follow Up]           │
├──────────────────────────────────┤
│  [_____________________] [→]     │  ← text input, Enter to submit
└──────────────────────────────────┘
```

**State (local to component, not persisted):**

```typescript
const [messages,  setMessages]  = useState<VibeTagMessage[]>([]);
const [proposal,  setProposal]  = useState<MetadataProposal | null>(null);
const [loading,   setLoading]   = useState(false);
const [error,     setError]     = useState<string | null>(null);
```

**Conversation history scoping:** Clear `messages`, `proposal`, and `error` whenever `selectedIds` changes (via `useEffect` with `selectedIds` as a dependency). This matches the architecture spec: history is stale when the selection changes.

**Submit flow:**
1. Append user message to `messages`.
2. Set `loading: true`.
3. Call `runVibeTag(apiKey, messages, count, summary, mapboxToken)`.
4. On success: append the assistant's raw JSON as a message, set `proposal`.
5. On error: set `error` string, do not append to messages.
6. Set `loading: false`.

**Accept:**
1. Convert `MetadataProposal` fields to `Partial<Metadata>`:
   - `capture_date` → `captureDate`
   - `capture_time` → `captureTime`
   - `timezone` → `timezone`
   - `camera_body` → `cameraBody`
   - `lens` → `lens`
   - `film` → `film`
   - `location.lat` / `location.lng` → `gpsLat` / `gpsLng`
2. Dispatch `SET_PENDING` for all selected photo IDs.
3. Clear `proposal` and `messages`.

**Follow Up:**
- Keep `proposal` and `messages` as-is. The input field re-focuses and the previous proposal remains visible as context.
- User types a follow-up message; on submit the full `messages` array (including prior assistant proposal) is sent to Claude.

**Loading state:** Show a spinner in the input area. Disable the input during `loading`.

**Error state:** Show `error` text below the input in `--color-danger` color. Clear on next submit.

**Styled in `VibeTagSection.module.css`.**

---

## What this phase does NOT include

The following are deferred to later phases:

- **MapPanel bottom overlay** — map pins for all photos, GPX route rendering, resize handle behavior (Phase 7).
- **GPX import and auto-tagging** — "Locate Photos on GPX" button in Location section (Phase 8).
- **Corpus pre-loaded defaults** — seeding the built-in camera/lens/film options from a bundled JSON file (Phase 9).
- **ExifTool apply pipeline** — the Rust `apply_changes` command writes metadata to disk using ExifTool; the Rust backend stubs are wired but ExifTool integration is Phase 3/6 territory.
- **`tzf-rs` full integration** — the Rust command stub returns a placeholder; the actual `tzf-rs` crate integration and its binary data dependency are completed when the Location section is exercised end-to-end.
- **Keychain storage for API keys** — the SQLite settings table is the implementation here; migrating to macOS Keychain via `tauri-plugin-stronghold` is a future hardening step.
