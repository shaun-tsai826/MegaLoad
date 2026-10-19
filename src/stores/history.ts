import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";

import type { HistoryRecord } from "@/types";
import { toAppError } from "@/utils/appError";
import {
  DEFAULT_PAGE_SIZE,
  clampPage,
  isPageSize,
  pageCount,
  pageRange as rangeOf,
  paginate,
  type PageSize,
} from "@/utils/pagination";
import { useDownloadTaskStore } from "./downloadTask";

/** localStorage key for the chosen page size (a per-viewer convenience). */
const PAGE_SIZE_KEY = "megaload.history.pageSize";

function loadPageSize(): PageSize {
  try {
    const saved = Number(localStorage.getItem(PAGE_SIZE_KEY));
    return isPageSize(saved) ? saved : DEFAULT_PAGE_SIZE;
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
}

function savePageSize(size: PageSize) {
  try {
    localStorage.setItem(PAGE_SIZE_KEY, String(size));
  } catch {
    // Storage unavailable: the size just isn't remembered.
  }
}

export const useHistoryStore = defineStore("history", () => {
  // State (newest first, same order as history.json)
  const records = ref<HistoryRecord[]>([]);
  const isLoading = ref(false);
  const pageSize = ref<PageSize>(loadPageSize());
  /** 1-based. Kept in the store so leaving and returning keeps the page. */
  const currentPage = ref(1);

  // Getters
  const totalPages = computed(() => pageCount(records.value.length, pageSize.value));
  const pagedRecords = computed(() => paginate(records.value, currentPage.value, pageSize.value));
  const pageRange = computed(() => rangeOf(currentPage.value, records.value.length, pageSize.value));

  // Deleting records can remove the current page; fall back to the last one.
  watch(totalPages, (total) => {
    if (currentPage.value > total) currentPage.value = total;
  });

  // Actions
  async function loadHistory() {
    isLoading.value = true;
    try {
      records.value = await invoke<HistoryRecord[]>("get_history");
    } catch (e) {
      throw toAppError(e);
    } finally {
      isLoading.value = false;
    }
  }

  async function deleteRecord(id: string) {
    try {
      await invoke("delete_history_item", { id });
    } catch (e) {
      throw toAppError(e);
    }
    records.value = records.value.filter((r) => r.id !== id);
  }

  async function clearAll() {
    try {
      await invoke("clear_all_history");
    } catch (e) {
      throw toAppError(e);
    }
    records.value = [];
    currentPage.value = 1;
  }

  /** Starts a new download with the record's original parameters. */
  async function retryDownload(record: HistoryRecord): Promise<string> {
    return redownload(record);
  }

  /**
   * Downloads a record again with its original URL, quality and folder.
   * `overwrite` replaces a file that is still on disk; without it yt-dlp
   * would skip the download because the file already exists.
   */
  async function redownload(record: HistoryRecord, options: { overwrite?: boolean } = {}): Promise<string> {
    return useDownloadTaskStore().startDownload(
      record.url,
      record.quality,
      record.outputPath,
      { title: record.title, thumbnail: record.thumbnail },
      options,
    );
  }

  /** Whether the record's downloaded file is still on disk. */
  async function fileExists(record: HistoryRecord): Promise<boolean> {
    if (!record.filePath) return false;
    try {
      return await invoke<boolean>("file_exists", { path: record.filePath });
    } catch (e) {
      throw toAppError(e);
    }
  }

  /**
   * Adds a finished task to the list. The backend has already persisted it, so
   * this only updates the UI; a record with the same id is replaced.
   */
  function appendRecord(record: HistoryRecord) {
    records.value = [record, ...records.value.filter((r) => r.id !== record.id)];
  }

  function setPage(page: number) {
    currentPage.value = clampPage(page, records.value.length, pageSize.value);
  }

  /** Changes the page size, keeping the first record of the current page in view. */
  function setPageSize(size: PageSize) {
    const firstIndex = (currentPage.value - 1) * pageSize.value;
    pageSize.value = size;
    savePageSize(size);
    setPage(Math.floor(firstIndex / size) + 1);
  }

  return {
    records,
    isLoading,
    pageSize,
    currentPage,
    totalPages,
    pagedRecords,
    pageRange,
    loadHistory,
    deleteRecord,
    clearAll,
    retryDownload,
    redownload,
    fileExists,
    appendRecord,
    setPage,
    setPageSize,
  };
});
