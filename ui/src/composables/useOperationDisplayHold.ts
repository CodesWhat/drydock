import { shallowRef, triggerRef } from 'vue';
import type { Container, ContainerUpdateOperation } from '../types/container';

export const OPERATION_DISPLAY_HOLD_MS = 1500;
export const OPERATION_ACTIVE_HOLD_MS = 10 * 60 * 1000;

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
  currentTag: Container['currentTag'];
  image: Container['image'];
  imageCreated?: Container['imageCreated'];
}

interface OperationDisplayHoldRecord {
  containerIds: string[];
  containerName?: string;
  displayUntil: number;
  operation: ContainerUpdateOperation;
  /** Pre-operation sort-field values; stabilises sort position during the docker recreate window. */
  sortSnapshot?: ContainerSortSnapshot;
}

// shallowRef + in-place Map mutation with triggerRef — avoids allocating a
// fresh Map on every set/remove. The ref identity stays stable; only the
// internal Map is mutated, and triggerRef notifies reactive subscribers.
// This is O(1) per mutation instead of O(N) copy, and matters because
// projectContainerDisplayState (called for every container in displayContainers)
// reads heldOperations.value — so every set/remove used to invalidate the
// computed for ALL N containers.
const heldOperations = shallowRef(new Map<string, OperationDisplayHoldRecord>());
const releaseTimers = new Map<string, ReturnType<typeof setTimeout>>();

function setHeldOperation(operationId: string, hold: OperationDisplayHoldRecord) {
  heldOperations.value.set(operationId, hold);
  triggerRef(heldOperations);
}

function removeHeldOperation(operationId: string) {
  if (heldOperations.value.delete(operationId)) {
    triggerRef(heldOperations);
  }
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
  const displayUntil = (args.now ?? Date.now()) + OPERATION_ACTIVE_HOLD_MS;

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
    const now = args.now ?? Date.now();
    const nextHold = {
      ...updateHoldTargets(heldOperations.value.get(operationId)!, args),
      displayUntil: now + OPERATION_DISPLAY_HOLD_MS,
    };
    setHeldOperation(operationId, nextHold);
    clearReleaseTimer(operationId);

    scheduled = true;
    releaseTimers.set(
      operationId,
      setTimeout(() => {
        releaseTimers.delete(operationId);
        removeHeldOperation(operationId);
      }, OPERATION_DISPLAY_HOLD_MS),
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
      sortSnapshot.newTag !== container.newTag ||
      sortSnapshot.currentTag !== container.currentTag ||
      sortSnapshot.image !== container.image ||
      sortSnapshot.imageCreated !== container.imageCreated);

  return {
    ...container,
    updateOperation: held.operation,
    ...(needsSortFields
      ? {
          status: sortSnapshot.status,
          updateKind: sortSnapshot.updateKind,
          newTag: sortSnapshot.newTag,
          currentTag: sortSnapshot.currentTag,
          image: sortSnapshot.image,
          imageCreated: sortSnapshot.imageCreated,
        }
      : {}),
  } as T;
}

function clearAllOperationDisplayHolds() {
  for (const timer of releaseTimers.values()) {
    clearTimeout(timer);
  }
  releaseTimers.clear();
  if (heldOperations.value.size > 0) {
    heldOperations.value.clear();
    triggerRef(heldOperations);
  }
}

/**
 * Safety net for missed terminal SSEs: active holds now live for 10 minutes so the
 * row stays stable through a full recreate, but if the terminal SSE is ever lost
 * (reconnect, stream hiccup), the hold would otherwise stay up for the full window.
 * After each container list reload, fold any hold whose matching container has no
 * active operation in the raw API response into the short settle window — so the
 * row releases within ~1.5s of the next refresh instead of 10 minutes.
 */
function reconcileHoldsAgainstContainers(
  containers: readonly Pick<Container, 'id' | 'name' | 'updateOperation'>[],
  now?: number,
) {
  const currentNow = now ?? Date.now();
  for (const [operationId, hold] of heldOperations.value.entries()) {
    const remainingActiveWindow = hold.displayUntil - currentNow;
    if (remainingActiveWindow <= OPERATION_DISPLAY_HOLD_MS) {
      continue;
    }
    const match = containers.find((container) => holdMatchesTarget(hold, container));
    if (!match) {
      continue;
    }
    const rawStatus = match.updateOperation?.status;
    const rawIsActive = rawStatus === 'queued' || rawStatus === 'in-progress';
    if (rawIsActive) {
      continue;
    }
    scheduleHeldOperationRelease({
      operationId,
      containerId: hold.containerIds[0],
      containerName: hold.containerName,
      now: currentNow,
    });
  }
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
    reconcileHoldsAgainstContainers,
    scheduleHeldOperationRelease,
  };
}
