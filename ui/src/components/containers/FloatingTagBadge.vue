<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import AppBadge from '@/components/AppBadge.vue';

const { t } = useI18n();

const props = defineProps<{
  tagPrecision?: 'specific' | 'floating';
  imageDigestWatch?: boolean;
}>();

const shouldRender = computed(() => props.tagPrecision === 'floating' && !props.imageDigestWatch);
</script>

<template>
  <span
    v-if="shouldRender"
    data-test="floating-tag-badge"
    v-tooltip.top="t('containerComponents.floatingTag.tooltip')"
    class="cursor-help"
  >
    <AppBadge tone="caution" size="xs">{{ t('containerComponents.floatingTag.badgeText') }}</AppBadge>
  </span>
</template>
