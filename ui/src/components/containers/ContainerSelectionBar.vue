<script setup lang="ts">
import { computed, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useContainerSelection } from '../../composables/useContainerSelection';
import { useDependencyGraph } from '../../composables/useDependencyGraph';
import type { Container } from '../../types/container';
import type { BulkRowState, BulkUpdatePlan } from '../../utils/bulk-update-plan';
import { planBulkUpdate } from '../../utils/bulk-update-plan';
import type { TranslateFn } from '../../utils/container-update';
import { hasRawUpdateCandidate, updateButtonState } from '../../utils/update-eligibility';
import { useContainersViewTemplateContext } from './containersViewTemplateContext';

const {
  containers,
  filteredContainers,
  containerActionsEnabled,
  confirmBulkUpdate,
  isContainerUpdateInProgress,
  isContainerUpdateQueued,
  isContainerRowLocked,
  updateMode: configuredUpdateMode,
  groupKeyForContainer,
} = useContainersViewTemplateContext();
const updateMode = computed(() => configuredUpdateMode?.value ?? 'manual');
const { adjacency } = useDependencyGraph();
const { t } = useI18n();
const { selectedIds, count, clear } = useContainerSelection();

function rowState(container: Container): BulkRowState {
  if (container.bouncer === 'blocked') {
    return 'blocked';
  }
  return updateButtonState(
    container.updateEligibility,
    hasRawUpdateCandidate(container),
    isContainerUpdateInProgress(container) || isContainerUpdateQueued(container),
    updateMode.value,
  );
}

const plan = computed<BulkUpdatePlan>(() =>
  planBulkUpdate({
    selectedIds: selectedIds.value,
    containers: filteredContainers.value,
    allContainers: containers.value,
    adjacency: adjacency.value,
    rowState,
    isRowLocked: isContainerRowLocked,
    groupKeyForContainer,
    t: t as TranslateFn,
  }),
);

function handleUpdate() {
  confirmBulkUpdate(plan.value);
}

onUnmounted(clear);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="containerActionsEnabled && count > 0"
      role="region"
      :aria-label="t('containerComponents.selection.barLabel')"
      data-test="container-selection-bar"
      class="fixed bottom-6 left-1/2 -translate-x-1/2 z-popover w-[calc(100%-2rem)] max-w-lg dd-bg-elevated dd-text dd-rounded shadow-lg px-4 py-3 flex items-center justify-between gap-3"
    >
      <span class="text-2xs-plus font-semibold">
        {{ t('containerComponents.selection.count', { count }) }}
      </span>
      <div class="flex items-center gap-2">
        <AppButton
          size="sm"
          variant="secondary"
          data-test="container-selection-clear"
          @click="clear"
        >
          {{ t('containerComponents.selection.clear') }}
        </AppButton>
        <AppButton
          size="sm"
          variant="elevated"
          :disabled="plan.dispatch.length === 0"
          data-test="container-selection-update"
          @click="handleUpdate"
        >
          {{ t('containerComponents.selection.updateSelected') }}
        </AppButton>
      </div>
    </div>
  </Teleport>
</template>
