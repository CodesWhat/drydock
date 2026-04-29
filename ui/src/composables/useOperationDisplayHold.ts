import { shallowRef, triggerRef } from 'vue';
import type { Container, ContainerUpdateOperation } from '../types/container';
import {
  type ActiveContainerUpdateOperationPhase,
  type ActiveContainerUpdateOperationStatus,
  type ContainerUpdateOperationStatus,
  isActiveContainerUpdateOperationPhaseForStatus,
  isActiveContainerUpdateOperationStatus,
  isContainerUpdateOperationStatus,
  type TerminalContainerUpdateOperationStatus,
} from '../types/update-operation';

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
  // Captured so the dashboard Updates Available widget keeps its detectedAt-based
  // sort stable while the backend transiently clears `updateAvailable` (and with
  // it `updateDetectedAt`) during an active update.
  updateDetectedAt?: Container['updateDetectedAt'];
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
      sortSnapshot.imageCreated !== container.imageCreated ||
      sortSnapshot.updateDetectedAt !== container.updateDetectedAt);

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
          updateDetectedAt: sortSnapshot.updateDetectedAt,
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

export interface TerminalResolvedArgs {
  operationId: string;
  containerName?: string;
  containerIds: readonly string[];
  hold: OperationDisplayHoldRecord;
}

/**
 * Safety net for missed terminal SSEs: active holds now live for 10 minutes so the
 * row stays stable through a full recreate, but if the terminal SSE is ever lost
 * (reconnect, stream hiccup), the hold would otherwise stay up for the full window.
 * After each container list reload, fold any hold whose matching container has no
 * active operation in the raw API response into the short settle window — so the
 * row releases within ~1.5s of the next refresh instead of 10 minutes.
 *
 * When `onTerminalResolved` is provided, it is invoked before scheduling the
 * release so callers can perform local cleanup. Toasts intentionally remain on
 * the replayable dd:update-applied / dd:update-failed path.
 */
function reconcileHoldsAgainstContainers(
  containers: readonly Pick<Container, 'id' | 'name' | 'updateOperation'>[],
  now?: number,
  onTerminalResolved?: (args: TerminalResolvedArgs) => void | Promise<void>,
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
    if (onTerminalResolved) {
      void onTerminalResolved({
        operationId,
        containerName: hold.containerName,
        containerIds: hold.containerIds,
        hold,
      });
    }
    scheduleHeldOperationRelease({
      operationId,
      containerId: hold.containerIds[0],
      containerName: hold.containerName,
      now: currentNow,
    });
  }
}

export interface ParsedUpdateOperationSse {
  operationId?: string;
  containerId?: string;
  newContainerId?: string;
  containerName?: string;
  status: ContainerUpdateOperationStatus;
  phase?: unknown;
}

/**
 * Validate + normalise a raw `dd:sse-update-operation-changed` payload into the
 * subset of fields the hold map cares about. Returns undefined when the payload
 * is not a recognised update-operation event so callers can short-circuit.
 */
export function parseUpdateOperationSsePayload(raw: unknown): ParsedUpdateOperationSse | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const p = raw as Record<string, unknown>;
  if (!isContainerUpdateOperationStatus(p.status)) {
    return undefined;
  }
  return {
    operationId: typeof p.operationId === 'string' ? p.operationId : undefined,
    containerId: typeof p.containerId === 'string' ? p.containerId : undefined,
    newContainerId: typeof p.newContainerId === 'string' ? p.newContainerId : undefined,
    containerName: typeof p.containerName === 'string' ? p.containerName : undefined,
    status: p.status,
    phase: p.phase,
  };
}

function resolveActiveOperationPhase(args: {
  status: ActiveContainerUpdateOperationStatus;
  phase: unknown;
  previousPhase?: unknown;
}): ActiveContainerUpdateOperationPhase {
  if (isActiveContainerUpdateOperationPhaseForStatus(args.status, args.phase)) {
    return args.phase;
  }
  if (
    args.previousPhase !== undefined &&
    isActiveContainerUpdateOperationPhaseForStatus(args.status, args.previousPhase)
  ) {
    return args.previousPhase;
  }
  return args.status === 'queued' ? 'queued' : 'pulling';
}

/** Subset of Container fields the hold composable reads off the live row. */
export type HoldSourceContainer = Pick<
  Container,
  | 'id'
  | 'name'
  | 'status'
  | 'updateKind'
  | 'newTag'
  | 'currentTag'
  | 'image'
  | 'imageCreated'
  | 'updateDetectedAt'
  | 'updateOperation'
>;

