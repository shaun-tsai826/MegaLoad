<template>
  <section class="space-y-3">
    <div class="flex items-baseline justify-between">
      <h2 class="text-sm font-semibold text-gray-700">下載任務</h2>
      <p v-if="downloadTasks.activeCount > 0" class="text-xs text-gray-500">
        {{ downloadTasks.activeCount }} 個進行中
      </p>
    </div>

    <p
      v-if="downloadTasks.taskList.length === 0"
      class="rounded-xl border border-dashed border-gray-300 py-10 text-center text-sm text-gray-400"
    >
      目前沒有下載任務。貼上網址並按「解析影片」開始。
    </p>
    <template v-else>
      <DownloadTaskCard v-for="task in downloadTasks.taskList" :key="task.id" :task="task" />
    </template>
  </section>
</template>

<script setup lang="ts">
import DownloadTaskCard from "@/components/DownloadTaskCard.vue";
import { useDownloadTaskStore } from "@/stores/downloadTask";

const downloadTasks = useDownloadTaskStore();
</script>
