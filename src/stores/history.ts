import { defineStore } from "pinia";
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

import type { HistoryRecord } from "@/types";
import { toAppError } from "@/utils/appError";
import { useDownloadTaskStore } from "./downloadTask";

export const useHistoryStore = defineStore("history", () => {
  // State (newest first, same order as history.json)
  const records = ref<HistoryRecord[]>([]);
  const isLoading = ref(false);

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
  }

  /** Starts a new download with the record's original parameters. */
  async function retryDownload(record: HistoryRecord): Promise<string> {
    return useDownloadTaskStore().startDownload(record.url, record.quality, record.outputPath, {
      title: record.title,
      thumbnail: record.thumbnail,
    });
  }

  /**
   * Adds a finished task to the list. The backend has already persisted it, so
   * this only updates the UI; a record with the same id is replaced.
   */
  function appendRecord(record: HistoryRecord) {
    records.value = [record, ...records.value.filter((r) => r.id !== record.id)];
  }

  return { records, isLoading, loadHistory, deleteRecord, clearAll, retryDownload, appendRecord };
});
