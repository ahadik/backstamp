mod commands;
mod corpus;
mod exiftool;
mod gpx;
pub mod session;
pub mod thumbnail;

use commands::{corpus as corpus_commands, metadata, photos, session as session_commands, settings, thumbnails, timezone};
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
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            session_commands::load_session,
            session_commands::clear_session,
            photos::import_photos,
            photos::remove_photos,
            photos::reorder_photos,
            metadata::apply_changes,
            metadata::apply_cancel,
            metadata::rollback,
            metadata::reset_photos,
            thumbnails::get_thumbnail,
            corpus_commands::load_corpus,
            corpus_commands::add_corpus_entry,
            corpus_commands::remove_corpus_entry,
            corpus_commands::record_corpus_use,
            settings::get_setting,
            settings::set_setting,
            timezone::resolve_timezone,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
