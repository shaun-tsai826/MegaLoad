use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::async_runtime::Receiver;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tokio::sync::oneshot;
use tokio::time::Instant;

use crate::commands::history::HistoryState;
use crate::error::AppError;
use crate::models::{DownloadStatus, DownloadTask, HistoryRecord, QualityOption};
use crate::progress::parse_progress_line;
use crate::sidecar::spawn_sidecar;

pub const EVENT_PROGRESS: &str = "download://progress";
pub const EVENT_COMPLETED: &str = "download://completed";
pub const EVENT_FAILED: &str = "download://failed";
pub const EVENT_CANCELLED: &str = "download://cancelled";

/// `--progress-template` output, e.g. `downloading  45.3%  1.23MiB/s 00:23`.
/// Parsed by `progress::parse_progress_line`.
const PROGRESS_TEMPLATE: &str =
    "%(progress.status)s %(progress._percent_str)s %(progress._speed_str)s %(progress._eta_str)s";

/// Prefix of the line printed once the final file is in place.
const DONE_PREFIX: &str = "MEGALOAD_DONE:";

/// `--print` template: after the file has been moved to its final location,
/// print `MEGALOAD_DONE:{"title": ..., "filepath": ...}` as a single line.
/// The prefix keeps it distinguishable from progress lines.
const DONE_PRINT_TEMPLATE: &str = "after_move:MEGALOAD_DONE:%(.{title,filepath})j";

/// Output filename for video downloads, tagged with the resolution yt-dlp
/// actually downloaded (e.g. `Title [1920x1080].mp4`, `Title [1080x1920].mp4`).
/// The full resolution stays correct for portrait videos, where `[{height}p]`
/// would read `[1920p]`, and when the sort order falls back to another
/// resolution. It also keeps different qualities from sharing one filename
/// (yt-dlp skips a download whose file already exists). No tag if the
/// resolution is unknown.
const VIDEO_OUTPUT_TEMPLATE: &str = "%(title)s%(resolution& [{}]|)s.%(ext)s";

/// Output filename for MP3 downloads, e.g. `Title [MP3].mp3`.
const AUDIO_OUTPUT_TEMPLATE: &str = "%(title)s [MP3].%(ext)s";

/// How long to wait after SIGTERM before force-killing the sidecar.
const CANCEL_GRACE: Duration = Duration::from_secs(5);

/// In-progress download tasks keyed by task id.
///
/// Mounted with `app.manage(DownloadState::default())`; Tauri wraps managed
/// state in an `Arc`, so the spawned download task can reach it through
/// `app.state::<DownloadState>()`.
#[derive(Default)]
pub struct DownloadState(Mutex<HashMap<String, DownloadTask>>);

