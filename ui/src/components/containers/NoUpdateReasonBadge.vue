<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    reason: string;
    variant?: 'icon' | 'inline';
    size?: number;
  }>(),
  { variant: 'icon', size: 14 },
);
</script>

<template>
  <span
    v-if="props.reason"
    data-test="no-update-reason-badge"
    v-tooltip.top="props.reason"
    :aria-label="props.reason"
    class="inline-flex items-center shrink-0"
    :class="props.variant === 'inline' ? 'gap-1 px-1.5 py-0.5 dd-rounded-sm text-2xs' : ''"
    :style="
      props.variant === 'inline'
        ? { backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }
        : { color: 'var(--dd-warning)' }
    "
  >
    <AppIcon name="warning" :size="props.size" class="shrink-0" />
    <span v-if="props.variant === 'inline'" class="whitespace-normal break-words">{{ props.reason }}</span>
  </span>
</template>
