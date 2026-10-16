// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

mod commands;
mod error;
mod models;
pub mod progress;
mod sidecar;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(commands::download::DownloadState::default())
        .setup(|app| {
            let path = app.path().app_data_dir()?.join("history.json");
            app.manage(commands::history::HistoryState::new(path));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::parse::parse_video,
            commands::folder::select_folder,
            commands::folder::open_folder,
            commands::folder::get_default_download_dir,
            commands::download::start_download,
            commands::download::cancel_download,
            commands::history::get_history,
            commands::history::delete_history_item,
            commands::history::clear_all_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
