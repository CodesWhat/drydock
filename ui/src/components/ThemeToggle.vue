<script setup lang="ts">
import { computed, ref } from 'vue';
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

const expanded = ref(false);

const cellSize = computed(() => (props.size === 'md' ? 32 : 32));
const iconSize = computed(() => (props.size === 'md' ? 14 : 15));

const activeIndex = computed(() => variants.findIndex((v) => v.id === themeVariant.value));

function select(id: 'light' | 'system' | 'dark', e: MouseEvent) {
  if (themeVariant.value === id) return;
  transitionTheme(() => setThemeVariant(id), e);
  expanded.value = false;
}

function iconColor(id: string) {
  if (id !== themeVariant.value) return 'dd-text-muted';
  return isDark.value ? 'dd-text-info' : id === 'dark' ? 'dd-text-info' : 'dd-text-caution';
}
</script>

<template>
  <div
    class="theme-toggle relative inline-flex items-center overflow-hidden transition-all duration-200 ease-out"
    :style="{ width: expanded ? `${variants.length * cellSize}px` : `${cellSize}px` }"
    @mouseenter="expanded = true"
    @mouseleave="expanded = false"
  >
    <!-- Always render all 3 in fixed order: light, system, dark -->
    <!-- When collapsed, translate so only the active icon is visible -->
    <div
      class="theme-toggle-track inline-flex items-center transition-transform duration-200 ease-out"
      :style="{ transform: expanded ? 'translateX(0)' : `translateX(-${activeIndex * cellSize}px)` }"
    >
      <button
        v-for="v in variants"
        :key="v.id"
        class="flex-shrink-0 flex items-center justify-center rounded-md transition-colors"
        :class="[iconColor(v.id), 'hover:dd-bg-elevated']"
        :style="{ width: `${cellSize}px`, height: `${cellSize}px` }"
        :title="v.id.charAt(0).toUpperCase() + v.id.slice(1)"
        :aria-label="'Switch to ' + v.id + ' theme'"
        :aria-pressed="String(v.id === themeVariant)"
        @click="v.id === themeVariant ? (expanded = !expanded) : select(v.id, $event)"
      >
        <AppIcon :name="v.icon" :size="iconSize" />
      </button>
    </div>
  </div>
</template>
