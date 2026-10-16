use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;

/// The video quality option selected by the user.
///
/// Serializes to/from the string values used by the frontend TypeScript types:
/// `"1080p"`, `"720p"`, `"480p"`, `"audio_mp3"`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum QualityOption {
    #[serde(rename = "1080p")]
    Q1080p,
    #[serde(rename = "720p")]
    Q720p,
    #[serde(rename = "480p")]
    Q480p,
    #[serde(rename = "audio_mp3")]
    AudioMp3,
}

impl QualityOption {
    /// Returns the yt-dlp `-f` format selector string for this quality option.
    pub fn format_selector(&self) -> &'static str {
        match self {
            QualityOption::Q1080p => {
                "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]"
            }
            QualityOption::Q720p => {
                "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]"
            }
            QualityOption::Q480p => {
                "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]"
            }
            QualityOption::AudioMp3 => "bestaudio/best",
        }
    }
}

/// The lifecycle status of a download task.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DownloadStatus {
    Pending,
    Downloading,
    Completed,
    Failed,
    Cancelled,
}

/// An in-progress download task managed by the Rust backend.
///
/// This struct is intentionally **not** `Serialize`/`Deserialize` because it
/// contains `cancel_tx` (`oneshot::Sender<()>`), which is not serializable.
/// Only the fields needed for history persistence are captured in `HistoryRecord`.
pub struct DownloadTask {
    pub id: String,
    pub url: String,
    pub quality: QualityOption,
    pub output_path: String,
    /// Title from the frontend's parsed metadata; empty if not provided.
    pub title: String,
    /// Thumbnail URL from the frontend's parsed metadata; empty if not provided.
    pub thumbnail: String,
    /// ISO 8601 timestamp when the task was created.
    pub created_at: String,
    pub status: DownloadStatus,
    /// Sending on this channel requests cancellation of the running yt-dlp process.
    pub cancel_tx: Option<oneshot::Sender<()>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quality_option_format_selectors_are_non_empty() {
        let cases = [
            QualityOption::Q1080p,
            QualityOption::Q720p,
            QualityOption::Q480p,
            QualityOption::AudioMp3,
        ];
        for q in &cases {
            assert!(!q.format_selector().is_empty());
        }
    }

    #[test]
    fn quality_option_1080p_contains_height_constraint() {
        assert!(QualityOption::Q1080p.format_selector().contains("1080"));
    }

    #[test]
    fn quality_option_720p_contains_height_constraint() {
        assert!(QualityOption::Q720p.format_selector().contains("720"));
    }

    #[test]
    fn quality_option_480p_contains_height_constraint() {
        assert!(QualityOption::Q480p.format_selector().contains("480"));
    }

    #[test]
    fn quality_option_serializes_to_string_values() {
        assert_eq!(
            serde_json::to_string(&QualityOption::Q1080p).unwrap(),
            "\"1080p\""
        );
        assert_eq!(
            serde_json::to_string(&QualityOption::Q720p).unwrap(),
            "\"720p\""
        );
        assert_eq!(
            serde_json::to_string(&QualityOption::Q480p).unwrap(),
            "\"480p\""
        );
        assert_eq!(
            serde_json::to_string(&QualityOption::AudioMp3).unwrap(),
            "\"audio_mp3\""
        );
    }

    #[test]
    fn quality_option_deserializes_from_string_values() {
        assert_eq!(
            serde_json::from_str::<QualityOption>("\"1080p\"").unwrap(),
            QualityOption::Q1080p
        );
        assert_eq!(
            serde_json::from_str::<QualityOption>("\"audio_mp3\"").unwrap(),
            QualityOption::AudioMp3
        );
    }

    #[test]
    fn download_status_serializes_snake_case() {
        assert_eq!(
            serde_json::to_string(&DownloadStatus::Pending).unwrap(),
            "\"pending\""
        );
        assert_eq!(
            serde_json::to_string(&DownloadStatus::Downloading).unwrap(),
            "\"downloading\""
        );
        assert_eq!(
            serde_json::to_string(&DownloadStatus::Completed).unwrap(),
            "\"completed\""
        );
        assert_eq!(
            serde_json::to_string(&DownloadStatus::Failed).unwrap(),
            "\"failed\""
        );
        assert_eq!(
            serde_json::to_string(&DownloadStatus::Cancelled).unwrap(),
            "\"cancelled\""
        );
    }
}
