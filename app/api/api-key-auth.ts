/**
 * API key authentication.
 *
 * Registered first in the chain, ahead of Basic, OIDC, session and anonymous.
 * It reads `Authorization` and returns `undefined` immediately unless the value
 * is `Bearer ddk_…`, so every other scheme is reached untouched by
 * construction: the authenticator never inspects, consumes or logs a credential
 * that is not its own. Nothing else in the codebase uses the `ddk_` prefix, so
 * the OIDC bearer path, Basic auth, the /metrics bearer and the webhook bearer
 * are all provably unaffected.
 *
 * A credential that *does* carry the prefix and fails gets a terminal
 * rejection, not a fall-through. Falling through would mean a browser holding
 * both a session cookie and a revoked key silently keeps working under the
 * cookie's identity, which is the opposite of what revoking a key is for. Every
 * owned-prefix failure — malformed, unknown id, wrong secret, revoked, expired
 * — returns the identical 401, so no failure mode is distinguishable from
 * another.
 *
 * This module writes no session code at all: not a conditional, not a flag.
 * `persistsSession: false` on the registration is the entire mechanism, so
 * there is no path here that could persist one even by mistake (DR-7).
 *
 * Keys are accepted only in the `Authorization` header. Never a query
 * parameter, never a custom header, because a credential in a URL lands in
 * every access log and referrer.
 */

import { ipKeyGenerator } from 'express-rate-limit';
import { recordApiKeyUsage, verifyApiKey } from '../store/api-key.js';
import { recordApiKeyAuthFailureAuditEvent } from './api-key-audit.js';
import { extractApiKeyCredential } from './api-key-credential.js';
import type { AuthRequest } from './auth-types.js';
import {
  type AuthenticationOutcome,
  type Authenticator,
  rejectAuthentication,
} from './authenticator-chain.js';
import type { AuthenticatedPrincipal } from './principal.js';

export const API_KEY_AUTHENTICATOR_ID = 'api-key';

/**
 * The failed-attempt budget, per client address, per window.
 *
 * The outer API limiter gives a key its own bucket once it can see one, which
 * is what stops several integrations behind one NAT from sharing a budget.
 * The id in that bucket comes off an unauthenticated header, so on its own it
 * would also hand an attacker a fresh budget per made-up id. This is the other
 * half: however many buckets a caller can mint, the failures it can spend
 * across all of them are capped per address.
 *
 * 30 a minute is far above any real client. A key either works or it does not,
 * so a legitimate integration fails once and then stops, or fails on every
 * poll — and a poll loop fast enough to spend 30 failures a minute is already
 * misconfigured. Successful requests are never charged, so no scrape interval
 * and no number of integrations can exhaust it.
 */
export const API_KEY_AUTH_FAILURE_WINDOW_MS = 60 * 1000;
export const API_KEY_AUTH_MAX_FAILURES_PER_SOURCE = 30;

/**
 * Above this many tracked addresses, expired windows are swept and, failing
 * that, the least recently seen address is evicted. An IPv6 /56 still leaves an
 * attacker plenty of distinct sources, and an unbounded map would be the memory
 * the budget exists to protect. Evicting a live entry refunds that address its
 * budget, which is the deliberate trade: an attacker holding 1,000 addresses
 * can already spend 30,000 failures a minute without any eviction at all.
 */
const AUTH_FAILURE_SOURCE_LIMIT = 1000;

interface FailureBudget {
  windowStartedAtMs: number;
  failures: number;
}

const failureBudgetsBySource = new Map<string, FailureBudget>();

/**
 * Which budget a request spends from.
 *
 * `ipKeyGenerator` collapses an IPv6 address to its allocation prefix, so a
 * single /56 is one source rather than 2^72 of them. A request with no
 * discoverable address shares one bucket, which is the conservative reading:
 * it cannot be attributed, so it is not given its own budget.
 * @param req
 */
function getFailureBudgetSource(req: AuthRequest): string {
  const address =
    typeof req.ip === 'string' && req.ip.length > 0
      ? req.ip
      : (req.socket?.remoteAddress ?? undefined);
  return address === undefined ? 'unknown' : ipKeyGenerator(address);
}

