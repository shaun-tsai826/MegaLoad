<template>
  <section
    v-if="urlInput.hasMetadata && metadata"
    class="flex gap-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
  >
    <img
      v-if="metadata.thumbnail"
      :src="metadata.thumbnail"
      alt=""
      class="h-28 w-48 shrink-0 rounded-lg bg-gray-100 object-cover"
    />
    <div v-else class="h-28 w-48 shrink-0 rounded-lg bg-gray-100" />

    <div class="min-w-0 flex-1 space-y-4">
      <div>
        <h2 class="truncate text-base font-semibold text-gray-900" :title="metadata.title">
          {{ metadata.title }}
        </h2>
        <p class="text-sm text-gray-500">
          {{ metadata.uploader }}
          <span v-if="metadata.duration > 0"> · {{ formatDuration(metadata.duration) }}</span>
        </p>
      </div>

      <fieldset>
        <legend class="mb-2 text-xs font-medium text-gray-500">畫質</legend>
        <div class="flex flex-wrap gap-2">
          <label
            v-for="q in qualities"
            :key="q"
            class="cursor-pointer rounded-lg border px-3 py-1.5 text-sm"
            :class="
              urlInput.selectedQuality === q
                ? 'border-blue-600 bg-blue-50 text-blue-700'
                : 'border-gray-300 text-gray-700 hover:border-gray-400'
            "
          >
            <input v-model="urlInput.selectedQuality" type="radio" name="quality" :value="q" class="sr-only" />
            {{ qualityLabel(q) }}
          </label>
        </div>
      </fieldset>

      <div>
        <p class="mb-2 text-xs font-medium text-gray-500">儲存位置</p>
        <div class="flex gap-2">
          <p
            data-testid="selected-path"
            class="flex-1 truncate rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-700"
            :title="urlInput.selectedPath"
          >
            {{ urlInput.selectedPath || "（讀取中…）" }}
          </p>
          <button
            type="button"
            class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            @click="changeFolder"
          >
            變更路徑
          </button>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <button
          type="button"
          :disabled="!canStart"
          class="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          @click="start"
        >
          {{ starting ? "啟動中…" : "開始下載" }}
        </button>
        <p v-if="error" role="alert" class="text-sm text-red-600">{{ error }}</p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import { useDownloadTaskStore } from "@/stores/downloadTask";
import { useUrlInputStore } from "@/stores/urlInput";
import { describeError, toAppError } from "@/utils/appError";
import { formatDuration, qualityLabel } from "@/utils/format";
import { QUALITY_PRIORITY } from "@/utils/quality";

const urlInput = useUrlInputStore();
const downloadTasks = useDownloadTaskStore();

const starting = ref(false);
const error = ref("");

const metadata = computed(() => urlInput.metadata);
/** Available options in priority order (1080p first). */
const qualities = computed(() =>
  QUALITY_PRIORITY.filter((q) => metadata.value?.availableQualities.includes(q)),
);
const canStart = computed(
  () => !starting.value && urlInput.selectedQuality !== null && urlInput.selectedPath !== "",
);

onMounted(async () => {
  try {
    await urlInput.loadDefaultPath();
  } catch (e) {
    error.value = `無法取得預設下載資料夾：${describeError(toAppError(e))}`;
  }
});

async function changeFolder() {
  error.value = "";
  try {
    await urlInput.selectFolder();
  } catch (e) {
    error.value = describeError(toAppError(e));
  }
}

async function start() {
  if (!canStart.value || !metadata.value || !urlInput.selectedQuality) return;
  starting.value = true;
  error.value = "";
  try {
    await downloadTasks.startDownload(urlInput.url.trim(), urlInput.selectedQuality, urlInput.selectedPath, {
      title: metadata.value.title,
      thumbnail: metadata.value.thumbnail,
    });
    // Ready for the next URL right away (Requirement 4.1).
    urlInput.reset();
  } catch (e) {
    error.value = describeError(toAppError(e));
  } finally {
    starting.value = false;
  }
}
</script>
