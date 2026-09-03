/**
 * Audit records for API key lifecycle and authentication failures.
 *
 * `AuditEntry.containerName` is required by the type even though none of these
 * events concerns a container, so they use a fixed sentinel the way
 * `auth-audit.ts` does for `auth-login`. An audit reader filters on the action,
 * not on the sentinel.
 *
 * Nothing here ever receives, logs or records a secret. The only identifier
 * that reaches an audit row is `keyId`, which is the non-secret half of the
 * credential and is safe to log by construction.
 */

import { recordAuthApiKeyFailure } from '../prometheus/auth.js';
import { parseApiKey } from '../store/api-key.js';
import { recordAuditEvent } from './audit-events.js';

/** Stand-in for the container an API key event does not have. */
export const API_KEY_AUDIT_SENTINEL = 'api-key';

/**
 * At most one failure row per source key per minute. An attacker spraying keys
 * would otherwise fill the audit collection, which is both a denial of service
 * against the audit trail and the thing that hides the real entry in it.
 */
export const API_KEY_AUTH_FAILURE_AUDIT_THROTTLE_MS = 60 * 1000;

/**
 * Above this many tracked sources, expired entries are swept before a new one
 * is added. Without a bound the throttle map is itself the memory the spray
 * attack was trying to exhaust, because every random `keyId` mints an entry.
 *
 * The sweep only frees entries past their window, so on its own it is not a
 * bound: 1,000 *fresh* sources free nothing and the map keeps growing. What
 * makes it one is the row budget below, which admits at most
 * API_KEY_AUTH_FAILURE_AUDIT_MAX_ROWS_PER_WINDOW new sources per window, so
 * everything already in the map is a window old by the time the cap is
 * reached. Map size is therefore bounded by the cap plus one window's budget.
 */
const AUTH_FAILURE_SOURCE_LIMIT = 1000;

/**
 * Ceiling on failure rows written per window, across every source.
 *
 * The per-source throttle bounds a repeat offender; it does nothing about an
 * attacker who never repeats an id, and the id is the attacker's to choose. A
 * spray of distinct ids wrote one row each, so the audit collection grew at
 * whatever rate the network allowed and kept it for the full 30-day retention
 * — a denial of service against the audit trail, and the thing that hides the
 * real entry in it.
 *
 * 100 matches METRICS_AUTH_MAX_FAILURES, the failure budget the metrics route
 * already runs on, and it is far above what a real deployment produces: keys
 * are counted in tens, and a failing one repeats rather than rotating its id.
 * Past the budget the Prometheus counter still takes every call, so the volume
 * of an attack stays visible even while the rows stop.
 */
export const API_KEY_AUTH_FAILURE_AUDIT_MAX_ROWS_PER_WINDOW = 100;

/** Source label for a credential that never parsed, so it has no `keyId`. */
export const UNPARSEABLE_KEY_SOURCE = 'unparseable';

const authFailureLastRecordedMs = new Map<string, number>();
let auditRowBudgetWindowStartedAtMs: number | undefined;
let auditRowsWrittenInWindow = 0;

/**
 * Which bucket a failed credential throttles against.
 *
 * A well-formed credential throttles on its own `keyId`, so one noisy
 * integration cannot mask another key's failures. Everything malformed shares
 * a single bucket: it has no id to key on, and giving each malformed string
 * its own bucket would defeat the throttle entirely, since the attacker
 * chooses the string.
 * @param credential - the raw presented credential
 */
export function getAuthFailureSource(credential: string): string {
  return parseApiKey(credential)?.keyId ?? UNPARSEABLE_KEY_SOURCE;
}

/**
 * Take one row out of this window's global budget, or refuse.
 * @param nowMs
 */
function claimAuditRowBudget(nowMs: number): boolean {
  if (
    auditRowBudgetWindowStartedAtMs === undefined ||
    nowMs - auditRowBudgetWindowStartedAtMs >= API_KEY_AUTH_FAILURE_AUDIT_THROTTLE_MS
  ) {
    auditRowBudgetWindowStartedAtMs = nowMs;
    auditRowsWrittenInWindow = 0;
  }
  if (auditRowsWrittenInWindow >= API_KEY_AUTH_FAILURE_AUDIT_MAX_ROWS_PER_WINDOW) {
    return false;
  }
  auditRowsWrittenInWindow += 1;
  return true;
}

function sweepExpiredSources(nowMs: number): void {
  for (const [source, recordedMs] of authFailureLastRecordedMs) {
    if (nowMs - recordedMs >= API_KEY_AUTH_FAILURE_AUDIT_THROTTLE_MS) {
      authFailureLastRecordedMs.delete(source);
    }
  }
}

/**
 * Record a failed API key authentication.
 *
 * The Prometheus counter takes every call; the audit row is throttled. So the
 * volume of an attack stays visible in metrics even while the audit trail
 * keeps one line per source per minute.
 * @param credential - the raw presented credential, never stored or logged
 * @param now
 * @returns whether an audit row was written
 */
export function recordApiKeyAuthFailureAuditEvent(credential: string, now = new Date()): boolean {
  recordAuthApiKeyFailure();

  const source = getAuthFailureSource(credential);
  const nowMs = now.getTime();
  const lastRecordedMs = authFailureLastRecordedMs.get(source);
  if (
    lastRecordedMs !== undefined &&
    nowMs - lastRecordedMs < API_KEY_AUTH_FAILURE_AUDIT_THROTTLE_MS
  ) {
    return false;
  }

  // After the per-source throttle, so a repeat offender inside its own window
  // is refused without spending a row another source could have used.
  if (!claimAuditRowBudget(nowMs)) {
    return false;
  }

  if (authFailureLastRecordedMs.size >= AUTH_FAILURE_SOURCE_LIMIT) {
    sweepExpiredSources(nowMs);
  }
  authFailureLastRecordedMs.set(source, nowMs);

  recordAuditEvent({
    action: 'api-key-auth-failed',
    status: 'error',
    containerName: API_KEY_AUDIT_SENTINEL,
    details: `API key authentication failed; keyId=${source}`,
  });
  return true;
}

/**
 * Record a key being minted.
 * @param keyId
 * @param createdBy - `user:<username>` or `api-key:<parentKeyId>`
 * @param scopes
 */
export function recordApiKeyCreatedAuditEvent(
  keyId: string,
  createdBy: string,
  scopes: readonly string[],
): void {
  recordAuditEvent({
    action: 'api-key-created',
    status: 'success',
    containerName: API_KEY_AUDIT_SENTINEL,
    details: `Created API key ${keyId}; by=${createdBy}; scopes=${scopes.join(',')}`,
  });
}

/**
 * Record a revocation, including how many descendants it cascaded to.
 * @param keyId
 * @param revokedBy
 * @param revokedKeyIds - the root plus every descendant this call revoked
 */
export function recordApiKeyRevokedAuditEvent(
  keyId: string,
  revokedBy: string,
  revokedKeyIds: readonly string[],
): void {
  recordAuditEvent({
    action: 'api-key-revoked',
    status: 'success',
    containerName: API_KEY_AUDIT_SENTINEL,
    details: `Revoked API key ${keyId}; by=${revokedBy}; cascade=${revokedKeyIds.length}`,
  });
}

export function _resetApiKeyAuditThrottleForTests(): void {
  authFailureLastRecordedMs.clear();
  auditRowBudgetWindowStartedAtMs = undefined;
  auditRowsWrittenInWindow = 0;
}

export function _apiKeyAuditTrackedSourceCountForTests(): number {
  return authFailureLastRecordedMs.size;
}
