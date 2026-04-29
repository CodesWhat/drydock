import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
  type BatchUpdateCompletedPayload,
  type OperationChangedPayload,
  type UpdateAppliedPayload,
  type UpdateFailedPayload,
  useEventStreamStore,
} from './eventStream';

type OperationStatus = 'queued' | 'in-progress' | 'succeeded' | 'failed' | 'rolled-back' | string;

export interface UiUpdateOperation {
  operationId: string;
  containerName?: string;
  containerId?: string;
  newContainerId?: string;
  batchId?: string;
  status: OperationStatus;
  phase?: string;
  error?: string;
  completedAt?: string;
}

export interface UiBatchProgress {
  batchId: string;
  total: number;
  succeeded: number;
  failed: number;
  active: number;
}

export interface FrozenBatch {
  frozenTotal: number;
  startedAt: number;
  succeededCount: number;
  failedCount: number;
}

const ACTIVE_STATUSES = new Set(['queued', 'in-progress']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function getNullableBatchId(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function isActiveOperation(operation: UiUpdateOperation | undefined): boolean {
  return Boolean(operation && ACTIVE_STATUSES.has(operation.status));
}

function normalizeOperationChangedPayload(payload: unknown): OperationChangedPayload | undefined {
  if (!isObject(payload)) {
    return undefined;
  }
  const operationId = getString(payload.operationId);
  const status = getString(payload.status);
  if (!operationId || !status) {
    return undefined;
  }
  return {
    operationId,
    containerName: getString(payload.containerName),
    containerId: getString(payload.containerId),
    newContainerId: getString(payload.newContainerId),
    batchId: getString(payload.batchId),
    status,
    phase: getString(payload.phase),
  };
}

function normalizeUpdateAppliedPayload(payload: unknown): UpdateAppliedPayload | undefined {
  if (!isObject(payload)) {
    return undefined;
  }
  const operationId = getString(payload.operationId);
  const containerName = getString(payload.containerName);
  const containerId = getString(payload.containerId);
  const timestamp = getString(payload.timestamp) || new Date().toISOString();
  if (!operationId || !containerName || !containerId) {
    return undefined;
  }
  return {
    operationId,
    containerId,
    containerName,
    batchId: getNullableBatchId(payload.batchId) ?? null,
    timestamp,
  };
}

function normalizeUpdateFailedPayload(payload: unknown): UpdateFailedPayload | undefined {
  if (!isObject(payload)) {
    return undefined;
  }
  const operationId = getString(payload.operationId);
  const containerName = getString(payload.containerName);
  const containerId = getString(payload.containerId);
  const error = getString(payload.error);
  const phase = getString(payload.phase) || 'failed';
  const timestamp = getString(payload.timestamp) || new Date().toISOString();
  if (!operationId || !containerName || !containerId || !error) {
    return undefined;
  }
  return {
    operationId,
    containerId,
    containerName,
    error,
    phase,
    batchId: getNullableBatchId(payload.batchId) ?? null,
    timestamp,
  };
}

function normalizeBatchCompletedPayload(payload: unknown): BatchUpdateCompletedPayload | undefined {
  if (!isObject(payload)) {
    return undefined;
  }
  const batchId = getString(payload.batchId);
  if (!batchId || !Array.isArray(payload.items)) {
    return undefined;
  }
  return {
    batchId,
    total: typeof payload.total === 'number' ? payload.total : payload.items.length,
    succeeded: typeof payload.succeeded === 'number' ? payload.succeeded : 0,
    failed: typeof payload.failed === 'number' ? payload.failed : 0,
    durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : 0,
    timestamp: getString(payload.timestamp) || new Date().toISOString(),
    items: payload.items
      .filter(isObject)
      .map((item) => ({
        operationId: getString(item.operationId) || '',
        containerId: getString(item.containerId) || '',
        containerName: getString(item.containerName) || '',
        status: item.status === 'succeeded' ? 'succeeded' : 'failed',
      }))
      .filter((item) => item.operationId !== ''),
  };
}

export const useOperationStore = defineStore('operations', () => {
  const byId = ref<Record<string, UiUpdateOperation>>({});
  const batchSummaries = ref<Record<string, UiBatchProgress>>({});
  const displayBatches = ref(new Map<string, FrozenBatch>());
  let unsubscribeEventStream: Array<() => void> = [];

  function upsertOperation(operation: UiUpdateOperation): void {
    byId.value = {
      ...byId.value,
      [operation.operationId]: {
        ...byId.value[operation.operationId],
        ...operation,
      },
    };
  }

  function applyOperationChanged(payload: OperationChangedPayload): void {
    if (!payload.operationId) {
      return;
    }
    upsertOperation({
      operationId: payload.operationId,
      containerName: payload.containerName,
      containerId: payload.containerId,
      newContainerId: payload.newContainerId,
      batchId: payload.batchId,
      status: payload.status,
      phase: payload.phase,
    });
  }

  function applyUpdateApplied(payload: UpdateAppliedPayload): void {
    upsertOperation({
      operationId: payload.operationId,
      containerId: payload.containerId,
      containerName: payload.containerName,
      batchId: payload.batchId || undefined,
      status: 'succeeded',
      phase: 'succeeded',
      completedAt: payload.timestamp,
    });
  }

  function applyUpdateFailed(payload: UpdateFailedPayload): void {
    upsertOperation({
      operationId: payload.operationId,
      containerId: payload.containerId,
      containerName: payload.containerName,
      batchId: payload.batchId || undefined,
      status: 'failed',
      phase: payload.phase,
      error: payload.error,
      completedAt: payload.timestamp,
    });
  }

  function applyBatchCompleted(payload: BatchUpdateCompletedPayload): void {
    batchSummaries.value = {
      ...batchSummaries.value,
      [payload.batchId]: {
        batchId: payload.batchId,
        total: payload.total,
        succeeded: payload.succeeded,
        failed: payload.failed,
        active: 0,
      },
    };

    for (const item of payload.items) {
      upsertOperation({
        operationId: item.operationId,
        containerId: item.containerId,
        containerName: item.containerName,
        batchId: payload.batchId,
        status: item.status,
        phase: item.status,
        completedAt: payload.timestamp,
      });
    }
  }

  function getOperationByContainerId(containerId: string): UiUpdateOperation | undefined {
    return Object.values(byId.value).find(
      (operation) =>
        isActiveOperation(operation) &&
        (operation.containerId === containerId || operation.newContainerId === containerId),
    );
  }

  function getBatchProgress(batchId: string): UiBatchProgress | undefined {
    const displayBatch = displayBatches.value.get(batchId);
    if (displayBatch) {
      return {
        batchId,
        total: displayBatch.frozenTotal,
        succeeded: displayBatch.succeededCount,
        failed: displayBatch.failedCount,
        active: Math.max(
          0,
          displayBatch.frozenTotal - displayBatch.succeededCount - displayBatch.failedCount,
        ),
      };
    }

    const summary = batchSummaries.value[batchId];
    if (summary) {
      return summary;
    }

    const operations = Object.values(byId.value).filter(
      (operation) => operation.batchId === batchId,
    );
    if (operations.length === 0) {
      return undefined;
    }
    return {
      batchId,
      total: operations.length,
      succeeded: operations.filter((operation) => operation.status === 'succeeded').length,
      failed: operations.filter(
        (operation) => operation.status === 'failed' || operation.status === 'rolled-back',
      ).length,
      active: operations.filter(isActiveOperation).length,
    };
  }

  function replaceDisplayBatches(next: Map<string, FrozenBatch>): void {
    displayBatches.value = new Map(next);
  }

  function captureDisplayBatch(groupKey: string, frozenTotal: number): void {
    const next = new Map(displayBatches.value);
    next.set(groupKey, {
      frozenTotal,
      startedAt: Date.now(),
      succeededCount: 0,
      failedCount: 0,
    });
    displayBatches.value = next;
  }

  function clearDisplayBatch(groupKey: string): void {
    if (!displayBatches.value.has(groupKey)) {
      return;
    }
    const next = new Map(displayBatches.value);
    next.delete(groupKey);
    displayBatches.value = next;
  }

  function getDisplayBatch(groupKey: string): FrozenBatch | undefined {
    return displayBatches.value.get(groupKey);
  }

  function incrementDisplayBatch(groupKey: string, field: 'succeededCount' | 'failedCount'): void {
    const batch = displayBatches.value.get(groupKey);
    if (!batch) {
      return;
    }
    const next = new Map(displayBatches.value);
    next.set(groupKey, { ...batch, [field]: batch[field] + 1 });
    displayBatches.value = next;
  }

  function start(): void {
    if (unsubscribeEventStream.length > 0) {
      return;
    }

    const eventStream = useEventStreamStore();
    unsubscribeEventStream = [
      eventStream.subscribe('update-operation-changed', (payload) => {
        const normalized = normalizeOperationChangedPayload(payload);
        if (normalized) {
          applyOperationChanged(normalized);
        }
      }),
      eventStream.subscribe('update-applied', (payload) => {
        const normalized = normalizeUpdateAppliedPayload(payload);
        if (normalized) {
          applyUpdateApplied(normalized);
        }
      }),
      eventStream.subscribe('update-failed', (payload) => {
        const normalized = normalizeUpdateFailedPayload(payload);
        if (normalized) {
          applyUpdateFailed(normalized);
        }
      }),
      eventStream.subscribe('batch-update-completed', (payload) => {
        const normalized = normalizeBatchCompletedPayload(payload);
        if (normalized) {
          applyBatchCompleted(normalized);
        }
      }),
    ];
  }

  function stop(): void {
    for (const unsubscribe of unsubscribeEventStream) {
      unsubscribe();
    }
    unsubscribeEventStream = [];
  }

  return {
    byId,
    batchSummaries,
    displayBatches,
    start,
    stop,
    applyOperationChanged,
    applyUpdateApplied,
    applyUpdateFailed,
    applyBatchCompleted,
    captureDisplayBatch,
    clearDisplayBatch,
    getDisplayBatch,
    incrementDisplayBatchFailed: (groupKey: string) =>
      incrementDisplayBatch(groupKey, 'failedCount'),
    incrementDisplayBatchSucceeded: (groupKey: string) =>
      incrementDisplayBatch(groupKey, 'succeededCount'),
    replaceDisplayBatches,
    getOperationByContainerId,
    getBatchProgress,
  };
});
