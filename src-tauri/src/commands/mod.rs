// Commands module
// Sub-modules still to be added in subsequent tasks:
//   pub mod download;   // start_download / cancel_download (task 5.1, 5.3)
//   pub mod history;    // get_history / delete_history_item / clear_all_history (task 7.3)
//
// 註冊 command 時請在 `generate_handler!` 使用完整模組路徑（例如 `commands::parse::parse_video`），
// 因為 `#[tauri::command]` 產生的隱藏巨集不會跟著 `pub use` 重新匯出。

pub mod folder;
pub mod parse;
