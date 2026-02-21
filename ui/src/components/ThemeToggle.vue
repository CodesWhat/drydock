<script setup lang="ts">
import { computed } from 'vue';
import { useTheme } from '../theme/useTheme';

const props = withDefaults(
  defineProps<{
    size?: 'sm' | 'md';
  }>(),
  { size: 'sm' },
);

const { themeVariant, isDark, setThemeVariant, transitionTheme } = useTheme();

const variants = [
  { id: 'light' as const, icon: 'sun' },
  { id: 'system' as const, icon: 'monitor' },
  { id: 'dark' as const, icon: 'moon' },
];

const activeIndex = computed(() => variants.findIndex((v) => v.id === themeVariant.value));

const cellSize = computed(() => (props.size === 'md' ? 32 : 24));
const iconSize = computed(() => (props.size === 'md' ? 14 : 11));
const pad = computed(() => (props.size === 'md' ? 3 : 2));

function select(id: 'light' | 'system' | 'dark', e: MouseEvent) {
  if (themeVariant.value === id) return;
  transitionTheme(() => setThemeVariant(id), e);
}
</script>

<template>
  <div
    class="theme-toggle dd-rounded-lg relative inline-flex items-center"
    :style="{
      padding: `${pad}px`,
      backgroundColor: 'var(--dd-bg-inset)',
      border: '1px solid var(--dd-border-strong)',
    }"
  >
    <!-- Sliding indicator -->
    <div
      class="theme-toggle-indicator dd-rounded absolute transition-transform duration-200 ease-out"
      :style="{
        width: `${cellSize}px`,
        height: `${cellSize}px`,
        top: `${pad}px`,
        left: `${pad}px`,
        transform: `translateX(${activeIndex * cellSize}px)`,
        backgroundColor: 'var(--dd-bg-card)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
      }"
    />

    <!-- Option buttons -->
    <button
      v-for="v in variants"
      :key="v.id"
      class="relative z-[1] flex items-center justify-center transition-colors"
      :style="{ width: `${cellSize}px`, height: `${cellSize}px` }"
      :class="themeVariant === v.id
        ? (isDark ? 'dd-text-info' : v.id === 'dark' ? 'dd-text-info' : 'dd-text-caution')
        : 'dd-text-muted'"
      :title="v.id.charAt(0).toUpperCase() + v.id.slice(1)"
      @click="select(v.id, $event)"
    >
      <AppIcon :name="v.icon" :size="iconSize" />
    </button>
  </div>
</template>
