use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;

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

/// Opens the system file explorer at the given folder path.
///
/// Delegates to the OS default handler for directories:
/// - macOS: `open`
/// - Windows: `explorer`
/// - Linux: `xdg-open`
///
/// # Errors
/// Returns `AppError::IoError` if the shell `open` call fails (e.g., the path
/// does not exist or the OS rejects the request).
///
/// # Requirements
/// - 5.3: Tauri Backend opens system file explorer via Tauri Shell Plugin
#[tauri::command]
pub async fn open_folder(app: AppHandle, path: String) -> Result<(), AppError> {
    app.shell()
        .open(&path, None)
        .map_err(|e| AppError::IoError(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    // Integration tests for select_folder and open_folder require a live
    // AppHandle with the dialog and shell plugins initialised, so they are
    // exercised during manual / Tauri dev-mode testing.
    //
    // The unit-testable surface here is minimal: both commands are thin
    // wrappers around plugin APIs.  The contract tested at the call-site is:
    // - select_folder returns None on cancellation (see requirement 3.5)
    // - open_folder maps plugin errors to AppError::IoError
    //
    // Error-mapping logic is covered by the AppError tests in error.rs.
}
