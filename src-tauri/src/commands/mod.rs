// Commands module
//
// 註冊 command 時請在 `generate_handler!` 使用完整模組路徑（例如 `commands::parse::parse_video`），
// 因為 `#[tauri::command]` 產生的隱藏巨集不會跟著 `pub use` 重新匯出。

pub mod download;
pub mod folder;
pub mod history;
pub mod parse;
