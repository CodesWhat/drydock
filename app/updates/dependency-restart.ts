import { recordAuditEvent } from '../api/audit-events.js';
import {
  AGENT_LIFECYCLE_UNSUPPORTED_ERROR,
  findDockerTriggerForContainer,
  isAgentLifecycleUnsupported,
  NO_DOCKER_TRIGGER_FOUND_ERROR,
} from '../api/docker-trigger.js';
import logger from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import type { Container } from '../model/container.js';
import * as registry from '../registry/index.js';
import * as storeContainer from '../store/container.js';

/**
 * Dependency-chain restart primitive (`dd.depends_on.action=restart`, v1.7
 * Phase 6.1, #219 — design §3). Equivalent to the docker-restart action
 * already exposed at `POST /:id/restart` (`app/api/container-actions.ts`),
 * reimplemented here (rather than imported) because that handler is private
 * to the Express request/response cycle. Wave entries carrying
 * `actionKind: 'restart'` call this instead of `trigger.trigger()`,
 * bypassing the pull/SecurityGate/rollback-monitor pipeline entirely — a
 * same-image restart is not an update and none of that applies.
 */

const log = logger.child({ component: 'updates.dependency-restart' });

type DockerContainerHandle = {
  restart: () => Promise<void>;
  inspect: () => Promise<{ State?: { Status?: string } }>;
};

type DockerWatcher = {
  dockerApi: {
    getContainer: (id: string) => DockerContainerHandle;
  };
};

export async function restartDependentContainer(container: Container): Promise<void> {
  if (isAgentLifecycleUnsupported(container)) {
    throw new Error(AGENT_LIFECYCLE_UNSUPPORTED_ERROR);
  }

  const trigger = findDockerTriggerForContainer(registry.getState().trigger, container);
  if (!trigger) {
    throw new Error(NO_DOCKER_TRIGGER_FOUND_ERROR);
  }

  const watcher = trigger.getWatcher(container) as DockerWatcher;
  const dockerContainer = watcher.dockerApi.getContainer(container.id);
  await dockerContainer.restart();

  // Best-effort store refresh, mirroring the /:id/restart handler — never let a
  // status-sync hiccup fail the restart itself, the dispatcher only cares
  // whether the restart succeeded.
  try {
    const inspectResult = await dockerContainer.inspect();
    const newStatus = inspectResult?.State?.Status;
    if (newStatus) {
      const containerForUpdate = storeContainer.getContainer(container.id);
      if (containerForUpdate) {
        storeContainer.updateContainer({ ...containerForUpdate, status: newStatus });
      }
    }
  } catch (error: unknown) {
    log.debug(
      `Restarted ${sanitizeLogParam(container.name)} as a dependency-chain action but failed to refresh its stored status (${sanitizeLogParam(error instanceof Error ? error.message : String(error))})`,
    );
  }

  recordAuditEvent({
    action: 'container-restart',
    container,
    status: 'success',
  });
  log.info(
    `Restarted ${sanitizeLogParam(container.name)} as a dependency-chain action (dd.depends_on.action=restart)`,
  );
}
