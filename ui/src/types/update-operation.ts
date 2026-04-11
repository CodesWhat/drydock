export const CONTAINER_UPDATE_OPERATION_KINDS = ['container-update', 'self-update'] as const;

export type ContainerUpdateOperationKind = (typeof CONTAINER_UPDATE_OPERATION_KINDS)[number];

export const CONTAINER_UPDATE_OPERATION_STATUSES = [
  'queued',
  'in-progress',
  'succeeded',
  'rolled-back',
  'failed',
] as const;

export type ContainerUpdateOperationStatus = (typeof CONTAINER_UPDATE_OPERATION_STATUSES)[number];

export const ACTIVE_CONTAINER_UPDATE_OPERATION_STATUSES = ['queued', 'in-progress'] as const;

export type ActiveContainerUpdateOperationStatus =
  (typeof ACTIVE_CONTAINER_UPDATE_OPERATION_STATUSES)[number];

export const TERMINAL_CONTAINER_UPDATE_OPERATION_STATUSES = [
  'succeeded',
  'rolled-back',
  'failed',
] as const;

export type TerminalContainerUpdateOperationStatus =
  (typeof TERMINAL_CONTAINER_UPDATE_OPERATION_STATUSES)[number];

export const CONTAINER_UPDATE_OPERATION_PHASES = [
  'queued',
  'pulling',
  'pull-failed',
  'prepare',
  'dryrun',
  'renamed',
  'new-created',
  'old-stopped',
  'new-started',
  'health-gate',
  'health-gate-passed',
  'succeeded',
  'failed',
  'recovered-cleanup-temp',
  'recovered-rollback',
  'recovered-active',
  'recovery-failed',
  'recovery-missing-containers',
  'rollback-started',
  'rolled-back',
  'rollback-deferred',
  'rollback-failed',
] as const;

export type ContainerUpdateOperationPhase = (typeof CONTAINER_UPDATE_OPERATION_PHASES)[number];

export const QUEUED_CONTAINER_UPDATE_OPERATION_PHASES = ['queued'] as const;

export type QueuedContainerUpdateOperationPhase =
  (typeof QUEUED_CONTAINER_UPDATE_OPERATION_PHASES)[number];

export const IN_PROGRESS_CONTAINER_UPDATE_OPERATION_PHASES = [
  'pulling',
  'prepare',
  'renamed',
  'new-created',
  'old-stopped',
  'new-started',
  'health-gate',
  'health-gate-passed',
  'rollback-started',
  'rollback-deferred',
] as const;

export type InProgressContainerUpdateOperationPhase =
  (typeof IN_PROGRESS_CONTAINER_UPDATE_OPERATION_PHASES)[number];

export type ActiveContainerUpdateOperationPhase =
  | QueuedContainerUpdateOperationPhase
  | InProgressContainerUpdateOperationPhase;

function assertNever(value: never): never {
  throw new Error(`Unexpected container update operation state: ${String(value)}`);
}

export function isContainerUpdateOperationStatus(
  value: unknown,
): value is ContainerUpdateOperationStatus {
  return (
    typeof value === 'string' &&
    (CONTAINER_UPDATE_OPERATION_STATUSES as readonly string[]).includes(value)
  );
}

export function isContainerUpdateOperationKind(
  value: unknown,
): value is ContainerUpdateOperationKind {
  return (
    typeof value === 'string' &&
    (CONTAINER_UPDATE_OPERATION_KINDS as readonly string[]).includes(value)
  );
}

export function isActiveContainerUpdateOperationStatus(
  value: unknown,
): value is ActiveContainerUpdateOperationStatus {
  return (
    typeof value === 'string' &&
    (ACTIVE_CONTAINER_UPDATE_OPERATION_STATUSES as readonly string[]).includes(value)
  );
}

export function isContainerUpdateOperationPhase(
  value: unknown,
): value is ContainerUpdateOperationPhase {
  return (
    typeof value === 'string' &&
    (CONTAINER_UPDATE_OPERATION_PHASES as readonly string[]).includes(value)
  );
}

export function isQueuedContainerUpdateOperationPhase(
  value: unknown,
): value is QueuedContainerUpdateOperationPhase {
  return (
    typeof value === 'string' &&
    (QUEUED_CONTAINER_UPDATE_OPERATION_PHASES as readonly string[]).includes(value)
  );
}

export function isInProgressContainerUpdateOperationPhase(
  value: unknown,
): value is InProgressContainerUpdateOperationPhase {
  return (
    typeof value === 'string' &&
    (IN_PROGRESS_CONTAINER_UPDATE_OPERATION_PHASES as readonly string[]).includes(value)
  );
}

export function isActiveContainerUpdateOperationPhaseForStatus(
  status: ActiveContainerUpdateOperationStatus,
  phase: unknown,
): phase is ActiveContainerUpdateOperationPhase {
  switch (status) {
    case 'queued':
      return isQueuedContainerUpdateOperationPhase(phase);
    case 'in-progress':
      return isInProgressContainerUpdateOperationPhase(phase);
    default:
      return assertNever(status);
  }
}
