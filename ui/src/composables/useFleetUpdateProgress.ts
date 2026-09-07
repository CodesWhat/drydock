import { createPinia, getActivePinia, setActivePinia } from 'pinia';
import { computed } from 'vue';
import { type UiBatchProgress, useOperationStore } from '@/stores/operations';

let fallbackPinia: ReturnType<typeof createPinia> | undefined;

function getStore() {
  if (!getActivePinia()) {
    fallbackPinia ||= createPinia();
    setActivePinia(fallbackPinia);
  }
  return useOperationStore();
}

/**
 * Reactive list of fleet-wide update batches currently in flight (2+
 * containers, at least one still queued or in-progress), derived from the
 * same SSE-fed operation store the per-group "Update All" progress already
 * reads. Self-cleaning: a batch drops out of the list once its last
 * operation reaches a terminal status.
 */
export function useFleetUpdateProgress() {
  const store = getStore();
  const activeBatches = computed<UiBatchProgress[]>(() => store.getActiveBatchProgress());
  return { activeBatches };
}
