import { getAuditCounter } from '../../../prometheus/audit.js';
import * as auditStore from '../../../store/audit.js';
import * as backupStore from '../../../store/backup.js';
import { buildContainerLockKey, withContainerUpdateLocks } from '../../../updates/update-locks.js';
import { type ContainerBackupScope, resolveRollbackImageReference } from '../../../util/backup.js';
import { getErrorMessage } from '../../../util/error.js';
import {
  cleanupCreatedContainerCandidate,
  getCreatedContainerCandidate,
} from './created-container-candidate.js';
import { finishRollbackOperation, startRollbackOperation } from './rollback-operation.js';
import { getRollbackCandidateTarget, recordUpdateRollback } from './rollback-state.js';

type UnknownRecord = Record<string, unknown>;

interface LoggerLike {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

interface DockerContainerLike {
  inspect(): Promise<unknown>;
}

interface DockerApiLike {
  getContainer(containerId: string): DockerContainerLike;
}

interface TriggerInstanceLike {
  pullRollbackImage(
    dockerApi: DockerApiLike,
    rollbackImage: string,
    containerRef: ContainerRef,
    log: LoggerLike,
  ): Promise<void>;
  getCurrentContainer(dockerApi: DockerApiLike, containerRef: ContainerRef): Promise<unknown>;
  inspectContainer(container: unknown, log: LoggerLike): Promise<unknown>;
  /**
   * Keys serialising this container's update lifecycle. Optional so trigger
   * doubles without it fall back to the plain per-container key.
   */
  getUpdateLockKeys?(container: ContainerRef): string[];
  stopAndRemoveContainer(
    container: unknown,
    containerSpec: unknown,
    containerRef: ContainerRef,
    log: LoggerLike,
  ): Promise<void>;
  recreateContainer(
    dockerApi: DockerApiLike,
    containerSpec: unknown,
    backupImage: string,
    containerRef: ContainerRef,
    log: LoggerLike,
  ): Promise<void>;
  /**
   * Repoint containers that share the namespace or volumes of the container
   * just restored, which still reference the removed replacement. Optional so
   * trigger doubles without it keep working.
   */
  recreateSharedNamespaceDependents?(
    dockerApi: DockerApiLike,
    previousContainerId: string,
    containerName: string,
    log: LoggerLike,
    containerRef?: ContainerRef,
  ): Promise<unknown>;
  /**
   * Same post-pull identity binder the update path and the manual rollback
   * API (`app/util/backup.ts`) use, exposed here so auto-rollback can resolve
   * its reference through `resolveRollbackImageReference` (DR-59). A trigger
   * instance that doesn't implement it (test doubles) falls back to the
   * mutable tag inside that helper.
   */
  bindPulledImageIdentity?: (
    dockerApi: unknown,
    imageReference: string,
    container: unknown,
    logContainer: { info: (msg: string) => void; warn: (msg: string) => void },
    options?: { preferredDigest: string | null },
  ) => Promise<{ imageIdentity?: string; skipSecurityGate?: boolean }>;
  getRollbackIdentityBindingPolicy?: (container: unknown) => 'required' | 'optional' | 'disabled';
}

interface HealthMonitorOptions {
  dockerApi: unknown;
  container: MonitoredContainer;
  containerId: string;
  containerName: string;
  backupImageTag: string;
  backupImageDigest?: string;
  backupScope: ContainerBackupScope;
  window: number;
  interval: number;
  /**
   * `liveness` is for containers without a HEALTHCHECK: roll back when the
   * replacement exits, is OOM-killed or restarts (restart count rises above
   * `baselineRestartCount`) inside the window. Defaults to `health`.
   */
  mode?: MonitorMode;
  baselineRestartCount?: number;
  /**
   * Whether the container was running before the update. A rollback restores
   * that state: the container the monitor sees at failure time is usually dead
   * (liveness) and recreating from its spec would leave the service down.
   * Defaults to true, since a monitor is only armed for a running container.
   */
  wasRunning?: boolean;
  triggerInstance: unknown;
  log: unknown;
}

type MonitorMode = 'health' | 'liveness';

/**
 * The watcher-discovered container the update ran against. Carried whole
 * because a rollback is a trigger lifecycle call like any other: the compose
 * action reads the registry name, the watcher and the compose labels off it to
 * find the service to rewrite, and an `{ id, name }` stand-in threw a
 * TypeError before it got as far as the compose file (DR-101). The fields
 * named here are the ones this module's own consumers read; the rest ride
 * along under the index signature.
 */
interface MonitoredContainer {
  id?: string;
  watcher: string;
  agent?: string;
  result?: { digest?: string; tag?: string };
  labels: Record<string, string>;
  image: { registry: { name: string }; tag: { value: string } };
  [field: string]: unknown;
}

interface ContainerRef extends MonitoredContainer {
  id: string;
  name: string;
}

interface MonitorTimers {
  pollTimer?: ReturnType<typeof setInterval>;
  windowTimer?: ReturnType<typeof setTimeout>;
}

interface RollbackContext {
  dockerApi: DockerApiLike;
  triggerInstance: TriggerInstanceLike;
  containerRef: ContainerRef;
  /** The container as the update saw it, before the replacement's id replaced its own. */
  monitoredContainer: MonitoredContainer;
  signal: AbortSignal;
  wasRunning: boolean;
  containerName: string;
  backupImageTag: string;
  backupImageDigest?: string;
  backupScope: ContainerBackupScope;
  mode: MonitorMode;
  log: LoggerLike;
}

interface HealthPollContext {
  dockerApi: DockerApiLike;
  containerId: string;
  containerName: string;
  signal: AbortSignal;
  cleanup: () => void;
  onUnhealthy: () => Promise<void>;
  mode: MonitorMode;
  baselineRestartCount: number;
  log: LoggerLike;
}

function asUnknownRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as UnknownRecord;
}

