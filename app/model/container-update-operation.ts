const CONTAINER_UPDATE_OPERATION_KINDS = ['container-update', 'self-update'] as const;

export type ContainerUpdateOperationKind = (typeof CONTAINER_UPDATE_OPERATION_KINDS)[number];

const CONTAINER_UPDATE_OPERATION_STATUSES = [
  'queued',
  'in-progress',
  'succeeded',
  'rolled-back',
  'failed',
  'expired',
  'skipped-dependency',
] as const;

export type ContainerUpdateOperationStatus = (typeof CONTAINER_UPDATE_OPERATION_STATUSES)[number];

export const ACTIVE_CONTAINER_UPDATE_OPERATION_STATUSES = ['queued', 'in-progress'] as const;

export type ActiveContainerUpdateOperationStatus =
  (typeof ACTIVE_CONTAINER_UPDATE_OPERATION_STATUSES)[number];

export const TERMINAL_CONTAINER_UPDATE_OPERATION_STATUSES = [
  'succeeded',
  'rolled-back',
  'failed',
  'expired',
  'skipped-dependency',
] as const;

export type TerminalContainerUpdateOperationStatus =
  (typeof TERMINAL_CONTAINER_UPDATE_OPERATION_STATUSES)[number];

export const CONTAINER_UPDATE_OPERATION_PHASES = [
  'queued',
  'pulling',
  'scanning',
  'sbom-generating',
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
  'portainer-target',
  'portainer-restore',
  'rollback-failed',
  'expired',
  'skipped-dependency',
] as const;

export type ContainerUpdateOperationPhase = (typeof CONTAINER_UPDATE_OPERATION_PHASES)[number];

const QUEUED_CONTAINER_UPDATE_OPERATION_PHASES = ['queued'] as const;

type QueuedContainerUpdateOperationPhase =
  (typeof QUEUED_CONTAINER_UPDATE_OPERATION_PHASES)[number];

export const IN_PROGRESS_CONTAINER_UPDATE_OPERATION_PHASES = [
  'pulling',
  'scanning',
  'sbom-generating',
  'prepare',
  'renamed',
  'new-created',
  'old-stopped',
  'new-started',
  'health-gate',
  'health-gate-passed',
  'rollback-started',
  'rollback-deferred',
  'portainer-target',
  'portainer-restore',
] as const;

export type InProgressContainerUpdateOperationPhase =
  (typeof IN_PROGRESS_CONTAINER_UPDATE_OPERATION_PHASES)[number];

export type ActiveContainerUpdateOperationPhase =
  | QueuedContainerUpdateOperationPhase
  | InProgressContainerUpdateOperationPhase;

const SUCCEEDED_CONTAINER_UPDATE_OPERATION_PHASES = [
  'dryrun',
  'succeeded',
  'recovered-cleanup-temp',
  'recovered-active',
] as const;

export type SucceededContainerUpdateOperationPhase =
  (typeof SUCCEEDED_CONTAINER_UPDATE_OPERATION_PHASES)[number];

const ROLLED_BACK_CONTAINER_UPDATE_OPERATION_PHASES = [
  'rolled-back',
  'recovered-rollback',
] as const;

export type RolledBackContainerUpdateOperationPhase =
  (typeof ROLLED_BACK_CONTAINER_UPDATE_OPERATION_PHASES)[number];

const FAILED_CONTAINER_UPDATE_OPERATION_PHASES = [
  'pull-failed',
  'failed',
  'recovery-failed',
  'recovery-missing-containers',
  'rollback-failed',
] as const;

export type FailedContainerUpdateOperationPhase =
  (typeof FAILED_CONTAINER_UPDATE_OPERATION_PHASES)[number];

// Non-notifying terminal phase used when the active-TTL sweep or startup-orphan
// reconciliation terminalises a stuck operation. It is deliberately NOT a member
// of FAILED_* so that no "update failed" lifecycle event is emitted (see
// emitTerminalLifecycleEvent in app/store/update-operation.ts). See issue #410.
const EXPIRED_CONTAINER_UPDATE_OPERATION_PHASES = ['expired'] as const;

