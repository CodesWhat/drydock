<script setup lang="ts">
import { useTheme } from '../theme/useTheme';
import AppIcon from './AppIcon.vue';

defineProps<{
  size?: number;
}>();

const { themeVariant, toggleVariant, transitionTheme } = useTheme();
</script>

<template>
  <button
    class="flex items-center justify-center dd-rounded transition-colors dd-text-secondary hover:dd-bg-elevated"
    :class="themeVariant === 'light' ? 'hover:dd-text-caution' : themeVariant === 'dark' ? 'hover:dd-text-info' : 'hover:dd-text'"
    @click="transitionTheme(() => toggleVariant(), $event)"
  >
    <AppIcon :name="themeVariant === 'system' ? 'monitor' : themeVariant === 'dark' ? 'moon' : 'sun'" :size="size ?? 14" />
  </button>
</template>
