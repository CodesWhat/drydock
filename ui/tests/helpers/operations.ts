import type { Pinia } from 'pinia';
import {
  type OperationContainerRef,
  type UiUpdateOperation,
  useOperationStore,
} from '@/stores/operations';

/**
 * Seed an operation for a container into the operations store. Active
 * operations go through the container-list seeding path (so identityKey,
 * updatedAt and versions are indexed like production); terminal ones are
 * applied as an SSE event.
 */
export function seedOperation(
  pinia: Pinia,
  container: OperationContainerRef,
  partialOp: Partial<Omit<UiUpdateOperation, 'lastSeenAt'>> = {},
): UiUpdateOperation {
  const store = useOperationStore(pinia);
  const operationId = partialOp.operationId ?? `op-${container.id}`;
  const status = partialOp.status ?? 'in-progress';

  if (status === 'queued' || status === 'in-progress') {
    store.seedFromContainerList(
      [
        {
          id: container.id,
          identityKey: container.identityKey,
          name: container.name,
          updateOperation: {
            id: operationId,
            status,
            phase: partialOp.phase ?? (status === 'queued' ? 'queued' : 'pulling'),
            updatedAt: partialOp.updatedAt ?? new Date().toISOString(),
            fromVersion: partialOp.fromVersion,
            toVersion: partialOp.toVersion,
            batchId: partialOp.batchId,
            queuePosition: partialOp.queuePosition,
            queueTotal: partialOp.queueTotal,
          },
        },
      ],
      Date.now(),
    );
  } else {
    store.applyOperationChanged({
      operationId,
      containerId: container.id,
      containerName: container.name,
      batchId: partialOp.batchId,
      status,
      phase: partialOp.phase,
    });
  }
  return store.byId[operationId];
}
