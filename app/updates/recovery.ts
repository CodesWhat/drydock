import { findDockerTriggerForContainer } from '../api/docker-trigger.js';
import log from '../log/index.js';
import type { Container } from '../model/container.js';
import * as registry from '../registry/index.js';
import * as containerStore from '../store/container.js';
import * as updateOperationStore from '../store/update-operation.js';
import { parseEnvNonNegativeInteger } from '../util/parse.js';
import type { AcceptedContainerUpdateRequest } from './request-update.js';
import { dispatchAccepted } from './request-update.js';

const DEFAULT_RECOVERY_BOOT_CONCURRENCY = 4;
const RECOVERY_BOOT_CONCURRENCY_ENV = 'DD_UPDATE_RECOVERY_BOOT_CONCURRENCY';

export interface RecoveryResult {
  resumed: number;
  abandoned: number;
}

type RecoveryTriggerRegistry = Parameters<typeof findDockerTriggerForContainer>[0];

function getRecoveryTriggerRegistry(): RecoveryTriggerRegistry {
  return registry.getState().trigger;
}

export function parseRecoveryBootConcurrency(raw: string | undefined): number {
  const parsed = parseEnvNonNegativeInteger(raw, RECOVERY_BOOT_CONCURRENCY_ENV);
  if (parsed === undefined) {
    return DEFAULT_RECOVERY_BOOT_CONCURRENCY;
  }
  if (parsed === 0) {
    throw new Error(`${RECOVERY_BOOT_CONCURRENCY_ENV} must be at least 1 (got "${raw}")`);
  }
  return parsed;
}

export function findRecoveryUpdateTrigger(
  container: Container,
): AcceptedContainerUpdateRequest['trigger'] | undefined {
  return findDockerTriggerForContainer(getRecoveryTriggerRegistry(), container);
}

/**
 * After registry initialisation, scan the operation store for queued
 * operations left over from a previous process run and dispatch them.
 *
 * Operations whose container or update trigger cannot be resolved (e.g. the
 * container was removed or the trigger configuration changed since the last
 * run) are marked failed so the row does not stay perpetually queued.
 *
 * Non-resumable in-progress operations were already terminalised by the
 * store-level reconciliation that runs during store init. This function only
 * touches operations currently in `status: queued`.
 */
export function recoverQueuedOperationsOnStartup(): RecoveryResult {
  const queued = updateOperationStore
    .listActiveOperations()
    .filter((operation) => operation.status === 'queued' && operation.kind !== 'self-update');

  if (queued.length === 0) {
    return { resumed: 0, abandoned: 0 };
  }

  const recoveryLog = log.child({ component: 'updates.recovery' });
  const accepted: AcceptedContainerUpdateRequest[] = [];
  let abandoned = 0;

  for (const operation of queued) {
    const container = operation.containerId
      ? (containerStore.getContainer(operation.containerId) as Container | undefined)
      : undefined;
    if (!container) {
      updateOperationStore.markOperationTerminal(operation.id, {
        status: 'failed',
        phase: 'failed',
        lastError: `Recovery abandoned: container ${operation.containerId || operation.containerName} not found in store after restart.`,
      });
      abandoned++;
      continue;
    }

    const trigger = findRecoveryUpdateTrigger(container);
    if (!trigger) {
      updateOperationStore.markOperationTerminal(operation.id, {
        status: 'failed',
        phase: 'failed',
        lastError: `Recovery abandoned: no compatible update trigger for ${container.name} after restart.`,
      });
      abandoned++;
      continue;
    }

    accepted.push({
      container,
      operationId: operation.id,
      trigger,
    });
  }

  if (accepted.length > 0) {
    const bootConcurrency = parseRecoveryBootConcurrency(
      process.env.DD_UPDATE_RECOVERY_BOOT_CONCURRENCY,
    );
    recoveryLog.info(
      `Recovering ${accepted.length} queued update operation${accepted.length === 1 ? '' : 's'} after restart`,
    );
    dispatchAccepted(accepted, { concurrency: bootConcurrency });
  }
  if (abandoned > 0) {
    recoveryLog.warn(
      `Marked ${abandoned} queued update operation${abandoned === 1 ? '' : 's'} as failed because container or trigger could not be resolved after restart`,
    );
  }

  return { resumed: accepted.length, abandoned };
}
