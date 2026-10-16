use serde::{Deserialize, Serialize};

use super::download_task::QualityOption;

/// A completed, failed, or cancelled download record persisted to `history.json`.
///
/// Serialized with camelCase keys (`outputPath`, `filePath`, ...) to match `src/types/index.ts`,
/// since Tauri does not rename command return values. The same format is used for `history.json`.
/// This struct derives both `Serialize` and `Deserialize` so it can be written to and read from
/// the history JSON file without loss of information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRecord {
    pub id: String,
    pub url: String,
    pub title: String,
    pub thumbnail: String,
    pub quality: QualityOption,
    pub output_path: String,
    pub file_path: Option<String>,
    /// One of `"completed"`, `"failed"`, or `"cancelled"`.
    pub status: String,
    pub error_message: Option<String>,
    /// ISO 8601 timestamp when the task was created.
    pub created_at: String,
    /// ISO 8601 timestamp when the task finished (present only for `completed`).
    pub completed_at: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_record() -> HistoryRecord {
        HistoryRecord {
            id: "test-uuid-1234".to_string(),
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ".to_string(),
            title: "Never Gonna Give You Up".to_string(),
            thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg".to_string(),
            quality: QualityOption::Q1080p,
            output_path: "/Users/user/Downloads".to_string(),
            file_path: Some("/Users/user/Downloads/Never Gonna Give You Up.mp4".to_string()),
            status: "completed".to_string(),
            error_message: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            completed_at: Some("2024-01-01T00:05:00Z".to_string()),
        }
    }

    #[test]
    fn history_record_serializes_and_deserializes() {
        let record = sample_record();
        let json = serde_json::to_string(&record).expect("serialization failed");
        let restored: HistoryRecord =
            serde_json::from_str(&json).expect("deserialization failed");

        assert_eq!(restored.id, record.id);
        assert_eq!(restored.url, record.url);
        assert_eq!(restored.title, record.title);
        assert_eq!(restored.quality, record.quality);
        assert_eq!(restored.output_path, record.output_path);
        assert_eq!(restored.status, record.status);
    }

    #[test]
    fn history_record_with_failed_status_roundtrips() {
        let mut record = sample_record();
        record.status = "failed".to_string();
        record.file_path = None;
        record.error_message = Some("Network error occurred".to_string());
        record.completed_at = None;

        let json = serde_json::to_string(&record).expect("serialization failed");
        let restored: HistoryRecord =
            serde_json::from_str(&json).expect("deserialization failed");

        assert_eq!(restored.status, "failed");
        assert_eq!(restored.error_message, Some("Network error occurred".to_string()));
        assert!(restored.file_path.is_none());
        assert!(restored.completed_at.is_none());
    }

    #[test]
    fn history_record_json_uses_camel_case_keys() {
        let record = sample_record();
        let json = serde_json::to_string(&record).expect("serialization failed");

        assert!(json.contains("\"outputPath\""));
        assert!(json.contains("\"filePath\""));
        assert!(json.contains("\"errorMessage\""));
        assert!(json.contains("\"createdAt\""));
        assert!(json.contains("\"completedAt\""));
        assert!(!json.contains("\"output_path\""));
    }

    #[test]
    fn history_record_vec_roundtrips() {
        let records = vec![sample_record(), {
            let mut r = sample_record();
            r.id = "another-uuid".to_string();
            r.status = "cancelled".to_string();
            r.file_path = None;
            r.completed_at = None;
            r
        }];

        let json = serde_json::to_string_pretty(&records).expect("serialization failed");
        let restored: Vec<HistoryRecord> =
            serde_json::from_str(&json).expect("deserialization failed");

        assert_eq!(restored.len(), 2);
        assert_eq!(restored[0].id, "test-uuid-1234");
        assert_eq!(restored[1].id, "another-uuid");
        assert_eq!(restored[1].status, "cancelled");
    }
}
