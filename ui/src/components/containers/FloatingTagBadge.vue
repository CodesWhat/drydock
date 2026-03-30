<script setup lang="ts">
import { computed } from 'vue';
import AppBadge from '@/components/AppBadge.vue';

const props = defineProps<{
  tagPrecision?: 'specific' | 'floating';
  imageDigestWatch?: boolean;
}>();

const FLOATING_TAG_TOOLTIP =
  'This tag may be updated in-place by the registry. Enable dd.watch.digest=true or use a full semver tag for complete update detection.';

const shouldRender = computed(() => props.tagPrecision === 'floating' && !props.imageDigestWatch);
</script>

<template>
  <span
    v-if="shouldRender"
    data-test="floating-tag-badge"
    v-tooltip.top="FLOATING_TAG_TOOLTIP"
    class="cursor-help"
  >
    <AppBadge tone="caution" size="xs">floating tag</AppBadge>
  </span>
</template>
