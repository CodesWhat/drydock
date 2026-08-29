/**
 * Pure approval-queue model (spec-ca-2-approval-queue.md, slice 1).
 *
 * The queue is the manual update path made durable, not a third update mode: there is
 * no new `updateMode` value and no new `UpdateBlockerReason`. A pending row exists for
 * exactly the candidate set that today renders an enabled Update button and will not be
 * auto-dispatched. Everything live — soft blockers, eligibility, release-notes body,
 * current vulnerability counts — is read from the container at render time; the record
 * below freezes only what identifies the decision.
 *
 * Nothing here touches the store, the registry, or the event bus, so the predicate can
 * be exercised as a table.
 */
import type { UpdateMode } from '../store/settings.js';
import { type ActionPolicyTrigger, selectActionTrigger } from './action-policy.js';
import { type Container, getContainerIdentityKey, hasRawUpdate } from './container.js';
import {
  computeUpdateEligibility,
  getPrimaryHardBlocker,
  type UpdateEligibilityContext,
} from './update-eligibility.js';

export const APPROVAL_SCHEMA_VERSION = 1;

export type ApprovalDecision = 'pending' | 'approved' | 'rejected' | 'deferred';
export type ApprovalResolution =
  | 'superseded'
  | 'container-removed'
  | 'candidate-withdrawn'
  | 'auto-applied';
export type ApprovalOutcome = 'applied' | 'rolled-back' | 'failed';
export type ApprovalUpdateKind = 'tag' | 'digest' | 'unknown';
export type ApprovalSemverDiff = 'major' | 'minor' | 'patch' | 'prerelease' | 'unknown';

/**
 * One row per `(containerId, candidateRef)`, inserted on first sighting so `createdAt`
 * (time-in-queue) is real.
 *
 * Migration-friendliness rules, enforced by review rather than by a test: no nested
 * objects, no arrays, no index signature, every field a scalar with an obvious column
 * type. This maps 1:1 onto a SQLite table at the v1.8 store migration — table
 * `approval`, PK `id`, `UNIQUE (container_id, candidate_ref)`, index on
 * `(decision, created_at_ms)`. Carrying both `containerId` and `containerIdentityKey`
 * is what lets the ID-based-container-identity change re-key rows without orphaning
 * them.
 *
 * `schemaVersion` is typed `number` rather than the literal `1` so a row written by a
 * future version round-trips through the read path without a cast; new rows are always
 * written at `APPROVAL_SCHEMA_VERSION`.
 */
export interface ApprovalRecord {
  schemaVersion: number;
  id: string;
  containerId: string;
  containerIdentityKey: string;
  containerName: string;
  watcher: string;
  agent?: string;
  image: string;
  fromRef: string;
  toRef: string;
  candidateRef: string;
  updateKind: ApprovalUpdateKind;
  semverDiff: ApprovalSemverDiff;
  releaseNotesUrl?: string;
  scanCritical?: number;
  scanHigh?: number;
  scanMedium?: number;
  scanLow?: number;
  scanUnknown?: number;
  scanAt?: string;
  createdAt: string;
  createdAtMs: number;
  decision: ApprovalDecision;
  decidedAt?: string;
  decidedBy?: string;
  decisionNote?: string;
  deferredUntil?: string;
  operationId?: string;
  outcome?: ApprovalOutcome;
  resolvedAt?: string;
  resolution?: ApprovalResolution;
}

/** Container-derived half of a record; the store owns id, schemaVersion and timestamps. */
export type ApprovalRecordInput = Pick<
  ApprovalRecord,
  | 'containerId'
  | 'containerIdentityKey'
  | 'containerName'
  | 'watcher'
  | 'image'
  | 'fromRef'
  | 'toRef'
  | 'candidateRef'
  | 'updateKind'
  | 'semverDiff'
> &
  Partial<
    Pick<
      ApprovalRecord,
      | 'agent'
      | 'releaseNotesUrl'
      | 'scanCritical'
      | 'scanHigh'
      | 'scanMedium'
      | 'scanLow'
      | 'scanUnknown'
      | 'scanAt'
    >
  >;

export interface ShouldQueueForApprovalOptions {
  isSelfUpdateAvailable?: boolean;
}

/**
 * `shouldQueueForApproval(container, triggers, updateMode)`:
 *
 *      hasRawUpdate(container)                                   # NOT updateAvailable
 *  AND getPrimaryHardBlocker(computeUpdateEligibility(...)) is undefined
 *  AND NOT ( updateMode === 'auto'
 *            AND selectActionTrigger(triggers, container, { requireAuto: true }) is auto )
 *
 * `hasRawUpdate`, not `container.updateAvailable`, is load-bearing: soft gates (snooze,
 * threshold, maturity, skip-tag/skip-digest, maintenance window) suppress the public
 * `updateAvailable` getter while the raw candidate stays in `image`/`result`. Keying off
 * `updateAvailable` would make every soft-gated container invisible to the queue, which
 * is precisely the set an operator most wants to review; soft blockers instead render as
 * the row's hold reasons.
 *
 * The auto conjunct tests the resolved state rather than the mere presence of a result,
 * because an explicit `dd.action.exclude` match is returned as a `blocked` verdict even
 * under `requireAuto`. That case is already excluded by the hard-blocker conjunct
 * (`trigger-excluded` is hard), so the two forms agree today; testing the state keeps
 * them agreeing if that severity ever changes again.
 *
 * There is deliberately no injectable clock: every time-dependent blocker (`snoozed`,
 * `maturity-not-reached`) is soft, so no value of `now` can change this answer. The
 * queue's only time-dependent state is deferral, which is a query predicate on the
 * record rather than an input to the predicate.
 */
