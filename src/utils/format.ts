import type { QualityOption } from "@/types";

const QUALITY_LABELS: Record<QualityOption, string> = {
  "1080p": "1080p",
  "720p": "720p",
  "480p": "480p",
  audio_mp3: "僅音訊 MP3",
};

export function qualityLabel(quality: QualityOption): string {
  return QUALITY_LABELS[quality];
}

/** Bytes per second as `KB/s` or `MB/s` (Requirement 4.3). Empty when unknown. */
export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "";
  const kb = bytesPerSecond / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB/s`;
  return `${(kb / 1024).toFixed(1)} MB/s`;
}

/** Seconds as `m:ss` or `h:mm:ss`. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** ISO 8601 timestamp in local time, e.g. `2026/10/16 18:33`. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
