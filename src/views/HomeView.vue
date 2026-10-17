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
    <main class="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <UrlInputBar />
      <VideoPreview />
      <DownloadList />
    </main>
  </div>
</template>

<script setup lang="ts">
import { RouterLink } from "vue-router";

import DownloadList from "@/components/DownloadList.vue";
import UrlInputBar from "@/components/UrlInputBar.vue";
import VideoPreview from "@/components/VideoPreview.vue";
</script>
