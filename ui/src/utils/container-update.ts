import type { ContainerUpdateOperation } from '../types/container';
import { isNoUpdateAvailableError } from './error';

export type ContainerUpdateRequestResult = 'accepted' | 'stale';

type UpdateOperationSequenceLike = Pick<
  ContainerUpdateOperation,
  'status' | 'updatedAt' | 'batchId' | 'queuePosition' | 'queueTotal'
>;

type UpdateOperationContainerLike = {
  id: string;
  updateOperation?: UpdateOperationSequenceLike;
};

function hasPersistedUpdateBatchId(operation?: UpdateOperationSequenceLike): boolean {
  return Boolean(operation?.batchId);
}

function hasPersistedUpdateQueuePosition(operation?: UpdateOperationSequenceLike): boolean {
  const queuePosition = operation?.queuePosition;
  return Number.isSafeInteger(queuePosition) && queuePosition > 0;
}

function hasPersistedUpdateQueueTotal(operation?: UpdateOperationSequenceLike): boolean {
  const queueTotal = operation?.queueTotal;
  return Number.isSafeInteger(queueTotal) && queueTotal > 0;
}

function hasPersistedUpdateQueueOrder(operation?: UpdateOperationSequenceLike): boolean {
  const queuePosition = operation?.queuePosition;
  const queueTotal = operation?.queueTotal;
  if (!hasPersistedUpdateQueuePosition(operation) || !hasPersistedUpdateQueueTotal(operation)) {
    return false;
  }

  return queuePosition! <= queueTotal!;
}

function hasPersistedUpdateBatchSequence(operation?: UpdateOperationSequenceLike): boolean {
  return hasPersistedUpdateBatchId(operation) && hasPersistedUpdateQueueOrder(operation);
}

function isStandaloneQueuedUpdateOperation(operation?: UpdateOperationSequenceLike): boolean {
  return operation?.status === 'queued' && !hasPersistedUpdateBatchSequence(operation);
}

function getPersistedBatchHeadIds(
  containers: readonly UpdateOperationContainerLike[],
): Set<string> {
  const queuedHeads = new Map<string, { id: string; position: number }>();

  for (const container of containers) {
    const operation = container.updateOperation;
    // In-progress operations are handled before this helper runs.
    if (
      operation?.status !== 'queued' ||
      !hasPersistedUpdateBatchSequence(operation) ||
      !operation.batchId
    ) {
      continue;
    }

    const currentHead = queuedHeads.get(operation.batchId);
    if (!currentHead || operation.queuePosition! < currentHead.position) {
      queuedHeads.set(operation.batchId, {
        id: container.id,
        position: operation.queuePosition!,
      });
    }
  }

  return new Set(Array.from(queuedHeads.values(), ({ id }) => id));
}

function parseUpdateOperationTimestamp(updatedAt?: string): number {
  if (typeof updatedAt !== 'string') {
    return Number.POSITIVE_INFINITY;
  }

  const parsed = Date.parse(updatedAt);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

export function shouldRenderStandaloneQueuedUpdateAsUpdating(args: {
  containers: readonly UpdateOperationContainerLike[];
  operation?: UpdateOperationSequenceLike;
  targetId?: string;
  hasExternalActiveHead?: boolean;
}): boolean {
  if (!isStandaloneQueuedUpdateOperation(args.operation)) {
    return false;
  }

  if (args.hasExternalActiveHead === true) {
    return false;
  }

  const hasActivePredecessor = args.containers.some(
    (container) =>
      container.id !== args.targetId && container.updateOperation?.status === 'in-progress',
  );
  if (hasActivePredecessor) {
    return false;
  }

  const persistedBatchHeadIds = getPersistedBatchHeadIds(args.containers);
  if ([...persistedBatchHeadIds].some((id) => id !== args.targetId)) {
    return false;
  }

  let headId: string | undefined;
  let headTimestamp = Number.POSITIVE_INFINITY;

  for (const container of args.containers) {
    if (!isStandaloneQueuedUpdateOperation(container.updateOperation)) {
      continue;
    }

    const candidateTimestamp = parseUpdateOperationTimestamp(container.updateOperation?.updatedAt);
    if (candidateTimestamp < headTimestamp) {
      headTimestamp = candidateTimestamp;
      headId = container.id;
    }
  }

  if (!headId) {
    return true;
  }

  return headId === args.targetId;
}

export type UpdateInProgressPhaseLabelKey =
  | 'pulling'
  | 'scanning'
  | 'generatingSbom'
  | 'updating'
  | 'healthChecking'
  | 'finalizing'
  | 'rollingBack';

export function getUpdateInProgressPhaseLabelKey(
  phase: string | undefined,
): UpdateInProgressPhaseLabelKey {
  switch (phase) {
    case 'pulling':
      return 'pulling';
    case 'scanning':
      return 'scanning';
    case 'sbom-generating':
      return 'generatingSbom';
    case 'health-gate':
      return 'healthChecking';
    case 'health-gate-passed':
      return 'finalizing';
    case 'rollback-started':
    case 'rollback-deferred':
      return 'rollingBack';
    default:
      return 'updating';
  }
}

/** Maps every UpdateInProgressPhaseLabelKey to its i18n message path. */
export const UPDATE_IN_PROGRESS_PHASE_I18N: Record<UpdateInProgressPhaseLabelKey, string> = {
  pulling: 'containerComponents.groupedViews.statusPulling',
  scanning: 'containerComponents.groupedViews.statusScanningPhase',
  generatingSbom: 'containerComponents.groupedViews.statusGeneratingSbom',
  updating: 'containerComponents.groupedViews.statusUpdating',
  healthChecking: 'containerComponents.groupedViews.statusHealthChecking',
  finalizing: 'containerComponents.groupedViews.statusFinalizing',
  rollingBack: 'containerComponents.groupedViews.statusRollingBack',
};

export function isStaleContainerUpdateError(error: unknown): boolean {
  return isNoUpdateAvailableError(error);
}

export function getContainerUpdateStartedMessage(name: string): string {
  return `Update started: ${name}`;
}

export function getForceContainerUpdateStartedMessage(name: string): string {
  return `Force update started: ${name}`;
}

export function getContainerAlreadyUpToDateMessage(name: string): string {
  return `Already up to date: ${name}`;
}

export function formatContainerUpdateStartedCountMessage(count: number): string {
  return `Queued update${count === 1 ? '' : 's'} for ${count} container${count === 1 ? '' : 's'}`;
}

export function formatContainersAlreadyUpToDateMessage(count: number): string {
  return `${count} container${count === 1 ? '' : 's'} already up to date`;
}

export async function runContainerUpdateRequest(args: {
  request: () => Promise<unknown>;
  onAccepted?: () => void | Promise<void>;
  onStale?: () => void | Promise<void>;
  isStaleError?: (error: unknown) => boolean;
}): Promise<ContainerUpdateRequestResult> {
  try {
    await args.request();
    await args.onAccepted?.();
    return 'accepted';
  } catch (error: unknown) {
    if (args.isStaleError?.(error) !== true) {
      throw error;
    }
    await args.onStale?.();
    return 'stale';
  }
}
