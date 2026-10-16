/**
 * Shared TypeScript type definitions for the Video Downloader application.
 *
 * These types are used across Pinia stores, Vue components, and composables to
 * ensure a consistent data contract between the frontend and the Tauri backend.
 */

// ---------------------------------------------------------------------------
// URL Validation
// ---------------------------------------------------------------------------

/**
 * The validation state of the URL input field.
 *
 * - `"idle"`    – The field is empty; no validation has been performed yet.
 * - `"valid"`   – The input is a well-formed HTTP/HTTPS URL.
 * - `"invalid"` – The input is present but fails URL format validation.
 */
export type UrlValidationState = "idle" | "valid" | "invalid";

// ---------------------------------------------------------------------------
// Video Metadata
// ---------------------------------------------------------------------------

/**
 * Parsed metadata returned by `yt-dlp -J` for a given video URL.
 */
export interface VideoMetadata {
  /** Human-readable title of the video. */
  title: string;

  /** Direct URL of the video's cover/thumbnail image. */
  thumbnail: string;

  /** Video duration in seconds. */
  duration: number;

  /** Name of the channel or account that uploaded the video. */
  uploader: string;

  /** List of quality options available for this video. */
  availableQualities: QualityOption[];
}

/**
 * Selectable download quality options.
 *
 * Corresponds to yt-dlp format selector strings defined in the design document.
 */
export type QualityOption = "1080p" | "720p" | "480p" | "audio_mp3";

// ---------------------------------------------------------------------------
// Download Task (in-progress)
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a download task.
 *
 * State transitions:
 *   pending → downloading → completed
 *                        ↘ failed
 *   (any)  →              cancelled
 */
export type DownloadStatus =
  | "pending"
  | "downloading"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * A single download task tracked in the `useDownloadTaskStore`.
 * Represents an in-progress or recently-finished download.
 */
export interface DownloadTask {
  /** Unique identifier (UUID v4) assigned by the Tauri backend. */
  id: string;

  /** Source URL submitted by the user. */
  url: string;

  /** Video title from metadata. */
  title: string;

  /** Thumbnail URL from metadata. */
  thumbnail: string;

  /** Selected download quality. */
  quality: QualityOption;

  /** Absolute path of the directory where the file will be saved. */
  outputPath: string;

  /** Current lifecycle status of the download. */
  status: DownloadStatus;

  /** Download completion percentage (0–100). */
  percent: number;

  /** Human-readable download speed (e.g. `"1.23MiB/s"`). */
  speed: string;

  /** Download speed in bytes per second. */
  speedBytes: number;

  /** Estimated seconds remaining until download completes. */
  etaSeconds: number;

  /** Absolute path of the downloaded file (populated on completion). */
  filePath: string | null;

  /** Human-readable error description (populated on failure). */
  errorMessage: string | null;

  /**
   * Structured error type string forwarded from the Tauri backend
   * (e.g. `"NetworkError"`, `"AuthRequired"`, `"YtDlpError"`).
   */
  errorType: string | null;

  /** ISO 8601 timestamp when the task was created. */
  createdAt: string;

  /** ISO 8601 timestamp when the task completed or failed. `null` while in progress. */
  completedAt: string | null;
}

// ---------------------------------------------------------------------------
// Download History (persisted)
// ---------------------------------------------------------------------------

/**
 * A persisted record of a completed, failed, or cancelled download task.
 * Written to `history.json` on disk by the Tauri backend.
 */
export interface HistoryRecord {
  /** Unique identifier (UUID v4). */
  id: string;

  /** Source URL of the download. */
  url: string;

  /** Video title. */
  title: string;

  /** Thumbnail URL. */
  thumbnail: string;

  /** Download quality used. */
  quality: QualityOption;

  /** Directory where the file was saved. */
  outputPath: string;

  /** Absolute path of the downloaded file, or `null` if download failed. */
  filePath: string | null;

  /** Final status of the download. */
  status: "completed" | "failed" | "cancelled";

  /** Error description for failed downloads. `null` for completed downloads. */
  errorMessage: string | null;

  /** ISO 8601 timestamp when the download was initiated. */
  createdAt: string;

  /** ISO 8601 timestamp when the download finished. `null` for failed/cancelled. */
  completedAt: string | null;
}

// ---------------------------------------------------------------------------
// Tauri Event Payloads
// ---------------------------------------------------------------------------
// The Rust structs use `#[serde(rename_all = "camelCase")]`, so keys are camelCase.

/**
 * Payload emitted by the Tauri backend on the `download://progress` event.
 */
export interface DownloadProgressEvent {
  taskId: string;
  /** Percentage complete (0.0–100.0). */
  percent: number;
  /** Human-readable speed string (e.g. `"1.23MiB/s"`). */
  speed: string;
  /** Speed in bytes per second. */
  speedBytes: number;
  /** Human-readable ETA string (e.g. `"00:23"`). */
  eta: string;
  /** ETA in seconds. */
  etaSeconds: number;
}

/**
 * Payload emitted by the Tauri backend on the `download://completed` event.
 */
export interface DownloadCompletedEvent {
  taskId: string;
  /** Absolute path of the completed download. */
  filePath: string;
  /** Video title. */
  title: string;
  /** ISO 8601 timestamp of completion. */
  completedAt: string;
}

/**
 * Payload emitted by the Tauri backend on the `download://failed` event.
 */
export interface DownloadFailedEvent {
  taskId: string;
  /** Structured error category. */
  errorType: "NetworkError" | "AuthRequired" | "YtDlpError" | "IoError" | "Unknown";
  /** Human-readable error description. */
  message: string;
}

/**
 * Payload emitted by the Tauri backend on the `download://cancelled` event.
 * Cancellation is a separate event so the task is marked `cancelled`, not `failed`.
 */
export interface DownloadCancelledEvent {
  taskId: string;
}
