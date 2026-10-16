use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_shell::process::CommandEvent;

use crate::error::AppError;
use crate::sidecar::spawn_sidecar;

/// Video metadata returned to the frontend after a successful parse.
///
/// Serialized with camelCase keys (`availableQualities`) to match `src/types/index.ts`.
/// `available_qualities` contains the quality strings available for this video,
/// e.g. `["1080p", "720p", "480p", "audio_mp3"]`.  Audio MP3 is always present.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoMetadata {
    pub title: String,
    pub thumbnail: String,
    pub duration: f64,
    pub uploader: String,
    pub available_qualities: Vec<String>,
}

/// Parses video metadata for the given URL by invoking the yt-dlp sidecar
/// with `["--no-warnings", "-J", &url]`.
///
/// On success the full stdout is decoded as JSON and mapped to a
/// `VideoMetadata` struct.  On failure the stderr is classified via
/// `AppError::from_ytdlp_stderr`.
///
/// # Errors
///
/// - `AppError::YtDlpError` if the sidecar cannot be spawned or the JSON
///   cannot be parsed.
/// - `AppError::AuthRequired` if the video is private or requires login.
/// - `AppError::NetworkError` if a network issue is detected.
#[tauri::command]
pub async fn parse_video(app: AppHandle, url: String) -> Result<VideoMetadata, AppError> {
    let (mut rx, _child) = spawn_sidecar(&app, &["--no-warnings", "-J", &url])
        .map_err(|e| AppError::YtDlpError(e.to_string()))?;

    let mut stdout_buf = String::new();
    let mut stderr_buf = String::new();

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) => {
                stdout_buf.push_str(&String::from_utf8_lossy(&line));
            }
            CommandEvent::Stderr(line) => {
                stderr_buf.push_str(&String::from_utf8_lossy(&line));
            }
            CommandEvent::Terminated(status) => {
                if status.code != Some(0) && !stderr_buf.is_empty() {
                    return Err(AppError::from_ytdlp_stderr(&stderr_buf));
                }
                break;
            }
            _ => {}
        }
    }

    if stdout_buf.is_empty() && !stderr_buf.is_empty() {
        return Err(AppError::from_ytdlp_stderr(&stderr_buf));
    }

    parse_metadata_json(&stdout_buf)
}

/// Deserializes the yt-dlp `-J` JSON output into a `VideoMetadata`.
///
/// Fields that are absent or of an unexpected type fall back to safe defaults
/// rather than causing a parse error so that unusual video sources still work.
pub(crate) fn parse_metadata_json(json: &str) -> Result<VideoMetadata, AppError> {
    let value: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| AppError::YtDlpError(format!("Failed to parse metadata: {}", e)))?;

    let title = value["title"]
        .as_str()
        .unwrap_or("Unknown Title")
        .to_string();
    let thumbnail = value["thumbnail"].as_str().unwrap_or("").to_string();
    let duration = value["duration"].as_f64().unwrap_or(0.0);
    let uploader = value["uploader"]
        .as_str()
        .or_else(|| value["channel"].as_str())
        .unwrap_or("Unknown Uploader")
        .to_string();

    let formats = value["formats"].as_array();
    let available_qualities = determine_available_qualities(formats);

    Ok(VideoMetadata {
        title,
        thumbnail,
        duration,
        uploader,
        available_qualities,
    })
}

