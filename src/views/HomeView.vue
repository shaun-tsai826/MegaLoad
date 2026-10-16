<template>
  <div class="min-h-screen bg-gray-50">
    <!-- Navigation bar -->
    <nav class="bg-white shadow-sm px-6 py-4 flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-800">Video Downloader</h1>
      <RouterLink
        to="/history"
        class="text-blue-600 hover:text-blue-800 text-sm font-medium"
      >
        歷史記錄
      </RouterLink>
    </nav>

    <!-- Main content -->
    <main class="max-w-3xl mx-auto px-6 py-8">
      <!-- URL Input, VideoPreview, and DownloadList components will be assembled here -->
      <p class="text-gray-400 text-center text-sm mt-16">
        請在上方輸入影音 URL 開始使用
      </p>
    </main>
  </div>
</template>

<script setup lang="ts">
import { RouterLink } from "vue-router";
</script>
