import { defineStore } from 'pinia';
import { ref } from 'vue';
import { getHeldOperation } from '../composables/useOperationDisplayHold';
import type { ContainerUpdateOperation } from '../types/container';
import {
  type ActiveContainerUpdateOperationStatus,
  type ContainerUpdateOperationPhase,
  type ContainerUpdateOperationStatus,
  isActiveContainerUpdateOperationPhaseForStatus,
  isActiveContainerUpdateOperationStatus,
  isContainerUpdateOperationPhase,
  isContainerUpdateOperationStatus,
} from '../types/update-operation';
import { buildContainerIdentityKey } from '../utils/container-action-key';
import {
  type BatchUpdateCompletedPayload,
  type OperationChangedPayload,
  type UpdateAppliedPayload,
  type UpdateFailedPayload,
  useEventStreamStore,
} from './eventStream';

type OperationStatus = ContainerUpdateOperationStatus;
type OperationPhase = ContainerUpdateOperationPhase;

export interface UiUpdateOperation {
  operationId: string;
  containerName?: string;
  containerId?: string;
  newContainerId?: string;
  batchId?: string;
  queuePosition?: number;
  queueTotal?: number;
  status: OperationStatus;
  phase?: OperationPhase;
  error?: string;
  completedAt?: string;
  /** Server value from the container list, else the SSE event receipt time. */
  updatedAt?: string;
  fromVersion?: string;
  toVersion?: string;
  identityKey?: string;
  /** Client epoch ms, stamped on every upsert. */
  lastSeenAt: number;
}

type OperationUpsert = Omit<UiUpdateOperation, 'lastSeenAt'> & { lastSeenAt?: number };

/** Minimal container identity needed to resolve its operation. */
export interface OperationContainerRef {
  id: string;
  identityKey?: string;
  name?: string;
}

export interface UiBatchProgress {
  batchId: string;
  total: number;
  succeeded: number;
  failed: number;
  active: number;
  /**
   * Names of the containers currently queued or in-progress for this batch,
   * in operation order. Only populated by getBatchProgress()'s per-operation
   * path (a live batch derived from byId) — the display-batch and
   * batch-summary paths don't track individual containers, so they report
   * an empty array rather than a fabricated one.
   */
  activeContainerNames: string[];
}

export interface FrozenBatch {
  frozenTotal: number;
  startedAt: number;
  succeededCount: number;
  failedCount: number;
}

/** Terminal operations outside any display batch are dropped after this long. */
const TERMINAL_OPERATION_RETENTION_MS = 30 * 60 * 1000;

const ACTIVE_STATUSES = new Set<OperationStatus>(['queued', 'in-progress']);

/**
 * Monotonic rank for operation statuses. Higher rank = further along the lifecycle.
 */
const STATUS_RANK: Record<OperationStatus, number> = {
  queued: 1,
  'in-progress': 2,
  succeeded: 3,
  failed: 3,
  'rolled-back': 3,
  expired: 3,
  'skipped-dependency': 3,
};

