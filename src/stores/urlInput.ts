import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

import type { AppError, QualityOption, UrlValidationState, VideoMetadata } from "@/types";
import { toAppError } from "@/utils/appError";
import { pickDefaultQuality } from "@/utils/quality";
import { validateUrl } from "@/utils/urlValidator";

export const useUrlInputStore = defineStore("urlInput", () => {
  // State
  const url = ref("");
  const validationState = ref<UrlValidationState>("idle");
  const isParsing = ref(false);
  const metadata = ref<VideoMetadata | null>(null);
  const parseError = ref<AppError | null>(null);
  const selectedQuality = ref<QualityOption | null>(null);
  const selectedPath = ref("");

  /** Incremented per parse so a stale response cannot overwrite a newer URL's result. */
  let parseSeq = 0;

  // Getters
  const canParse = computed(() => validationState.value === "valid" && !isParsing.value);
  const hasMetadata = computed(() => metadata.value !== null);

  // Actions
  function setUrl(value: string) {
    if (value !== url.value) {
      // Metadata belongs to the previous URL; keeping it would download the wrong video.
      metadata.value = null;
      selectedQuality.value = null;
      parseError.value = null;
    }
    url.value = value;
    if (value === "") {
      validationState.value = "idle";
    } else {
      validationState.value = validateUrl(value) ? "valid" : "invalid";
    }
  }

  async function parseVideo() {
    if (!canParse.value) return;
    const seq = ++parseSeq;
    isParsing.value = true;
    parseError.value = null;
    metadata.value = null;
    try {
      const result = await invoke<VideoMetadata>("parse_video", { url: url.value.trim() });
      if (seq !== parseSeq) return;
      metadata.value = result;
      selectedQuality.value = pickDefaultQuality(result.availableQualities);
    } catch (e) {
      if (seq !== parseSeq) return;
      parseError.value = toAppError(e);
    } finally {
      if (seq === parseSeq) isParsing.value = false;
    }
  }

  /** Sets `selectedPath` to the system download directory if no path is chosen yet. */
  async function loadDefaultPath() {
    if (selectedPath.value !== "") return;
    selectedPath.value = await invoke<string>("get_default_download_dir");
  }

  /** Opens the folder picker; keeps the current path if the dialog is cancelled. */
  async function selectFolder() {
    const folder = await invoke<string | null>("select_folder");
    if (folder) selectedPath.value = folder;
  }

  /** Clears the URL and parse result. `selectedPath` is kept for the next download. */
  function reset() {
    parseSeq++;
    url.value = "";
    validationState.value = "idle";
    isParsing.value = false;
    metadata.value = null;
    parseError.value = null;
    selectedQuality.value = null;
  }

  return {
    url,
    validationState,
    isParsing,
    metadata,
    parseError,
    selectedQuality,
    selectedPath,
    canParse,
    hasMetadata,
    setUrl,
    parseVideo,
    loadDefaultPath,
    selectFolder,
    reset,
  };
});
