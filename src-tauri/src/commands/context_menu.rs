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
