<template>
  <div class="min-h-screen bg-gray-50">
    <!-- Navigation bar -->
    <nav class="bg-white shadow-sm px-6 py-4 flex items-center gap-4">
      <RouterLink
        to="/"
        class="text-blue-600 hover:text-blue-800 text-sm font-medium"
      >
        ← 返回首頁
      </RouterLink>
      <h1 class="text-xl font-semibold text-gray-800">下載歷史記錄</h1>
    </nav>

    <!-- Main content -->
    <main class="max-w-5xl mx-auto px-6 py-8">
      <!-- HistoryPage component will be assembled here -->
      <p class="text-gray-400 text-center text-sm mt-16">尚無下載歷史記錄</p>
    </main>
  </div>
</template>

<script setup lang="ts">
import { RouterLink } from "vue-router";
</script>