impl DownloadState {
    /// Locks the task map. A poisoned lock is recovered because the map holds
    /// no invariants that a panicking holder could break.
    fn tasks(&self) -> MutexGuard<'_, HashMap<String, DownloadTask>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressPayload {
    pub task_id: String,
    pub percent: f64,
    pub speed: String,
    pub speed_bytes: u64,
    pub eta: String,
    pub eta_seconds: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadCompletedPayload {
    pub task_id: String,
    pub file_path: String,
    pub title: String,
    /// ISO 8601 timestamp.
    pub completed_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadFailedPayload {
    pub task_id: String,
    /// `AppError` variant name, e.g. `"NetworkError"`.
    pub error_type: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadCancelledPayload {
    pub task_id: String,
}

/// Contents of the `MEGALOAD_DONE:` line.
#[derive(Debug, Deserialize, PartialEq)]
pub(crate) struct DoneInfo {
    pub title: String,
    pub filepath: String,
}

/// How a download ended.
#[derive(Debug)]
pub(crate) enum Outcome {
    Completed(DoneInfo),
    Failed(AppError),
    Cancelled,
}

/// Starts a download in the background and returns its task id immediately.
///
/// Progress is reported via `download://progress`; the task ends with exactly
/// one of `download://completed`, `download://failed` or `download://cancelled`,
/// and a matching `HistoryRecord` is appended to `history.json`.
///
/// `title` and `thumbnail` come from the frontend's parsed metadata and are
/// stored in the history record (yt-dlp cannot supply them for failed or
/// cancelled downloads).
///
/// # Errors
/// Returns `AppError::YtDlpError` if the yt-dlp sidecar cannot be spawned, and
/// `AppError::IoError` if the ffmpeg location cannot be determined.
#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    state: State<'_, DownloadState>,
    url: String,
    quality: QualityOption,
    output_path: String,
    title: Option<String>,
    thumbnail: Option<String>,
) -> Result<String, AppError> {
    let ffmpeg = ffmpeg_location()?;
    let args = build_download_args(&url, &quality, &output_path, &ffmpeg);
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let (rx, child) =
        spawn_sidecar(&app, &arg_refs).map_err(|e| AppError::YtDlpError(e.to_string()))?;

    let task_id = uuid::Uuid::new_v4().to_string();
    let (cancel_tx, cancel_rx) = oneshot::channel();
    state.tasks().insert(
        task_id.clone(),
        DownloadTask {
            id: task_id.clone(),
            url,
            quality,
            output_path,
            title: title.unwrap_or_default(),
            thumbnail: thumbnail.unwrap_or_default(),
            created_at: now_iso8601(),
            status: DownloadStatus::Pending,
            cancel_tx: Some(cancel_tx),
        },
    );

    let id = task_id.clone();
    tauri::async_runtime::spawn(async move {
        let outcome = drive_download(&app, &id, rx, child, cancel_rx).await;
        let finished_at = now_iso8601();
        let task = app.state::<DownloadState>().tasks().remove(&id);
        if let Some(task) = task {
            let record = history_record(&task, &outcome, &finished_at);
            if let Err(e) = app.state::<HistoryState>().append(record) {
                eprintln!("寫入下載歷史失敗：{e}");
            }
        }
        emit_outcome(&app, &id, outcome, &finished_at);
    });

    Ok(task_id)
}

/// Requests cancellation of a running download. The task then ends with a
/// `download://cancelled` event (never `download://failed`).
///
/// # Errors
/// Returns `AppError::Unknown` if no running task has the given id.
#[tauri::command]
pub async fn cancel_download(
    state: State<'_, DownloadState>,
    task_id: String,
) -> Result<(), AppError> {
    let cancel_tx = {
        let mut tasks = state.tasks();
        let task = tasks
            .get_mut(&task_id)
            .ok_or_else(|| AppError::Unknown(format!("找不到下載任務：{task_id}")))?;
        task.status = DownloadStatus::Cancelled;
        task.cancel_tx.take()
    };
    if let Some(tx) = cancel_tx {
        // The receiver is gone only if the task already finished.
        let _ = tx.send(());
    }
    Ok(())
}

/// Builds the yt-dlp argument list for a download.
pub(crate) fn build_download_args(
    url: &str,
    quality: &QualityOption,
    output_path: &str,
    ffmpeg_location: &str,
) -> Vec<String> {
    let mut args: Vec<String> = [
        "--newline",
        "--no-colors",
        "--no-warnings",
        "--no-playlist",
        // `--print` implies `--quiet`, which hides progress unless forced.
        "--progress",
        "--progress-template",
        PROGRESS_TEMPLATE,
        "--print",
        DONE_PRINT_TEMPLATE,
        "--ffmpeg-location",
        ffmpeg_location,
        "-f",
        quality.format_selector(),
        "-P",
        output_path,
        "-o",
        output_template(quality),
    ]
    .into_iter()
    .map(String::from)
    .collect();

    if let Some(sort) = quality.sort_order() {
        args.extend(["-S", sort].map(String::from));
    }

    if *quality == QualityOption::AudioMp3 {
        args.extend(["-x", "--audio-format", "mp3"].map(String::from));
    }

    // `--` stops a URL that starts with `-` from being read as an option.
    args.push("--".into());
    args.push(url.into());
    args
}

fn output_template(quality: &QualityOption) -> &'static str {
    match quality {
        QualityOption::AudioMp3 => AUDIO_OUTPUT_TEMPLATE,
        _ => VIDEO_OUTPUT_TEMPLATE,
    }
}

/// Parses a `MEGALOAD_DONE:{...}` line; returns `None` for any other line.
pub(crate) fn parse_done_line(line: &str) -> Option<DoneInfo> {
    serde_json::from_str(line.strip_prefix(DONE_PREFIX)?).ok()
}

/// Decides the outcome once the yt-dlp process has terminated.
pub(crate) fn resolve_outcome(
    cancelled: bool,
    exit_code: Option<i32>,
    done: Option<DoneInfo>,
    stderr: &str,
) -> Outcome {
    if cancelled {
        return Outcome::Cancelled;
    }
    let stderr = stderr.trim();
    match (exit_code, done) {
        (Some(0), Some(info)) => Outcome::Completed(info),
        (Some(0), None) => Outcome::Failed(AppError::YtDlpError(
            "下載已結束，但無法取得檔案路徑".to_string(),
        )),
        _ if !stderr.is_empty() => Outcome::Failed(AppError::from_ytdlp_stderr(stderr)),
        (code, _) => Outcome::Failed(AppError::YtDlpError(format!(
            "yt-dlp 異常結束（結束代碼 {code:?}）"
        ))),
    }
}

/// Builds the history entry for a finished task.
///
/// The title prefers the frontend's metadata, then the title yt-dlp printed,
/// then the URL, so a record is never untitled.
pub(crate) fn history_record(
    task: &DownloadTask,
    outcome: &Outcome,
    finished_at: &str,
) -> HistoryRecord {
    let (status, file_path, error_message, completed_at, printed_title) = match outcome {
        Outcome::Completed(info) => (
            "completed",
            Some(info.filepath.clone()),
            None,
            Some(finished_at.to_string()),
            Some(info.title.as_str()),
        ),
        Outcome::Failed(err) => ("failed", None, Some(err.to_string()), None, None),
        Outcome::Cancelled => ("cancelled", None, None, None, None),
    };
    let title = if task.title.is_empty() {
        printed_title.unwrap_or(&task.url).to_string()
    } else {
        task.title.clone()
    };

    HistoryRecord {
        id: task.id.clone(),
        url: task.url.clone(),
        title,
        thumbnail: task.thumbnail.clone(),
        quality: task.quality.clone(),
        output_path: task.output_path.clone(),
        file_path,
        status: status.to_string(),
        error_message,
        created_at: task.created_at.clone(),
        completed_at,
    }
}

/// The ffmpeg sidecar sits next to the main executable at runtime
/// (`target/debug/` in dev, `Contents/MacOS/` in a macOS bundle).
fn ffmpeg_location() -> Result<String, AppError> {
    let exe = std::env::current_exe().map_err(|e| AppError::IoError(e.to_string()))?;
    let dir = exe
        .parent()
        .ok_or_else(|| AppError::IoError("無法取得執行檔所在目錄".to_string()))?;
    let ffmpeg = dir.join(format!("ffmpeg{}", std::env::consts::EXE_SUFFIX));
    Ok(ffmpeg.to_string_lossy().into_owned())
}

/// Reads sidecar events until the process terminates, emitting progress and
/// handling cancellation.
async fn drive_download(
    app: &AppHandle,
    task_id: &str,
    mut rx: Receiver<CommandEvent>,
    child: CommandChild,
    mut cancel_rx: oneshot::Receiver<()>,
) -> Outcome {
    let mut child = Some(child);
    let mut cancel_armed = true;
    let mut cancelled = false;
    let mut kill_deadline: Option<Instant> = None;
    let mut started = false;
    let mut done: Option<DoneInfo> = None;
    let mut stderr = String::new();

    loop {
        tokio::select! {
            res = &mut cancel_rx, if cancel_armed => {
                cancel_armed = false;
                // `Err` means the sender was dropped without cancelling.
                if res.is_ok() {
                    cancelled = true;
                    kill_deadline = request_terminate(&mut child);
                }
            }
            _ = tokio::time::sleep_until(kill_deadline.unwrap_or_else(Instant::now)),
                if kill_deadline.is_some() =>
            {
                kill_deadline = None;
                if let Some(c) = child.take() {
                    let _ = c.kill();
                }
            }
            event = rx.recv() => match event {
                Some(CommandEvent::Stdout(bytes)) => {
                    let line = String::from_utf8_lossy(&bytes);
                    let line = line.trim();
                    if let Some(info) = parse_done_line(line) {
                        done = Some(info);
                    } else if let Some(p) = parse_progress_line(line) {
                        if !started {
                            started = true;
                            mark_downloading(app, task_id);
                        }
                        let _ = app.emit(EVENT_PROGRESS, DownloadProgressPayload {
                            task_id: task_id.to_string(),
                            percent: p.percent,
                            speed: p.speed_str,
                            speed_bytes: p.speed_bytes,
                            eta: p.eta_str,
                            eta_seconds: p.eta_seconds,
                        });
                    }
                }
                Some(CommandEvent::Stderr(bytes)) => {
                    stderr.push_str(&String::from_utf8_lossy(&bytes));
                    stderr.push('\n');
                }
                Some(CommandEvent::Error(e)) => {
                    stderr.push_str(&e);
                    stderr.push('\n');
                }
                Some(CommandEvent::Terminated(status)) => {
                    return resolve_outcome(cancelled, status.code, done, &stderr);
                }
                Some(_) => {}
                None => return resolve_outcome(cancelled, None, done, &stderr),
            }
        }
    }
}

/// Asks the sidecar to stop. Returns the deadline after which it is force-killed.
///
/// On Unix this sends SIGTERM: the yt-dlp binary is a PyInstaller one-file
/// build whose bootloader forwards SIGTERM to the real Python process, whereas
/// SIGKILL would orphan that process and let the download continue.
#[cfg(unix)]
fn request_terminate(child: &mut Option<CommandChild>) -> Option<Instant> {
    let pid = child.as_ref()?.pid();
    // SAFETY: `kill` has no memory-safety preconditions; the pid belongs to a
    // child we have not yet reaped, so it cannot have been reused.
    unsafe {
        libc::kill(pid as libc::pid_t, libc::SIGTERM);
    }
    Some(Instant::now() + CANCEL_GRACE)
}

#[cfg(not(unix))]
fn request_terminate(child: &mut Option<CommandChild>) -> Option<Instant> {
    if let Some(c) = child.take() {
        let _ = c.kill();
    }
    None
}

fn mark_downloading(app: &AppHandle, task_id: &str) {
    if let Some(task) = app.state::<DownloadState>().tasks().get_mut(task_id) {
        if task.status == DownloadStatus::Pending {
            task.status = DownloadStatus::Downloading;
        }
    }
}

fn emit_outcome(app: &AppHandle, task_id: &str, outcome: Outcome, finished_at: &str) {
    let task_id = task_id.to_string();
    let _ = match outcome {
        Outcome::Completed(info) => app.emit(
            EVENT_COMPLETED,
            DownloadCompletedPayload {
                task_id,
                file_path: info.filepath,
                title: info.title,
                completed_at: finished_at.to_string(),
            },
        ),
        Outcome::Failed(err) => app.emit(
            EVENT_FAILED,
            DownloadFailedPayload {
                task_id,
                error_type: err.kind().to_string(),
                message: err.to_string(),
            },
        ),
        Outcome::Cancelled => app.emit(EVENT_CANCELLED, DownloadCancelledPayload { task_id }),
    };
}

fn now_iso8601() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    const URL: &str = "https://www.youtube.com/watch?v=jNQXAC9IVRw";

