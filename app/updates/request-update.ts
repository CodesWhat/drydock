import crypto from 'node:crypto';
import {
  findDockerTriggerForContainer,
  NO_DOCKER_TRIGGER_FOUND_ERROR,
} from '../api/docker-trigger.js';
import type { Container } from '../model/container.js';
import * as registry from '../registry/index.js';
import * as updateOperationStore from '../store/update-operation.js';
import Trigger from '../triggers/providers/Trigger.js';

interface UpdateQueueBatchMetadata {
  batchId: string;
  queuePosition: number;
  queueTotal: number;
}

type UpdateTriggerType = 'docker' | 'dockercompose';

type UpdateTriggerLike = {
  type: string;
  trigger: (container: Container, runtimeContext?: unknown) => Promise<unknown>;
};

type ResolvedUpdateTrigger = UpdateTriggerLike & {
  agent?: string;
  configuration?: Record<string, unknown>;
  getDefaultComposeFilePath?: () => string | null;
  getComposeFilesForContainer?: (container: {
    name?: string;
    labels?: Record<string, string>;
    watcher?: string;
  }) => string[];
};

export interface AcceptedContainerUpdateRequest {
  container: Container;
  operationId: string;
  trigger: UpdateTriggerLike;
}

export interface RejectedContainerUpdateRequest {
  container: Container;
  message: string;
  statusCode: number;
}

export interface ContainerUpdateRequestBatchResult {
  accepted: AcceptedContainerUpdateRequest[];
  rejected: RejectedContainerUpdateRequest[];
}

type PreparedContainerUpdateRequest = {
  container: Container;
  trigger: UpdateTriggerLike;
};

interface EnqueueContainerUpdateOptions {
  trigger?: UpdateTriggerLike;
  triggerTypes?: UpdateTriggerType[];
}

interface RunAcceptedContainerUpdatesOptions {
  executeAcceptedUpdates?: (accepted: AcceptedContainerUpdateRequest[]) => Promise<void>;
  onSuccess?: (accepted: AcceptedContainerUpdateRequest) => Promise<void> | void;
  onFailure?: (accepted: AcceptedContainerUpdateRequest, error: unknown) => Promise<void> | void;
}

export interface RequestContainerUpdateOptions
  extends EnqueueContainerUpdateOptions,
    RunAcceptedContainerUpdatesOptions {}

const DEFAULT_UPDATE_TRIGGER_TYPES: UpdateTriggerType[] = ['docker', 'dockercompose'];

export class UpdateRequestError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'UpdateRequestError';
    this.statusCode = statusCode;
  }
}

