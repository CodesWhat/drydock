<script setup lang="ts">
import { maturityColor } from '../../utils/display';

const props = withDefaults(
  defineProps<{
    maturity: 'fresh' | 'settled' | null;
    tooltip?: string;
    size?: 'sm' | 'md';
  }>(),
  { size: 'md' },
);

function maturityLabel(maturity: 'fresh' | 'settled' | null): 'NEW' | 'MATURE' {
  return maturity === 'fresh' ? 'NEW' : 'MATURE';
}

function fallbackTooltip(maturity: 'fresh' | 'settled' | null): string {
  return maturity === 'fresh' ? 'New update' : 'Mature update';
}
</script>

<template>
  <span
    v-if="props.maturity"
    class="badge uppercase font-bold inline-flex items-center gap-1"
    :class="props.size === 'sm' ? 'px-1.5 py-0 text-3xs' : 'text-3xs'"
    :style="{ backgroundColor: maturityColor(props.maturity).bg, color: maturityColor(props.maturity).text }"
    v-tooltip.top="props.tooltip ?? fallbackTooltip(props.maturity)"
    data-test="update-maturity-badge"
  >
    <AppIcon :name="props.maturity === 'fresh' ? 'flame' : 'clock'" :size="props.size === 'sm' ? 10 : 11" />
    <span class="tracking-wide leading-none">{{ maturityLabel(props.maturity) }}</span>
  </span>
</template>
