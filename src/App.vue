<template>
  <RouterView />
</template>

<script setup lang="ts">
import { RouterView } from "vue-router";
import { useTauriEvents } from "@/composables/useTauriEvents";

useTauriEvents();
</script>
