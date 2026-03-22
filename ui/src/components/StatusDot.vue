<script setup lang="ts">
import { computed } from 'vue';

type Status = 'connected' | 'disconnected' | 'running' | 'stopped' | 'warning' | 'idle';

interface Props {
  status?: Status;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
  pulse?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
  pulse: false,
});

const sizeClass: Record<string, string> = {
  sm: 'w-1.5 h-1.5',
  md: 'w-2 h-2',
  lg: 'w-2.5 h-2.5',
};

const statusColorMap: Record<Status, string> = {
  connected: 'var(--dd-success)',
  running: 'var(--dd-success)',
  disconnected: 'var(--dd-danger)',
  stopped: 'var(--dd-danger)',
  warning: 'var(--dd-warning)',
  idle: 'var(--dd-text-muted)',
};

const resolvedColor = computed(() => {
  if (props.color) return props.color;
  if (props.status) return statusColorMap[props.status];
  return 'var(--dd-text-muted)';
});
</script>

<template>
  <span
    :class="['rounded-full shrink-0 inline-block', sizeClass[props.size], props.pulse && 'animate-pulse']"
    :style="{ backgroundColor: resolvedColor }"
    role="presentation"
  />
</template>
