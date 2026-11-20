<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import AppBadge from '@/components/AppBadge.vue';
import type { Container } from '../../types/container';
import { updateKindColor } from '../../utils/display';
import { getUpdateKindLabel } from '../../utils/update-kind-labels';

const { t } = useI18n();

const props = defineProps<{
  candidates: Container['updateCandidates'];
}>();

// One candidate is just the main update, which the version row already shows.
const visibleCandidates = computed(() =>
  props.candidates && props.candidates.length > 1 ? props.candidates : [],
);
</script>

<template>
  <div
    v-if="visibleCandidates.length > 0"
    class="mt-1.5 px-2.5 py-1.5 dd-rounded text-2xs-plus font-mono"
    :style="{ backgroundColor: 'var(--dd-bg-inset)' }"
    data-test="update-candidates"
  >
    <div class="dd-text-secondary mb-1">{{ t('containerComponents.updateCandidates.title') }}</div>
    <div class="flex items-center gap-1.5 flex-wrap">
      <span
        v-for="candidate in visibleCandidates"
        :key="candidate.kind"
        class="inline-flex items-center gap-1"
        :data-test="`update-candidate-${candidate.kind}`"
      >
        <AppBadge size="xs" :custom="updateKindColor(candidate.kind)">
          {{ getUpdateKindLabel(candidate.kind, t) }}
        </AppBadge>
        <CopyableTag :tag="candidate.tag" class="font-bold dd-text">{{ candidate.tag }}</CopyableTag>
      </span>
    </div>
  </div>
</template>
