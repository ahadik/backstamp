# Phase 11: Vibe Tag / Claude Integration

## Current state audit

Most of the Vibe Tag and Settings infrastructure was built alongside earlier phases. Before implementing, confirm:

| Component | Status |
|---|---|
| `src/lib/vibeTag.ts` — Claude API client, tool use loop, geocoding | ✅ Done |
| `src/components/InspectorPanel/VibeTagSection/VibeTagSection.tsx` — full chat UI, Accept/Follow Up, key gating | ✅ Done |
| `src/components/SettingsModal/SettingsModal.tsx` — two-key settings with test/show/remove | ✅ Done |
| `UIContext` — `mapboxToken` + `claudeApiKey` state and actions | ✅ Done |
| `App.tsx` — loads keys from SQLite on startup, renders `SettingsModal`, passes `onOpenSettings` | ✅ Done |
| `TopBar` — gear icon wired to `onOpenSettings` | ✅ Done |
| `LocationSection` — Mapbox key gating with "Open Settings" button | ✅ Done |
| `MapPanel` — Mapbox key gating (text message only; no "Open Settings" button) | ⚠️ Incomplete |
| GPX import — blocked when Mapbox token is missing | ❌ Missing |
| `MetadataProposal` client-side schema validation | ❌ Missing |
| Tests: `vibeTag.ts`, `VibeTagSection`, `SettingsModal` | ❌ Missing |

Phase 11 has three deliverables.

---

## Step 1 — Complete Mapbox Key Gating

**Deliverable:** The Map Panel shows an "Open Settings" button in its no-key state. GPX import is blocked when no Mapbox token is set, with a prompt to open Settings. This matches the LocationSection pattern.

### 1a. MapPanel "Open Settings" button

`MapPanel` is rendered from `App.tsx` without any props. Add `onOpenSettings`.

**`App.tsx`** — pass the prop:
```tsx
<MapPanel onOpenSettings={openSettings} />
```

**`MapPanel.tsx`** — add the prop interface and update the no-key return:
```typescript
interface MapPanelProps {
  onOpenSettings: () => void;
}

export function MapPanel({ onOpenSettings }: MapPanelProps) {
```

Update the no-key return block:
```tsx
if (!ui.mapboxToken || mapError) {
  return (
    <div
      className={styles.panel}
      style={{ ["--panel-height" as string]: `${ui.mapPanelHeight}px` }}
    >
      <div className={styles.tokenPrompt}>
        <p>
          {mapError
            ? `Map error: ${mapError}`
            : "A Mapbox API key is required to enable the map."}
        </p>
        <button className="btn btn-primary" onClick={onOpenSettings}>
          Open Settings
        </button>
      </div>
      <div className={styles.resizeZone} onMouseDown={handleDragStart} />
    </div>
  );
}
```

Update `MapPanel.module.css` — add flex layout to `.tokenPrompt` so the paragraph and button stack vertically centered:
```css
.tokenPrompt {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  height: 100%;
  padding: var(--space-4);
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 13px;
}
```

Update `MapPanel.test.tsx` — the existing "shows token prompt when mapboxToken is null" test should now also assert the "Open Settings" button is present and calls `onOpenSettings` when clicked. Add the `onOpenSettings` mock prop to `setupMocks`.

### 1b. GPX import Mapbox key gate

The PRD requires that GPX file import is blocked entirely when no Mapbox token is set, because route thumbnails are generated via the Mapbox Static Images API and the feature is considered incomplete without them.

`PhotoManager` currently imports GPX files unconditionally and silently skips thumbnail generation when no token is present. The gate must be added.

**`App.tsx`** — pass `onOpenSettings` to `PhotoManager`:
```tsx
<PhotoManager onOpenSettings={openSettings} />
```

**`PhotoManager.tsx`** — add the prop and a state variable for the prompt:

```typescript
interface PhotoManagerProps {
  onOpenSettings: () => void;
}

export function PhotoManager({ onOpenSettings }: PhotoManagerProps) {
  // ...
  const [showGpxKeyPrompt, setShowGpxKeyPrompt] = useState(false);
```

In the GPX drop handler (inside the `onDrop` / Tauri drag-drop listener), before calling `tauriCommands.importGpx`, check for the token:

```typescript
// Inside the GPX path of the drop handler:
if (!uiState.mapboxToken) {
  setShowGpxKeyPrompt(true);
  return;
}
// proceed with importGpx...
```

Apply the same gate to the GPX file picker button (if one exists in `FloatingControls`).

Render the prompt dialog at the bottom of the `PhotoManager` return:
```tsx
{showGpxKeyPrompt && (
  <ConfirmDialog
    title="Mapbox API Key Required"
    message="A Mapbox API key is required to import GPX files. Route thumbnails are generated using the Mapbox Static Images API."
    confirmLabel="Open Settings"
    onConfirm={() => {
      setShowGpxKeyPrompt(false);
      onOpenSettings();
    }}
    onCancel={() => setShowGpxKeyPrompt(false)}
  />
)}
```

