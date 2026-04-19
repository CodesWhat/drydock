import { ref } from 'vue';
import type { Container, ContainerUpdateOperation } from '../types/container';

export const OPERATION_DISPLAY_HOLD_MS = 1500;

interface OperationDisplayHoldTarget {
  containerId?: string;
  newContainerId?: string;
  containerName?: string;
}

/** Frozen snapshot of sort-affecting container fields captured at hold start. */
export interface ContainerSortSnapshot {
  status: Container['status'];
  updateKind: Container['updateKind'];
  newTag: Container['newTag'];
}

interface OperationDisplayHoldRecord {
  containerIds: string[];
  containerName?: string;
  displayUntil: number;
  operation: ContainerUpdateOperation;
  /** Pre-operation sort-field values; stabilises sort position during the docker recreate window. */
  sortSnapshot?: ContainerSortSnapshot;
}

const heldOperations = ref(new Map<string, OperationDisplayHoldRecord>());
const releaseTimers = new Map<string, ReturnType<typeof setTimeout>>();

function setHeldOperation(operationId: string, hold: OperationDisplayHoldRecord) {
  const next = new Map(heldOperations.value);
  next.set(operationId, hold);
  heldOperations.value = next;
}

function removeHeldOperation(operationId: string) {
  const next = new Map(heldOperations.value);
  next.delete(operationId);
  heldOperations.value = next;
}

function clearReleaseTimer(operationId: string) {
  const timer = releaseTimers.get(operationId);
  if (timer === undefined) {
    return;
  }
  clearTimeout(timer);
  releaseTimers.delete(operationId);
}

function normalizeContainerIds(
  existingIds: readonly string[] = [],
  containerId?: string,
  newContainerId?: string,
) {
  return [...new Set([...existingIds, containerId, newContainerId].filter(Boolean))] as string[];
}

