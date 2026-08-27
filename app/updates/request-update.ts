import crypto from 'node:crypto';
import {
  AGENT_LIFECYCLE_UNSUPPORTED_ERROR,
  isAgentLifecycleUnsupported,
  NO_DOCKER_TRIGGER_FOUND_ERROR,
} from '../api/docker-trigger.js';
import {
  buildDependencyGraph,
  buildDependentsByDependency,
  collectContainerIdsWithResolvedDependsOn,
  collectTransitiveDependents,
  resolveDependencyActionKind,
  topologicalSort,
} from '../dependencies/dependency-graph.js';
import logger from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import {
  type ActionPolicyTrigger,
  resolveForTrigger,
  selectActionTrigger,
} from '../model/action-policy.js';
import { type Container, hasRawUpdate } from '../model/container.js';
import {
  computeUpdateEligibility,
  getPrimaryHardBlocker,
  type UpdateBlocker,
  type UpdateBlockerReason,
} from '../model/update-eligibility.js';
import * as registry from '../registry/index.js';
import { getUpdateMode } from '../store/settings.js';
import * as updateOperationStore from '../store/update-operation.js';
import { isSelfUpdateAvailable } from '../triggers/providers/docker/self-update-availability.js';
import { getErrorMessage } from '../util/error.js';
import { restartDependentContainer } from './dependency-restart.js';
import {
  classifyDuplicateOpTerminalStatus,
  isDuplicateStyleError,
} from './duplicate-op-classification.js';
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
  getId: () => string;
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
  dependencyContext?: Container[];
}

export interface AcceptedUpdateDispatchGroup {
  accepted: AcceptedContainerUpdateRequest[];
  dependencyContext: Container[];
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
  operationId?: string;
  allowSoftPolicyOverride?: boolean;
  source?: 'automatic' | 'manual';
}

export interface RequestContainerUpdateOptions
  extends Omit<EnqueueContainerUpdateOptions, 'allowSoftPolicyOverride' | 'source'> {}

const DEFAULT_UPDATE_TRIGGER_TYPES: UpdateTriggerType[] = ['docker', 'dockercompose'];
const log = logger.child({ component: 'updates.request-update' });
const NOTIFY_MODE_REJECTION_MESSAGE = 'Update mode is notify; Drydock will not apply updates';
const MANUAL_MODE_REJECTION_MESSAGE = 'Update mode is manual; automatic updates are disabled';
const ACTION_POLICY_NOT_AUTO_REJECTION_MESSAGE =
  'Action policy for this trigger does not permit automatic updates for this container';

export class UpdateRequestError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'UpdateRequestError';
    this.statusCode = statusCode;
  }
}

