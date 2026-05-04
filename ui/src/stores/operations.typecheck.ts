import type { ContainerUpdateOperationPhase } from '../types/update-operation';
import type { UiUpdateOperation } from './operations';

declare const operation: UiUpdateOperation;

const phase: ContainerUpdateOperationPhase | undefined = operation.phase;

const validOperation: UiUpdateOperation = {
  operationId: 'op-valid',
  status: 'in-progress',
  phase: 'pulling',
};

const invalidOperation: UiUpdateOperation = {
  operationId: 'op-invalid',
  status: 'in-progress',
  // @ts-expect-error arbitrary phase strings should not be accepted
  phase: 'creating',
};

void phase;
void validOperation;
void invalidOperation;
