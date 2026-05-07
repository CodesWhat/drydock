<script setup lang="ts">
import { computed } from 'vue';
import AppIcon from './AppIcon.vue';

type Tone = 'success' | 'danger' | 'warning' | 'caution' | 'info' | 'primary' | 'alt' | 'neutral';
type IndicatorSize = 'xs' | 'sm' | 'md';
type Marker = 'dot' | 'icon' | 'none';

const props = withDefaults(
  defineProps<{
    tone?: Tone;
    label: string | number;
    size?: IndicatorSize;
    marker?: Marker;
    icon?: string;
    uppercase?: boolean;
  }>(),
  {
    tone: 'neutral',
    size: 'sm',
    marker: 'dot',
    uppercase: false,
  },
);

const textClasses: Record<Tone, string> = {
  success: 'dd-text-success',
  danger: 'dd-text-danger',
  warning: 'dd-text-warning',
  caution: 'dd-text-caution',
  info: 'dd-text-info',
  primary: 'dd-text-primary',
  alt: 'dd-text-alt',
  neutral: 'dd-text-neutral',
};

const dotClasses: Record<Tone, string> = {
  success: 'dd-bg-success',
  danger: 'dd-bg-danger',
  warning: 'dd-bg-warning',
  caution: 'dd-bg-caution',
  info: 'dd-bg-info',
  primary: 'dd-bg-primary',
  alt: 'dd-bg-alt',
  neutral: 'dd-bg-neutral',
};

const sizeClasses: Record<IndicatorSize, string> = {
  xs: 'dd-text-indicator-xs',
  sm: 'dd-text-indicator',
  md: 'dd-text-indicator-md',
};

const dotSizeClasses: Record<IndicatorSize, string> = {
  xs: 'h-1.5 w-1.5',
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5',
};

const iconSizes: Record<IndicatorSize, number> = {
  xs: 10,
  sm: 12,
  md: 14,
};

const indicatorClasses = computed(() => [
  'inline-flex min-w-0 items-center gap-1.5 font-semibold',
  sizeClasses[props.size],
  textClasses[props.tone],
  props.uppercase ? 'uppercase tracking-wide' : '',
]);
</script>

<template>
  <span data-test="status-indicator" :class="indicatorClasses">
    <span
      v-if="marker === 'dot'"
      data-test="status-indicator-marker"
      class="shrink-0 rounded-full"
      :class="[dotSizeClasses[size], dotClasses[tone]]"
    />
    <AppIcon
      v-else-if="marker === 'icon' && icon"
      :name="icon"
      :size="iconSizes[size]"
      class="shrink-0"
    />
    <span class="min-w-0 truncate">{{ label }}</span>
  </span>
</template>
