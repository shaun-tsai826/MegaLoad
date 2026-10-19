<template>
  <section class="space-y-4">
    <div class="flex items-center justify-between">
      <p class="text-sm text-gray-500">共 {{ history.records.length }} 筆</p>
      <div v-if="history.records.length > 0" class="flex items-center gap-2">
        <template v-if="confirmingClear">
          <span class="text-sm text-gray-700">確定清除全部歷史？已下載的檔案不會被刪除。</span>
          <button
            type="button"
            class="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
            @click="clearAll"
          >
            確定清除
          </button>
          <button
            type="button"
            class="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            @click="confirmingClear = false"
          >
            取消
          </button>
        </template>
        <button
          v-else
          type="button"
          class="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
          @click="confirmingClear = true"
        >
          清除全部歷史
        </button>
      </div>
    </div>

    <p v-if="error" role="alert" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>

    <p v-if="history.isLoading && history.records.length === 0" class="py-16 text-center text-sm text-gray-400">
      讀取中…
    </p>
    <p v-else-if="history.records.length === 0" class="py-16 text-center text-sm text-gray-400">
      尚無下載歷史記錄
    </p>

    <div v-else class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <table class="w-full table-fixed text-left text-sm">
        <thead class="bg-gray-50 text-xs text-gray-500">
          <tr>
            <th class="w-24 px-4 py-2 font-medium">縮圖</th>
            <th class="px-4 py-2 font-medium">標題</th>
            <th class="w-24 px-4 py-2 font-medium">畫質</th>
            <th class="w-36 px-4 py-2 font-medium">時間</th>
            <th class="w-20 px-4 py-2 font-medium">狀態</th>
            <th class="w-64 px-4 py-2 font-medium text-right">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="record in history.pagedRecords" :key="record.id" :data-id="record.id">
            <td class="px-4 py-3">
              <img v-if="record.thumbnail" :src="record.thumbnail" alt="" class="h-10 w-16 rounded bg-gray-100 object-cover" />
              <div v-else class="h-10 w-16 rounded bg-gray-100" />
            </td>
            <td class="px-4 py-3">
              <p class="truncate font-medium text-gray-900" :title="record.url">{{ record.title }}</p>
              <p class="truncate text-xs text-gray-500" :title="record.filePath ?? record.outputPath">
                {{ record.filePath ?? record.outputPath }}
              </p>
              <p v-if="record.errorMessage" class="truncate text-xs text-red-600" :title="record.errorMessage">
                {{ record.errorMessage }}
              </p>
            </td>
            <td class="px-4 py-3 text-gray-700">{{ qualityLabel(record.quality) }}</td>
            <td class="px-4 py-3 text-gray-700">{{ formatDateTime(record.completedAt ?? record.createdAt) }}</td>
            <td class="px-4 py-3">
              <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="STATUS_BADGES[record.status].class">
                {{ STATUS_BADGES[record.status].label }}
              </span>
            </td>
            <td class="px-4 py-3">
              <div v-if="confirmingOverwriteId === record.id" class="flex flex-wrap items-center justify-end gap-2">
                <span class="text-xs text-amber-700">檔案已存在，要覆蓋嗎？</span>
                <button
                  type="button"
                  class="rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700"
                  @click="startRedownload(record, true)"
                >
                  覆蓋下載
                </button>
                <button
                  type="button"
                  class="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
                  @click="confirmingOverwriteId = null"
                >
                  取消
                </button>
              </div>
              <div v-else class="flex justify-end gap-2">
                <button
                  v-if="record.status === 'completed' && record.filePath"
                  type="button"
                  class="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
                  @click="reveal(record.filePath)"
                >
                  開啟位置
                </button>
                <button
                  v-if="record.status === 'completed'"
                  type="button"
                  :disabled="checkingId === record.id"
                  class="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  @click="redownload(record)"
                >
                  重新下載
                </button>
                <button
                  v-if="record.status !== 'completed'"
                  type="button"
                  class="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
                  @click="retry(record)"
                >
                  重試
                </button>
                <button
                  type="button"
                  class="rounded-md px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                  @click="remove(record.id)"
                >
                  清除
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <PaginationBar
      v-if="history.records.length > PAGE_SIZE_OPTIONS[0]"
      :page="history.currentPage"
      :total-pages="history.totalPages"
      :page-size="history.pageSize"
      :total="history.records.length"
      :range="history.pageRange"
      @update:page="history.setPage"
      @update:page-size="history.setPageSize"
    />
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { invoke } from "@tauri-apps/api/core";

import PaginationBar from "@/components/PaginationBar.vue";
import type { HistoryRecord } from "@/types";
import { useHistoryStore } from "@/stores/history";
import { describeError, toAppError } from "@/utils/appError";
import { formatDateTime, qualityLabel } from "@/utils/format";
import { PAGE_SIZE_OPTIONS } from "@/utils/pagination";

const STATUS_BADGES: Record<HistoryRecord["status"], { label: string; class: string }> = {
  completed: { label: "已完成", class: "bg-green-100 text-green-700" },
  failed: { label: "失敗", class: "bg-red-100 text-red-700" },
  cancelled: { label: "已取消", class: "bg-gray-100 text-gray-600" },
};

const history = useHistoryStore();
const router = useRouter();
const error = ref("");
const confirmingClear = ref(false);
/** Record whose file still exists and is waiting for the overwrite confirmation. */
const confirmingOverwriteId = ref<string | null>(null);
/** Record whose file is being checked, to disable its button meanwhile. */
const checkingId = ref<string | null>(null);

async function run(action: () => Promise<unknown>) {
  error.value = "";
  try {
    await action();
  } catch (e) {
    error.value = describeError(toAppError(e));
  }
}

onMounted(() => run(() => history.loadHistory()));

function remove(id: string) {
  return run(() => history.deleteRecord(id));
}

async function clearAll() {
  await run(() => history.clearAll());
  confirmingClear.value = false;
}

function reveal(path: string) {
  return run(() => invoke("open_folder", { path }));
}

/** Restarts the download, then goes home so the new task's progress is visible. */
async function retry(record: HistoryRecord) {
  await run(async () => {
    await history.retryDownload(record);
    await router.push("/");
  });
}

/**
 * Re-downloads a completed record. If its file is still on disk, asks before
 * overwriting it (otherwise yt-dlp would skip the download as already done).
 */
async function redownload(record: HistoryRecord) {
  confirmingOverwriteId.value = null;
  checkingId.value = record.id;
  let exists = false;
  try {
    exists = await history.fileExists(record);
  } catch (e) {
    error.value = describeError(toAppError(e));
    return;
  } finally {
    checkingId.value = null;
  }
  if (exists) confirmingOverwriteId.value = record.id;
  else await startRedownload(record, false);
}

async function startRedownload(record: HistoryRecord, overwrite: boolean) {
  confirmingOverwriteId.value = null;
  await run(async () => {
    await history.redownload(record, { overwrite });
    await router.push("/");
  });
}
</script>
