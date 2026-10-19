use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::error::AppError;

/// Opens a native folder picker dialog and returns the selected path.
///
/// Returns `Ok(Some(path))` when the user selects a folder, or `Ok(None)` if
/// the user cancels (closes the dialog without selecting).
///
/// Uses `tauri_plugin_dialog`'s blocking API so the result is returned
/// directly rather than via callback.
///
/// # Requirements
/// - 3.3: Tauri Backend opens native folder picker via Tauri Dialog Plugin
/// - 3.4: Frontend updates displayed path when a folder is selected
/// - 3.5: Frontend keeps original path when dialog is cancelled
#[tauri::command]
pub async fn select_folder(app: AppHandle) -> Result<Option<String>, AppError> {
    let folder = app.dialog().file().blocking_pick_folder();

    match folder {
        Some(file_path) => Ok(Some(file_path.to_string())),
        None => Ok(None),
    }
}

/// Returns the platform's default download directory (e.g. `~/Downloads`).
///
/// Used by the frontend as the initial save path before the user picks a folder.
///
/// # Errors
/// Returns `AppError::IoError` if the OS does not expose a download directory.
#[tauri::command]
pub async fn get_default_download_dir(app: AppHandle) -> Result<String, AppError> {
    app.path()
        .download_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| AppError::IoError(e.to_string()))
}

/// Returns whether `path` points to an existing file.
///
/// The history page uses it before re-downloading a completed record: if the
/// file is still there, the user is asked before it is overwritten.
#[tauri::command]
pub async fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).is_file()
}

/// Reveals `path` in the system file explorer (Finder / Explorer).
///
/// Pass a downloaded file's path to open its folder with the file selected;
/// a directory path opens its parent with the directory selected.
///
/// Uses `tauri-plugin-opener`'s `reveal_item_in_dir` rather than
/// `tauri-plugin-shell`'s `open()`, whose default scope rejects local paths.
///
/// # Errors
/// Returns `AppError::IoError` if the path does not exist or the OS rejects
/// the request.
///
/// # Requirements
/// - 5.3: Tauri Backend opens the system file explorer at the download location
#[tauri::command]
pub async fn open_folder(app: AppHandle, path: String) -> Result<(), AppError> {
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| AppError::IoError(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_exists_is_true_only_for_existing_files() {
        let dir = std::env::temp_dir().join(format!("megaload-fe-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("video [1920x1080].mp4");
        std::fs::write(&file, b"x").unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        assert!(rt.block_on(file_exists(file.to_string_lossy().into_owned())));
        assert!(!rt.block_on(file_exists(dir.join("missing.mp4").to_string_lossy().into_owned())));
        // A directory is not a downloaded file.
        assert!(!rt.block_on(file_exists(dir.to_string_lossy().into_owned())));
    }

    // Integration tests for select_folder and open_folder require a live
    // AppHandle with the dialog and opener plugins initialised, so they are
    // exercised during manual / Tauri dev-mode testing.
    //
    // The unit-testable surface here is minimal: both commands are thin
    // wrappers around plugin APIs.  The contract tested at the call-site is:
    // - select_folder returns None on cancellation (see requirement 3.5)
    // - open_folder maps plugin errors to AppError::IoError
    //
    // Error-mapping logic is covered by the AppError tests in error.rs.
}
