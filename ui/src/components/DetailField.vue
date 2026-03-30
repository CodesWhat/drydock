<script setup lang="ts">
interface Props {
  label: string;
  mono?: boolean;
  compact?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  mono: false,
  compact: false,
});
</script>

<template>
  <div>
    <div class="dd-text-label" :class="props.compact ? 'mb-0.5' : 'mb-1'" style="color: var(--dd-text-muted)">
      {{ props.label }}
    </div>
    <div class="text-2xs-plus" :class="[props.mono && 'font-mono']" style="color: var(--dd-text)">
      <slot />
    </div>
  </div>
</template>
