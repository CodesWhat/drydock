import { ref } from 'vue';

export interface FrozenBatch {
  frozenTotal: number;
  startedAt: number;
}

const batches = ref(new Map<string, FrozenBatch>());

function captureBatch(groupKey: string, frozenTotal: number) {
  const next = new Map(batches.value);
  next.set(groupKey, {
    frozenTotal,
    startedAt: Date.now(),
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

export function useUpdateBatches() {
  return {
    batches,
    captureBatch,
    clearBatch,
    getBatch,
  };
}
