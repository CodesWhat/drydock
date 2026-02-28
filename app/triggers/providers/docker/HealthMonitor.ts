import { getAuditCounter } from '../../../prometheus/audit.js';
import * as auditStore from '../../../store/audit.js';
import * as backupStore from '../../../store/backup.js';

export interface HealthMonitorOptions {
  dockerApi: any;
  containerId: string;
  containerName: string;
  backupImageTag: string;
  backupImageDigest?: string;
  window: number;
  interval: number;
  triggerInstance: any;
  log: any;
}

interface ContainerRef {
  id: string;
  name: string;
}

interface MonitorTimers {
  pollTimer?: ReturnType<typeof setInterval>;
  windowTimer?: ReturnType<typeof setTimeout>;
}

interface RollbackContext {
  dockerApi: any;
  triggerInstance: any;
  containerRef: ContainerRef;
  containerName: string;
  backupImageTag: string;
  log: any;
}

interface HealthPollContext {
  dockerApi: any;
  containerId: string;
  containerName: string;
  signal: AbortSignal;
  cleanup: () => void;
  onUnhealthy: () => Promise<void>;
  log: any;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createContainerRef(containerId: string, containerName: string): ContainerRef {
  return { id: containerId, name: containerName };
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
): void {
  auditStore.insertAudit({
    id: '',
    timestamp: new Date().toISOString(),
    action: 'auto-rollback',
    containerName,
    fromVersion: backupImageTag,
    toVersion: restoredTag,
    status: 'success',
    details: 'Automatic rollback triggered by health check failure',
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

async function performRollback(context: RollbackContext): Promise<void> {
  const { dockerApi, triggerInstance, containerRef, containerName, backupImageTag, log } = context;

  try {
    const backups = backupStore.getBackupsByName(containerName);
    if (backups.length === 0) {
      log.warn(`No backups found for container ${containerName} — cannot auto-rollback`);
      return;
    }

    const latestBackup = backups[0];
    const backupImage = `${latestBackup.imageName}:${latestBackup.imageTag}`;

    log.info(`Auto-rollback: pulling backup image ${backupImage}`);

    const currentContainer = await triggerInstance.getCurrentContainer(dockerApi, containerRef);
    if (!currentContainer) {
      log.warn(`Container ${containerName} not found — cannot auto-rollback`);
      return;
    }

    const currentContainerSpec = await triggerInstance.inspectContainer(currentContainer, log);
    await triggerInstance.stopAndRemoveContainer(
      currentContainer,
      currentContainerSpec,
      containerRef,
      log,
    );
    await triggerInstance.recreateContainer(
      dockerApi,
      currentContainerSpec,
      backupImage,
      containerRef,
      log,
    );

    recordRollbackSuccess(containerName, backupImageTag, latestBackup.imageTag);
    log.info(`Auto-rollback of container ${containerName} completed successfully`);
  } catch (error) {
    const message = toErrorMessage(error);
    log.error(`Auto-rollback failed for container ${containerName}: ${message}`);
    recordRollbackError(containerName, message);
  }
}

async function inspectHealthAndHandle(context: HealthPollContext): Promise<void> {
  const { dockerApi, containerId, containerName, cleanup, onUnhealthy, log } = context;
  const container = dockerApi.getContainer(containerId);
  const inspection = await container.inspect();
  const healthState = inspection?.State?.Health;

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
      await inspectHealthAndHandle(context);
    } catch (error) {
      const message = toErrorMessage(error);
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
  log: any,
): void {
  if (signal.aborted) return;
  log.info(
    `Health monitoring window expired for container ${containerName} — container is healthy`,
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
    dockerApi,
    containerId,
    containerName,
    backupImageTag,
    window: monitorWindow,
    interval,
    triggerInstance,
    log,
  } = options;

  const abortController = new AbortController();
  const { signal } = abortController;
  const timers: MonitorTimers = {};
  const containerRef = createContainerRef(containerId, containerName);

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
        containerName,
        backupImageTag,
        log,
      }),
    log,
  });

  timers.pollTimer = setInterval(checkHealth, interval);
  timers.windowTimer = setTimeout(
    () => handleWindowExpiry(signal, containerName, cleanup, log),
    monitorWindow,
  );

  return abortController;
}
