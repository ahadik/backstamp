use keyring::Entry;
use reqwest::Client;
use rusqlite::params;
use serde_json::json;

const SERVICE: &str = "com.alexhadik.backstamp";

fn entry(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, account).map_err(|e| format!("keychain entry: {e}"))
}

#[tauri::command]
pub async fn get_api_key(account: String) -> Result<Option<String>, String> {
    let e = entry(&account)?;
    match e.get_password() {
        Ok(pw) if !pw.is_empty() => Ok(Some(pw)),
        Ok(_) => Ok(None),
        Err(err) if matches!(err, keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(format!("get_api_key: {err}")),
    }
}

#[tauri::command]
pub async fn set_api_key(account: String, value: String) -> Result<(), String> {
    let e = entry(&account)?;
    e.set_password(&value)
        .map_err(|err| format!("set_api_key: {err}"))
}

#[tauri::command]
pub async fn delete_api_key(account: String) -> Result<(), String> {
    let e = entry(&account)?;
    match e.delete_credential() {
        Ok(()) => Ok(()),
        Err(err) if matches!(err, keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(format!("delete_api_key: {err}")),
    }
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

/// Called once at startup: moves any API key values still stored in SQLite into the Keychain
/// and removes them from the database. This handles upgrades from the earlier SQLite-based storage.
pub fn migrate_keys_from_sqlite(conn: &rusqlite::Connection) {
    for account in &["mapbox_token", "google_maps_key", "claude_api_key"] {
        let result: rusqlite::Result<String> = conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![account],
            |row| row.get(0),
        );
        match result {
            Ok(value) if !value.is_empty() => {
                if let Ok(e) = Entry::new(SERVICE, account) {
                    if e.set_password(&value).is_ok() {
                        let _ = conn.execute(
                            "DELETE FROM settings WHERE key = ?1",
                            params![account],
                        );
                    }
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