export type ExpiredContainerUpdateOperationPhase =
  (typeof EXPIRED_CONTAINER_UPDATE_OPERATION_PHASES)[number];

// Non-notifying terminal phase used when a dependency-ordered wave dispatch
// (v1.7 Phase 6.1, #219) skips a container because an upstream dependency in
// its chain failed or is deferred by its own maintenance window this cycle.
// Deliberately NOT a member of FAILED_* so no false "update failed" lifecycle
// event fires for a container that was never attempted (see design §3).
const SKIPPED_DEPENDENCY_CONTAINER_UPDATE_OPERATION_PHASES = ['skipped-dependency'] as const;

export type SkippedDependencyContainerUpdateOperationPhase =
  (typeof SKIPPED_DEPENDENCY_CONTAINER_UPDATE_OPERATION_PHASES)[number];

export type TerminalContainerUpdateOperationPhase =
  | SucceededContainerUpdateOperationPhase
  | RolledBackContainerUpdateOperationPhase
  | FailedContainerUpdateOperationPhase
  | ExpiredContainerUpdateOperationPhase
  | SkippedDependencyContainerUpdateOperationPhase;

export type TerminalContainerUpdateOperationPhaseForStatus<
  TStatus extends TerminalContainerUpdateOperationStatus,
> = TStatus extends 'succeeded'
  ? SucceededContainerUpdateOperationPhase
  : TStatus extends 'rolled-back'
    ? RolledBackContainerUpdateOperationPhase
    : TStatus extends 'expired'
      ? ExpiredContainerUpdateOperationPhase
      : TStatus extends 'skipped-dependency'
        ? SkippedDependencyContainerUpdateOperationPhase
        : FailedContainerUpdateOperationPhase;

const DEFAULT_TERMINAL_PHASE_BY_STATUS = {
  succeeded: 'succeeded',
  'rolled-back': 'rolled-back',
  failed: 'failed',
  expired: 'expired',
  'skipped-dependency': 'skipped-dependency',
} as const satisfies {
  [TStatus in TerminalContainerUpdateOperationStatus]: TerminalContainerUpdateOperationPhaseForStatus<TStatus>;
};

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

