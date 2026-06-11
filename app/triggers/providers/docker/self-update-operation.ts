import crypto from 'node:crypto';
import { issueSelfUpdateFinalizeSecret } from '../../../api/internal-self-update.js';
import * as updateOperationStore from '../../../store/update-operation.js';
import { getRequestedOperationId } from './update-runtime-context.js';

type SelfUpdateContainer = {
  id?: string;
  name: string;
  image?: {
    tag?: {
      value?: string;
    };
  };
  updateKind?: {
    localValue?: string;
    remoteValue?: string;
  };
};

type SelfUpdateContext = {
  newImage?: string;
  currentContainerSpec?: {
    Id?: string;
    Name?: string;
    State?: {
      Running?: boolean;
    };
  };
};

export interface PrepareSelfUpdateOperationArgs {
  container: SelfUpdateContainer;
  context: SelfUpdateContext;
  triggerName?: string;
  runtimeContext?: unknown;
  now?: () => string;
  createOperationId?: () => string;
}

function normalizeContainerName(name: unknown): string | undefined {
  if (typeof name !== 'string') {
    return undefined;
  }
  const trimmed = name.replace(/^\//, '').trim();
  return trimmed !== '' ? trimmed : undefined;
}

export function prepareSelfUpdateOperation(args: PrepareSelfUpdateOperationArgs): string {
  const requestedOperationId = getRequestedOperationId(args.container, args.runtimeContext);
  const generateOperationId = args.createOperationId || crypto.randomUUID;
  const currentContainerSpec = args.context.currentContainerSpec;
  const oldName = normalizeContainerName(currentContainerSpec?.Name);
  const fromVersion =
    args.container.updateKind?.localValue || args.container.image?.tag?.value || undefined;
  const toVersion =
    args.container.updateKind?.remoteValue || args.container.image?.tag?.value || undefined;

  const operationFields = {
    kind: 'self-update' as const,
    containerId: args.container.id,
    containerName: args.container.name,
    triggerName: args.triggerName,
    oldContainerId: currentContainerSpec?.Id,
    oldName,
    oldContainerWasRunning: currentContainerSpec?.State?.Running === true,
    fromVersion,
    toVersion,
    targetImage: args.context.newImage,
    status: 'in-progress' as const,
    phase: 'prepare' as const,
  };

  // Resolve the final operation id before issuing any secrets.
  const existingOperation = requestedOperationId
    ? updateOperationStore.getOperationById(requestedOperationId)
    : undefined;

  const isReusable =
    existingOperation &&
    (existingOperation.status === 'queued' || existingOperation.status === 'in-progress');

  const operationId = isReusable
    ? requestedOperationId!
    : requestedOperationId && !existingOperation
      ? requestedOperationId
      : generateOperationId();

  const { secretHash } = issueSelfUpdateFinalizeSecret(operationId);

  const operationFieldsWithSecret = { ...operationFields, finalizeSecretHash: secretHash };

  const operation = isReusable
    ? updateOperationStore.updateOperation(operationId, {
        ...operationFieldsWithSecret,
        completedAt: undefined,
        lastError: undefined,
        rollbackReason: undefined,
        newContainerId: undefined,
      })
    : updateOperationStore.insertOperation({
        id: operationId,
        createdAt: args.now?.(),
        updatedAt: args.now?.(),
        ...operationFieldsWithSecret,
      });

  if (!operation) {
    throw new Error('Failed to prepare self-update operation');
  }

  return operation.id;
}

export function markSelfUpdateOperationFailed(
  operationId: string,
  lastError: string,
): ReturnType<typeof updateOperationStore.markOperationTerminal> {
  return updateOperationStore.markOperationTerminal(operationId, {
    status: 'failed',
    lastError,
  });
}

export function markSelfUpdateOperationSkipped(
  operationId: string,
  lastError: string,
): ReturnType<typeof updateOperationStore.markOperationTerminal> {
  return updateOperationStore.markOperationTerminal(operationId, {
    status: 'expired',
    lastError,
  });
}