export function isUpdateModeAdmissionRejection(
  rejection: Pick<RejectedContainerUpdateRequest, 'message' | 'statusCode'>,
): boolean {
  return (
    rejection.statusCode === 409 &&
    (rejection.message === NOTIFY_MODE_REJECTION_MESSAGE ||
      rejection.message === MANUAL_MODE_REJECTION_MESSAGE)
  );
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

function isResolvedUpdateTrigger(trigger: unknown): trigger is ResolvedUpdateTrigger {
  return (
    typeof trigger === 'object' &&
    trigger !== null &&
    typeof (trigger as { type?: unknown }).type === 'string' &&
    typeof (trigger as { getId?: unknown }).getId === 'function'
  );
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

  // Routed through the action-policy resolver's hybrid multi-trigger walk
  // (spec-6.0.1-action-policy.md) rather than the plain agent/compose
  // compatibility lookup: a candidate that resolves `not-included` is no
  // longer eligible to be the resolved trigger, even though it would have
  // been returned (and, before the slice-6 soft->hard flip, admitted) prior
  // to this wiring. An explicit `dd.action.exclude` hit is still returned
  // (hard stop) so eligibility's `trigger-excluded` messaging is unchanged
  // by this slice. `options.triggerTypes` is honored via `selectActionTrigger`'s
  // own `triggerTypes` option: when provided, candidates whose type is not in
  // the list are excluded before ranking, so a narrower caller-supplied scope
  // (e.g. compose-only) can never fall through to a type it didn't ask for.
  const selection = selectActionTrigger(
    registry.getState().trigger as unknown as Record<string, ActionPolicyTrigger> | undefined,
    container,
    { requireAuto: false, triggerTypes: options.triggerTypes },
  );
  if (!selection) {
    throw new UpdateRequestError(404, NO_DOCKER_TRIGGER_FOUND_ERROR);
  }
  return selection.trigger as unknown as ResolvedUpdateTrigger;
}

function getActiveUpdateOperationForContainer(container: Container) {
  const byId = updateOperationStore.getActiveOperationByContainerId(container.id);
  if (byId) {
    return byId;
  }

  // Fall back to name-based lookup scoped by agent+watcher so that identically-named
  // containers on different agents do not produce a false 409 (issue #411).
  return updateOperationStore.getActiveOperationByContainerName(container.name, {
    agent: container.agent,
    watcher: container.watcher,
  });
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
  'self-update-unavailable': 409,
  snoozed: 409,
  'skip-tag': 409,
  'skip-digest': 409,
  'maturity-not-reached': 409,
  'threshold-not-reached': 409,
  'trigger-excluded': 409,
  'trigger-not-included': 409,
  // soft — manual callers do not reach this code path but the map must be exhaustive
  'maintenance-window-closed': 409,
};

function statusCodeForHardBlocker(blocker: UpdateBlocker): number {
  return HARD_BLOCKER_STATUS[blocker.reason];
}

function markAcceptedQueuedOperationFailed(operationId: string, error: unknown) {
  const operation = updateOperationStore.getOperationById(operationId);
  if (operation?.status !== 'queued') {
    return;
  }
  const operationIdentity =
    operation.container && typeof operation.container.watcher === 'string'
      ? {
          agent: operation.container.agent,
          watcher: operation.container.watcher,
        }
      : undefined;

  // Issue #410 Part B / #421: if this failure looks like a stale-container
  // 404/409 or a compose "no longer exists" AND there is a recent succeeded op
  // for the same container name and source identity, the duplicate update
  // already succeeded — reclassify to `expired` so no false "update failed"
  // notification fires.  Passing operationId activates the active-op check
  // (issue #421) for when the winner is still in flight.
  if (
    isDuplicateStyleError(error) &&
    operation.containerName &&
    classifyDuplicateOpTerminalStatus(
      error,
      operation.containerName,
      undefined,
      operationIdentity,
      operationId,
    ) === 'expired'
  ) {
    updateOperationStore.markOperationTerminal(operationId, {
      status: 'expired',
      phase: 'expired',
      lastError: getErrorMessage(error),
    });
    return;
  }

  updateOperationStore.markOperationTerminal(operationId, {
    status: 'failed',
    phase: 'failed',
    lastError: getErrorMessage(error),
  });
}

function formatAcceptedDispatchContext(accepted: AcceptedContainerUpdateRequest[]): string {
  if (accepted.length === 1) {
    const entry = accepted[0];
    return `${sanitizeLogParam(entry.container.name || entry.container.id || '<unknown>')} (operation ${sanitizeLogParam(entry.operationId)})`;
  }

  const operationIds = accepted
    .map((entry) => sanitizeLogParam(entry.operationId, 80))
    .filter((operationId) => operationId !== '')
    .join(', ');
  return `${accepted.length} accepted updates${operationIds ? ` (operations ${operationIds})` : ''}`;
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

  const updateMode = getUpdateMode();
  // The lower-level enqueue path is used by watcher-driven action triggers.
  // Manual/API callers go through requestContainerUpdate(s), which explicitly
  // override this to manual. Defaulting to automatic keeps future internal
  // callers fail-closed when the global mode is manual.
  const source = options.source ?? 'automatic';
  if (updateMode === 'notify') {
    throw new UpdateRequestError(409, NOTIFY_MODE_REJECTION_MESSAGE);
  }
  if (updateMode === 'manual' && source === 'automatic') {
    throw new UpdateRequestError(409, MANUAL_MODE_REJECTION_MESSAGE);
  }

  // A user-initiated request may intentionally override a soft policy gate. Those
  // gates suppress the public updateAvailable getter, but the raw candidate is
  // still present in image/result and remains safe to pass through hard-blocker
  // enforcement below. Reject only when there is genuinely no candidate.
  //
  // dd.depends_on.action=restart entries are exempt: a restart-kind dependent
  // is designed to never carry its own image update (design §3) — it's
  // admitted here so it gets a real operation record and passes through the
  // same dedup/mode/hard-blocker gates as any other request. Admission alone
  // does not decide restart-vs-update dispatch: if this container turns out
  // to have its own update anyway, or never resolved a dependsOn edge at
  // all, the wave dispatcher's resolveDependencyActionKind (dependency-graph.ts)
  // routes it through the normal trigger instead of
  // restartDependentContainer() (PR #681 review #2/#3).
  if (
    !container.updateAvailable &&
    !(options.allowSoftPolicyOverride === true && hasRawUpdate(container)) &&
    container.dependsOnAction !== 'restart'
  ) {
    throw new UpdateRequestError(400, 'No update available for this container');
  }

  // Reject on any hard eligibility blocker. `trigger-not-included`/`trigger-excluded`
  // became hard in v1.7.0 (spec-6.0.1-action-policy.md slice 6) — see DEPRECATIONS.md —
  // so a container the action-policy resolver did not authorize is now rejected here too,
  // same as any other hard blocker. Soft blockers (snooze, threshold, maturity,
  // skip-tag/digest) still allow manual update — that mirrors the badge layer's "warn but
  // allow" stance for user-policy gates.
  //
  // The raw-candidate check above is the source of truth for "an update exists"
  // when a soft gate deliberately makes updateAvailable false.
  //
  // isAgentPendingRegistration is deliberately NOT wired in here. That softening
  // exists only for display surfaces (container list, SSE enrichment) — admission
  // stays hard/fail-closed so a hard agent-mismatch can never be bypassed to enqueue
  // an update through a wrong-agent trigger during the component re-registration
  // window. See issue #605.
  const eligibility = computeUpdateEligibility(container, {
    triggers: registry.getState().trigger,
    getActiveOperation: () => undefined,
    isSelfUpdateAvailable: isSelfUpdateAvailable(container),
  });
  const hardBlocker = getPrimaryHardBlocker(eligibility);
  if (hardBlocker && hardBlocker.reason !== 'no-update-available') {
    throw new UpdateRequestError(statusCodeForHardBlocker(hardBlocker), hardBlocker.message);
  }

  const trigger = resolveUpdateTrigger(container, options);

  // Defense-in-depth (spec-6.0.1-action-policy.md): now that trigger-excluded/
  // trigger-not-included are 'hard' (slice 6), the hard-blocker check above already
  // rejects a not-included/excluded container regardless of source. This guard stays
  // as belt-and-suspenders for automatic (watcher-driven) admission specifically —
  // it must never fire through anything short of a resolved 'auto' policy even in a
  // future where a not-included/excluded reason's severity changes again — while
  // manual/API callers (source 'manual') keep admitting both 'manual' and 'auto' states.
  if (source === 'automatic') {
    const resolvedPolicy = resolveForTrigger(trigger as unknown as ActionPolicyTrigger, container);
    if (resolvedPolicy.state !== 'auto') {
      throw new UpdateRequestError(409, ACTION_POLICY_NOT_AUTO_REJECTION_MESSAGE);
    }
  }

  return {
    container,
    trigger,
  };
}

function createAcceptedContainerUpdateRequest(
  prepared: PreparedContainerUpdateRequest,
  batchMetadata?: UpdateQueueBatchMetadata,
  providedOperationId?: string,
): AcceptedContainerUpdateRequest {
  const operationId = providedOperationId ?? crypto.randomUUID();

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
      container: prepared.container,
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
  return createAcceptedContainerUpdateRequest(
    prepareContainerUpdateRequest(container, options),
    undefined,
    options.operationId,
  );
}

export async function enqueueContainerUpdates(
  containers: Container[],
  options: EnqueueContainerUpdateOptions = {},
): Promise<ContainerUpdateRequestBatchResult> {
  let preparedAccepted: PreparedContainerUpdateRequest[] = [];
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

  const { edges } = buildDependencyGraph(containers);
  const containerIdsWithResolvedDependsOn = collectContainerIdsWithResolvedDependsOn(edges);
  const lifecycleSupported: PreparedContainerUpdateRequest[] = [];
  for (const prepared of preparedAccepted) {
    const actionKind = resolveDependencyActionKind(
      prepared.container,
      containerIdsWithResolvedDependsOn,
    );
    if (actionKind === 'restart' && isAgentLifecycleUnsupported(prepared.container)) {
      rejected.push({
        container: prepared.container,
        message: AGENT_LIFECYCLE_UNSUPPORTED_ERROR,
        statusCode: 501,
      });
      continue;
    }
    lifecycleSupported.push(prepared);
  }
  preparedAccepted = lifecycleSupported;

  if (rejected.length > 0 && preparedAccepted.length > 0) {
    const dependentsByDependency = buildDependentsByDependency(edges);
    const blockingRejectionByContainerId = new Map<string, RejectedContainerUpdateRequest>();

    for (const blockingRejection of rejected) {
      for (const dependentId of collectTransitiveDependents(
        blockingRejection.container.id,
        dependentsByDependency,
      )) {
        blockingRejectionByContainerId.set(dependentId, blockingRejection);
      }
    }

    const stillAccepted: PreparedContainerUpdateRequest[] = [];
    for (const prepared of preparedAccepted) {
      const blockingRejection = blockingRejectionByContainerId.get(prepared.container.id);
      if (!blockingRejection) {
        stillAccepted.push(prepared);
        continue;
      }
      rejected.push({
        container: prepared.container,
        message: `Required upstream dependency ${blockingRejection.container.id} was not admitted`,
        statusCode: 409,
      });
    }
    preparedAccepted = stillAccepted;
  }

  const queueTotal = preparedAccepted.length;
  const batchId = queueTotal > 1 ? crypto.randomUUID() : undefined;
  // Only honor the caller-supplied operationId for single-container batches.
  // Multi-container batches generate one UUID per container to keep rows distinct.
  const singleContainerOperationId =
    queueTotal === 1 && options.operationId ? options.operationId : undefined;
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
      singleContainerOperationId,
    ),
  );

  return {
    accepted,
    rejected,
  };
}