`ConfirmDialog` is already used in `TopBar` — import it from `../common/ConfirmDialog/ConfirmDialog`.

---

## Step 2 — Proposal Validation

**Deliverable:** `MetadataProposal` values returned from Claude are validated against expected formats before reaching `proposalToChanges`. Malformed values surface a clear error message; they do not corrupt session state.

### 2a. `validateProposal()` in `src/lib/vibeTag.ts`

Add a pure validation function exported from `vibeTag.ts`. This runs on the parsed JSON before it is returned from `runVibeTag`.

```typescript
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}:\d{2}$/;

export function validateProposal(raw: unknown): MetadataProposal {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Claude returned an invalid response. Please try again.");
  }
  const p = raw as Record<string, unknown>;
  const out: MetadataProposal = {};

  if (p.capture_date !== undefined) {
    if (typeof p.capture_date !== "string" || !DATE_RE.test(p.capture_date)) {
      throw new Error(`Invalid capture_date: expected YYYY-MM-DD.`);
    }
    out.capture_date = p.capture_date;
  }
  if (p.capture_time !== undefined) {
    if (typeof p.capture_time !== "string" || !TIME_RE.test(p.capture_time)) {
      throw new Error(`Invalid capture_time: expected HH:MM:SS.`);
    }
    out.capture_time = p.capture_time;
  }
  if (p.timezone !== undefined) {
    if (typeof p.timezone !== "string") throw new Error("Invalid timezone.");
    out.timezone = p.timezone;
  }
  if (p.camera_make !== undefined) {
    if (typeof p.camera_make !== "string") throw new Error("Invalid camera_make.");
    out.camera_make = p.camera_make;
  }
  if (p.camera_model !== undefined) {
    if (typeof p.camera_model !== "string") throw new Error("Invalid camera_model.");
    // camera_model is only valid when camera_make is also present in this proposal
    if (out.camera_make !== undefined) {
      out.camera_model = p.camera_model;
    }
    // silently discard camera_model without camera_make rather than throwing,
    // since Claude may omit make when the user didn't mention it
  }
  if (p.lens !== undefined) {
    if (typeof p.lens !== "string") throw new Error("Invalid lens.");
    out.lens = p.lens;
  }
  if (p.film !== undefined) {
    const film = p.film as Record<string, unknown>;
    if (
      typeof film !== "object" || film === null ||
      typeof film.vendor !== "string" ||
      typeof film.type !== "string"
    ) {
      throw new Error("Invalid film value: expected { vendor, type }.");
    }
    out.film = { vendor: film.vendor, type: film.type };
  }
  if (p.location !== undefined) {
    const loc = p.location as Record<string, unknown>;
    if (
      typeof loc !== "object" || loc === null ||
      typeof loc.lat !== "number" ||
      typeof loc.lng !== "number"
    ) {
      throw new Error("Invalid location: expected { lat, lng }.");
    }
    out.location = {
      lat: loc.lat,
      lng: loc.lng,
      display_name: typeof loc.display_name === "string" ? loc.display_name : "",
    };
  }
  return out;
}
```

### 2b. Call `validateProposal()` inside `runVibeTag`

Replace the bare `JSON.parse` assignment:

```typescript
// before
proposal = JSON.parse(jsonStr);

// after
proposal = validateProposal(JSON.parse(jsonStr));
```

The surrounding `try/catch` already converts parse errors into user-facing messages.

---

## Step 3 — Tests

**Deliverable:** Unit and component tests cover the core Vibe Tag logic, proposal validation, and the Settings UI.

### 3a. `src/lib/vibeTag.test.ts`

Tests run without making network calls. Mock `@anthropic-ai/sdk` and `./tauri`.

```typescript
vi.mock("@anthropic-ai/sdk");
vi.mock("./tauri", () => ({
  tauriCommands: { resolveTimezone: vi.fn().mockResolvedValue("America/Los_Angeles") },
}));
```

**`validateProposal` — valid inputs:**
- `{}` → returns `{}`
- `{ capture_date: "2025-03-15" }` → returns `{ capture_date: "2025-03-15" }`
- Full valid proposal with all fields → all fields present in output
- `camera_model` present but `camera_make` absent → `camera_model` omitted, no throw
- `camera_make` and `camera_model` both present → both included

**`validateProposal` — invalid inputs:**
- Non-object (`"hello"`, `null`, `[]`) → throws
- `capture_date: "2024/03/15"` (slashes not dashes) → throws
- `capture_date: "20240315"` (no separators) → throws
- `capture_time: "14:30"` (missing seconds) → throws
- `capture_time: "14:30:00:00"` (extra field) → throws
- `film: { vendor: "Kodak" }` (missing `type`) → throws
- `film: "Kodak Portra 400"` (string instead of object) → throws
- `location: { lat: "37.7", lng: -122.4 }` (string lat) → throws

**`runVibeTag` — mocked Anthropic client:**

Mock `Anthropic` constructor to return a fake `messages.create`:

