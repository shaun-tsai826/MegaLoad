use serde::Serialize;
use thiserror::Error;

/// Application-level errors returned from Tauri commands.
///
/// Derives `Serialize` so it can be forwarded to the frontend as a structured
/// JSON object when a command returns `Err(AppError)`.
/// The `#[serde(tag = "type", content = "message")]` representation produces:
/// ```json
/// { "type": "YtDlpError", "message": "..." }
/// ```
#[derive(Debug, Error, Serialize)]
#[serde(tag = "type", content = "message")]
pub enum AppError {
    #[error("認證失敗：此影片需要登入帳號方可存取")]
    AuthRequired,

    #[error("yt-dlp 錯誤：{0}")]
    YtDlpError(String),

    #[error("網路連線中斷：{0}")]
    NetworkError(String),

    #[error("IO 錯誤：{0}")]
    IoError(String),

    #[error("未知錯誤：{0}")]
    Unknown(String),
}

impl AppError {
    /// Classify a yt-dlp stderr string into the appropriate `AppError` variant.
    ///
    /// Classification rules (case-insensitive):
    /// - Contains `login`, `sign in`, `private`, or `members only` → `AuthRequired`
    /// - Contains `network`, `connection`, `timed out`, or `unable to connect` → `NetworkError`
    /// - Everything else → `YtDlpError`
    pub fn from_ytdlp_stderr(stderr: &str) -> Self {
        let s = stderr.to_lowercase();

        if s.contains("login")
            || s.contains("sign in")
            || s.contains("private")
            || s.contains("members only")
        {
            AppError::AuthRequired
        } else if s.contains("network")
            || s.contains("connection")
            || s.contains("timed out")
            || s.contains("unable to connect")
        {
            AppError::NetworkError(stderr.to_string())
        } else {
            AppError::YtDlpError(stderr.to_string())
        }
    }

    /// The variant name, matching the `type` tag in the serialized JSON.
    /// Used as `errorType` in the `download://failed` event payload.
    pub fn kind(&self) -> &'static str {
        match self {
            AppError::AuthRequired => "AuthRequired",
            AppError::YtDlpError(_) => "YtDlpError",
            AppError::NetworkError(_) => "NetworkError",
            AppError::IoError(_) => "IoError",
            AppError::Unknown(_) => "Unknown",
        }
    }
}

// Tauri v2 allows commands to return `Result<T, E>` as long as `E: Serialize`.
// `AppError` derives `Serialize` above, so it can be used directly as the error
// type in `#[tauri::command]` functions without any additional From impl.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_required_for_login_keyword() {
        let err = AppError::from_ytdlp_stderr("ERROR: This video requires you to login");
        assert!(matches!(err, AppError::AuthRequired));
    }

    #[test]
    fn auth_required_case_insensitive() {
        let err = AppError::from_ytdlp_stderr("ERROR: Private video");
        assert!(matches!(err, AppError::AuthRequired));
    }

    #[test]
    fn auth_required_members_only() {
        let err = AppError::from_ytdlp_stderr("This video is for members only");
        assert!(matches!(err, AppError::AuthRequired));
    }

    #[test]
    fn network_error_for_connection_issues() {
        let err = AppError::from_ytdlp_stderr("ERROR: unable to connect to server");
        assert!(matches!(err, AppError::NetworkError(_)));
    }

    #[test]
    fn network_error_for_timed_out() {
        let err = AppError::from_ytdlp_stderr("ERROR: Connection timed out");
        assert!(matches!(err, AppError::NetworkError(_)));
    }

    #[test]
    fn ytdlp_error_for_unknown_message() {
        let err = AppError::from_ytdlp_stderr("ERROR: Unsupported URL");
        assert!(matches!(err, AppError::YtDlpError(_)));
    }

    #[test]
    fn kind_matches_serialized_type_tag() {
        let cases = [
            AppError::AuthRequired,
            AppError::YtDlpError("x".into()),
            AppError::NetworkError("x".into()),
            AppError::IoError("x".into()),
            AppError::Unknown("x".into()),
        ];
        for err in &cases {
            let json = serde_json::to_value(err).unwrap();
            assert_eq!(json["type"], err.kind());
        }
    }

    #[test]
    fn empty_stderr_becomes_ytdlp_error() {
        let err = AppError::from_ytdlp_stderr("");
        assert!(matches!(err, AppError::YtDlpError(_)));
    }
}
