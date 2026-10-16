use tauri::async_runtime::Receiver;
use tauri::AppHandle;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Spawns the yt-dlp sidecar with the given arguments.
///
/// The sidecar binary must be located at `src-tauri/binaries/` and named
/// according to the Tauri sidecar naming convention:
/// - `yt-dlp-x86_64-pc-windows-msvc.exe` (Windows x64)
/// - `yt-dlp-aarch64-apple-darwin`        (macOS ARM64)
/// - `yt-dlp-x86_64-apple-darwin`         (macOS x86_64)
///
/// In `tauri.conf.json`, the binary is declared as:
/// ```json
/// { "bundle": { "externalBin": ["binaries/yt-dlp"] } }
/// ```
///
/// Returns a tuple of `(event_receiver, child_process)` so callers can
/// independently consume stdout/stderr events and manage the process lifetime.
///
/// # Errors
///
/// Returns `tauri_plugin_shell::Error` if the sidecar binary cannot be found or spawned.
/// Callers map it to `AppError` (e.g. `.map_err(|e| AppError::YtDlpError(e.to_string()))`).
pub fn spawn_sidecar(
    app: &AppHandle,
    args: &[&str],
) -> Result<(Receiver<CommandEvent>, CommandChild), tauri_plugin_shell::Error> {
    let shell = app.shell();
    let (rx, child) = shell
        .sidecar("yt-dlp")?
        .args(args)
        .spawn()?;
    Ok((rx, child))
}

#[cfg(test)]
mod tests {
    // Integration tests for spawn_sidecar require a real AppHandle and a
    // yt-dlp binary present at src-tauri/binaries/, so they are run during
    // CI after the sidecar download step.  Unit-level structural tests are
    // covered by the command-layer tests (parse.rs, download.rs) that use
    // this helper.
}
