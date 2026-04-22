<script setup lang="ts">
import { computed } from 'vue';
import { suggestedTagColor } from '../../utils/display';

const props = defineProps<{
  tag: string | undefined;
  currentTag: string;
}>();

const isLatestOrUntagged = computed(() => {
  const t = (props.currentTag ?? '').toLowerCase();
  return t === 'latest' || t === '';
});

const shouldShow = computed(() => !!props.tag && isLatestOrUntagged.value);

const tooltip = computed(() => {
  const hint = 'Best stable semver tag available \u2014 consider pinning';
  return props.tag ? `Suggested: ${props.tag}\n${hint}` : hint;
});

const colors = suggestedTagColor();
</script>

<template>
  <span
    v-if="shouldShow"
    class="badge text-3xs font-bold inline-flex items-center gap-1"
    :style="{ backgroundColor: colors.bg, color: colors.text }"
    v-tooltip.top="tooltip"
    data-test="suggested-tag-badge"
  >
    <AppIcon name="tag" :size="10" class="shrink-0" />
    <span>Suggested</span>
  </span>
</template>
