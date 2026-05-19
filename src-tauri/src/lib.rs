mod commands;
mod corpus_seed;
mod exiftool;
mod gpx;
pub mod session;
pub mod thumbnail;
pub mod write_metadata;

use commands::{api_keys, context_menu, corpus as corpus_commands, gpx as gpx_commands, metadata, photos, session as session_commands, settings, thumbnails, timezone};
use exiftool::ExiftoolProcess;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tauri::Manager;

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub exiftool: Arc<Mutex<ExiftoolProcess>>,
    pub thumbnails_dir: PathBuf,
    pub apply_cancel_flag: Arc<AtomicBool>,
    pub context_menu_path: Arc<Mutex<Option<String>>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app;
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data directory");
            std::fs::create_dir_all(&app_data_dir)
                .expect("failed to create app data directory");

            let db = session::init_db(&app_data_dir)
                .expect("failed to initialize database");
            api_keys::migrate_keys_from_sqlite(&db);

            let exiftool = ExiftoolProcess::start(&app.handle())
                .expect("failed to start exiftool");

            let thumbnails_dir = app_data_dir.join("thumbnails");
            std::fs::create_dir_all(&thumbnails_dir)
                .expect("failed to create thumbnails directory");

            app.manage(AppState {
                db: Arc::new(Mutex::new(db)),
                exiftool: Arc::new(Mutex::new(exiftool)),
                thumbnails_dir,
                apply_cancel_flag: Arc::new(AtomicBool::new(false)),
                context_menu_path: Arc::new(Mutex::new(None)),
            });

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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            session_commands::load_session,
            session_commands::clear_session,
            photos::import_photos,
            photos::find_xmp_sidecars,
            photos::remove_photos,
            photos::reorder_photos,
            metadata::apply_changes,
            metadata::apply_cancel,
            metadata::rollback,
            metadata::reset_photos,
            metadata::set_pending_changes,
            metadata::clear_pending_changes,
            thumbnails::get_thumbnail,
            corpus_commands::load_corpus,
            corpus_commands::add_corpus_entry,
            corpus_commands::remove_corpus_entry,
            corpus_commands::record_corpus_use,
            settings::get_setting,
            settings::set_setting,
            api_keys::get_api_key,
            api_keys::set_api_key,
            api_keys::delete_api_key,
            api_keys::test_api_key,
            timezone::resolve_timezone,
            context_menu::show_photo_context_menu,
            gpx_commands::import_gpx,
            gpx_commands::remove_gpx,
            gpx_commands::save_gpx_thumbnail,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
