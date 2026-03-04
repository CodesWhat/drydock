<script setup lang="ts">
defineProps<{
  progress: { done: number; total: number };
}>();
</script>

<template>
  <span>Scanning {{ progress.done }}/{{ progress.total }}...</span>
</template>