interface SkipDependencyInfo {
  reason: 'upstream-failed';
  blockingContainerId: string;
  blockingOperationId: string;
}

function markEntrySkippedDependency(
  entry: AcceptedContainerUpdateRequest,
  skipInfo: SkipDependencyInfo,
): void {
  updateOperationStore.markOperationTerminal(entry.operationId, {
    status: 'skipped-dependency',
    phase: 'skipped-dependency',
    skippedDependencyReason: skipInfo.reason,
    blockingContainerId: skipInfo.blockingContainerId,
    blockingOperationId: skipInfo.blockingOperationId,
    lastError: `Skipped: upstream dependency ${sanitizeLogParam(skipInfo.blockingContainerId)} failed (operation ${sanitizeLogParam(skipInfo.blockingOperationId)})`,
  });
}

/**
 * Dispatch already-accepted update requests wave by wave, ordered by the
 * dependency graph resolved over this batch's own containers (v1.7 Phase 6.1,
 * #219 — design §3). A batch with no `dd.depends_on` edges resolves to a
 * single wave containing every entry, which is dispatched exactly as before
 * this feature existed — this is a strict no-op for the common case.
 *
 * Entries whose `dependsOnAction` label resolves to `restart` are dispatched
 * via the dependency-chain restart primitive instead of the trigger's normal
 * pull/update lifecycle (no pull, no SecurityGate, no rollback monitor — a
 * same-image restart isn't an update) — but only when genuinely restart-only:
 * `resolveDependencyActionKind` requires a resolved `dependsOn` edge for this
 * entry in this batch's graph AND no update of its own. A `restart` label
 * with no resolved edge, or one whose own update is available, dispatches
 * through the normal trigger instead (PR #681 review #2/#3).
 *
 * If an entry fails, its transitive dependents (via the resolved graph) are
 * never dispatched — they are terminalised as `skipped-dependency` instead,
 * recording which upstream container/operation blocked them. Entries outside
 * the failed chain are unaffected: they occupy their own wave slot and run
 * exactly as they would have without this feature.
 */
