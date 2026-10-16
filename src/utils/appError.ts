import type { AppError, AppErrorType } from "@/types";

const ERROR_TYPES: readonly AppErrorType[] = [
  "AuthRequired",
  "YtDlpError",
  "NetworkError",
  "IoError",
  "Unknown",
];

/**
 * Normalizes whatever a rejected `invoke()` produced into an `AppError`.
 *
 * Rust commands reject with `{ type, message }`; anything else (a plain
 * string from Tauri itself, a JS `Error`) becomes `Unknown`.
 */
export function toAppError(e: unknown): AppError {
  if (typeof e === "object" && e !== null && "type" in e) {
    const { type, message } = e as { type: unknown; message?: unknown };
    if (ERROR_TYPES.includes(type as AppErrorType)) {
      return typeof message === "string"
        ? { type: type as AppErrorType, message }
        : { type: type as AppErrorType };
    }
  }
  if (e instanceof Error) return { type: "Unknown", message: e.message };
  return { type: "Unknown", message: String(e) };
}

/**
 * User-facing text for an `AppError`, matching the `#[error(...)]` strings in
 * `src-tauri/src/error.rs` (which `download://failed` already uses as `message`).
 */
export function describeError(e: AppError): string {
  const detail = e.message ?? "";
  switch (e.type) {
    case "AuthRequired":
      return "認證失敗：此影片需要登入帳號方可存取";
    case "YtDlpError":
      return `yt-dlp 錯誤：${detail}`;
    case "NetworkError":
      return `網路連線中斷：${detail}`;
    case "IoError":
      return `IO 錯誤：${detail}`;
    case "Unknown":
      return `未知錯誤：${detail}`;
  }
}