function statusRank(status: OperationStatus): number {
  return STATUS_RANK[status];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function getPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function getOperationPhase(value: unknown): OperationPhase | undefined {
  return isContainerUpdateOperationPhase(value) ? value : undefined;
}

function isActiveOperation(operation: UiUpdateOperation | undefined): boolean {
  return Boolean(operation && ACTIVE_STATUSES.has(operation.status));
}

function getOperationContainerIds(operation: UiUpdateOperation | undefined): string[] {
  if (!operation) {
    return [];
  }

  const ids = new Set<string>();
  if (operation.containerId) {
    ids.add(operation.containerId);
  }
  if (operation.newContainerId) {
    ids.add(operation.newContainerId);
  }
  return [...ids];
}

function getRecordString(record: Record<string, unknown>, key: string): string | undefined {
  return getString(record[key]);
}

/** Same derivation as the container mapper, so a mapped container's identityKey hits the index. */
function deriveRowIdentityKey(row: Record<string, unknown>): string | undefined {
  return buildContainerIdentityKey(row) || getString(row.id) || getString(row.name);
}

/**
 * Validate the `updateOperation` attached to a container list row. Only an
 * active operation with a phase valid for its status and an `updatedAt` is
 * accepted; anything else is treated as "no operation".
 */
function normalizeListOperation(row: unknown): UiUpdateOperation | undefined {
  if (!isObject(row) || !isObject(row.updateOperation)) {
    return undefined;
  }
  const operation = row.updateOperation;
  const operationId = getRecordString(operation, 'id');
  const status = operation.status;
  if (!operationId || !isActiveContainerUpdateOperationStatus(status)) {
    return undefined;
  }
  const phase = operation.phase;
  const updatedAt = getRecordString(operation, 'updatedAt');
  if (!isActiveContainerUpdateOperationPhaseForStatus(status, phase) || !updatedAt) {
    return undefined;
  }
  const batchId = getRecordString(operation, 'batchId');
  const queuePosition = getPositiveInteger(operation.queuePosition);
  const queueTotal = getPositiveInteger(operation.queueTotal);
  const hasBatch = Boolean(batchId && queuePosition && queueTotal && queuePosition <= queueTotal);
  const fromVersion = getRecordString(operation, 'fromVersion');
  const toVersion = getRecordString(operation, 'toVersion');
  const containerId = getString(row.id);
  const containerName = getString(row.name);
  const identityKey = deriveRowIdentityKey(row);

  return {
    operationId,
    status,
    phase,
    updatedAt,
    lastSeenAt: 0,
    ...(containerId ? { containerId } : {}),
    ...(identityKey ? { identityKey } : {}),
    ...(containerName ? { containerName } : {}),
    ...(fromVersion ? { fromVersion } : {}),
    ...(toVersion ? { toVersion } : {}),
    ...(hasBatch ? { batchId, queuePosition, queueTotal } : {}),
  };
}

function toContainerUpdateOperation(operation: UiUpdateOperation): ContainerUpdateOperation {
  // Callers only pass operations resolved through the active indexes.
  const status = operation.status as ActiveContainerUpdateOperationStatus;
  const phase = isActiveContainerUpdateOperationPhaseForStatus(status, operation.phase)
    ? operation.phase
    : status === 'queued'
      ? 'queued'
      : 'pulling';
  return {
    id: operation.operationId,
    status,
    phase,
    updatedAt: operation.updatedAt ?? new Date(operation.lastSeenAt).toISOString(),
    ...(operation.batchId ? { batchId: operation.batchId } : {}),
    ...(operation.queuePosition ? { queuePosition: operation.queuePosition } : {}),
    ...(operation.queueTotal ? { queueTotal: operation.queueTotal } : {}),
    ...(operation.fromVersion ? { fromVersion: operation.fromVersion } : {}),
    ...(operation.toVersion ? { toVersion: operation.toVersion } : {}),
  };
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
  if (!isContainerUpdateOperationStatus(status)) {
    return undefined;
  }
  return {
    operationId,
    containerName: getString(payload.containerName),
    containerId: getString(payload.containerId),
    newContainerId: getString(payload.newContainerId),
    batchId: getString(payload.batchId),
    queuePosition: getPositiveInteger(payload.queuePosition),
    queueTotal: getPositiveInteger(payload.queueTotal),
    status,
    phase: getOperationPhase(payload.phase),
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
    batchId: getString(payload.batchId) ?? null,
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
  const phase = getOperationPhase(payload.phase) ?? 'failed';
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
    batchId: getString(payload.batchId) ?? null,
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
      .map((item): BatchUpdateCompletedPayload['items'][number] => ({
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
  const byContainerId = ref(new Map<string, string>());
  const byIdentityKey = ref(new Map<string, string>());
  /** Container-list row ids that carried an operation owned by another container id (SSE owns the ids). */
  const byListAlias = ref(new Map<string, string>());
  const batchSummaries = ref<Record<string, UiBatchProgress>>({});
  const displayBatches = ref(new Map<string, FrozenBatch>());
  let unsubscribeEventStream: Array<() => void> = [];

  function replaceContainerIndex(
    previous: UiUpdateOperation | undefined,
    next: UiUpdateOperation | undefined,
  ): void {
    const nextIndex = new Map(byContainerId.value);

    for (const containerId of getOperationContainerIds(previous)) {
      if (nextIndex.get(containerId) === previous?.operationId) {
        nextIndex.delete(containerId);
      }
    }

    if (isActiveOperation(next)) {
      for (const containerId of getOperationContainerIds(next)) {
        nextIndex.set(containerId, next.operationId);
      }
    }

    byContainerId.value = nextIndex;

    const nextIdentityIndex = new Map(byIdentityKey.value);
    if (
      previous?.identityKey &&
      nextIdentityIndex.get(previous.identityKey) === previous.operationId
    ) {
      nextIdentityIndex.delete(previous.identityKey);
    }
    if (next && isActiveOperation(next) && next.identityKey) {
      nextIdentityIndex.set(next.identityKey, next.operationId);
    }
    byIdentityKey.value = nextIdentityIndex;

    if (previous && !isActiveOperation(next)) {
      const nextAliasIndex = new Map(byListAlias.value);
      for (const [alias, operationId] of byListAlias.value) {
        if (operationId === previous.operationId) {
          nextAliasIndex.delete(alias);
        }
      }
      byListAlias.value = nextAliasIndex;
    }
  }

  function upsertOperation(input: OperationUpsert): void {
    const operation: UiUpdateOperation = { ...input, lastSeenAt: input.lastSeenAt ?? Date.now() };
    const existing = byId.value[operation.operationId];
    if (!existing) {
      // First insert — no guard needed.
      byId.value = { ...byId.value, [operation.operationId]: operation };
      replaceContainerIndex(undefined, operation);
      return;
    }

    const existingRank = statusRank(existing.status);
    const incomingRank = statusRank(operation.status);
    let nextOperation: UiUpdateOperation;

    if (incomingRank < existingRank) {
      // Stale event: drop status and phase but allow other metadata to merge through.
      const { status: _s, phase: _p, ...rest } = operation;
      nextOperation = { ...existing, ...rest };
      byId.value = {
        ...byId.value,
        [operation.operationId]: nextOperation,
      };
      replaceContainerIndex(existing, nextOperation);
      return;
    }

    if (existingRank === 3 && incomingRank === 3 && operation.status !== existing.status) {
      // Two different terminal statuses — preserve the first; only allow non-status metadata.
      const { status: _s, phase: _p, ...rest } = operation;
      nextOperation = { ...existing, ...rest };
      byId.value = {
        ...byId.value,
        [operation.operationId]: nextOperation,
      };
      replaceContainerIndex(existing, nextOperation);
      return;
    }

    nextOperation = { ...existing, ...operation };
    byId.value = {
      ...byId.value,
      [operation.operationId]: nextOperation,
    };
    replaceContainerIndex(existing, nextOperation);
  }

  function removeOperation(operationId: string): void {
    const existing = byId.value[operationId];
    if (!existing) {
      return;
    }

    const { [operationId]: _removed, ...nextById } = byId.value;
    byId.value = nextById;
    replaceContainerIndex(existing, undefined);
  }

  function applyOperationChanged(payload: OperationChangedPayload): void {
    if (!payload.operationId) {
      return;
    }
    if (!isContainerUpdateOperationStatus(payload.status)) {
      return;
    }
    upsertOperation({
      operationId: payload.operationId,
      containerName: payload.containerName,
      containerId: payload.containerId,
      newContainerId: payload.newContainerId,
      batchId: payload.batchId,
      queuePosition: payload.queuePosition,
      queueTotal: payload.queueTotal,
      status: payload.status,
      phase: getOperationPhase(payload.phase),
      updatedAt: new Date().toISOString(),
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
      updatedAt: payload.timestamp,
    });
  }

  function applyUpdateFailed(payload: UpdateFailedPayload): void {
    upsertOperation({
      operationId: payload.operationId,
      containerId: payload.containerId,
      containerName: payload.containerName,
      batchId: payload.batchId || undefined,
      status: 'failed',
      phase: getOperationPhase(payload.phase) ?? 'failed',
      error: payload.error,
      completedAt: payload.timestamp,
      updatedAt: payload.timestamp,
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
        activeContainerNames: [],
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
        updatedAt: payload.timestamp,
      });
    }
  }

  function getOperationByContainerId(containerId: string): UiUpdateOperation | undefined {
    const operationId = byContainerId.value.get(containerId);
    return operationId ? byId.value[operationId] : undefined;
  }

  function getOperationByListAlias(containerId: string): UiUpdateOperation | undefined {
    const operationId = byListAlias.value.get(containerId);
    return operationId ? byId.value[operationId] : undefined;
  }

  function getOperationByIdentityKey(identityKey: string): UiUpdateOperation | undefined {
    const operationId = byIdentityKey.value.get(identityKey);
    return operationId ? byId.value[operationId] : undefined;
  }

  function findOperationByName(name: string): UiUpdateOperation | undefined {
    // Same rule as holdMatchesTarget: a name-only match is allowed only for
    // operations that carry no container id at all (#411 safety).
    return Object.values(byId.value).find(
      (operation) =>
        isActiveOperation(operation) &&
        !operation.containerId &&
        !operation.newContainerId &&
        operation.containerName === name,
    );
  }

  /**
   * Resolve the active operation for a container: held display op, then
   * container id, then list alias, then identity key, then a guarded name match.
   */
  function getOperationForContainer(
    container: OperationContainerRef,
    options: { ignoreHold?: boolean } = {},
  ): ContainerUpdateOperation | undefined {
    const held = options.ignoreHold ? undefined : getHeldOperation(container);
    if (held) {
      return held;
    }
    const operation =
      getOperationByContainerId(container.id) ??
      getOperationByListAlias(container.id) ??
      (container.identityKey ? getOperationByIdentityKey(container.identityKey) : undefined) ??
      (container.name ? findOperationByName(container.name) : undefined);
    return operation ? toContainerUpdateOperation(operation) : undefined;
  }

  /**
   * `ignoreHold` reads only the store's own indexes. Hold reconciliation needs it:
   * the hold would otherwise report every held container as still active.
   */
  function isContainerUpdateActive(
    container: OperationContainerRef,
    options: { ignoreHold?: boolean } = {},
  ): boolean {
    return getOperationForContainer(container, options) !== undefined;
  }

  function getActiveOperationStatus(
    container: OperationContainerRef,
  ): ContainerUpdateOperation['status'] | undefined {
    return getOperationForContainer(container)?.status;
  }

  function operationAgeAnchor(operation: UiUpdateOperation): number {
    const completed = operation.completedAt ? Date.parse(operation.completedAt) : Number.NaN;
    return Number.isNaN(completed) ? operation.lastSeenAt : completed;
  }

  function batchHasActiveOperation(batchId: string): boolean {
    return Object.values(byId.value).some(
      (candidate) => candidate.batchId === batchId && isActiveOperation(candidate),
    );
  }

  /** Drop terminal operations past retention that belong to no display batch. */
  function pruneTerminalOperations(now: number = Date.now()): void {
    for (const operation of Object.values(byId.value)) {
      if (isActiveOperation(operation)) {
        continue;
      }
      if (operation.batchId && displayBatches.value.has(operation.batchId)) {
        continue;
      }
      // Batch counts are derived from byId; pruning a finished member of a live batch shrinks them.
      if (operation.batchId && batchHasActiveOperation(operation.batchId)) {
        continue;
      }
      if (now - operationAgeAnchor(operation) > TERMINAL_OPERATION_RETENTION_MS) {
        removeOperation(operation.operationId);
      }
    }
  }

  function dropContainerIndexEntry(
    key: string,
    index: 'container' | 'identity' | 'alias',
    seenBefore: number,
  ) {
    const map =
      index === 'container' ? byContainerId : index === 'alias' ? byListAlias : byIdentityKey;
    const operationId = map.value.get(key);
    const operation = operationId ? byId.value[operationId] : undefined;
    if (!operation || !isActiveOperation(operation) || operation.lastSeenAt >= seenBefore) {
      return;
    }
    const next = new Map(map.value);
    next.delete(key);
    map.value = next;
  }

  /**
   * Merge a list row into an operation the store already knows. SSE owns the
   * operation's container ids, so a differing row id becomes a list alias rather
   * than a rewrite (compose replicas can share an operation through the backend
   * identity fallback). A list fetched before the last SSE touch only fills
   * fields the operation is missing.
   */
  function mergeListRowIntoExisting(
    existing: UiUpdateOperation,
    incoming: OperationUpsert,
    requestStartedAt: number,
  ): void {
    const rowContainerId = incoming.containerId;
    const merged: OperationUpsert = { ...incoming };
    delete merged.containerId;
    delete merged.newContainerId;
    if (!existing.containerId && rowContainerId) {
      merged.containerId = rowContainerId;
    }

    if (existing.lastSeenAt >= requestStartedAt) {
      const { status: _s, phase: _p, ...rest } = merged;
      const fill = Object.fromEntries(
        Object.entries(rest).filter(
          ([key]) => existing[key as keyof UiUpdateOperation] === undefined,
        ),
      );
      upsertOperation({
        ...existing,
        ...fill,
        operationId: existing.operationId,
        status: existing.status,
        phase: existing.phase,
      });
    } else {
      upsertOperation(merged);
    }

    const current = byId.value[existing.operationId];
    if (
      rowContainerId &&
      current &&
      isActiveOperation(current) &&
      !getOperationContainerIds(current).includes(rowContainerId)
    ) {
      const nextAliases = new Map(byListAlias.value);
      nextAliases.set(rowContainerId, current.operationId);
      byListAlias.value = nextAliases;
    }
  }

  /**
   * Seed the store from a GET /containers payload. Rows with a valid active
   * operation are upserted (the status-rank guard keeps a stale list from
   * pulling an SSE-terminal operation back to active). For rows without one,
   * an active operation that was last seen before the request started and that
   * the list no longer shows loses its per-container index entry; batch counts
   * are untouched.
   */
  function seedFromContainerList(apiContainers: unknown, requestStartedAt: number): void {
    if (!Array.isArray(apiContainers)) {
      return;
    }
    for (const row of apiContainers) {
      const normalized = normalizeListOperation(row);
      if (normalized) {
        const { lastSeenAt: _ignored, ...incoming } = normalized;
        const existing = byId.value[incoming.operationId];
        if (existing) {
          mergeListRowIntoExisting(existing, incoming, requestStartedAt);
        } else {
          upsertOperation(incoming);
        }
        continue;
      }
      const rowId = isObject(row) ? getString(row.id) : undefined;
      const rowIdentityKey = isObject(row) ? deriveRowIdentityKey(row) : undefined;
      if (rowId) {
        dropContainerIndexEntry(rowId, 'container', requestStartedAt);
        dropContainerIndexEntry(rowId, 'alias', requestStartedAt);
      }
      if (rowIdentityKey) {
        dropContainerIndexEntry(rowIdentityKey, 'identity', requestStartedAt);
      }
    }
    pruneTerminalOperations();
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
        activeContainerNames: [],
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
      activeContainerNames: operations
        .filter((operation) => operation.status === 'in-progress')
        .map((operation) => operation.containerName)
        .filter((name): name is string => Boolean(name)),
    };
  }

  /**
   * Batches with at least one queued/in-progress operation right now,
   * derived purely from byId — the same SSE-fed operation state
   * getBatchProgress() already reads, no new event payload needed. Single-
   * container "batches" (total < 2) are excluded: a lone update already has
   * its own row-level indicator, so surfacing it here would just be noise.
   * Self-cleaning: a batch drops out once its last operation leaves the
   * active statuses, no separate teardown call required.
   */
  function getActiveBatchProgress(): UiBatchProgress[] {
    const batchIds = new Set<string>();
    for (const operation of Object.values(byId.value)) {
      if (operation.batchId) {
        batchIds.add(operation.batchId);
      }
    }

    const progress: UiBatchProgress[] = [];
    for (const batchId of [...batchIds].sort()) {
      const summary = getBatchProgress(batchId);
      if (summary && summary.active > 0 && summary.total >= 2) {
        progress.push(summary);
      }
    }
    return progress;
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
    removeOperation,
    captureDisplayBatch,
    clearDisplayBatch,
    getDisplayBatch,
    incrementDisplayBatchFailed: (groupKey: string) =>
      incrementDisplayBatch(groupKey, 'failedCount'),
    incrementDisplayBatchSucceeded: (groupKey: string) =>
      incrementDisplayBatch(groupKey, 'succeededCount'),
    replaceDisplayBatches,
    getOperationByContainerId,
    getOperationByIdentityKey,
    getOperationByListAlias,
    getOperationForContainer,
    isContainerUpdateActive,
    getActiveOperationStatus,
    seedFromContainerList,
    pruneTerminalOperations,
    getBatchProgress,
    getActiveBatchProgress,
  };
});
