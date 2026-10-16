import type { QualityOption } from "@/types";

/** Highest priority first. */
export const QUALITY_PRIORITY: readonly QualityOption[] = ["1080p", "720p", "480p", "audio_mp3"];

/** Returns the highest-priority option in `options`, or `null` if it is empty. */
export function pickDefaultQuality(options: readonly QualityOption[]): QualityOption | null {
  return QUALITY_PRIORITY.find((q) => options.includes(q)) ?? null;
}
