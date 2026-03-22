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

const colors = suggestedTagColor();
</script>

<template>
  <span
    v-if="shouldShow"
    class="badge text-3xs font-bold inline-flex items-center gap-1"
    :style="{ backgroundColor: colors.bg, color: colors.text }"
    v-tooltip.top="'Best stable semver tag available \u2014 consider pinning'"
    data-test="suggested-tag-badge"
  >
    <AppIcon name="tag" :size="10" />
    Suggested: {{ props.tag }}
  </span>
</template>
