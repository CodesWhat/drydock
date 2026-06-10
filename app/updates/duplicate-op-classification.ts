/**
 * Shared helpers for detecting "benign duplicate-update" failures (issue #410,
 * issue #421).
 *
 * When Docker Compose or an agent races ahead and successfully recreates a
 * container, a lagging queued or in-progress operation may see:
 *   - Docker API 404 "no such container"  (container already replaced)
 *   - HTTP 409 conflict                    (agent already holds the lock)
 *   - "no longer exists" message           (Dockercompose.ts line ~2078)
 *
 * If a recent succeeded operation exists for the same container name, these
 * errors are benign — the update already happened.  Alternatively, if another
 * active (in-progress or queued) operation is present for the same container
 * and agent+watcher identity, the 409 arrived while the winner is still in
 * flight — the outcome is also benign.  We mark such operations `expired`
 * (silent) rather than `failed` (emits update-failed notification).
 *
 * Exported so Docker.ts, ContainerUpdateExecutor.ts, and request-update.ts all
 * share one implementation without a circular import:
 *   duplicate-op-classification → store/update-operation   (no cycle)
 *   Docker.ts / ContainerUpdateExecutor.ts / request-update.ts → duplicate-op-classification
 */

import type { ContainerIdentityFilter } from '../store/update-operation.js';
import * as updateOperationStore from '../store/update-operation.js';

/** 15-minute window for "was there a recent success?" look-back. */
export const DUPLICATE_OP_RECENT_SUCCESS_WINDOW_MS = 15 * 60 * 1000;

/** True for Docker API 404 "no such container" errors. */
export function isContainerNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const err = error as Record<string, unknown>;
  if (typeof err.statusCode === 'number' && err.statusCode === 404) {
    return true;
  }
  if (typeof err.status === 'number' && err.status === 404) {
    return true;
  }
  if (typeof err.message === 'string' && /no such container/i.test(err.message)) {
    return true;
  }
  return false;
}

/** True for HTTP 409 conflict errors (e.g. agent already has an active op). */
export function isConflictError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const err = error as Record<string, unknown>;
  const response = err.response;
  if (
    response &&
    typeof response === 'object' &&
    (response as Record<string, unknown>).status === 409
  ) {
    return true;
  }
  return false;
}

/**
 * True for HTTP 409 responses whose body confirms the agent's active-update
 * lock is the cause of the conflict.
 *
 * The agent's `/api/triggers/:type/:name` endpoint returns
 * `{ error: "Container update already queued" }` or
 * `{ error: "Container update already in progress" }` (via `sendErrorResponse`)
 * when `requestContainerUpdate` throws `UpdateRequestError(409, ...)` for the
 * active-operation hard blocker.  Matching on this message lets the classifier
 * treat the 409 as expired even before the winning operation's `dd:update-applied`
 * SSE arrives on the controller — the remote lock is authoritative.
 */
export function isActiveUpdateConflictError(error: unknown): boolean {
  if (!isConflictError(error)) {
    return false;
  }
  const response = (error as Record<string, unknown>).response as Record<string, unknown>;
  const data = response?.data;
  if (!data || typeof data !== 'object') {
    return false;
  }
  const errorMessage = (data as Record<string, unknown>).error;
  if (typeof errorMessage !== 'string') {
    return false;
  }
  return /container update already (queued|in progress)/i.test(errorMessage);
}

/** True for Dockercompose "no longer exists" container-vanished errors. */
export function isContainerNoLongerExistsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const message = (error as Record<string, unknown>).message;
  return typeof message === 'string' && /no longer exists/i.test(message);
}

/**
 * Return true if the error looks like a benign duplicate-update vanish:
 * Docker 404, HTTP 409, or compose "no longer exists".
 */
export function isDuplicateStyleError(error: unknown): boolean {
  return (
    isContainerNotFoundError(error) ||
    isConflictError(error) ||
    isContainerNoLongerExistsError(error)
  );
}

/**
 * Given an error and the affected container name, decide whether to mark the
 * operation `expired` (benign duplicate, silent) or `failed` (genuine failure,
 * emits update-failed notification).
 *
 * Returns `'expired'` when ANY of the following hold:
 *   1. The error is a duplicate-style vanish AND a terminal `succeeded`
 *      operation for `containerName` exists within the last `windowMs`
 *      milliseconds (optionally filtered by agent+watcher identity).
 *   2. The error is an active-update conflict (409 + active-lock message from
 *      the agent endpoint) — the remote lock is authoritative regardless of
 *      the controller's store state, so no store lookup is needed.
 *   3. The error is a duplicate-style vanish, `excludeOperationId` is provided,
 *      `identity.watcher` is present (so the match is trustworthy), AND another
 *      active (in-progress or queued) operation exists for `containerName` with
 *      the same identity.  Without both guards, legacy rows (no container
 *      snapshot) could cross-match containers on different agents that happen to
 *      share a name (issue #421 cross-agent masking risk).
 *
 * Returns `'failed'` in all other cases.
 */
export function classifyDuplicateOpTerminalStatus(
  error: unknown,
  containerName: string,
  windowMs = DUPLICATE_OP_RECENT_SUCCESS_WINDOW_MS,
  identity?: ContainerIdentityFilter,
  excludeOperationId?: string,
): 'expired' | 'failed' {
  if (!isDuplicateStyleError(error)) {
    return 'failed';
  }

  // (1) Recent succeeded operation for the same container — the update already
  // completed before our operation arrived.
  const recentSuccess = updateOperationStore.getRecentTerminalSucceededOperationByContainerName(
    containerName,
    windowMs,
    identity,
  );
  if (recentSuccess) {
    return 'expired';
  }

  // (2) The 409 payload itself proves the agent's active-update lock is held.
  // The controller's store has no winner row yet (SSE lag), but the agent's
  // lock message is authoritative — the winner will report its own outcome.
  // This branch does NOT require excludeOperationId or a store hit.
  if (isActiveUpdateConflictError(error)) {
    return 'expired';
  }

  // (3) Issue #421: in the duplicate-request race the winning update may still
  // be in flight when the loser's 409 arrives, so no succeeded row exists yet.
  // Require both excludeOperationId (caller must identify itself) AND
  // identity.watcher (so legacy rows without a container snapshot can never
  // cross-match containers from different agents that share a name).
  // Rows older than DD_UPDATE_OPERATION_ACTIVE_TTL_MS are treated as expired
  // by the freshness check inside hasOtherActiveOperationByContainerName, so
  // the TTL should not be set below the longest expected pull (audit follow-up).
  if (
    excludeOperationId &&
    identity?.watcher &&
    updateOperationStore.hasOtherActiveOperationByContainerName(
      containerName,
      excludeOperationId,
      identity,
    )
  ) {
    return 'expired';
  }

  return 'failed';
}
