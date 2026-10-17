<template>
  <article class="flex gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm" :data-status="task.status">
    <img v-if="task.thumbnail" :src="task.thumbnail" alt="" class="h-16 w-28 shrink-0 rounded-md bg-gray-100 object-cover" />
    <div v-else class="h-16 w-28 shrink-0 rounded-md bg-gray-100" />

    <div class="min-w-0 flex-1 space-y-2">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="truncate text-sm font-semibold text-gray-900" :title="task.title || task.url">
            {{ task.title || task.url }}
          </h3>
          <p class="truncate text-xs text-gray-500" :title="task.outputPath">
            {{ qualityLabel(task.quality) }} · {{ task.outputPath }}
          </p>
        </div>

        <div class="flex shrink-0 gap-2">
          <button
            v-if="isActive"
            type="button"
            :disabled="cancelling"
            class="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            @click="cancel"
          >
            {{ cancelling ? "取消中…" : "取消" }}
          </button>
          <template v-else>
            <button
              v-if="task.status === 'completed' && task.filePath"
              type="button"
              class="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
              @click="reveal"
            >
              開啟檔案位置
            </button>
            <button
              v-if="task.status === 'failed' || task.status === 'cancelled'"
              type="button"
              :disabled="retrying"
              class="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              @click="retry"
            >
              重試
            </button>
            <button
              type="button"
              aria-label="移除"
              class="rounded-md px-2 py-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              @click="downloadTasks.removeTask(task.id)"
            >
              ✕
            </button>
          </template>
        </div>
      </div>

      <div
        class="h-2 overflow-hidden rounded-full bg-gray-100"
        role="progressbar"
        :aria-valuenow="Math.round(barPercent)"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div
          class="h-full rounded-full transition-[width] duration-300"
          :class="[barColor, task.status === 'pending' ? 'animate-pulse' : '']"
          :style="{ width: `${barPercent}%` }"
        />
      </div>

      <p class="text-xs" :class="statusTextColor" data-testid="status-line">
        <template v-if="task.status === 'pending'">準備中…</template>
        <template v-else-if="task.status === 'downloading'">
          {{ task.percent.toFixed(1) }}%
          <span v-if="task.segment > 1">（第 {{ task.segment }} 段）</span>
          <span v-if="speed"> · {{ speed }}</span>
          <span v-if="task.etaSeconds > 0"> · 剩餘 {{ formatDuration(task.etaSeconds) }}</span>
        </template>
        <template v-else-if="task.status === 'completed'">已完成</template>
        <template v-else-if="task.status === 'cancelled'">已取消</template>
        <template v-else>⚠ {{ task.errorMessage || "下載失敗" }}</template>
      </p>
      <p v-if="actionError" role="alert" class="text-xs text-red-600">{{ actionError }}</p>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

import type { DownloadTask } from "@/types";
import { useDownloadTaskStore } from "@/stores/downloadTask";
import { describeError, toAppError } from "@/utils/appError";
import { formatDuration, formatSpeed, qualityLabel } from "@/utils/format";

const props = defineProps<{ task: DownloadTask }>();

const downloadTasks = useDownloadTaskStore();
const cancelling = ref(false);
const retrying = ref(false);
const actionError = ref("");

const isActive = computed(() => props.task.status === "pending" || props.task.status === "downloading");
const speed = computed(() => formatSpeed(props.task.speedBytes));

const barPercent = computed(() => {
  switch (props.task.status) {
    case "pending":
      return 100;
    case "completed":
      return 100;
    default:
      return props.task.percent;
  }
});
const barColor = computed(() => {
  switch (props.task.status) {
    case "pending":
      return "bg-blue-200";
    case "completed":
      return "bg-green-500";
    case "failed":
      return "bg-red-400";
    case "cancelled":
      return "bg-gray-300";
    default:
      return "bg-blue-600";
  }
});
const statusTextColor = computed(() => {
  switch (props.task.status) {
    case "completed":
      return "text-green-700";
    case "failed":
      return "text-red-600";
    default:
      return "text-gray-500";
  }
});

async function run(action: () => Promise<unknown>) {
  actionError.value = "";
  try {
    await action();
  } catch (e) {
    actionError.value = describeError(toAppError(e));
  }
}

async function cancel() {
  cancelling.value = true;
  await run(() => downloadTasks.cancelTask(props.task.id));
  // On success the card switches to "cancelled" when the event arrives.
  if (actionError.value) cancelling.value = false;
}

async function retry() {
  retrying.value = true;
  await run(() => downloadTasks.retryTask(props.task.id));
  retrying.value = false;
}

function reveal() {
  return run(() => invoke("open_folder", { path: props.task.filePath }));
}
</script>
