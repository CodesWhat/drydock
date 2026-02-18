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

  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let windowTimer: ReturnType<typeof setTimeout> | undefined;
  let checkInFlight = false;

  function cleanup() {
    if (pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
    if (windowTimer !== undefined) {
      clearTimeout(windowTimer);
      windowTimer = undefined;
    }
  }

  signal.addEventListener('abort', () => {
    cleanup();
  });

  async function checkHealth() {
    if (signal.aborted || checkInFlight) return;
    checkInFlight = true;

    try {
      const container = dockerApi.getContainer(containerId);
      const inspection = await container.inspect();
      const healthState = inspection?.State?.Health;

      if (!healthState) {
        log.warn(
          `Container ${containerName} has no HEALTHCHECK defined — stopping health monitoring`,
        );
        cleanup();
        return;
      }

      const status = healthState.Status;

      if (status === 'unhealthy') {
        log.warn(`Container ${containerName} became unhealthy — initiating automatic rollback`);
        cleanup();
        await performRollback();
      }
    } catch (e) {
      log.warn(
        `Error inspecting container ${containerName} during health monitoring: ${e.message}`,
      );
    } finally {
      checkInFlight = false;
    }
  }

  async function performRollback() {
    try {
      const backups = backupStore.getBackups(containerId);
      if (backups.length === 0) {
        log.warn(`No backups found for container ${containerName} — cannot auto-rollback`);
        return;
      }

      const latestBackup = backups[0];
      const backupImage = `${latestBackup.imageName}:${latestBackup.imageTag}`;

      log.info(`Auto-rollback: pulling backup image ${backupImage}`);

      const currentContainer = await triggerInstance.getCurrentContainer(dockerApi, {
        id: containerId,
        name: containerName,
      });

      if (!currentContainer) {
        log.warn(`Container ${containerName} not found — cannot auto-rollback`);
        return;
      }

      const currentContainerSpec = await triggerInstance.inspectContainer(currentContainer, log);

      await triggerInstance.stopAndRemoveContainer(
        currentContainer,
        currentContainerSpec,
        { id: containerId, name: containerName },
        log,
      );

      await triggerInstance.recreateContainer(
        dockerApi,
        currentContainerSpec,
        backupImage,
        { id: containerId, name: containerName },
        log,
      );

      auditStore.insertAudit({
        id: '',
        timestamp: new Date().toISOString(),
        action: 'auto-rollback',
        containerName,
        fromVersion: backupImageTag,
        toVersion: latestBackup.imageTag,
        status: 'success',
        details: 'Automatic rollback triggered by health check failure',
      });
      getAuditCounter()?.inc({ action: 'auto-rollback' });

      log.info(`Auto-rollback of container ${containerName} completed successfully`);
    } catch (e) {
      log.error(`Auto-rollback failed for container ${containerName}: ${e.message}`);

      auditStore.insertAudit({
        id: '',
        timestamp: new Date().toISOString(),
        action: 'auto-rollback',
        containerName,
        status: 'error',
        details: `Auto-rollback failed: ${e.message}`,
      });
      getAuditCounter()?.inc({ action: 'auto-rollback' });
    }
  }

  // Start polling
  pollTimer = setInterval(checkHealth, interval);

  // Stop monitoring after the window expires
  windowTimer = setTimeout(() => {
    if (!signal.aborted) {
      log.info(
        `Health monitoring window expired for container ${containerName} — container is healthy`,
      );
      cleanup();
    }
  }, monitorWindow);

  return abortController;
}