    fn args_for(quality: QualityOption) -> Vec<String> {
        build_download_args(URL, &quality, "/tmp/out", "/app/ffmpeg")
    }

    /// Returns the value following `flag` in `args`.
    fn value_of<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
        let i = args.iter().position(|a| a == flag)?;
        args.get(i + 1).map(String::as_str)
    }

    #[test]
    fn args_end_with_separator_and_url() {
        let args = args_for(QualityOption::Q720p);
        assert_eq!(&args[args.len() - 2..], ["--", URL]);
    }

    #[test]
    fn args_include_required_flags() {
        let args = args_for(QualityOption::Q1080p);
        for flag in ["--newline", "--no-colors", "--progress", "--no-playlist"] {
            assert!(args.iter().any(|a| a == flag), "missing {flag}");
        }
        assert_eq!(value_of(&args, "--ffmpeg-location"), Some("/app/ffmpeg"));
        assert_eq!(value_of(&args, "-P"), Some("/tmp/out"));
        assert_eq!(value_of(&args, "--print"), Some(DONE_PRINT_TEMPLATE));
        assert_eq!(
            value_of(&args, "-f"),
            Some(QualityOption::Q1080p.format_selector())
        );
    }

    #[test]
    fn video_filenames_are_tagged_with_actual_resolution() {
        for q in [QualityOption::Q1080p, QualityOption::Q720p, QualityOption::Q480p] {
            assert_eq!(value_of(&args_for(q), "-o"), Some(VIDEO_OUTPUT_TEMPLATE));
        }
        // `[1080x1920]`, not `[1920p]`, for portrait videos.
        assert!(VIDEO_OUTPUT_TEMPLATE.contains("%(resolution& [{}]|)s"));
        assert!(!VIDEO_OUTPUT_TEMPLATE.contains("height"));
    }

    #[test]
    fn mp3_filenames_are_tagged_mp3() {
        assert_eq!(
            value_of(&args_for(QualityOption::AudioMp3), "-o"),
            Some("%(title)s [MP3].%(ext)s")
        );
    }

    #[test]
    fn mp3_adds_extract_audio_flags() {
        let args = args_for(QualityOption::AudioMp3);
        assert_eq!(value_of(&args, "-f"), Some("bestaudio/best"));
        assert!(args.iter().any(|a| a == "-x"));
        assert_eq!(value_of(&args, "--audio-format"), Some("mp3"));
    }

    #[test]
    fn video_qualities_sort_by_resolution() {
        for (q, sort) in [
            (QualityOption::Q1080p, "res:1080,ext:mp4:m4a"),
            (QualityOption::Q720p, "res:720,ext:mp4:m4a"),
            (QualityOption::Q480p, "res:480,ext:mp4:m4a"),
        ] {
            assert_eq!(value_of(&args_for(q), "-S"), Some(sort));
        }
    }

    #[test]
    fn mp3_has_no_sort_order() {
        assert!(!args_for(QualityOption::AudioMp3).iter().any(|a| a == "-S"));
    }

    #[test]
    fn video_qualities_do_not_extract_audio() {
        for q in [QualityOption::Q1080p, QualityOption::Q720p, QualityOption::Q480p] {
            assert!(!args_for(q).iter().any(|a| a == "-x"));
        }
    }

    #[test]
    fn url_starting_with_dash_stays_after_separator() {
        let args = build_download_args("--exec=rm", &QualityOption::Q480p, "/o", "/f");
        let sep = args.iter().position(|a| a == "--").unwrap();
        assert_eq!(args[sep + 1], "--exec=rm");
        assert_eq!(args.len(), sep + 2);
    }

    #[test]
    fn template_output_is_parsed_as_progress() {
        // Real line produced by PROGRESS_TEMPLATE with yt-dlp 2026.07.04.
        let p = parse_progress_line("downloading   5.0%  766.09KiB/s 00:00").unwrap();
        assert!((p.percent - 5.0).abs() < f64::EPSILON);
        assert_eq!(p.speed_str, "766.09KiB/s");
    }

    #[test]
    fn done_line_is_parsed() {
        let line = r#"MEGALOAD_DONE:{"title": "Me at the zoo", "filepath": "/d/Me at the zoo.mp4"}"#;
        assert_eq!(
            parse_done_line(line),
            Some(DoneInfo {
                title: "Me at the zoo".into(),
                filepath: "/d/Me at the zoo.mp4".into(),
            })
        );
    }

    #[test]
    fn other_lines_are_not_done_lines() {
        assert!(parse_done_line("downloading  45.3%  1.23MiB/s 00:23").is_none());
        assert!(parse_done_line("MEGALOAD_DONE:not json").is_none());
        assert!(parse_done_line("").is_none());
    }

    fn done() -> Option<DoneInfo> {
        Some(DoneInfo {
            title: "t".into(),
            filepath: "/f".into(),
        })
    }

    #[test]
    fn exit_zero_with_done_line_completes() {
        assert!(matches!(
            resolve_outcome(false, Some(0), done(), ""),
            Outcome::Completed(_)
        ));
    }

    #[test]
    fn cancellation_wins_over_exit_status() {
        assert!(matches!(
            resolve_outcome(true, Some(0), done(), ""),
            Outcome::Cancelled
        ));
        assert!(matches!(
            resolve_outcome(true, Some(1), None, "ERROR: x"),
            Outcome::Cancelled
        ));
    }

    #[test]
    fn nonzero_exit_classifies_stderr() {
        let outcome = resolve_outcome(false, Some(1), None, "ERROR: Private video\n");
        assert!(matches!(outcome, Outcome::Failed(AppError::AuthRequired)));
    }

    #[test]
    fn nonzero_exit_without_stderr_still_fails() {
        assert!(matches!(
            resolve_outcome(false, Some(2), None, "  \n"),
            Outcome::Failed(AppError::YtDlpError(_))
        ));
    }

    #[test]
    fn exit_zero_without_done_line_fails() {
        assert!(matches!(
            resolve_outcome(false, Some(0), None, ""),
            Outcome::Failed(AppError::YtDlpError(_))
        ));
    }

    fn task(title: &str) -> DownloadTask {
        DownloadTask {
            id: "task-1".into(),
            url: URL.into(),
            quality: QualityOption::Q720p,
            output_path: "/out".into(),
            title: title.into(),
            thumbnail: "https://i.ytimg.com/t.jpg".into(),
            created_at: "2026-10-16T00:00:00Z".into(),
            status: DownloadStatus::Downloading,
            cancel_tx: None,
        }
    }

    #[test]
    fn completed_record_has_file_path_and_completed_at() {
        let r = history_record(&task("Zoo"), &Outcome::Completed(done().unwrap()), "T1");
        assert_eq!(r.status, "completed");
        assert_eq!(r.file_path.as_deref(), Some("/f"));
        assert_eq!(r.completed_at.as_deref(), Some("T1"));
        assert_eq!(r.error_message, None);
        assert_eq!(r.title, "Zoo");
    }

    #[test]
    fn record_keeps_task_fields() {
        let t = task("Zoo");
        let r = history_record(&t, &Outcome::Cancelled, "T1");
        assert_eq!(r.id, t.id);
        assert_eq!(r.url, t.url);
        assert_eq!(r.quality, t.quality);
        assert_eq!(r.output_path, t.output_path);
        assert_eq!(r.thumbnail, t.thumbnail);
        assert_eq!(r.created_at, t.created_at);
    }

    #[test]
    fn failed_record_has_error_and_no_completed_at() {
        let r = history_record(
            &task("Zoo"),
            &Outcome::Failed(AppError::NetworkError("x".into())),
            "T1",
        );
        assert_eq!(r.status, "failed");
        assert!(r.error_message.unwrap().contains('x'));
        assert_eq!(r.file_path, None);
        assert_eq!(r.completed_at, None);
    }

    #[test]
    fn cancelled_record_is_not_failed() {
        let r = history_record(&task("Zoo"), &Outcome::Cancelled, "T1");
        assert_eq!(r.status, "cancelled");
        assert_eq!(r.error_message, None);
    }

    #[test]
    fn record_title_falls_back_to_printed_title_then_url() {
        let completed = history_record(&task(""), &Outcome::Completed(done().unwrap()), "T1");
        assert_eq!(completed.title, "t");
        let cancelled = history_record(&task(""), &Outcome::Cancelled, "T1");
        assert_eq!(cancelled.title, URL);
    }

    #[test]
    fn payloads_serialize_camel_case() {
        let progress = serde_json::to_value(DownloadProgressPayload {
            task_id: "id".into(),
            percent: 1.0,
            speed: "1MiB/s".into(),
            speed_bytes: 1,
            eta: "00:01".into(),
            eta_seconds: 1,
        })
        .unwrap();
        for key in ["taskId", "speedBytes", "etaSeconds"] {
            assert!(progress.get(key).is_some(), "missing {key}");
        }

        let completed = serde_json::to_value(DownloadCompletedPayload {
            task_id: "id".into(),
            file_path: "/f".into(),
            title: "t".into(),
            completed_at: now_iso8601(),
        })
        .unwrap();
        assert!(completed.get("filePath").is_some());
        assert!(completed.get("completedAt").is_some());

        let failed = serde_json::to_value(DownloadFailedPayload {
            task_id: "id".into(),
            error_type: "NetworkError".into(),
            message: "m".into(),
        })
        .unwrap();
        assert_eq!(failed["errorType"], "NetworkError");
    }
}
