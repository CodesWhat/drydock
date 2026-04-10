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