function isOverFailureBudget(source: string, nowMs: number): boolean {
  const budget = failureBudgetsBySource.get(source);
  if (budget === undefined || nowMs - budget.windowStartedAtMs >= API_KEY_AUTH_FAILURE_WINDOW_MS) {
    return false;
  }
  return budget.failures >= API_KEY_AUTH_MAX_FAILURES_PER_SOURCE;
}

function evictFailureBudgetsIfFull(nowMs: number): void {
  if (failureBudgetsBySource.size < AUTH_FAILURE_SOURCE_LIMIT) {
    return;
  }
  for (const [source, budget] of failureBudgetsBySource) {
    if (nowMs - budget.windowStartedAtMs >= API_KEY_AUTH_FAILURE_WINDOW_MS) {
      failureBudgetsBySource.delete(source);
    }
  }
  // Map iteration is insertion order, so this walks oldest first.
  for (const source of failureBudgetsBySource.keys()) {
    if (failureBudgetsBySource.size < AUTH_FAILURE_SOURCE_LIMIT) {
      break;
    }
    failureBudgetsBySource.delete(source);
  }
}

function chargeFailureBudget(source: string, nowMs: number): void {
  const budget = failureBudgetsBySource.get(source);
  if (budget !== undefined && nowMs - budget.windowStartedAtMs < API_KEY_AUTH_FAILURE_WINDOW_MS) {
    budget.failures += 1;
    return;
  }
  evictFailureBudgetsIfFull(nowMs);
  // Re-inserted rather than updated so Map iteration order stays oldest-first,
  // which is what makes the eviction above evict the right entry.
  failureBudgetsBySource.delete(source);
  failureBudgetsBySource.set(source, { windowStartedAtMs: nowMs, failures: 1 });
}

export function _resetApiKeyAuthFailureBudgetForTests(): void {
  failureBudgetsBySource.clear();
}

export function _apiKeyAuthFailureSourceCountForTests(): number {
  return failureBudgetsBySource.size;
}

/**
 * Resolve a verified key record to the principal the request carries.
 *
 * `username` is the key's operator-supplied name so that response bodies and
 * audit lines read the same for a key as for a person. It is not unique, which
 * is exactly why `keyId` travels alongside it: the rate limiter and the audit
 * trail both key on the id, never on the name.
 */
function toApiKeyPrincipal(record: {
  keyId: string;
  name: string;
  scopes: string[];
  parentKeyId: string | null;
  rateLimitMax?: number;
}): AuthenticatedPrincipal {
  return {
    kind: 'api-key',
    username: record.name,
    keyId: record.keyId,
    scopes: [...record.scopes],
    parentKeyId: record.parentKeyId,
    ...(record.rateLimitMax !== undefined ? { rateLimitMax: record.rateLimitMax } : {}),
  };
}

/**
 * The authenticator itself.
 *
 * `countsTowardReadiness: false` keeps /health's fail-closed behaviour intact.
 * A key can only exist if somebody already authenticated to mint it, so a chain
 * holding nothing but this authenticator can never admit a first request, the
 * same reasoning that excludes the session authenticator.
 */
export const apiKeyAuthenticator: Authenticator = {
  id: API_KEY_AUTHENTICATOR_ID,
  persistsSession: false,
  countsTowardReadiness: false,
  authenticate: (req: AuthRequest): Promise<AuthenticationOutcome> => {
    const credential = extractApiKeyCredential(req);
    if (credential === undefined) {
      return Promise.resolve(undefined);
    }

    const source = getFailureBudgetSource(req);
    const nowMs = Date.now();
    if (isOverFailureBudget(source, nowMs)) {
      // Refused before the digest comparison, so a spray costs the attacker a
      // request and costs this process a map lookup. Still terminal, so the
      // rest of the chain never sees it, and still audited, so the attempt is
      // not silently dropped from the trail.
      recordApiKeyAuthFailureAuditEvent(credential);
      return Promise.resolve(rejectAuthentication(429));
    }

    const record = verifyApiKey(credential);
    if (record === null) {
      chargeFailureBudget(source, nowMs);
      recordApiKeyAuthFailureAuditEvent(credential);
      return Promise.resolve(rejectAuthentication());
    }

    // Throttled to one store write per key per minute inside the store, so a
    // 10-second-poll integration does not re-serialise the LokiJS file on
    // every request.
    recordApiKeyUsage(record.keyId);

    return Promise.resolve(toApiKeyPrincipal(record));
  },
};