function toRejectedContainerUpdateRequest(
  container: Container,
  error: UpdateRequestError,
): RejectedContainerUpdateRequest {
  return {
    container,
    message: error.message,
    statusCode: error.statusCode,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isResolvedUpdateTrigger(trigger: UpdateTriggerLike): trigger is ResolvedUpdateTrigger {
  return typeof trigger === 'object' && trigger !== null && typeof trigger.type === 'string';
}

function resolveUpdateTrigger(
  container: Container,
  options: EnqueueContainerUpdateOptions,
): ResolvedUpdateTrigger {
  const providedTrigger = options.trigger;
  if (providedTrigger) {
    if (!isResolvedUpdateTrigger(providedTrigger)) {
      throw new UpdateRequestError(500, 'Invalid update trigger');
    }
    if (!DEFAULT_UPDATE_TRIGGER_TYPES.includes(providedTrigger.type as UpdateTriggerType)) {
      throw new UpdateRequestError(400, 'Trigger is not a container update trigger');
    }
    return providedTrigger;
  }

  const trigger = findDockerTriggerForContainer(registry.getState().trigger, container, {
    triggerTypes: options.triggerTypes || DEFAULT_UPDATE_TRIGGER_TYPES,
  });
  if (!trigger) {
    throw new UpdateRequestError(404, NO_DOCKER_TRIGGER_FOUND_ERROR);
  }
  return trigger as ResolvedUpdateTrigger;
}

function getActiveUpdateOperationForContainer(container: Container) {
  const byId = updateOperationStore.getActiveOperationByContainerId(container.id);
  if (byId) {
    return byId;
  }

  const byName = updateOperationStore.getActiveOperationByContainerName(container.name);
  const isLegacyOperation =
    byName && typeof byName === 'object' && !('containerId' in (byName as Record<string, unknown>));
  return isLegacyOperation ? byName : undefined;
}

function markAcceptedQueuedOperationFailed(operationId: string, error: unknown) {
  const operation = updateOperationStore.getOperationById(operationId);
  if (operation?.status !== 'queued') {
    return;
  }

  updateOperationStore.markOperationTerminal(operationId, {
    status: 'failed',
    phase: 'failed',
    lastError: getErrorMessage(error),
  });
}

function prepareContainerUpdateRequest(
  container: Container,
  options: EnqueueContainerUpdateOptions = {},
): PreparedContainerUpdateRequest {
  const activeOperation = getActiveUpdateOperationForContainer(container);
  if (activeOperation) {
    throw new UpdateRequestError(
      409,
      `Container update already ${activeOperation.status === 'queued' ? 'queued' : 'in progress'}`,
    );
  }

  if (!container.updateAvailable) {
    throw new UpdateRequestError(400, 'No update available for this container');
  }

  if (Trigger.isRollbackContainer(container)) {
    throw new UpdateRequestError(
      409,
      'Cannot update temporary rollback container renamed with -old-{timestamp}',
    );
  }

  if (container.security?.scan?.status === 'blocked') {
    throw new UpdateRequestError(
      409,
      'Update blocked by security scan. Use force-update to override.',
    );
  }

  return {
    container,
    trigger: resolveUpdateTrigger(container, options),
  };
}

function createAcceptedContainerUpdateRequest(
  prepared: PreparedContainerUpdateRequest,
  batchMetadata?: UpdateQueueBatchMetadata,
): AcceptedContainerUpdateRequest {
  const operationId = crypto.randomUUID();

  updateOperationStore.insertOperation({
    id: operationId,
    containerId: prepared.container.id,
    containerName: prepared.container.name,
    status: 'queued',
    phase: 'queued',
    ...batchMetadata,
  });

  return {
    container: prepared.container,
    operationId,
    trigger: prepared.trigger,
  };
}

export function buildAcceptedUpdateRuntimeContext(
  accepted: AcceptedContainerUpdateRequest[],
): Record<string, unknown> {
  if (accepted.length === 1) {
    return { operationId: accepted[0].operationId };
  }

  return {
    operationIds: Object.fromEntries(
      accepted
        .filter((entry) => typeof entry.container.id === 'string' && entry.container.id !== '')
        .map((entry) => [entry.container.id, entry.operationId]),
    ),
  };
}

export async function enqueueContainerUpdate(
  container: Container,
  options: EnqueueContainerUpdateOptions = {},
): Promise<AcceptedContainerUpdateRequest> {
  return createAcceptedContainerUpdateRequest(prepareContainerUpdateRequest(container, options));
}

export async function enqueueContainerUpdates(
  containers: Container[],
  options: EnqueueContainerUpdateOptions = {},
): Promise<ContainerUpdateRequestBatchResult> {
  const preparedAccepted: PreparedContainerUpdateRequest[] = [];
  const rejected: RejectedContainerUpdateRequest[] = [];

  for (const container of containers) {
    try {
      preparedAccepted.push(prepareContainerUpdateRequest(container, options));
    } catch (error: unknown) {
      if (error instanceof UpdateRequestError) {
        rejected.push(toRejectedContainerUpdateRequest(container, error));
        continue;
      }
      throw error;
    }
  }

  const queueTotal = preparedAccepted.length;
  const batchId = queueTotal > 1 ? crypto.randomUUID() : undefined;
  const accepted = preparedAccepted.map((prepared, index) =>
    createAcceptedContainerUpdateRequest(
      prepared,
      batchId
        ? {
            batchId,
            queuePosition: index + 1,
            queueTotal,
          }
        : undefined,
    ),
  );

  return {
    accepted,
    rejected,
  };
}

async function defaultExecuteAcceptedUpdates(accepted: AcceptedContainerUpdateRequest[]) {
  for (const entry of accepted) {
    await entry.trigger.trigger(entry.container, { operationId: entry.operationId });
  }
}

export async function runAcceptedContainerUpdates(
  accepted: AcceptedContainerUpdateRequest[],
  options: RunAcceptedContainerUpdatesOptions = {},
): Promise<void> {
  if (accepted.length === 0) {
    return;
  }

  try {
    await (options.executeAcceptedUpdates || defaultExecuteAcceptedUpdates)(accepted);
    if (options.onSuccess) {
      for (const entry of accepted) {
        await options.onSuccess(entry);
      }
    }
  } catch (error: unknown) {
    for (const entry of accepted) {
      markAcceptedQueuedOperationFailed(entry.operationId, error);
    }
    if (options.onFailure) {
      for (const entry of accepted) {
        await options.onFailure(entry, error);
      }
    }
    throw error;
  }
}

export async function requestContainerUpdate(
  container: Container,
  options: RequestContainerUpdateOptions = {},
): Promise<AcceptedContainerUpdateRequest> {
  const accepted = await enqueueContainerUpdate(container, options);
  void runAcceptedContainerUpdates([accepted], options).catch(() => undefined);
  return accepted;
}

export async function requestContainerUpdates(
  containers: Container[],
  options: RequestContainerUpdateOptions = {},
): Promise<ContainerUpdateRequestBatchResult> {
  const result = await enqueueContainerUpdates(containers, options);
  void runAcceptedContainerUpdates(result.accepted, options).catch(() => undefined);
  return result;
}