export async function runAcceptedContainerUpdates(
  accepted: AcceptedContainerUpdateRequest[],
  options: AcceptedUpdateDispatchOptions = {},
): Promise<void> {
  if (accepted.length === 0) {
    return;
  }

  const concurrency = options.concurrency ?? accepted.length;
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new Error(`Accepted update dispatch concurrency must be a positive integer`);
  }

  const entryById = new Map(accepted.map((entry) => [entry.container.id, entry]));
  const dependencyContext = options.dependencyContext ?? accepted.map((entry) => entry.container);
  const { nodes, edges, unresolved, crossHostIgnored } = buildDependencyGraph(dependencyContext);
  const { waves } = topologicalSort(nodes, edges);
  const dependentsByDependency = buildDependentsByDependency(edges);
  const containerIdsWithResolvedDependsOn = collectContainerIdsWithResolvedDependsOn(edges);

  if (unresolved.length > 0 || crossHostIgnored.length > 0) {
    log.warn(
      `Dependency graph for this update batch has ${unresolved.length} unresolved target(s) and ${crossHostIgnored.length} cross-host edge(s) ignored; affected containers dispatch unordered relative to those targets`,
    );
  }

  let firstError: unknown;
  const toSkip = new Map<string, SkipDependencyInfo>();

  for (const wave of waves) {
    const waveEntries: AcceptedContainerUpdateRequest[] = [];
    for (const id of wave) {
      const entry = entryById.get(id);
      /* The dependency context can include entries rejected during admission,
         so only dispatch wave members that have an accepted operation. */
      if (!entry) {
        continue;
      }
      const skipInfo = toSkip.get(id);
      if (skipInfo) {
        markEntrySkippedDependency(entry, skipInfo);
        continue;
      }
      waveEntries.push(entry);
    }

    if (waveEntries.length === 0) {
      continue;
    }

    const failedEntriesThisWave: AcceptedContainerUpdateRequest[] = [];
    let nextIndex = 0;

    async function runNextWaveEntry(): Promise<void> {
      while (nextIndex < waveEntries.length) {
        const entry = waveEntries[nextIndex];
        nextIndex++;
        const actionKind = resolveDependencyActionKind(
          entry.container,
          containerIdsWithResolvedDependsOn,
        );
        try {
          if (actionKind === 'restart') {
            await restartDependentContainer(entry.container);
            updateOperationStore.markOperationTerminal(entry.operationId, {
              status: 'succeeded',
              phase: 'succeeded',
            });
          } else {
            await entry.trigger.trigger(entry.container, { operationId: entry.operationId });
          }
        } catch (error: unknown) {
          markAcceptedQueuedOperationFailed(entry.operationId, error);
          failedEntriesThisWave.push(entry);
          firstError ??= error;
        }
      }
    }

    const workerCount = Math.min(concurrency, waveEntries.length);
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        await runNextWaveEntry();
      }),
    );

    for (const failedEntry of failedEntriesThisWave) {
      const descendants = collectTransitiveDependents(
        failedEntry.container.id,
        dependentsByDependency,
      );
      for (const descendantId of descendants) {
        if (!toSkip.has(descendantId)) {
          toSkip.set(descendantId, {
            reason: 'upstream-failed',
            blockingContainerId: failedEntry.container.id,
            blockingOperationId: failedEntry.operationId,
          });
        }
      }
    }
  }

  if (firstError) {
    throw firstError;
  }
}

