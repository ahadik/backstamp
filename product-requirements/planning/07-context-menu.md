# Phase 7: Native macOS Context Menu

**Goal:** Right-clicking a photo tile in the grid shows a native macOS popup menu with "Open Image" and "Show in Finder" actions. The menu is built with Tauri 2's built-in `tauri::menu` module — no new Cargo dependency is required. Right-clicking anywhere else in the app retains default WebView behavior.

**Prerequisites:** Phase 5 inspector panel complete. `AppState` exists in `lib.rs` and is managed via `app.manage()`.

---

## Step 1 — Extend AppState with context menu path

**File:** `src-tauri/src/lib.rs`

Add `context_menu_path: Arc<Mutex<Option<String>>>` to `AppState`. This field stores the file path of the photo that was most recently right-clicked, so the global `on_menu_event` handler knows which file to act on.

```rust
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub exiftool: Arc<Mutex<ExiftoolProcess>>,
    pub thumbnails_dir: PathBuf,
    pub apply_cancel_flag: Arc<AtomicBool>,
    pub context_menu_path: Arc<Mutex<Option<String>>>,  // NEW
}
```

Update the `app.manage(AppState { ... })` call in `setup` to initialize it:

```rust
app.manage(AppState {
    // ...existing fields...
    context_menu_path: Arc::new(Mutex::new(None)),
});
```

---

## Step 2 — Register the menu event handler in setup

**File:** `src-tauri/src/lib.rs`, inside the `.setup(|app| { ... })` closure, after `app.manage(...)`.

```rust
app.on_menu_event(|app, event| {
    let state = app.state::<AppState>();
    let path = state.context_menu_path.lock().unwrap().clone();
    if let Some(path) = path {
        match event.id().0.as_str() {
            "show_in_finder" => {
                let _ = std::process::Command::new("open")
                    .args(["-R", &path])
                    .spawn();
            }
            "open_image" => {
                let _ = std::process::Command::new("open")
                    .arg(&path)
                    .spawn();
            }
            _ => {}
        }
    }
});
```

`open -R <path>` opens a Finder window with the file highlighted. `open <path>` opens the file in the system default app (Preview on macOS for images).

---

## Step 3 — New Tauri command: `show_photo_context_menu`

**File:** `src-tauri/src/commands/context_menu.rs` (new file)

```rust
use crate::AppState;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};

#[tauri::command]
pub async fn show_photo_context_menu(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AppState>,
    file_path: String,
    file_missing: bool,
) -> Result<(), String> {
    *state.context_menu_path.lock().unwrap() = Some(file_path);

    let open_item = MenuItem::with_id(&app, "open_image", "Open Image", !file_missing, None::<&str>)
        .map_err(|e| e.to_string())?;
    let separator = PredefinedMenuItem::separator(&app)
        .map_err(|e| e.to_string())?;
    let finder_item = MenuItem::with_id(&app, "show_in_finder", "Show in Finder", !file_missing, None::<&str>)
        .map_err(|e| e.to_string())?;

    let menu = Menu::with_items(&app, &[&open_item, &separator, &finder_item])
        .map_err(|e| e.to_string())?;

    window.popup_menu(&menu).map_err(|e| e.to_string())
}
```

The third argument to `MenuItem::with_id` is `enabled: bool`. Passing `!file_missing` disables both items when the source file is gone from disk.

---

## Step 4 — Register the command and module

**File:** `src-tauri/src/commands/mod.rs`

Add:
```rust
pub mod context_menu;
```

**File:** `src-tauri/src/lib.rs`

Update the `use commands::...` import line to include the new module:
```rust
use commands::{context_menu, corpus as corpus_commands, metadata, photos, session as session_commands, settings, thumbnails, timezone};
```

Add to `tauri::generate_handler![]`:
```rust
context_menu::show_photo_context_menu,
```

---

## Step 5 — Frontend: tauri.ts wrapper

**File:** `src/lib/tauri.ts`

Add to the `tauriCommands` object:

```typescript
showPhotoContextMenu: (filePath: string, fileMissing: boolean) =>
  invoke<void>("show_photo_context_menu", { filePath, fileMissing }),
```

---

## Step 6 — Frontend: PhotoTile component

**File:** `src/components/PhotoManager/PhotoGrid/PhotoTile.tsx`

Add an `onContextMenu` prop and attach it to the outer tile `div`. The handler calls the Tauri command with the photo's file path and missing status.

```tsx
interface Props {
  // ...existing props...
  onContextMenu?: (e: React.MouseEvent) => void;
}

// In the JSX:
<div
  className={tileClass}
  onClick={onClick}
  onContextMenu={onContextMenu}
  // ...rest of drag props...
>
```

---

## Step 7 — Frontend: PhotoGrid wiring

**File:** `src/components/PhotoManager/PhotoGrid/PhotoGrid.tsx`

Import `tauriCommands` and create a stable `handleContextMenu` callback per photo tile:

```tsx
import { tauriCommands } from "../../../lib/tauri";

// Inside the render of each PhotoTile:
onContextMenu={(e) => {
  e.preventDefault();
  tauriCommands.showPhotoContextMenu(
    photo.filePath,
    photo.fileStatus === "missing"
  );
}}
```

`e.preventDefault()` suppresses the default WebView context menu only on photo tiles. Tiles that are in "missing" state pass `fileMissing: true`, which disables the menu items on the Rust side.

---

## Acceptance Criteria

- Right-clicking any photo tile shows a native macOS popup menu with two items: "Open Image" and "Show in Finder", separated by a divider.
- "Open Image" opens the file in Preview (or the user's default image viewer).
- "Show in Finder" opens a Finder window with the file highlighted and selected.
- Both items are visually disabled (greyed out) when the photo's file is missing from disk.
- Right-clicking elsewhere in the app (text, background, top bar, inspector panel) shows the default WebView context menu, not the custom one.
- No new Cargo dependencies are required.
