<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { updateInsightColor } from '../../utils/display';

const { t } = useI18n();

const props = defineProps<{
  insight: { tag: string; kind: 'major' | 'minor' | 'patch' } | undefined;
}>();

const shouldShow = computed(() => !!props.insight);

const TOOLTIP_KEY_BY_KIND: Record<'major' | 'minor' | 'patch', string> = {
  major: 'containerComponents.updateInsight.tooltipMajor',
  minor: 'containerComponents.updateInsight.tooltipMinor',
  patch: 'containerComponents.updateInsight.tooltipPatch',
};

const tooltip = computed(() => {
  if (!props.insight) return '';
  return t(TOOLTIP_KEY_BY_KIND[props.insight.kind], { tag: props.insight.tag });
});

const colors = updateInsightColor();
</script>

<template>
  <span
    v-if="shouldShow"
    class="badge text-3xs font-bold inline-flex items-center gap-1 min-w-0 max-w-full"
    :style="{ backgroundColor: colors.bg, color: colors.text }"
    v-tooltip.top="tooltip"
    data-test="update-insight-badge"
  >
    <AppIcon name="info" :size="10" class="shrink-0" />
    <span class="truncate">{{ t('containerComponents.updateInsight.badgeText') }}</span>
  </span>
</template>
