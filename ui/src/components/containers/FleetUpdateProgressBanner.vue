<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useFleetUpdateProgress } from '../../composables/useFleetUpdateProgress';

// Only the first few running container names are named directly; beyond
// that the line grows unbounded with a large fleet, which is exactly the
// scenario this banner exists for.
const MAX_NAMED_RUNNING_CONTAINERS = 3;

const { t } = useI18n();
const { activeBatches } = useFleetUpdateProgress();

function doneCount(batch: { succeeded: number; failed: number }): number {
  return batch.succeeded + batch.failed;
}

function runningLabel(batch: { activeContainerNames: string[] }): string | undefined {
  if (batch.activeContainerNames.length === 0) {
    return undefined;
  }
  const named = batch.activeContainerNames.slice(0, MAX_NAMED_RUNNING_CONTAINERS);
  const more = batch.activeContainerNames.length - named.length;
  return more > 0
    ? t('containerComponents.listContent.fleetUpdateProgressRunningMore', {
        names: named.join(', '),
        more,
      })
    : t('containerComponents.listContent.fleetUpdateProgressRunning', { names: named.join(', ') });
}
</script>

<template>
  <div
    v-for="batch in activeBatches"
    :key="batch.batchId"
    class="mb-3 px-3 py-2 text-2xs-plus dd-rounded"
    :style="{ backgroundColor: 'var(--dd-primary-muted)', color: 'var(--dd-primary)' }"
    data-test="fleet-update-progress">
    <div>
      {{ t('containerComponents.listContent.fleetUpdateProgress', { done: doneCount(batch), total: batch.total }) }}
    </div>
    <div v-if="runningLabel(batch)" class="dd-text-muted">{{ runningLabel(batch) }}</div>
  </div>
</template>
