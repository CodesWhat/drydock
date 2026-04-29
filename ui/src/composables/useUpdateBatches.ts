import { ref } from 'vue';

export interface FrozenBatch {
  frozenTotal: number;
  startedAt: number;
  succeededCount: number;
  failedCount: number;
}

const batches = ref(new Map<string, FrozenBatch>());

function captureBatch(groupKey: string, frozenTotal: number) {
  const next = new Map(batches.value);
  next.set(groupKey, {
    frozenTotal,
    startedAt: Date.now(),
    succeededCount: 0,
    failedCount: 0,
  });
  batches.value = next;
}

function clearBatch(groupKey: string) {
  if (!batches.value.has(groupKey)) {
    return;
  }

  const next = new Map(batches.value);
  next.delete(groupKey);
  batches.value = next;
}

function getBatch(groupKey: string) {
  return batches.value.get(groupKey);
}

function incrementSucceeded(groupKey: string) {
  const batch = batches.value.get(groupKey);
  if (!batch) {
    return;
  }
  const next = new Map(batches.value);
  next.set(groupKey, { ...batch, succeededCount: batch.succeededCount + 1 });
  batches.value = next;
}

function incrementFailed(groupKey: string) {
  const batch = batches.value.get(groupKey);
  if (!batch) {
    return;
  }
  const next = new Map(batches.value);
  next.set(groupKey, { ...batch, failedCount: batch.failedCount + 1 });
  batches.value = next;
}

export function useUpdateBatches() {
  return {
    batches,
    captureBatch,
    clearBatch,
    getBatch,
    incrementSucceeded,
    incrementFailed,
  };
}
