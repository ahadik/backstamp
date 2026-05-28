// API key storage.
//
// Keys are persisted to a JSON file (`api_keys.json`) in the app data directory.
// On Unix the file is chmod 0600 so other local users can't read it.
//
// ---------------------------------------------------------------------------
// Why a file and not the macOS Keychain?
// ---------------------------------------------------------------------------
// We previously stored keys in the Keychain via the `keyring` crate. Keychain
// entries carry a `partition_id` integrity ACL bound to the *hash* of the
// binary that wrote them. That works fine within a single signed identity,
// but it falls over in two cases we actually ship through:
//
//   1. `tauri dev` — each rebuild produces a new ad-hoc signature, so every
//      run looks like a different app to the Keychain and can't decrypt the
//      previous run's entries.
//
//   2. DMG upgrades of unsigned (or ad-hoc signed) release builds — same
//      problem at the user level: the new binary's hash doesn't match the
//      ACL, so v0.2.0 can't read keys written by v0.1.0 and the user has to
//      re-enter them on every release. This was reported during the v0.1.0
//      smoke test of an upgrade install.
//
// Until we ship a stable Developer ID signature (see RELEASING.md "Future
// work"), the Keychain provides no real benefit over a local file — the app
// is unsigned anyway, and the session DB sitting next to this file is also
// plaintext. So we store keys in plaintext JSON, with restrictive file perms,
// and accept that anyone with local read access to this user's home dir can
// read them. That's the same trust boundary the rest of the app already
// assumes.
//
// ---------------------------------------------------------------------------
// How to switch back to the Keychain once the app is signed
// ---------------------------------------------------------------------------
// When Developer ID signing + notarization are wired up:
//
//   1. Re-add `keyring = "3"` to src-tauri/Cargo.toml.
//   2. Gate this file's storage on `#[cfg(debug_assertions)]` again: keep the
//      JSON path for dev builds (where ad-hoc signing still breaks Keychain),
//      and use `keyring::Entry::new(SERVICE, account)` for release builds.
//      SERVICE was `"com.alexhadik.backstamp"` (matches the bundle id).
//   3. In `migrate_keys_from_sqlite`, add a second migration step that runs
//      once per install: if `api_keys.json` exists in a release build, read
//      each key, write it to the Keychain, then delete the file. Mirror the
//      pattern already used here for the SQLite -> file migration.
//   4. Verify the partition_id ACL is stable across releases by building two
//      signed DMGs with different version numbers and confirming the second
//      one can read keys written by the first without prompting.
// ---------------------------------------------------------------------------

use reqwest::Client;
use rusqlite::params;
use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const ACCOUNTS: &[&str] = &["mapbox_token", "google_maps_key", "claude_api_key"];

fn keys_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("api_keys.json")
}

fn legacy_keys_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("dev_api_keys.json")
}

// Older dev builds wrote to `dev_api_keys.json`. Rename it on first read so
// existing dev installs don't lose their keys.
fn migrate_legacy_filename(app_data_dir: &Path) {
    let legacy = legacy_keys_path(app_data_dir);
    let current = keys_path(app_data_dir);
    if legacy.exists() && !current.exists() {
        let _ = std::fs::rename(&legacy, &current);
    }
}

fn read_all(app_data_dir: &Path) -> Result<HashMap<String, String>, String> {
    migrate_legacy_filename(app_data_dir);
    let path = keys_path(app_data_dir);
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let data = std::fs::read_to_string(&path).map_err(|e| format!("read keys: {e}"))?;
    serde_json::from_str(&data).map_err(|e| format!("parse keys: {e}"))
}

fn write_all(app_data_dir: &Path, keys: &HashMap<String, String>) -> Result<(), String> {
    let path = keys_path(app_data_dir);
    let data = serde_json::to_string_pretty(keys)
        .map_err(|e| format!("serialize keys: {e}"))?;
    std::fs::write(&path, data).map_err(|e| format!("write keys: {e}"))?;
    restrict_permissions(&path);
    Ok(())
}

#[cfg(unix)]
fn restrict_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) {}

