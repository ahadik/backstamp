use tauri::AppHandle;

#[tauri::command]
pub async fn load_session(_app: AppHandle) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "photos": [],
        "gpxFiles": [],
        "selectedIds": []
    }))
}

#[tauri::command]
pub async fn clear_session(_app: AppHandle) -> Result<(), String> {
    Ok(())
}
