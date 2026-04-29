<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { iconButtonIconSizes, iconButtonPixels } from './appIconButtonSizes';
import { useBreakpoints } from '../composables/useBreakpoints';
import { useTheme } from '../theme/useTheme';

const props = withDefaults(
  defineProps<{
    size?: 'sm' | 'md';
  }>(),
  { size: 'sm' },
);

const { t } = useI18n();
const { themeVariant, isDark, setThemeVariant, transitionTheme } = useTheme();
const { windowNarrow } = useBreakpoints();

const variants = [
  { id: 'light' as const, icon: 'sun' },
  { id: 'system' as const, icon: 'monitor' },
  { id: 'dark' as const, icon: 'moon' },
];

const expanded = ref(false);

const cellSize = computed(() => iconButtonPixels[props.size]);
const iconSize = computed(() => iconButtonIconSizes[props.size]);

const activeIndex = computed(() => variants.findIndex((v) => v.id === themeVariant.value));
const activeVariant = computed(() => variants[activeIndex.value]);

function cycle(e: MouseEvent) {
  const next = variants[(activeIndex.value + 1) % variants.length].id;
  transitionTheme(() => setThemeVariant(next), e);
}

function select(id: 'light' | 'system' | 'dark', e: MouseEvent) {
  if (themeVariant.value === id) return;
  transitionTheme(() => setThemeVariant(id), e);
  expanded.value = false;
}

function activeIconColor() {
  return isDark.value
    ? 'dd-text-info'
    : themeVariant.value === 'dark'
      ? 'dd-text-info'
      : 'dd-text-caution';
}

function iconColor(id: string) {
  if (id !== themeVariant.value) return 'dd-text-muted';
  return activeIconColor();
}
</script>

<template>
  <!-- Mobile: single button that cycles on tap -->
  <button
    v-if="windowNarrow"
    class="flex items-center justify-center rounded-md transition-colors"
    :class="[activeIconColor(), 'hover:dd-bg-elevated']"
    :style="{ width: `${cellSize}px`, height: `${cellSize}px` }"
    v-tooltip.top="t('appShell.themeToggle.variantLabel', { label: activeVariant.id.charAt(0).toUpperCase() + activeVariant.id.slice(1) })"
    :aria-label="t('appShell.themeToggle.mobileLabel', { id: activeVariant.id })"
    @click="cycle($event)"
  >
    <AppIcon :name="activeVariant.icon" :size="iconSize" />
  </button>

  <!-- Desktop: expand-on-hover track -->
  <div
    v-else
    class="theme-toggle relative inline-flex items-center overflow-hidden transition-[width,color,background-color,border-color,opacity,transform,box-shadow] duration-200 ease-out"
    :style="{ width: expanded ? `${variants.length * cellSize}px` : `${cellSize}px` }"
    @mouseenter="expanded = true"
    @mouseleave="expanded = false"
  >
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
        v-tooltip.top="t('appShell.themeToggle.variantLabel', { label: v.id.charAt(0).toUpperCase() + v.id.slice(1) })"
        :aria-label="t('appShell.themeToggle.switchTo', { id: v.id })"
        :aria-pressed="String(v.id === themeVariant)"
        @click="v.id === themeVariant ? (expanded = !expanded) : select(v.id, $event)"
      >
        <AppIcon :name="v.icon" :size="iconSize" />
      </button>
    </div>
  </div>
</template>
