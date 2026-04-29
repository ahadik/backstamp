use tauri::AppHandle;

#[tauri::command]
pub async fn apply_changes(
    _app: AppHandle,
    payload: serde_json::Value,
) -> Result<(), String> {
    println!("apply_changes stub: {:?}", payload);
    Ok(())
}

#[tauri::command]
pub async fn rollback(_app: AppHandle) -> Result<(), String> {
    println!("rollback stub");
    Ok(())
}

#[tauri::command]
pub async fn reset_photos(_app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    println!("reset_photos stub: {:?}", ids);
    Ok(())
}
