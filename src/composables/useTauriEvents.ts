import { onMounted, onUnmounted } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

import type {
  DownloadCancelledEvent,
  DownloadCompletedEvent,
  DownloadFailedEvent,
  DownloadProgressEvent,
  DownloadTask,
} from "@/types";
import { toHistoryRecord, useDownloadTaskStore } from "@/stores/downloadTask";
import { useHistoryStore } from "@/stores/history";

/** Shows a system notification; asks for permission the first time. Never throws. */
async function notifyCompleted(title: string) {
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) sendNotification({ title: "下載完成", body: title });
  } catch (e) {
    console.warn("無法發送系統通知：", e);
  }
}

/**
 * Subscribes to all `download://` events and routes them to the stores.
 * Resolves to a function that removes every listener.
 */
export async function registerDownloadEvents(): Promise<UnlistenFn> {
  const downloadTaskStore = useDownloadTaskStore();
  const historyStore = useHistoryStore();

  function recordFinished(task: DownloadTask | undefined) {
    const record = task && toHistoryRecord(task);
    if (record) historyStore.appendRecord(record);
  }

  const unlisteners = await Promise.all([
    listen<DownloadProgressEvent>("download://progress", (e) => {
      downloadTaskStore.updateProgress(e.payload);
    }),
    listen<DownloadCompletedEvent>("download://completed", (e) => {
      const task = downloadTaskStore.markCompleted(e.payload);
      recordFinished(task);
      void notifyCompleted(task?.title || e.payload.title);
    }),
    listen<DownloadFailedEvent>("download://failed", (e) => {
      recordFinished(downloadTaskStore.markFailed(e.payload));
    }),
    listen<DownloadCancelledEvent>("download://cancelled", (e) => {
      recordFinished(downloadTaskStore.markCancelled(e.payload));
    }),
  ]);

  return () => unlisteners.forEach((unlisten) => unlisten());
}

/**
 * Registers the download event listeners for the lifetime of the calling
 * component. Call once from `App.vue`.
 */
export function useTauriEvents() {
  let unlisten: UnlistenFn | null = null;
  let unmounted = false;

  onMounted(async () => {
    const fn = await registerDownloadEvents();
    // The component may have unmounted while `listen` was still resolving.
    if (unmounted) fn();
    else unlisten = fn;
  });

  onUnmounted(() => {
    unmounted = true;
    unlisten?.();
    unlisten = null;
  });
}
