use tauri::AppHandle;

#[tauri::command]
pub async fn get_thumbnail(_app: AppHandle, photo_id: String) -> Result<String, String> {
    println!("get_thumbnail stub: {}", photo_id);
    Ok(String::new())
}
