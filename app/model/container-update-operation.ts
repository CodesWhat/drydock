export const CONTAINER_UPDATE_OPERATION_STATUSES = [
  'queued',
  'in-progress',
  'succeeded',
  'rolled-back',
  'failed',
] as const;

export type ContainerUpdateOperationStatus = (typeof CONTAINER_UPDATE_OPERATION_STATUSES)[number];

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
  'rollback-started',
  'rolled-back',
  'rollback-deferred',
  'rollback-failed',
] as const;

export type ContainerUpdateOperationPhase = (typeof CONTAINER_UPDATE_OPERATION_PHASES)[number];

export function isContainerUpdateOperationStatus(
  value: unknown,
): value is ContainerUpdateOperationStatus {
  return (
    typeof value === 'string' &&
    (CONTAINER_UPDATE_OPERATION_STATUSES as readonly string[]).includes(value)
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
