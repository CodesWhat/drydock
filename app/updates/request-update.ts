import crypto from 'node:crypto';
import {
  findDockerTriggerForContainer,
  NO_DOCKER_TRIGGER_FOUND_ERROR,
} from '../api/docker-trigger.js';
import type { Container } from '../model/container.js';
import {
  computeUpdateEligibility,
  getPrimaryHardBlocker,
  type UpdateBlocker,
  type UpdateBlockerReason,
} from '../model/update-eligibility.js';
import * as registry from '../registry/index.js';
import * as updateOperationStore from '../store/update-operation.js';
import { hasUpdateConcurrencyCap } from './update-locks.js';

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
  configuration?: object;
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

export interface AcceptedUpdateDispatchOptions {
  concurrency?: number;
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

export interface RequestContainerUpdateOptions extends EnqueueContainerUpdateOptions {}

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

// Complete map covers every UpdateBlockerReason so callers never hit a missing
// entry; soft reasons get 409 because they are not expected to reach this code
// path (callers gate via getPrimaryHardBlocker), but if they ever do we still
// return a sensible status code instead of undefined.
const HARD_BLOCKER_STATUS: Record<UpdateBlockerReason, number> = {
  'no-update-available': 400,
  'agent-mismatch': 404,
  'no-update-trigger-configured': 404,
  'rollback-container': 409,
  'security-scan-blocked': 409,
  'last-update-rolled-back': 409,
  'active-operation': 409,
  snoozed: 409,
  'skip-tag': 409,
  'skip-digest': 409,
  'maturity-not-reached': 409,
  'threshold-not-reached': 409,
  'trigger-excluded': 409,
  'trigger-not-included': 409,
};

function statusCodeForHardBlocker(blocker: UpdateBlocker): number {
  return HARD_BLOCKER_STATUS[blocker.reason];
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
  // Active-operation gate first — preserves the original error wording for callers that
  // distinguish "queued" vs "in progress" by message text.
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

  // Reject on any hard eligibility blocker. Soft blockers (snooze, threshold, maturity,
  // skip-tag/digest, trigger-not-included/excluded) still allow manual update — that
  // mirrors the badge layer's "warn but allow" stance for user-policy gates.
  //
  // We trust container.updateAvailable (checked above) as the source of truth for
  // "an update exists" and ignore eligibility's no-update-available short-circuit, which
  // uses a stricter raw-tag/digest comparison meant for the watch loop.
  const eligibility = computeUpdateEligibility(container, {
    triggers: registry.getState().trigger,
    getActiveOperation: () => undefined,
  });
  const hardBlocker = getPrimaryHardBlocker(eligibility);
  if (hardBlocker && hardBlocker.reason !== 'no-update-available') {
    throw new UpdateRequestError(statusCodeForHardBlocker(hardBlocker), hardBlocker.message);
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

  // Suppress the `queued` SSE when no global concurrency cap is configured:
  // every accepted update runs as soon as it is dispatched, so the UI would
  // otherwise see a useless "Queued" flash for the microsecond between insert
  // and the executor's `in-progress` transition. With a cap in place, real
  // waiting can occur — keep the SSE so users see the queue.
  const skipChangeEvent = !hasUpdateConcurrencyCap();

  updateOperationStore.insertOperation(
    {
      id: operationId,
      containerId: prepared.container.id,
      containerName: prepared.container.name,
      status: 'queued',
      phase: 'queued',
      ...batchMetadata,
    },
    { skipChangeEvent },
  );

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

export async function runAcceptedContainerUpdates(
  accepted: AcceptedContainerUpdateRequest[],
  options: AcceptedUpdateDispatchOptions = {},
): Promise<void> {
  if (accepted.length === 0) {
    return;
  }

  const concurrency = options.concurrency ?? 1;
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new Error(`Accepted update dispatch concurrency must be a positive integer`);
  }

  let firstError: unknown;
  let nextIndex = 0;

  async function runNextAcceptedUpdate(): Promise<void> {
    while (nextIndex < accepted.length) {
      const entry = accepted[nextIndex];
      nextIndex++;
      try {
        await entry.trigger.trigger(entry.container, { operationId: entry.operationId });
      } catch (error: unknown) {
        markAcceptedQueuedOperationFailed(entry.operationId, error);
        firstError ??= error;
      }
    }
  }

  const workerCount = Math.min(concurrency, accepted.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      await runNextAcceptedUpdate();
    }),
  );

  if (firstError) {
    throw firstError;
  }
}

/**
 * Dispatch already-accepted update requests in the background. Per-operation
 * failures are terminalised inside the lifecycle handler (see Docker.ts), so
 * the rejection from runAcceptedContainerUpdates carries no information that
 * isn't already persisted on the operation row — swallow it to avoid
 * unhandled rejections.
 */
export function dispatchAccepted(
  accepted: AcceptedContainerUpdateRequest[],
  options: AcceptedUpdateDispatchOptions = {},
): void {
  void runAcceptedContainerUpdates(accepted, options).catch(() => undefined);
}

export async function requestContainerUpdate(
  container: Container,
  options: RequestContainerUpdateOptions = {},
): Promise<AcceptedContainerUpdateRequest> {
  const accepted = await enqueueContainerUpdate(container, options);
  dispatchAccepted([accepted]);
  return accepted;
}

export async function requestContainerUpdates(
  containers: Container[],
  options: RequestContainerUpdateOptions = {},
): Promise<ContainerUpdateRequestBatchResult> {
  const result = await enqueueContainerUpdates(containers, options);
  dispatchAccepted(result.accepted);
  return result;
}