export function isTerminalContainerUpdateOperationStatus(
  value: unknown,
): value is TerminalContainerUpdateOperationStatus {
  return (
    typeof value === 'string' &&
    (TERMINAL_CONTAINER_UPDATE_OPERATION_STATUSES as readonly string[]).includes(value)
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

function isQueuedContainerUpdateOperationPhase(
  value: unknown,
): value is QueuedContainerUpdateOperationPhase {
  return (
    typeof value === 'string' &&
    (QUEUED_CONTAINER_UPDATE_OPERATION_PHASES as readonly string[]).includes(value)
  );
}

function isInProgressContainerUpdateOperationPhase(
  value: unknown,
): value is InProgressContainerUpdateOperationPhase {
  return (
    typeof value === 'string' &&
    (IN_PROGRESS_CONTAINER_UPDATE_OPERATION_PHASES as readonly string[]).includes(value)
  );
}

export function isActiveContainerUpdateOperationPhase(
  value: unknown,
): value is ActiveContainerUpdateOperationPhase {
  return (
    isQueuedContainerUpdateOperationPhase(value) || isInProgressContainerUpdateOperationPhase(value)
  );
}

function isSucceededContainerUpdateOperationPhase(
  value: unknown,
): value is SucceededContainerUpdateOperationPhase {
  return (
    typeof value === 'string' &&
    (SUCCEEDED_CONTAINER_UPDATE_OPERATION_PHASES as readonly string[]).includes(value)
  );
}

function isRolledBackContainerUpdateOperationPhase(
  value: unknown,
): value is RolledBackContainerUpdateOperationPhase {
  return (
    typeof value === 'string' &&
    (ROLLED_BACK_CONTAINER_UPDATE_OPERATION_PHASES as readonly string[]).includes(value)
  );
}

function isFailedContainerUpdateOperationPhase(
  value: unknown,
): value is FailedContainerUpdateOperationPhase {
  return (
    typeof value === 'string' &&
    (FAILED_CONTAINER_UPDATE_OPERATION_PHASES as readonly string[]).includes(value)
  );
}

export function isExpiredContainerUpdateOperationPhase(
  value: unknown,
): value is ExpiredContainerUpdateOperationPhase {
  return (
    typeof value === 'string' &&
    (EXPIRED_CONTAINER_UPDATE_OPERATION_PHASES as readonly string[]).includes(value)
  );
}

export function isSkippedDependencyContainerUpdateOperationPhase(
  value: unknown,
): value is SkippedDependencyContainerUpdateOperationPhase {
  return (
    typeof value === 'string' &&
    (SKIPPED_DEPENDENCY_CONTAINER_UPDATE_OPERATION_PHASES as readonly string[]).includes(value)
  );
}

export function isTerminalContainerUpdateOperationPhase(
  value: unknown,
): value is TerminalContainerUpdateOperationPhase {
  return (
    isSucceededContainerUpdateOperationPhase(value) ||
    isRolledBackContainerUpdateOperationPhase(value) ||
    isFailedContainerUpdateOperationPhase(value) ||
    isExpiredContainerUpdateOperationPhase(value) ||
    isSkippedDependencyContainerUpdateOperationPhase(value)
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

export function isTerminalContainerUpdateOperationPhaseForStatus<
  TStatus extends TerminalContainerUpdateOperationStatus,
>(
  status: TStatus,
  phase: unknown,
): phase is TerminalContainerUpdateOperationPhaseForStatus<TStatus> {
  switch (status) {
    case 'succeeded':
      return isSucceededContainerUpdateOperationPhase(phase);
    case 'rolled-back':
      return isRolledBackContainerUpdateOperationPhase(phase);
    case 'failed':
      return isFailedContainerUpdateOperationPhase(phase);
    case 'expired':
      return isExpiredContainerUpdateOperationPhase(phase);
    case 'skipped-dependency':
      return isSkippedDependencyContainerUpdateOperationPhase(phase);
    default:
      return assertNever(status);
  }
}

export function getDefaultTerminalContainerUpdateOperationPhase<
  TStatus extends TerminalContainerUpdateOperationStatus,
>(status: TStatus): TerminalContainerUpdateOperationPhaseForStatus<TStatus> {
  switch (status) {
    case 'succeeded':
      return DEFAULT_TERMINAL_PHASE_BY_STATUS.succeeded as TerminalContainerUpdateOperationPhaseForStatus<TStatus>;
    case 'rolled-back':
      return DEFAULT_TERMINAL_PHASE_BY_STATUS[
        'rolled-back'
      ] as TerminalContainerUpdateOperationPhaseForStatus<TStatus>;
    case 'failed':
      return DEFAULT_TERMINAL_PHASE_BY_STATUS.failed as TerminalContainerUpdateOperationPhaseForStatus<TStatus>;
    case 'expired':
      return DEFAULT_TERMINAL_PHASE_BY_STATUS.expired as TerminalContainerUpdateOperationPhaseForStatus<TStatus>;
    case 'skipped-dependency':
      return DEFAULT_TERMINAL_PHASE_BY_STATUS[
        'skipped-dependency'
      ] as TerminalContainerUpdateOperationPhaseForStatus<TStatus>;
    default:
      return assertNever(status);
  }
}

export function resolveTerminalContainerUpdateOperationPhase<
  TStatus extends TerminalContainerUpdateOperationStatus,
>(
  status: TStatus,
  phase?: ContainerUpdateOperationPhase,
): TerminalContainerUpdateOperationPhaseForStatus<TStatus> {
  if (isTerminalContainerUpdateOperationPhaseForStatus(status, phase)) {
    return phase;
  }

  return getDefaultTerminalContainerUpdateOperationPhase(status);
}