export function shouldQueueForApproval(
  container: Container,
  triggers: Record<string, ActionPolicyTrigger> | undefined,
  updateMode: UpdateMode,
  options: ShouldQueueForApprovalOptions = {},
): boolean {
  if (!hasRawUpdate(container)) {
    return false;
  }

  const eligibility = computeUpdateEligibility(container, {
    triggers: triggers as unknown as UpdateEligibilityContext['triggers'],
    // An in-flight operation is a transient hard blocker on the Update button, not a
    // statement about the candidate — the admission path in `updates/request-update.ts`
    // passes the same stub for the same reason and gates active operations separately.
    // Without this, approving a row would make the next watch cycle stop seeing its own
    // candidate.
    getActiveOperation: () => undefined,
    ...(options.isSelfUpdateAvailable !== undefined
      ? { isSelfUpdateAvailable: options.isSelfUpdateAvailable }
      : {}),
  });

  if (getPrimaryHardBlocker(eligibility) !== undefined) {
    return false;
  }

  if (updateMode !== 'auto') {
    return true;
  }

  return selectActionTrigger(triggers, container, { requireAuto: true })?.state !== 'auto';
}

/**
 * Dedupe key for a candidate: the strongest identity available, digest before tag.
 * Matches the candidate identity the `last-update-rolled-back` blocker scopes itself to,
 * so a row and that blocker can never disagree about which candidate they mean.
 */
export function getApprovalCandidateRef(container: Container): string | undefined {
  return container.result?.digest ?? container.result?.tag;
}

function getScanFields(container: Container): Partial<ApprovalRecordInput> {
  const updateScan = container.security?.updateScan;
  if (!updateScan) {
    return {};
  }
  return {
    scanCritical: updateScan.summary.critical,
    scanHigh: updateScan.summary.high,
    scanMedium: updateScan.summary.medium,
    scanLow: updateScan.summary.low,
    scanUnknown: updateScan.summary.unknown,
    scanAt: updateScan.scannedAt,
  };
}

/**
 * Derive the container-owned half of a record. Returns `undefined` when the candidate
 * carries neither a tag nor a digest — a created-date-only detection on a legacy v1
 * manifest — because without a stable ref the row could not dedupe against itself on the
 * next watch cycle.
 */
export function buildApprovalRecordInput(container: Container): ApprovalRecordInput | undefined {
  const candidateRef = getApprovalCandidateRef(container);
  if (candidateRef === undefined) {
    return undefined;
  }

  const updateKind = container.updateKind?.kind ?? 'unknown';
  const identityKey = getContainerIdentityKey(container);
  const releaseNotesUrl = container.result?.releaseNotes?.url;

  return {
    containerId: container.id,
    containerIdentityKey: identityKey ?? container.id,
    containerName: container.name,
    watcher: container.watcher,
    ...(container.agent !== undefined ? { agent: container.agent } : {}),
    image: container.image.name,
    fromRef: container.updateKind?.localValue ?? container.image.tag?.value ?? '',
    toRef: container.updateKind?.remoteValue ?? candidateRef,
    candidateRef,
    updateKind,
    semverDiff: container.updateKind?.semverDiff ?? 'unknown',
    ...(releaseNotesUrl !== undefined ? { releaseNotesUrl } : {}),
    ...getScanFields(container),
  };
}

/** A row that left the queue without a human decision (superseded, container gone, ...). */
export function isApprovalResolved(record: ApprovalRecord): boolean {
  return record.resolvedAt !== undefined;
}

/**
 * Deferral is a query predicate, not a job: a row is deferred iff it was deferred and
 * its `deferredUntil` is still in the future. There is no sweep, so no clock-skew bug,
 * no orphaned timer and no restart-recovery path. A missing or unparseable
 * `deferredUntil` reads as expired, which returns the row to the queue rather than
 * hiding it forever.
 */
export function isApprovalDeferred(record: ApprovalRecord, nowMs: number): boolean {
  if (record.decision !== 'deferred' || isApprovalResolved(record)) {
    return false;
  }
  if (record.deferredUntil === undefined) {
    return false;
  }
  const deferredUntilMs = Date.parse(record.deferredUntil);
  return Number.isFinite(deferredUntilMs) && deferredUntilMs > nowMs;
}

/** Awaiting an operator: never decided, or deferred past its expiry, and never resolved. */
export function isApprovalPending(record: ApprovalRecord, nowMs: number): boolean {
  if (isApprovalResolved(record)) {
    return false;
  }
  if (record.decision === 'pending') {
    return true;
  }
  return record.decision === 'deferred' && !isApprovalDeferred(record, nowMs);
}
