import { createPinia, getActivePinia, setActivePinia } from 'pinia';
import { computed } from 'vue';
import { type FrozenBatch, useOperationStore } from '@/stores/operations';

export type { FrozenBatch };

let fallbackPinia: ReturnType<typeof createPinia> | undefined;

function getStore() {
  if (!getActivePinia()) {
    fallbackPinia ||= createPinia();
    setActivePinia(fallbackPinia);
  }
  return useOperationStore();
}

const batches = computed<Map<string, FrozenBatch>>({
  get: () => getStore().displayBatches,
  set: (next) => getStore().replaceDisplayBatches(next),
});

export function useUpdateBatches() {
  const store = getStore();
  return {
    batches,
    captureBatch: store.captureDisplayBatch,
    clearBatch: store.clearDisplayBatch,
    getBatch: store.getDisplayBatch,
    incrementSucceeded: store.incrementDisplayBatchSucceeded,
    incrementFailed: store.incrementDisplayBatchFailed,
  };
}