export interface ApplyUpdateOperationSseArgs {
  parsed: ParsedUpdateOperationSse;
  /**
   * Looks up the container that the SSE event refers to from the caller's live
   * data (ContainersView: `containers.value`; DashboardView: the same shared
   * containers ref). Return undefined when the container has already been
   * pruned from the list — the helper still runs the terminal release path so
   * the hold releases even when the row no longer exists.
   */
  resolveContainer: (target: OperationDisplayHoldTarget) => HoldSourceContainer | undefined;
  /**
   * Invoked on active-status events with the computed next operation so the
   * caller can apply view-specific row mutations (ContainersView writes this
   * back onto containers.value[idx].updateOperation to drive its reactivity).
   * Skip providing this if the view re-derives from heldOperations only.
   */
  onActiveOperationComputed?: (args: {
    operationId: string;
    container: HoldSourceContainer;
    nextOperation: ContainerUpdateOperation;
  }) => void;
  /**
   * Invoked on every terminal-status event (succeeded / failed / rolled-back)
   * regardless of whether a hold was tracked. The helper has already called
   * scheduleHeldOperationRelease, so the caller's job is to apply any
   * view-specific row cleanup (e.g. clearing containers.value[idx].updateOperation).
   * Completion toasts are intentionally owned by dd:update-applied / dd:update-failed.
   */
  onTerminalEvent?: (args: {
    container?: HoldSourceContainer;
    status: TerminalContainerUpdateOperationStatus;
    name: string;
    operationId?: string;
  }) => void;
}

/**
 * Shared dispatcher that both ContainersView and DashboardView route their
 * `dd:sse-update-operation-changed` events through. Keeps the hold map, sort
 * snapshot, and terminal release behavior in one place so both views stay in
 * lockstep (previously DashboardView had only a terminal handler with no hold
 * creation or REST reconciliation, which was the root of #291).
 */
export function applyUpdateOperationSseToHold(args: ApplyUpdateOperationSseArgs) {
  const { parsed, resolveContainer, onActiveOperationComputed, onTerminalEvent } = args;
  const target: OperationDisplayHoldTarget = {
    containerId: parsed.containerId,
    newContainerId: parsed.newContainerId,
    containerName: parsed.containerName,
  };
  const container = resolveContainer(target);

  if (isActiveContainerUpdateOperationStatus(parsed.status)) {
    if (!container) {
      return;
    }
    const nextOperation: ContainerUpdateOperation = {
      ...(container.updateOperation ?? {}),
      id: parsed.operationId ?? container.updateOperation?.id ?? '',
      status: parsed.status,
      phase: resolveActiveOperationPhase({
        status: parsed.status,
        phase: parsed.phase,
        previousPhase: container.updateOperation?.phase,
      }),
      updatedAt: new Date().toISOString(),
    };
    if (parsed.operationId && parsed.operationId.length > 0) {
      onActiveOperationComputed?.({
        operationId: parsed.operationId,
        container,
        nextOperation,
      });
      holdOperationDisplay({
        operationId: parsed.operationId,
        operation: nextOperation,
        containerId: parsed.containerId,
        newContainerId: parsed.newContainerId,
        containerName: parsed.containerName,
        sortSnapshot: {
          status: container.status,
          updateKind: container.updateKind,
          newTag: container.newTag,
          currentTag: container.currentTag,
          image: container.image,
          imageCreated: container.imageCreated,
          updateDetectedAt: container.updateDetectedAt,
        },
      });
    }
    return;
  }

  const operationTarget = {
    operationId: parsed.operationId,
    ...target,
  };
  const terminalStatus = parsed.status;
  if (
    terminalStatus === 'succeeded' ||
    terminalStatus === 'failed' ||
    terminalStatus === 'rolled-back'
  ) {
    scheduleHeldOperationRelease(operationTarget);
    const toastName =
      (typeof container?.name === 'string' && container.name.length > 0
        ? container.name
        : undefined) ??
      parsed.containerName ??
      'container';
    onTerminalEvent?.({
      container,
      status: terminalStatus,
      name: toastName,
      operationId: parsed.operationId,
    });
    return;
  }

  clearHeldOperation(operationTarget);
}

export function useOperationDisplayHold() {
  return {
    applyUpdateOperationSseToHold,
    heldOperations,
    clearAllOperationDisplayHolds,
    clearHeldOperation,
    findMatchingOperationIds,
    getDisplayUpdateOperation,
    holdOperationDisplay,
    parseUpdateOperationSsePayload,
    projectContainerDisplayState,
    reconcileHoldsAgainstContainers,
    scheduleHeldOperationRelease,
  };
}
