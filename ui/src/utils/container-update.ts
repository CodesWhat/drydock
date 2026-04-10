import type { Container, ContainerUpdateOperation } from '../types/container';
import { isNoUpdateAvailableError } from './error';

export type ContainerUpdateRequestResult = 'accepted' | 'stale';

type UpdateOperationSequenceLike = Pick<
  ContainerUpdateOperation,
  'status' | 'updatedAt' | 'batchId' | 'queuePosition' | 'queueTotal'
>;

type UpdateOperationContainerLike = Pick<Container, 'id' | 'updateOperation'>;

function hasPersistedUpdateBatchSequence(operation?: UpdateOperationSequenceLike): boolean {
  return Boolean(
    operation?.batchId &&
      Number.isSafeInteger(operation.queuePosition) &&
      Number.isSafeInteger(operation.queueTotal) &&
      operation.queuePosition > 0 &&
      operation.queueTotal > 0 &&
      operation.queuePosition <= operation.queueTotal,
  );
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

export function createContainerUpdateBatchId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  return typeof randomUUID === 'function'
    ? randomUUID.call(globalThis.crypto)
    : `dd-update-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

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
  return `Started update${count === 1 ? '' : 's'} for ${count} container${count === 1 ? '' : 's'}`;
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