function getInspectionHealthState(inspection: unknown): UnknownRecord | null {
  const inspectionRecord = asUnknownRecord(inspection);
  const stateRecord = asUnknownRecord(inspectionRecord?.State);
  return asUnknownRecord(stateRecord?.Health);
}

/**
 * The container the rollback addresses: everything the watcher knows about it,
 * with the identity of the replacement that went unhealthy. The replacement
 * has its own Docker id, so the monitored id wins over the one the watcher
 * recorded for the container this update replaced.
 */
function createContainerRef(
  containerId: string,
  containerName: string,
  container: MonitoredContainer,
): ContainerRef {
  return { ...container, id: containerId, name: containerName };
}

function cleanupTimers(timers: MonitorTimers): void {
  if (timers.pollTimer !== undefined) {
    clearInterval(timers.pollTimer);
    timers.pollTimer = undefined;
  }
  if (timers.windowTimer !== undefined) {
    clearTimeout(timers.windowTimer);
    timers.windowTimer = undefined;
  }
}

function recordRollbackSuccess(
  containerName: string,
  backupImageTag: string,
  restoredTag: string,
  mode: MonitorMode,
): void {
  auditStore.insertAudit({
    id: '',
    timestamp: new Date().toISOString(),
    action: 'auto-rollback',
    containerName,
    fromVersion: backupImageTag,
    toVersion: restoredTag,
    status: 'success',
    details:
      mode === 'liveness'
        ? 'Automatic rollback triggered by liveness failure (container exited, restarted or was OOM-killed)'
        : 'Automatic rollback triggered by health check failure',
  });
  getAuditCounter()?.inc({ action: 'auto-rollback' });
}

function recordRollbackError(containerName: string, message: string): void {
  auditStore.insertAudit({
    id: '',
    timestamp: new Date().toISOString(),
    action: 'auto-rollback',
    containerName,
    status: 'error',
    details: `Auto-rollback failed: ${message}`,
  });
  getAuditCounter()?.inc({ action: 'auto-rollback' });
}

/**
 * Rollbacks take the same per-container lock updates do, so one can't
 * interleave with an update or a manual rollback of the same container. A
 * monitor cancelled while it waited (a newer update or a manual rollback took
 * over) stands down once it holds the lock.
 */
async function performRollback(context: RollbackContext): Promise<void> {
  const { triggerInstance, containerRef } = context;
  const lockKeys = triggerInstance.getUpdateLockKeys?.(containerRef) ?? [
    buildContainerLockKey(containerRef),
  ];
  await withContainerUpdateLocks(lockKeys, () => runRollback(context), {
    bypassGlobalCap: true,
  });
}

/**
 * The restored container must actually be up before the rollback counts as a
 * success. Looked up by name: the replacement's id is gone.
 */
async function assertRestoredContainerRunning(
  context: RollbackContext,
  containerName: string,
): Promise<void> {
  const { dockerApi, triggerInstance, log } = context;
  const restoredContainer = await triggerInstance.getCurrentContainer(dockerApi, {
    ...context.containerRef,
    id: containerName,
  });
  const restoredSpec = restoredContainer
    ? asUnknownRecord(await triggerInstance.inspectContainer(restoredContainer, log))
    : null;
  if (asUnknownRecord(restoredSpec?.State)?.Running !== true) {
    throw new Error(`restored container ${containerName} is not running after the rollback`);
  }
}

