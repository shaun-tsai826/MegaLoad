// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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
        .manage(commands::download::DownloadState::default())
        .invoke_handler(tauri::generate_handler![
            commands::parse::parse_video,
            commands::folder::select_folder,
            commands::folder::open_folder,
            commands::folder::get_default_download_dir,
            commands::download::start_download,
            commands::download::cancel_download,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
