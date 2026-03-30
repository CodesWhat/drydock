<script setup lang="ts">
import { computed } from 'vue';

type Tone = 'success' | 'danger' | 'warning' | 'caution' | 'info' | 'primary' | 'alt' | 'neutral';

interface Props {
  tone?: Tone;
  size?: 'xs' | 'sm' | 'md';
  uppercase?: boolean;
  dot?: boolean;
  custom?: { bg: string; text: string };
}

const props = withDefaults(defineProps<Props>(), {
  tone: 'neutral',
  size: 'sm',
  uppercase: true,
  dot: false,
});

const sizeClasses: Record<string, string> = {
  xs: 'text-3xs font-bold',
  sm: 'text-2xs font-semibold',
  md: 'text-2xs-plus font-semibold',
};

const badgeClasses = computed(() => [
  'badge',
  sizeClasses[props.size],
  props.uppercase ? 'uppercase' : '',
]);

const colorStyle = computed(() => {
  if (props.custom) {
    return { backgroundColor: props.custom.bg, color: props.custom.text };
  }
  return {
    backgroundColor: `var(--dd-${props.tone}-muted)`,
    color: `var(--dd-${props.tone})`,
  };
});

const dotStyle = computed(() => {
  if (props.custom) {
    return { backgroundColor: props.custom.text };
  }
  return { backgroundColor: `var(--dd-${props.tone})` };
});
</script>

<template>
  <span :class="badgeClasses" :style="colorStyle">
    <span v-if="dot" class="w-1.5 h-1.5 rounded-full mr-1.5 shrink-0" :style="dotStyle" />
    <slot />
  </span>
</template>