/**
 * Dispatch already-accepted update requests in the background. Per-operation
 * failures are terminalised inside the lifecycle handler (see Docker.ts). Log
 * the background rejection for operators, then swallow it to avoid unhandled
 * rejections.
 */
export function dispatchAccepted(
  accepted: AcceptedContainerUpdateRequest[],
  options: AcceptedUpdateDispatchOptions = {},
): void {
  void runAcceptedContainerUpdates(accepted, options).catch((error: unknown) => {
    log.warn(
      `Accepted update dispatch failed for ${formatAcceptedDispatchContext(accepted)}: ${sanitizeLogParam(getErrorMessage(error), 500)}`,
    );
  });
}

/**
 * Dispatch independent accepted batches sequentially in the background. Each
 * batch gets its own dependency graph while the configured concurrency remains
 * a process-wide startup cap instead of multiplying across recovered batches.
 */
export function dispatchAcceptedGroups(
  groups: AcceptedUpdateDispatchGroup[],
  options: Pick<AcceptedUpdateDispatchOptions, 'concurrency'> = {},
): void {
  void (async () => {
    for (const group of groups) {
      try {
        await runAcceptedContainerUpdates(group.accepted, {
          ...options,
          dependencyContext: group.dependencyContext,
        });
      } catch (error: unknown) {
        log.warn(
          `Accepted update dispatch failed for ${formatAcceptedDispatchContext(group.accepted)}: ${sanitizeLogParam(getErrorMessage(error), 500)}`,
        );
      }
    }
  })();
}

export async function requestContainerUpdate(
  container: Container,
  options: RequestContainerUpdateOptions = {},
): Promise<AcceptedContainerUpdateRequest> {
  const accepted = await enqueueContainerUpdate(container, {
    ...options,
    allowSoftPolicyOverride: true,
    source: 'manual',
  });
  dispatchAccepted([accepted]);
  return accepted;
}

export async function requestContainerUpdates(
  containers: Container[],
  options: RequestContainerUpdateOptions = {},
): Promise<ContainerUpdateRequestBatchResult> {
  const result = await enqueueContainerUpdates(containers, {
    ...options,
    allowSoftPolicyOverride: true,
    source: 'manual',
  });
  dispatchAccepted(result.accepted, { dependencyContext: containers });
  return result;
}
