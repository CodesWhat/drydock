import type { ContainerUpdateOperationPhase } from '../types/update-operation';
import type { UiUpdateOperation } from './operations';

declare const operation: UiUpdateOperation;

const phase: ContainerUpdateOperationPhase | undefined = operation.phase;

const validOperation: UiUpdateOperation = {
  operationId: 'op-valid',
  status: 'in-progress',
  phase: 'pulling',
  lastSeenAt: 0,
};

const invalidOperation: UiUpdateOperation = {
  operationId: 'op-invalid',
  status: 'in-progress',
  // @ts-expect-error arbitrary phase strings should not be accepted
  phase: 'creating',
  lastSeenAt: 0,
};

void phase;
void validOperation;
void invalidOperation;
