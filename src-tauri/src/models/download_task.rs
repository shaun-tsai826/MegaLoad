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
    ///
    /// Video qualities use yt-dlp's default selector and pick the resolution
    /// through `sort_order()` instead of `[height<=N]` filters: filters drop
    /// portrait videos (a 1080x1920 Instagram reel has height 1920) and formats
    /// whose height is unknown, which made the download fail with
    /// "Requested format is not available".
    pub fn format_selector(&self) -> &'static str {
        match self {
            QualityOption::AudioMp3 => "bestaudio/best",
            _ => "bv*+ba/b",
        }
    }

    /// Returns the yt-dlp `-S` sort order, or `None` for audio.
    ///
    /// `res` is the shorter side, so `res:1080` means "largest up to 1080p" for
    /// both landscape and portrait videos. Sorting only ranks formats, so a
    /// video without a matching resolution still downloads the closest one.
    pub fn sort_order(&self) -> Option<&'static str> {
        match self {
            QualityOption::Q1080p => Some("res:1080,ext:mp4:m4a"),
            QualityOption::Q720p => Some("res:720,ext:mp4:m4a"),
            QualityOption::Q480p => Some("res:480,ext:mp4:m4a"),
            QualityOption::AudioMp3 => None,
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
    fn quality_option_1080p_sorts_by_resolution() {
        assert_eq!(QualityOption::Q1080p.sort_order(), Some("res:1080,ext:mp4:m4a"));
        assert_eq!(QualityOption::Q1080p.format_selector(), "bv*+ba/b");
    }

    #[test]
    fn quality_option_720p_sorts_by_resolution() {
        assert_eq!(QualityOption::Q720p.sort_order(), Some("res:720,ext:mp4:m4a"));
        assert_eq!(QualityOption::Q720p.format_selector(), "bv*+ba/b");
    }

    #[test]
    fn quality_option_480p_sorts_by_resolution() {
        assert_eq!(QualityOption::Q480p.sort_order(), Some("res:480,ext:mp4:m4a"));
        assert_eq!(QualityOption::Q480p.format_selector(), "bv*+ba/b");
    }

    #[test]
    fn video_selectors_do_not_filter_by_height() {
        // Height filters exclude portrait videos; resolution is chosen by sort order.
        for q in [QualityOption::Q1080p, QualityOption::Q720p, QualityOption::Q480p] {
            assert!(!q.format_selector().contains("height"));
        }
    }

    #[test]
    fn audio_has_no_sort_order() {
        assert_eq!(QualityOption::AudioMp3.format_selector(), "bestaudio/best");
        assert_eq!(QualityOption::AudioMp3.sort_order(), None);
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