fn get_key(app_data_dir: &Path, account: &str) -> Result<Option<String>, String> {
    let keys = read_all(app_data_dir)?;
    Ok(keys.get(account).filter(|v| !v.is_empty()).cloned())
}

fn set_key(app_data_dir: &Path, account: &str, value: &str) -> Result<(), String> {
    let mut keys = read_all(app_data_dir)?;
    keys.insert(account.to_string(), value.to_string());
    write_all(app_data_dir, &keys)
}

fn delete_key(app_data_dir: &Path, account: &str) -> Result<(), String> {
    let mut keys = read_all(app_data_dir)?;
    if keys.remove(account).is_some() {
        write_all(app_data_dir, &keys)?;
    }
    Ok(())
}

fn resolve_app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))
}

#[tauri::command]
pub async fn get_api_key(
    app: tauri::AppHandle,
    account: String,
) -> Result<Option<String>, String> {
    let dir = resolve_app_data_dir(&app)?;
    get_key(&dir, &account)
}

#[tauri::command]
pub async fn set_api_key(
    app: tauri::AppHandle,
    account: String,
    value: String,
) -> Result<(), String> {
    let dir = resolve_app_data_dir(&app)?;
    set_key(&dir, &account, &value)
}

#[tauri::command]
pub async fn delete_api_key(
    app: tauri::AppHandle,
    account: String,
) -> Result<(), String> {
    let dir = resolve_app_data_dir(&app)?;
    delete_key(&dir, &account)
}

#[tauri::command]
pub async fn test_api_key(account: String, key: String) -> Result<bool, String> {
    match account.as_str() {
        "claude_api_key" => {
            let client = Client::new();
            let res = client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", &key)
                .header("anthropic-version", "2023-06-01")
                .json(&json!({
                    "model": "claude-haiku-4-5-20251001",
                    "max_tokens": 1,
                    "messages": [{"role": "user", "content": "ping"}]
                }))
                .send()
                .await
                .map_err(|e| format!("request failed: {e}"))?;
            Ok(res.status().as_u16() != 401)
        }
        "mapbox_token" => {
            let client = Client::new();
            let res = client
                .get("https://api.mapbox.com/geocoding/v5/mapbox.places/test.json")
                .query(&[("access_token", &key), ("limit", &"1".to_string())])
                .send()
                .await
                .map_err(|e| format!("request failed: {e}"))?;
            Ok(res.status().is_success())
        }
        "google_maps_key" => {
            let client = Client::new();
            let res = client
                .post("https://places.googleapis.com/v1/places:autocomplete")
                .header("X-Goog-Api-Key", &key)
                .header("X-Goog-FieldMask", "suggestions.placePrediction.placeId")
                .json(&json!({"input": "New York"}))
                .send()
                .await
                .map_err(|e| format!("request failed: {e}"))?;
            if !res.status().is_success() {
                return Ok(false);
            }
            let data: serde_json::Value = res.json().await.map_err(|e| format!("parse failed: {e}"))?;
            Ok(data.get("error").is_none() && data.get("suggestions").map(|s| s.is_array()).unwrap_or(false))
        }
        _ => Err(format!("unknown account: {account}")),
    }
}

/// Called once at startup: moves any API key values still stored in SQLite
/// into the JSON file store and removes them from the database. Handles
/// upgrades from the original SQLite-based storage.
pub fn migrate_keys_from_sqlite(conn: &rusqlite::Connection, app_data_dir: &Path) {
    for account in ACCOUNTS {
        let result: rusqlite::Result<String> = conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![account],
            |row| row.get(0),
        );
        match result {
            Ok(value) if !value.is_empty() => {
                if set_key(app_data_dir, account, &value).is_ok() {
                    let _ = conn.execute(
                        "DELETE FROM settings WHERE key = ?1",
                        params![account],
                    );
                }
            }
            Ok(_) => {
                let _ = conn.execute(
                    "DELETE FROM settings WHERE key = ?1",
                    params![account],
                );
            }
            Err(_) => {}
        }
    }
}
