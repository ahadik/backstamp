use std::sync::OnceLock;
use tzf_rs::DefaultFinder;

static FINDER: OnceLock<DefaultFinder> = OnceLock::new();

fn get_finder() -> &'static DefaultFinder {
    FINDER.get_or_init(DefaultFinder::new)
}

#[tauri::command]
pub async fn resolve_timezone(lat: f64, lng: f64) -> Result<String, String> {
    let name = get_finder().get_tz_name(lng, lat);
    Ok(name.to_string())
}
