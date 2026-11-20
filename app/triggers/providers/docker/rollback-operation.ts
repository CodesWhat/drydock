import log from '../../../log/index.js';
import * as updateOperationStore from '../../../store/update-operation.js';

const rollbackOperationLog = log.child({ component: 'rollback-operation' });

interface RollbackOperationContainer {
  /** Id of the container the rollback is about to stop, which state alerts see. */
  id?: string;
  name: string;
  watcher: string;
  agent?: string;
}

interface RollbackOperationDetails {
  fromVersion?: string;
  toVersion?: string;
  triggerName?: string;
  reason: string;
}

/**
 * Record a rollback as an operation, the same way an update is. Container
 * state alerts suppress stops and exits only while an operation covers the
 * container, so a rollback that left no record raised a "container stopped"
 * alert for Drydock's own action. Bookkeeping must not break the rollback, so
 * a store failure is logged and the rollback goes ahead without a record.
 */
export function startRollbackOperation(
  container: RollbackOperationContainer,
  details: RollbackOperationDetails,
): string | undefined {
  try {
    return updateOperationStore.insertOperation({
      kind: 'rollback',
      status: 'in-progress',
      phase: 'rollback-started',
      containerName: container.name,
      containerId: container.id,
      watcher: container.watcher,
      agent: container.agent,
      fromVersion: details.fromVersion,
      toVersion: details.toVersion,
      triggerName: details.triggerName,
      rollbackReason: details.reason,
    }).id;
  } catch (error: unknown) {
    rollbackOperationLog.warn(
      `Cannot record rollback operation for ${container.name}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

/**
 * Close a rollback operation. A rollback that restored the container ends as
 * `rolled-back`, never `succeeded`: other consumers read `succeeded` as an
 * update that was applied.
 */
export function finishRollbackOperation(
  operationId: string | undefined,
  outcome: { error?: string },
): void {
  if (!operationId) {
    return;
  }
  try {
    if (outcome.error === undefined) {
      updateOperationStore.markOperationTerminal(operationId, {
        status: 'rolled-back',
        phase: 'rolled-back',
      });
    } else {
      updateOperationStore.markOperationTerminal(operationId, {
        status: 'failed',
        phase: 'rollback-failed',
        lastError: outcome.error,
      });
    }
  } catch (error: unknown) {
    rollbackOperationLog.warn(
      `Cannot close rollback operation ${operationId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
