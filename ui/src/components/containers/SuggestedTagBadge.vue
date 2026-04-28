<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { suggestedTagColor } from '../../utils/display';

const { t } = useI18n();

const props = defineProps<{
  tag: string | undefined;
  currentTag: string;
}>();

const isLatestOrUntagged = computed(() => {
  const currentTag = (props.currentTag ?? '').toLowerCase();
  return currentTag === 'latest' || currentTag === '';
});

const shouldShow = computed(() => !!props.tag && isLatestOrUntagged.value);

const tooltip = computed(() => {
  const hint = t('containerComponents.suggestedTag.tooltip');
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
    <span>{{ t('containerComponents.suggestedTag.badgeText') }}</span>
  </span>
</template>