/// Derives the list of available quality strings from the yt-dlp `formats` array.
///
/// Video quality labels are included when at least one format entry has a
/// `height` value meeting or exceeding the threshold:
/// - `"1080p"` → height ≥ 1080
/// - `"720p"`  → height ≥ 720
/// - `"480p"`  → height ≥ 480
///
/// `"audio_mp3"` is always appended — audio extraction is always available.
pub(crate) fn determine_available_qualities(
    formats: Option<&Vec<serde_json::Value>>,
) -> Vec<String> {
    let mut qualities = Vec::new();

    if let Some(formats) = formats {
        let heights: Vec<u64> = formats
            .iter()
            .filter_map(|f| f["height"].as_u64())
            .collect();

        if heights.iter().any(|&h| h >= 1080) {
            qualities.push("1080p".to_string());
        }
        if heights.iter().any(|&h| h >= 720) {
            qualities.push("720p".to_string());
        }
        if heights.iter().any(|&h| h >= 480) {
            qualities.push("480p".to_string());
        }
    }

    // Audio is always available regardless of video formats
    qualities.push("audio_mp3".to_string());

    qualities
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── determine_available_qualities ─────────────────────────────────────

    #[test]
    fn audio_only_when_no_formats() {
        let result = determine_available_qualities(None);
        assert_eq!(result, vec!["audio_mp3"]);
    }

    #[test]
    fn audio_only_when_formats_array_is_empty() {
        let formats: Vec<serde_json::Value> = vec![];
        let result = determine_available_qualities(Some(&formats));
        assert_eq!(result, vec!["audio_mp3"]);
    }

    #[test]
    fn audio_only_when_formats_have_no_height() {
        let formats = vec![
            serde_json::json!({"format_id": "bestaudio", "ext": "m4a"}),
            serde_json::json!({"format_id": "bestaudio/best"}),
        ];
        let result = determine_available_qualities(Some(&formats));
        assert_eq!(result, vec!["audio_mp3"]);
    }

    #[test]
    fn all_qualities_present_when_1080p_format_available() {
        let formats = vec![
            serde_json::json!({"height": 1080}),
            serde_json::json!({"height": 720}),
            serde_json::json!({"height": 480}),
        ];
        let result = determine_available_qualities(Some(&formats));
        assert_eq!(result, vec!["1080p", "720p", "480p", "audio_mp3"]);
    }

    #[test]
    fn only_720p_and_below_when_no_1080p() {
        let formats = vec![
            serde_json::json!({"height": 720}),
            serde_json::json!({"height": 480}),
            serde_json::json!({"height": 360}),
        ];
        let result = determine_available_qualities(Some(&formats));
        assert_eq!(result, vec!["720p", "480p", "audio_mp3"]);
    }

    #[test]
    fn only_480p_when_max_height_is_480() {
        let formats = vec![
            serde_json::json!({"height": 480}),
            serde_json::json!({"height": 360}),
        ];
        let result = determine_available_qualities(Some(&formats));
        assert_eq!(result, vec!["480p", "audio_mp3"]);
    }

    #[test]
    fn audio_mp3_always_last_in_qualities() {
        let formats = vec![serde_json::json!({"height": 1080})];
        let result = determine_available_qualities(Some(&formats));
        assert_eq!(result.last().unwrap(), "audio_mp3");
    }

    #[test]
    fn exactly_1080_height_triggers_1080p() {
        let formats = vec![serde_json::json!({"height": 1080})];
        let result = determine_available_qualities(Some(&formats));
        assert!(result.contains(&"1080p".to_string()));
    }

    #[test]
    fn exactly_720_height_triggers_720p_but_not_1080p() {
        let formats = vec![serde_json::json!({"height": 720})];
        let result = determine_available_qualities(Some(&formats));
        assert!(result.contains(&"720p".to_string()));
        assert!(!result.contains(&"1080p".to_string()));
    }

    // ── parse_metadata_json ───────────────────────────────────────────────

    fn make_json(title: &str, thumbnail: &str, uploader: &str) -> String {
        serde_json::json!({
            "title": title,
            "thumbnail": thumbnail,
            "duration": 123.5,
            "uploader": uploader,
            "formats": [
                {"height": 1080},
                {"height": 720},
                {"height": 480}
            ]
        })
        .to_string()
    }

    #[test]
    fn parse_metadata_extracts_title() {
        let json = make_json("My Video Title", "https://thumb.example.com/img.jpg", "Channel");
        let meta = parse_metadata_json(&json).unwrap();
        assert_eq!(meta.title, "My Video Title");
    }

    #[test]
    fn parse_metadata_extracts_thumbnail() {
        let json = make_json("Title", "https://thumb.example.com/img.jpg", "Channel");
        let meta = parse_metadata_json(&json).unwrap();
        assert_eq!(meta.thumbnail, "https://thumb.example.com/img.jpg");
    }

    #[test]
    fn parse_metadata_extracts_duration() {
        let json = make_json("Title", "https://thumb.example.com/img.jpg", "Channel");
        let meta = parse_metadata_json(&json).unwrap();
        assert!((meta.duration - 123.5).abs() < f64::EPSILON);
    }

    #[test]
    fn parse_metadata_extracts_uploader() {
        let json = make_json("Title", "https://thumb.example.com/img.jpg", "MyChannel");
        let meta = parse_metadata_json(&json).unwrap();
        assert_eq!(meta.uploader, "MyChannel");
    }

    #[test]
    fn parse_metadata_falls_back_to_channel_when_uploader_absent() {
        let json = serde_json::json!({
            "title": "Title",
            "thumbnail": "https://thumb.example.com/img.jpg",
            "duration": 60.0,
            "channel": "FallbackChannel",
            "formats": []
        })
        .to_string();
        let meta = parse_metadata_json(&json).unwrap();
        assert_eq!(meta.uploader, "FallbackChannel");
    }

    #[test]
    fn parse_metadata_uses_default_uploader_when_both_absent() {
        let json = serde_json::json!({
            "title": "Title",
            "thumbnail": "https://t.example.com/img.jpg",
            "duration": 60.0,
            "formats": []
        })
        .to_string();
        let meta = parse_metadata_json(&json).unwrap();
        assert_eq!(meta.uploader, "Unknown Uploader");
    }

    #[test]
    fn parse_metadata_uses_default_title_when_absent() {
        let json = serde_json::json!({
            "thumbnail": "https://t.example.com/img.jpg",
            "duration": 0.0,
            "uploader": "Channel",
            "formats": []
        })
        .to_string();
        let meta = parse_metadata_json(&json).unwrap();
        assert_eq!(meta.title, "Unknown Title");
    }

    #[test]
    fn parse_metadata_uses_empty_thumbnail_when_absent() {
        let json = serde_json::json!({
            "title": "Title",
            "duration": 0.0,
            "uploader": "Channel",
            "formats": []
        })
        .to_string();
        let meta = parse_metadata_json(&json).unwrap();
        assert_eq!(meta.thumbnail, "");
    }

    #[test]
    fn parse_metadata_returns_err_on_invalid_json() {
        let result = parse_metadata_json("not valid json {{");
        assert!(result.is_err());
        match result {
            Err(AppError::YtDlpError(msg)) => assert!(msg.contains("Failed to parse metadata")),
            other => panic!("expected YtDlpError, got {:?}", other),
        }
    }

    #[test]
    fn parse_metadata_includes_all_qualities_for_full_format_list() {
        let json = make_json("Title", "https://t.example.com/img.jpg", "Channel");
        let meta = parse_metadata_json(&json).unwrap();
        assert!(meta.available_qualities.contains(&"1080p".to_string()));
        assert!(meta.available_qualities.contains(&"720p".to_string()));
        assert!(meta.available_qualities.contains(&"480p".to_string()));
        assert!(meta.available_qualities.contains(&"audio_mp3".to_string()));
    }

    #[test]
    fn parse_metadata_always_has_at_least_audio_mp3() {
        let json = serde_json::json!({
            "title": "Audio Only",
            "thumbnail": "",
            "duration": 30.0,
            "uploader": "Radio",
            "formats": [{"ext": "m4a"}]
        })
        .to_string();
        let meta = parse_metadata_json(&json).unwrap();
        assert!(meta.available_qualities.contains(&"audio_mp3".to_string()));
    }

    #[test]
    fn parse_metadata_duration_defaults_to_zero_when_absent() {
        let json = serde_json::json!({
            "title": "Title",
            "thumbnail": "https://t.example.com/img.jpg",
            "uploader": "Channel",
            "formats": []
        })
        .to_string();
        let meta = parse_metadata_json(&json).unwrap();
        assert_eq!(meta.duration, 0.0);
    }
}