async function runRollback(context: RollbackContext): Promise<void> {
  const {
    dockerApi,
    triggerInstance,
    containerRef,
    monitoredContainer,
    signal,
    wasRunning,
    containerName,
    backupImageTag,
    backupImageDigest,
    backupScope,
    mode,
    log,
  } = context;

  if (signal.aborted) {
    log.info(
      `Auto-rollback of container ${containerName} skipped: monitoring was cancelled by a newer update or rollback`,
    );
    return;
  }

  let operationId: string | undefined;
  try {
    const backups = backupStore.getBackupsForContainer(backupScope);
    if (backups.length === 0) {
      log.warn(`No backups found for container ${containerName} — cannot auto-rollback`);
      return;
    }

    const latestBackup = backups[0];
    // A record written before backup-time digest capture carries no
    // imageDigest of its own; the pre-update running image's digest (captured
    // before the health-checked update replaced it) is a trustworthy stand-in
    // because it is the exact image that was backed up. Route through the same
    // resolveRollbackImageReference the manual rollback API uses (DR-43) so
    // this fallback and the required-policy refusal it enforces both apply
    // here (DR-59), instead of pinning to whatever it finds unconditionally.
    const backupForResolution =
      backupImageDigest && !latestBackup.imageDigest
        ? { ...latestBackup, imageDigest: backupImageDigest }
        : latestBackup;
    const backupImage = await resolveRollbackImageReference(
      triggerInstance,
      dockerApi,
      containerRef,
      backupForResolution,
      log,
    );

    log.info(`Auto-rollback: resolving backup image ${backupImage}`);
    // Actually pull it, and pull it first. Neither recreate path fetches the
    // image for itself, so a backup that is no longer on the host used to fail
    // at create: on the Docker path after stopAndRemoveContainer had already
    // taken the running container away, and on the compose path after the
    // runtime refresh removed it and then "restored" the failing image the
    // rollback exists to undo. Pulling ahead of every destructive step turns
    // that into a refusal that leaves the container running (DR-110).
    await triggerInstance.pullRollbackImage(dockerApi, backupImage, containerRef, log);

    const currentContainer = await triggerInstance.getCurrentContainer(dockerApi, containerRef);
    if (!currentContainer) {
      log.warn(`Container ${containerName} not found — cannot auto-rollback`);
      return;
    }

    const currentContainerSpec = await triggerInstance.inspectContainer(currentContainer, log);
    // Opened just before the container is stopped: state alerts hold off while
    // an operation covers the container, so Drydock's own stop isn't reported.
    operationId = startRollbackOperation(containerRef, {
      fromVersion: backupImageTag,
      toVersion: latestBackup.imageTag,
      reason: mode === 'liveness' ? 'liveness-failure' : 'health-check-failure',
    });
    await triggerInstance.stopAndRemoveContainer(
      currentContainer,
      currentContainerSpec,
      containerRef,
      log,
    );
    // The container the monitor found is usually dead (liveness) and a spec
    // that says it isn't running makes both recreate paths leave the restored
    // container stopped. Restore the state it had before the update.
    const specToRestore = (
      wasRunning
        ? {
            ...(currentContainerSpec as UnknownRecord),
            State: {
              ...asUnknownRecord((currentContainerSpec as UnknownRecord).State),
              Running: true,
            },
          }
        : currentContainerSpec
    ) as UnknownRecord;
    await triggerInstance.recreateContainer(
      dockerApi,
      specToRestore,
      backupImage,
      containerRef,
      log,
    );
    if (wasRunning) {
      await assertRestoredContainerRunning(context, containerName);
    }
    await triggerInstance.recreateSharedNamespaceDependents?.(
      dockerApi,
      (currentContainerSpec as { Id: string }).Id,
      containerName,
      log,
      containerRef,
    );

    recordUpdateRollback(
      {
        id: monitoredContainer.id,
        name: containerName,
        watcher: monitoredContainer.watcher,
        agent: monitoredContainer.agent,
      },
      {
        targetDigest: getRollbackCandidateTarget(monitoredContainer, backupImageTag),
        reason: mode === 'liveness' ? 'liveness-failure' : 'health-check-failure',
      },
    );
    finishRollbackOperation(operationId, {});
    recordRollbackSuccess(containerName, backupImageTag, latestBackup.imageTag, mode);
    log.info(`Auto-rollback of container ${containerName} completed successfully`);
  } catch (error: unknown) {
    // recreateContainer may have created a replacement before a later step
    // (e.g. an additional-network connect) failed. The original container was
    // already stopped/removed above, so there's no name to rename back to —
    // just reclaim the orphan so it doesn't squat the container name.
    await cleanupCreatedContainerCandidate(getCreatedContainerCandidate(error), containerName, log);
    const message = getErrorMessage(error);
    finishRollbackOperation(operationId, { error: message });
    log.error(`Auto-rollback failed for container ${containerName}: ${message}`);
    recordRollbackError(containerName, message);
  }
}

/**
 * Why a container without a healthcheck counts as failed, or undefined while
 * it is still up. A restart under a restart policy leaves it running, so the
 * restart count is what catches a crash loop.
 */
