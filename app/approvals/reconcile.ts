/**
 * Approval reconciler (spec-ca-2-approval-queue.md, slice 2).
 *
 * The ledger stores decisions; the candidate set stays derived. Every watch cycle
 * re-answers "should this candidate be in the queue?" and this module makes the stored
 * rows agree with that answer, so it is idempotent by construction: an unchanged
 * container produces the same verdict on every cycle and a row that already matches it is
 * left untouched. Nothing here re-derives eligibility — `classifyApprovalCandidate` owns
 * that, so the queue can never disagree with the Update button about the same container.
 *
 * **The ledger is controller-owned (the DR-8 lesson).** The only writers are the
 * listeners registered below, and `init()` is called from the controller branch of the
 * entrypoint. `processAuthoritativeContainer` and the `dd:container_sync` bulk path never
 * reach an approval-store write, so an enrolled agent can neither mint, decide, nor
 * resolve a row; a rejected sync frame emits an empty batch and mints nothing. The
 * record's `agent` field is a filter, not a capability.
 *
 * Every listener is failure-isolated. Reconciliation is bookkeeping that hangs off the
 * watch cycle, and the update lifecycle awaits the same emit chain, so a store error here
 * must never propagate into the cycle that produced the report.
 */
import {
  type ContainerLifecycleEventPayload,
  type ContainerUpdateAppliedEvent,
  type ContainerUpdateFailedEventPayload,
  registerContainerRemoved,
  registerContainerReport,
  registerContainerReports,
  registerContainerUpdateApplied,
  registerContainerUpdateFailed,
} from '../event/index.js';
import logger from '../log/index.js';
import type { ActionPolicyTrigger } from '../model/action-policy.js';
import {
  type ApprovalOutcome,
  type ApprovalRecord,
  type ApprovalResolution,
  buildApprovalRecordInput,
  classifyApprovalCandidate,
  isApprovalResolved,
} from '../model/approval.js';
import type { Container, ContainerReport } from '../model/container.js';
import * as registry from '../registry/index.js';
import {
  type ApprovalPatch,
  findApprovalByOperationId,
  findApprovalsByContainerId,
  insertApproval,
  updateApproval,
} from '../store/approval.js';
import { getUpdateMode } from '../store/settings.js';
import { isSelfUpdateAvailable } from '../triggers/providers/docker/self-update-availability.js';
import { getErrorMessage } from '../util/error.js';

const log = logger.child({ component: 'approvals' });

/** Handler id, so the reconciler's position in the ordered emit chain is deterministic. */
const APPROVAL_HANDLER_ID = 'approvals';

let deregistrations: Array<() => void> = [];

function getActionTriggers(): Record<string, ActionPolicyTrigger> | undefined {
  return registry.getState().trigger as unknown as Record<string, ActionPolicyTrigger>;
}

/**
 * A row still waiting on an operator: never resolved out of the queue, and never decided
 * by one. An approved row points at a running operation and a rejected row is a recorded
 * answer — neither is the reconciler's to supersede or withdraw.
 */
function isOpen(record: ApprovalRecord): boolean {
  if (isApprovalResolved(record)) {
    return false;
  }
  return record.decision === 'pending' || record.decision === 'deferred';
}

function resolveRows(
  records: ApprovalRecord[],
  resolution: ApprovalResolution,
  extra: ApprovalPatch = {},
): void {
  const resolvedAt = new Date().toISOString();
  for (const record of records) {
    updateApproval(record.id, { ...extra, resolution, resolvedAt });
  }
}

/**
 * Make the rows for one container agree with the current verdict. Runs for every
 * container on every watch cycle, including unchanged ones — a candidate can leave the
 * queue without its container changing (the global update mode flipped, a trigger's
 * policy changed), and `changed` only describes the detection result.
 * @param container
 */
