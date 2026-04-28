<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

defineProps<{
  progress: { done: number; total: number };
}>();
</script>

<template>
  <span>{{ t('sharedComponents.scanProgressText.scanning', { done: progress.done, total: progress.total }) }}</span>
</template>