function getLivenessFailure(inspection: unknown, baselineRestartCount: number): string | undefined {
  const inspectionRecord = asUnknownRecord(inspection);
  const state = asUnknownRecord(inspectionRecord?.State);
  if (!state) {
    return undefined;
  }
  if (state.OOMKilled === true) {
    return 'was OOM-killed';
  }
  const restartCount = inspectionRecord?.RestartCount;
  if (typeof restartCount === 'number' && restartCount > baselineRestartCount) {
    return `restarted (restart count ${baselineRestartCount} -> ${restartCount})`;
  }
  if (state.Running === false) {
    const exitCode = typeof state.ExitCode === 'number' ? ` with exit code ${state.ExitCode}` : '';
    return `exited${exitCode}`;
  }
  return undefined;
}

async function inspectLivenessAndHandle(context: HealthPollContext): Promise<void> {
  const { dockerApi, containerId, containerName, cleanup, onUnhealthy, log } = context;
  const inspection = await dockerApi.getContainer(containerId).inspect();
  const failure = getLivenessFailure(inspection, context.baselineRestartCount);
  if (!failure) {
    return;
  }

  log.warn(`Container ${containerName} ${failure} — initiating automatic rollback`);
  cleanup();
  await onUnhealthy();
}

async function inspectHealthAndHandle(context: HealthPollContext): Promise<void> {
  const { dockerApi, containerId, containerName, cleanup, onUnhealthy, log } = context;
  const container = dockerApi.getContainer(containerId);
  const inspection = await container.inspect();
  const healthState = getInspectionHealthState(inspection);

  if (!healthState) {
    log.warn(`Container ${containerName} has no HEALTHCHECK defined — stopping health monitoring`);
    cleanup();
    return;
  }

  if (healthState.Status !== 'unhealthy') {
    return;
  }

  log.warn(`Container ${containerName} became unhealthy — initiating automatic rollback`);
  cleanup();
  await onUnhealthy();
}

function createPollHandler(context: HealthPollContext): () => Promise<void> {
  let checkInFlight = false;

  return async () => {
    if (context.signal.aborted || checkInFlight) return;
    checkInFlight = true;

    try {
      await (context.mode === 'liveness'
        ? inspectLivenessAndHandle(context)
        : inspectHealthAndHandle(context));
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      context.log.warn(
        `Error inspecting container ${context.containerName} during health monitoring: ${message}`,
      );
    } finally {
      checkInFlight = false;
    }
  };
}

function handleWindowExpiry(
  signal: AbortSignal,
  containerName: string,
  cleanup: () => void,
  log: LoggerLike,
  mode: MonitorMode,
): void {
  if (signal.aborted) return;
  log.info(
    mode === 'liveness'
      ? `Liveness watch window expired for container ${containerName} — container stayed up`
      : `Health monitoring window expired for container ${containerName} — container is healthy`,
  );
  cleanup();
}

/**
 * Start monitoring a container's health status after an update.
 * If the container becomes unhealthy within the monitoring window,
 * automatically roll back to the previous image.
 *
 * Returns an AbortController that can be used to cancel monitoring.
 */
export function startHealthMonitor(options: HealthMonitorOptions): AbortController {
  const {
    dockerApi: dockerApiOption,
    container,
    containerId,
    containerName,
    backupImageTag,
    backupImageDigest,
    backupScope,
    window: monitorWindow,
    interval,
    mode = 'health',
    baselineRestartCount = 0,
    wasRunning = true,
    triggerInstance: triggerInstanceOption,
    log: logOption,
  } = options;
  const dockerApi = dockerApiOption as DockerApiLike;
  const triggerInstance = triggerInstanceOption as TriggerInstanceLike;
  const log = logOption as LoggerLike;

  const abortController = new AbortController();
  const { signal } = abortController;
  const timers: MonitorTimers = {};
  const containerRef = createContainerRef(containerId, containerName, container);

  const cleanup = () => cleanupTimers(timers);
  signal.addEventListener('abort', cleanup);

  const checkHealth = createPollHandler({
    dockerApi,
    containerId,
    containerName,
    signal,
    cleanup,
    onUnhealthy: () =>
      performRollback({
        dockerApi,
        triggerInstance,
        containerRef,
        monitoredContainer: container,
        signal,
        wasRunning,
        containerName,
        backupImageTag,
        backupImageDigest,
        backupScope,
        mode,
        log,
      }),
    mode,
    baselineRestartCount,
    log,
  });

  timers.pollTimer = setInterval(checkHealth, interval);
  timers.windowTimer = setTimeout(
    () => handleWindowExpiry(signal, containerName, cleanup, log, mode),
    monitorWindow,
  );

  return abortController;
}