1. **Single-turn success** — `messages.create` returns `{ stop_reason: "end_turn", content: [{ type: "text", text: '{"capture_date":"2025-03-15"}' }] }`. Verify returned proposal matches.
2. **Error string** — `messages.create` returns `{ stop_reason: "end_turn", content: [{ type: "text", text: "I couldn't figure out what you meant" }] }`. Verify `runVibeTag` throws with that message.
3. **Malformed JSON** — text block contains `"not json"`. Verify throws with "invalid response" message.
4. **Code-fence wrapping** — text block contains `"```json\n{\"capture_time\":\"14:30:00\"}\n```"`. Verify JSON is extracted and proposal returned correctly.
5. **Tool use turn** — first call returns `stop_reason: "tool_use"` with a `geocode_location` block; second call returns final proposal. Verify `resolveTimezone` is called with the coordinates returned by the mock Mapbox fetch, and the final proposal includes the location.

For test 5, also mock `globalThis.fetch` to return a fake Mapbox geocoding response.

### 3b. `src/components/InspectorPanel/VibeTagSection/VibeTagSection.test.tsx`

```typescript
vi.mock("../../../state/SessionContext");
vi.mock("../../../state/UIContext");
vi.mock("../../../lib/vibeTag");
vi.mock("../../../lib/inspectorUtils");
```

**No-key state:**
- When `claudeApiKey` is null → renders "A Claude API key is required" message
- "Open Settings" button calls `onOpenSettings` prop

**Empty selection state:**
- When `claudeApiKey` is set and `selectedPhotos` is `[]` → renders "Select photos to use Vibe Tag"

**Normal state (key set, photos selected):**
- Chat input is visible and enabled
- Submit button disabled when input is empty
- Pressing Enter in empty input → `runVibeTag` not called

**Submit flow:**
- Type text + press Enter → `runVibeTag` called with the input text as first message, correct photo count, metadata summary, and mapbox token
- While loading: input disabled, spinner rendered, send button disabled
- On success: proposal summary rendered; "Accept" and "Follow Up" buttons visible; input cleared

**Accept:**
- Click "Accept" → dispatches `SET_PENDING` with `ids` matching `selectedPhotos` and `changes` matching the mocked proposal
- Proposal cleared, messages cleared after accept

**Follow Up:**
- Click "Follow Up" → proposal cleared, input focused; `messages` state retains the prior user + assistant turns (verify by checking `runVibeTag` is called with history on next submit)

**Error:**
- `runVibeTag` throws → error message rendered; input re-enabled

**Selection change clears conversation:**
- Simulate `selectedIds` changing → messages, proposal, and error all cleared

### 3c. `src/components/SettingsModal/SettingsModal.test.tsx`

```typescript
vi.mock("../../state/UIContext");
vi.mock("../../lib/tauri", () => ({
  tauriCommands: {
    setSetting: vi.fn().mockResolvedValue(undefined),
  },
}));
```

**Rendering:**
- Both "Mapbox API Key" and "Anthropic API Key" sections rendered
- When `savedValue` is set, masked key string is displayed
- When `savedValue` is null, Remove button is not rendered

**Save on blur:**
- Type new value into input → `isDirty` becomes true → on blur, `tauriCommands.setSetting` called with trimmed value and correct key name
- Clearing input + blur → field reverts to saved value; `setSetting` not called

**Remove:**
- Click Remove → `tauriCommands.setSetting` called with `""` → correct dispatch action fired (`SET_MAPBOX_TOKEN` or `SET_CLAUDE_API_KEY` with `null`) → field cleared

**Test button:**
- Click Test → test function called with current value → on success, "✓ Valid" badge shown → on failure, "✗ Invalid" badge shown
- Test button disabled when no key is stored and input is empty

**Show/Hide toggle:**
- Click "Show" → input type changes to `text`; button label becomes "Hide"
- Click "Hide" → input type reverts to `password`

**Escape to close:**
- Press Escape → `onClose` prop called

---

## What this phase does NOT include

- **Keychain storage** — API keys are stored in SQLite via the `settings` table. Migration to `tauri-plugin-keychain` is a future hardening step. The PRD specifies secure storage; the SQLite approach is acceptable for a single-user local app until a keychain integration phase is scoped.
- **Vibe Tag corpus validation** — the Vibe Tag section accepts any string for camera make/model/lens/film. It does not validate against the corpus or auto-add corpus entries. A user can accept a proposal with a camera body that isn't in their corpus; it will be set as the value and displayed in the Inspector. Corpus integration is a future polish item.
- **A "clear conversation" button** — the conversation clears automatically on selection change, which is the primary reset path. A manual clear button can be added in a future pass.
- **Vibe Tag–specific EXIF write logic** — changes queued by Vibe Tag are standard `pendingChanges` on `Photo` objects and go through the existing Apply pipeline unchanged.
- **Prompt caching** — the system prompt is rebuilt fresh on each API call. Anthropic prompt caching could reduce cost/latency for long conversations; it is not implemented in this phase.