function holdMatchesTarget(
  hold: OperationDisplayHoldRecord,
  target: string | Pick<Container, 'id' | 'name'> | OperationDisplayHoldTarget,
) {
  const targetIds =
    typeof target === 'string'
      ? []
      : [
          'id' in target ? target.id : undefined,
          'containerId' in target ? target.containerId : undefined,
          'newContainerId' in target ? target.newContainerId : undefined,
        ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  if (targetIds.some((id) => hold.containerIds.includes(id))) {
    return true;
  }

  const targetName =
    typeof target === 'string'
      ? target
      : 'name' in target && typeof target.name === 'string' && target.name.length > 0
        ? target.name
        : 'containerName' in target &&
            typeof target.containerName === 'string' &&
            target.containerName.length > 0
          ? target.containerName
          : undefined;

  return (
    typeof targetName === 'string' && targetName.length > 0 && hold.containerName === targetName
  );
}

function findMatchingOperationIds(target: OperationDisplayHoldTarget & { operationId?: string }) {
  if (typeof target.operationId === 'string' && heldOperations.value.has(target.operationId)) {
    return [target.operationId];
  }

  const matches: string[] = [];
  for (const [operationId, hold] of heldOperations.value.entries()) {
    if (holdMatchesTarget(hold, target)) {
      matches.push(operationId);
    }
  }
  return matches;
}

function dropConflictingHolds(target: OperationDisplayHoldTarget & { operationId: string }) {
  for (const operationId of findMatchingOperationIds(target)) {
    if (operationId === target.operationId) {
      continue;
    }
    clearReleaseTimer(operationId);
    removeHeldOperation(operationId);
  }
}

function updateHoldTargets(hold: OperationDisplayHoldRecord, target: OperationDisplayHoldTarget) {
  return {
    ...hold,
    containerIds: normalizeContainerIds(
      hold.containerIds,
      target.containerId,
      target.newContainerId,
    ),
    containerName:
      typeof target.containerName === 'string' && target.containerName.length > 0
        ? target.containerName
        : hold.containerName,
  };
}

function getHeldOperation(
  target: string | Pick<Container, 'id' | 'name'> | OperationDisplayHoldTarget,
) {
  const now = Date.now();
  for (const hold of heldOperations.value.values()) {
    if (hold.displayUntil <= now) {
      continue;
    }
    if (holdMatchesTarget(hold, target)) {
      return hold.operation;
    }
  }
  return undefined;
}

function holdOperationDisplay(args: {
  operationId: string;
  operation: ContainerUpdateOperation;
  containerId?: string;
  newContainerId?: string;
  containerName?: string;
  sortSnapshot?: ContainerSortSnapshot;
  now?: number;
}) {
  dropConflictingHolds(args);
  clearReleaseTimer(args.operationId);

  const existing = heldOperations.value.get(args.operationId);
  const displayUntil =
    existing?.displayUntil ?? (args.now ?? Date.now()) + OPERATION_DISPLAY_HOLD_MS;

  setHeldOperation(args.operationId, {
    containerIds: normalizeContainerIds(
      existing?.containerIds,
      args.containerId,
      args.newContainerId,
    ),
    containerName:
      typeof args.containerName === 'string' && args.containerName.length > 0
        ? args.containerName
        : existing?.containerName,
    displayUntil,
    operation: args.operation,
    sortSnapshot: args.sortSnapshot ?? existing?.sortSnapshot,
  });
}

function scheduleHeldOperationRelease(args: {
  operationId?: string;
  containerId?: string;
  newContainerId?: string;
  containerName?: string;
  now?: number;
}) {
  const operationIds = findMatchingOperationIds(args);
  let scheduled = false;

  for (const operationId of operationIds) {
    const nextHold = updateHoldTargets(heldOperations.value.get(operationId)!, args);
    setHeldOperation(operationId, nextHold);

    const remaining = nextHold.displayUntil - (args.now ?? Date.now());
    clearReleaseTimer(operationId);

    if (remaining <= 0) {
      removeHeldOperation(operationId);
      continue;
    }

    scheduled = true;
    releaseTimers.set(
      operationId,
      setTimeout(() => {
        releaseTimers.delete(operationId);
        removeHeldOperation(operationId);
      }, remaining),
    );
  }

  return scheduled;
}

function clearHeldOperation(args: {
  operationId?: string;
  containerId?: string;
  newContainerId?: string;
  containerName?: string;
}) {
  for (const operationId of findMatchingOperationIds(args)) {
    clearReleaseTimer(operationId);
    removeHeldOperation(operationId);
  }
}

function getDisplayUpdateOperation(
  target: string | Pick<Container, 'id' | 'name' | 'updateOperation'>,
) {
  return (
    getHeldOperation(target) ?? (typeof target === 'string' ? undefined : target.updateOperation)
  );
}

function getHeldState(
  target: Pick<Container, 'id' | 'name'>,
): { operation: ContainerUpdateOperation; sortSnapshot?: ContainerSortSnapshot } | undefined {
  const now = Date.now();
  for (const hold of heldOperations.value.values()) {
    if (hold.displayUntil <= now) {
      continue;
    }
    if (holdMatchesTarget(hold, target)) {
      return { operation: hold.operation, sortSnapshot: hold.sortSnapshot };
    }
  }
  return undefined;
}

function projectContainerDisplayState<T extends Container>(container: T): T {
  const held = getHeldState(container);

  if (held === undefined) {
    return container;
  }

  const { sortSnapshot } = held;
  const needsSortFields =
    sortSnapshot !== undefined &&
    (sortSnapshot.status !== container.status ||
      sortSnapshot.updateKind !== container.updateKind ||
      sortSnapshot.newTag !== container.newTag);

  return {
    ...container,
    updateOperation: held.operation,
    ...(needsSortFields
      ? {
          status: sortSnapshot.status,
          updateKind: sortSnapshot.updateKind,
          newTag: sortSnapshot.newTag,
        }
      : {}),
  } as T;
}

function clearAllOperationDisplayHolds() {
  for (const timer of releaseTimers.values()) {
    clearTimeout(timer);
  }
  releaseTimers.clear();
  heldOperations.value = new Map();
}

export function useOperationDisplayHold() {
  return {
    heldOperations,
    clearAllOperationDisplayHolds,
    clearHeldOperation,
    findMatchingOperationIds,
    getDisplayUpdateOperation,
    holdOperationDisplay,
    projectContainerDisplayState,
    scheduleHeldOperationRelease,
  };
}
