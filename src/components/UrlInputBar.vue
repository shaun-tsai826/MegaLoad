<template>
  <section class="space-y-2">
    <form class="flex gap-2" @submit.prevent="urlInput.parseVideo()">
      <input
        type="text"
        :value="urlInput.url"
        placeholder="貼上 YouTube、X/Twitter、Bilibili 等影片網址"
        aria-label="影片網址"
        autocomplete="off"
        spellcheck="false"
        class="flex-1 rounded-lg border bg-white px-4 py-2.5 text-sm text-gray-800 outline-none focus:ring-2"
        :class="
          urlInput.validationState === 'invalid'
            ? 'border-red-400 focus:ring-red-200'
            : 'border-gray-300 focus:ring-blue-200'
        "
        @input="urlInput.setUrl(($event.target as HTMLInputElement).value)"
      />
      <button
        type="submit"
        :disabled="!urlInput.canParse"
        class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        <svg
          v-if="urlInput.isParsing"
          data-testid="parse-spinner"
          class="h-4 w-4 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" class="opacity-25" />
          <path d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" stroke-width="4" stroke-linecap="round" />
        </svg>
        {{ urlInput.isParsing ? "解析中…" : "解析影片" }}
      </button>
    </form>

    <p v-if="urlInput.validationState === 'invalid'" class="text-sm text-red-600">
      網址格式不正確，請輸入 http:// 或 https:// 開頭的網址。
    </p>
    <p
      v-else-if="urlInput.parseError"
      role="alert"
      class="rounded-lg px-3 py-2 text-sm"
      :class="
        urlInput.parseError.type === 'AuthRequired'
          ? 'bg-amber-50 text-amber-800'
          : 'bg-red-50 text-red-700'
      "
    >
      {{ describeError(urlInput.parseError) }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { useUrlInputStore } from "@/stores/urlInput";
import { describeError } from "@/utils/appError";

const urlInput = useUrlInputStore();
</script>
