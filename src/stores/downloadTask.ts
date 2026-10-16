import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

import type {
  DownloadCancelledEvent,
  DownloadCompletedEvent,
  DownloadFailedEvent,
  DownloadProgressEvent,
  DownloadTask,
  HistoryRecord,
  QualityOption,
} from "@/types";
import { toAppError } from "@/utils/appError";

/**
 * Builds the history entry for a finished task. Mirrors the record the Rust
 * backend writes to `history.json` (same id), so the history list can be
 * updated without reloading it.
 */
export function toHistoryRecord(task: DownloadTask): HistoryRecord | null {
  if (task.status !== "completed" && task.status !== "failed" && task.status !== "cancelled") {
    return null;
  }
  return {
    id: task.id,
    url: task.url,
    title: task.title || task.url,
    thumbnail: task.thumbnail,
    quality: task.quality,
    outputPath: task.outputPath,
    filePath: task.filePath,
    status: task.status,
    errorMessage: task.errorMessage,
    createdAt: task.createdAt,
    completedAt: task.status === "completed" ? task.completedAt : null,
  };
}

export const useDownloadTaskStore = defineStore("downloadTask", () => {
  // State: task id → task
  const tasks = ref(new Map<string, DownloadTask>());

  // Getters
  const taskList = computed(() =>
    Array.from(tasks.value.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    ),
  );
  const activeCount = computed(
    () => taskList.value.filter((t) => t.status === "pending" || t.status === "downloading").length,
  );

  // Actions

  /**
   * Starts a download and adds it as a `pending` task. Rejects with an
   * `AppError` if the backend could not start yt-dlp.
   */
  async function startDownload(
    url: string,
    quality: QualityOption,
    outputPath: string,
    metadata: { title: string; thumbnail: string },
  ): Promise<string> {
    let id: string;
    try {
      id = await invoke<string>("start_download", {
        url,
        quality,
        outputPath,
        title: metadata.title,
        thumbnail: metadata.thumbnail,
      });
    } catch (e) {
      throw toAppError(e);
    }
    tasks.value.set(id, {
      id,
      url,
      title: metadata.title,
      thumbnail: metadata.thumbnail,
      quality,
      outputPath,
      status: "pending",
      percent: 0,
      speed: "",
      speedBytes: 0,
      etaSeconds: 0,
      filePath: null,
      errorMessage: null,
      errorType: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    });
    return id;
  }

  function updateProgress(event: DownloadProgressEvent) {
    const task = tasks.value.get(event.taskId);
    if (!task || isFinished(task)) return;
    task.percent = event.percent;
    task.speed = event.speed;
    task.speedBytes = event.speedBytes;
    task.etaSeconds = event.etaSeconds;
    task.status = "downloading";
  }

  /** Returns the updated task, or `undefined` if the id is unknown. */
  function markCompleted(event: DownloadCompletedEvent): DownloadTask | undefined {
    const task = tasks.value.get(event.taskId);
    if (!task) return undefined;
    task.status = "completed";
    task.percent = 100;
    task.etaSeconds = 0;
    task.filePath = event.filePath;
    task.completedAt = event.completedAt;
    return task;
  }

  /** Returns the updated task, or `undefined` if the id is unknown. */
  function markFailed(event: DownloadFailedEvent): DownloadTask | undefined {
    const task = tasks.value.get(event.taskId);
    if (!task) return undefined;
    task.status = "failed";
    task.errorType = event.errorType;
    task.errorMessage = event.message || "下載失敗";
    task.completedAt = new Date().toISOString();
    return task;
  }

  /** Returns the updated task, or `undefined` if the id is unknown. */
  function markCancelled(event: DownloadCancelledEvent): DownloadTask | undefined {
    const task = tasks.value.get(event.taskId);
    if (!task) return undefined;
    task.status = "cancelled";
    task.completedAt = new Date().toISOString();
    return task;
  }

  /**
   * Asks the backend to cancel. The status changes when `download://cancelled`
   * arrives, not here.
   */
  async function cancelTask(taskId: string) {
    try {
      await invoke("cancel_download", { taskId });
    } catch (e) {
      throw toAppError(e);
    }
  }

  function removeTask(taskId: string) {
    tasks.value.delete(taskId);
  }

  /** Re-runs a finished task with its original parameters, replacing its card. */
  async function retryTask(taskId: string): Promise<string | undefined> {
    const task = tasks.value.get(taskId);
    if (!task) return undefined;
    const newId = await startDownload(task.url, task.quality, task.outputPath, {
      title: task.title,
      thumbnail: task.thumbnail,
    });
    removeTask(taskId);
    return newId;
  }

  return {
    tasks,
    taskList,
    activeCount,
    startDownload,
    updateProgress,
    markCompleted,
    markFailed,
    markCancelled,
    cancelTask,
    removeTask,
    retryTask,
  };
});

function isFinished(task: DownloadTask): boolean {
  return task.status === "completed" || task.status === "failed" || task.status === "cancelled";
}
