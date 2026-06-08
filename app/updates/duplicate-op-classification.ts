/**
 * Shared helpers for detecting "benign duplicate-update" failures (issue #410).
 *
 * When Docker Compose or an agent races ahead and successfully recreates a
 * container, a lagging queued or in-progress operation may see:
 *   - Docker API 404 "no such container"  (container already replaced)
 *   - HTTP 409 conflict                    (agent already holds the lock)
 *   - "no longer exists" message           (Dockercompose.ts line ~2078)
 *
 * If a recent succeeded operation exists for the same container name, these
 * errors are benign — the update already happened.  We mark such operations
 * `expired` (silent) rather than `failed` (emits update-failed notification).
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
 * Returns `'expired'` when:
 *   - the error is a duplicate-style vanish, AND
 *   - a terminal `succeeded` operation for `containerName` exists within the
 *     last `windowMs` milliseconds for the same agent+watcher identity when
 *     identity is available.
 *
 * Returns `'failed'` in all other cases.
 */
export function classifyDuplicateOpTerminalStatus(
  error: unknown,
  containerName: string,
  windowMs = DUPLICATE_OP_RECENT_SUCCESS_WINDOW_MS,
  identity?: ContainerIdentityFilter,
): 'expired' | 'failed' {
  if (!isDuplicateStyleError(error)) {
    return 'failed';
  }
  const recentSuccess = updateOperationStore.getRecentTerminalSucceededOperationByContainerName(
    containerName,
    windowMs,
    identity,
  );
  return recentSuccess ? 'expired' : 'failed';
}