export function reconcileContainer(container: Container | undefined): void {
  if (!container?.id) {
    return;
  }

  const openRows = findApprovalsByContainerId(container.id).filter(isOpen);
  const verdict = classifyApprovalCandidate(
    container,
    getActionTriggers(),
    getUpdateMode(),
    // Resolved per container: it depends on this container's watcher configuration, and
    // it is the difference between Drydock's own container being queueable and its
    // `self-update-unavailable` hard blocker firing.
    { isSelfUpdateAvailable: isSelfUpdateAvailable(container) },
  );

  if (verdict === 'no-candidate') {
    resolveRows(openRows, 'candidate-withdrawn');
    return;
  }

  const input = buildApprovalRecordInput(container);
  if (input === undefined) {
    // A created-date-only detection on a legacy v1 manifest: a real candidate that will
    // not name itself. It cannot be inserted (nothing to dedupe on) and it cannot resolve
    // an existing row either, because there is no ref to compare against.
    return;
  }

  // A row pointing at a different candidate is stale whatever the new candidate's own
  // fate is — the operator would otherwise be asked to approve a version that is no
  // longer the one on offer.
  resolveRows(
    openRows.filter((row) => row.candidateRef !== input.candidateRef),
    'superseded',
  );
  const currentRows = openRows.filter((row) => row.candidateRef === input.candidateRef);

  if (verdict === 'auto-dispatch') {
    // The normal trigger path owns this candidate now, so the row would sit pending
    // forever behind an update that is about to happen without an operator.
    resolveRows(currentRows, 'auto-applied', { decidedBy: 'system' });
    return;
  }

  // `blocked` leaves the queue exactly as it is: the candidate still stands, the hard
  // blocker may lift on any cycle, and an operator reading the row wants the history.
  if (verdict === 'blocked' || currentRows.length > 0) {
    return;
  }

  insertApproval(input);
}

function stampOutcome(operationId: string | undefined, outcome: ApprovalOutcome): void {
  if (operationId === undefined) {
    return;
  }
  const record = findApprovalByOperationId(operationId);
  if (record === undefined) {
    return;
  }
  updateApproval(record.id, { outcome });
}

/** Pre-v1.5.0 callers emit the container name as a bare string, which carries no id. */
function getAppliedOperationId(payload: ContainerUpdateAppliedEvent): string | undefined {
  return typeof payload === 'string' ? undefined : payload.operationId;
}

function runSafely(action: () => void): void {
  try {
    action();
  } catch (error) {
    log.warn(`Approval reconciliation failed: ${getErrorMessage(error)}`);
  }
}

function handleContainerReport(report: ContainerReport): void {
  runSafely(() => reconcileContainer(report.container));
}

function handleContainerReports(reports: ContainerReport[]): void {
  // Per report rather than per batch, so one container's failure cannot skip the rest.
  for (const report of reports) {
    handleContainerReport(report);
  }
}

function handleContainerRemoved(payload: ContainerLifecycleEventPayload): void {
  runSafely(() => {
    const containerId = payload.id;
    if (containerId === undefined) {
      return;
    }
    resolveRows(findApprovalsByContainerId(containerId).filter(isOpen), 'container-removed');
  });
}

function handleContainerUpdateApplied(payload: ContainerUpdateAppliedEvent): void {
  runSafely(() => stampOutcome(getAppliedOperationId(payload), 'applied'));
}

function handleContainerUpdateFailed(payload: ContainerUpdateFailedEventPayload): void {
  runSafely(() =>
    stampOutcome(
      payload.operationId,
      payload.rollbackReason === undefined ? 'failed' : 'rolled-back',
    ),
  );
}

/**
 * Register the reconciler's listeners. Idempotent, so a second call cannot double every
 * row: the entrypoint calls it once, and tests call it freely.
 */
export function init(): void {
  if (deregistrations.length > 0) {
    return;
  }

  deregistrations = [
    registerContainerReport(handleContainerReport, { id: APPROVAL_HANDLER_ID }),
    registerContainerReports(handleContainerReports, { id: APPROVAL_HANDLER_ID }),
    registerContainerRemoved(handleContainerRemoved),
    registerContainerUpdateApplied(handleContainerUpdateApplied, { id: APPROVAL_HANDLER_ID }),
    registerContainerUpdateFailed(handleContainerUpdateFailed, { id: APPROVAL_HANDLER_ID }),
  ];
}

/** Drop every listener this module registered. */
export function deregisterForTests(): void {
  for (const deregister of deregistrations) {
    deregister();
  }
  deregistrations = [];
}
