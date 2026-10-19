<template>
  <nav class="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600" aria-label="分頁">
    <div class="flex items-center gap-2">
      <span data-testid="page-range">第 {{ range.from }}–{{ range.to }} 筆，共 {{ total }} 筆</span>
      <label class="flex items-center gap-1">
        每頁
        <select
          :value="pageSize"
          aria-label="每頁顯示筆數"
          class="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700"
          @change="emit('update:pageSize', Number(($event.target as HTMLSelectElement).value) as PageSize)"
        >
          <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">{{ size }}</option>
        </select>
        筆
      </label>
    </div>

    <div v-if="totalPages > 1" class="flex items-center gap-1">
      <button
        type="button"
        aria-label="上一頁"
        :disabled="page <= 1"
        class="rounded-md px-2 py-1 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent"
        @click="emit('update:page', page - 1)"
      >
        ‹
      </button>
      <template v-for="(item, i) in pageWindow(page, totalPages)" :key="`${item}-${i}`">
        <span v-if="item === '…'" class="px-1 text-gray-400">…</span>
        <button
          v-else
          type="button"
          :aria-current="item === page ? 'page' : undefined"
          class="min-w-8 rounded-md px-2 py-1"
          :class="item === page ? 'bg-blue-600 font-medium text-white' : 'hover:bg-gray-100'"
          @click="emit('update:page', item)"
        >
          {{ item }}
        </button>
      </template>
      <button
        type="button"
        aria-label="下一頁"
        :disabled="page >= totalPages"
        class="rounded-md px-2 py-1 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent"
        @click="emit('update:page', page + 1)"
      >
        ›
      </button>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { PAGE_SIZE_OPTIONS, pageWindow, type PageSize } from "@/utils/pagination";

defineProps<{
  page: number;
  totalPages: number;
  pageSize: PageSize;
  total: number;
  range: { from: number; to: number };
}>();

const emit = defineEmits<{
  "update:page": [page: number];
  "update:pageSize": [size: PageSize];
}>();
</script>
