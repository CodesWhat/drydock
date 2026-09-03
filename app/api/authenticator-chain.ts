/**
 * The ordered authenticator chain.
 *
 * Replaces `passport.use()` plus the global `STRATEGY_IDS` array that
 * `passport.authenticate(getAllIds())` used to index into. Authenticators are
 * registered as objects in a list, tried in registration order, and the first
 * one to return a principal wins.
 *
 * Session persistence is a property of the authenticator, not an argument at
 * the call site. `passport.authenticate(ids, { session: true })` meant every
 * header-authenticated request minted a 30-day session (DR-7); here a header
 * authenticator declares `persistsSession: false` and the chain has no path
 * that can write a session for it.
 */

import type { AuthRequest } from './auth-types.js';
import type { AuthenticatedPrincipal } from './principal.js';
import { writeSessionPrincipal } from './session-principal.js';

const DEFAULT_AUTHENTICATION_FAILURE_STATUS = 401;

/**
 * A terminal refusal. An authenticator returns this instead of `undefined`
 * when the request carried a credential that is unmistakably its own and that
 * credential did not check out, so the chain must stop rather than let a
 * weaker authenticator behind it admit the request.
 *
 * The distinction matters for exactly one reason: an API key is presented as
 * `Authorization: Bearer ddk_…`, and a browser that also holds a session
 * cookie would otherwise have a revoked key silently upgraded back to the
 * cookie's identity. `undefined` means "not my credential, keep going";
 * a rejection means "mine, and it is bad".
 *
 * It carries only a status, which the existing sanitized failure path already
 * knows how to render, so no authenticator can put a message of its own into
 * the response body.
 */
export interface AuthenticationRejection {
  readonly rejected: true;
  readonly status: number;
}

/** What one authenticator, or the whole chain, can answer. */
export type AuthenticationOutcome = AuthenticatedPrincipal | AuthenticationRejection | undefined;

export function isAuthenticationRejection(
  outcome: AuthenticationOutcome,
): outcome is AuthenticationRejection {
  return outcome !== undefined && (outcome as AuthenticationRejection).rejected === true;
}

/**
 * Build a terminal refusal.
 * @param status - the HTTP status the chain should answer with
 */
export function rejectAuthentication(status = DEFAULT_AUTHENTICATION_FAILURE_STATUS) {
  return { rejected: true, status } as const satisfies AuthenticationRejection;
}

export interface Authenticator {
  /** Stable id, used in logs and in registration diagnostics. */
  readonly id: string;

  /**
   * Whether a principal produced by this authenticator may be written into the
   * express-session store. True only for authenticators whose credential *is*
   * the session. Everything that authenticates from a request header declares
   * false, which is the whole mechanism: the chain never reaches a session
   * write for them, so there is no conditional to get wrong.
   */
  readonly persistsSession: boolean;

  /**
   * Resolve the request to a principal, or undefined to let the next
   * authenticator try, or a rejection to stop the chain.
   *
   * Returning undefined must be indistinguishable between "no credential of my
   * kind was presented" and "the credential was wrong", so a caller cannot
   * probe which one happened. An authenticator that owns an unambiguous prefix
   * returns a rejection instead, and then every failure behind that prefix —
   * malformed, unknown, wrong, revoked, expired — must return the identical
   * rejection, for the same reason.
   */
  authenticate(req: AuthRequest): Promise<AuthenticationOutcome>;

  /**
   * Whether this authenticator's presence means a caller can actually get in.
   *
   * Absent means yes. It is declared false by the two authenticators that can
   * only re-present an identity something else already established — the
   * session, and an API key, which cannot exist until somebody authenticated to
   * mint it. A chain holding only those can never admit a first request, so
   * /health must keep reporting 503 rather than open an unguarded dashboard.
   */
  readonly countsTowardReadiness?: boolean;

  /**
   * Optional HTTP status the chain should reject with when nothing in it
   * authenticated. Mirrors Passport's per-strategy `fail(status)`: the first
   * authenticator to name a status wins, and the default is 401.
   */
  getFailureStatus?(req: AuthRequest): number | undefined;
}

const chain: Authenticator[] = [];

export function registerAuthenticator(authenticator: Authenticator): void {
  chain.push(authenticator);
}

export function getAuthenticators(): readonly Authenticator[] {
  return [...chain];
}

/**
 * Empty the chain. Called at the start of every registration pass so that
 * building the chain twice — which only happens in tests, but used to leave
 * passport's id list holding duplicates — yields the same chain both times.
 */
export function clearAuthenticators(): void {
  chain.length = 0;
}

/**
 * Run the chain. Sets `req.principal` and returns it when an authenticator
 * accepts the request, returns a rejection when one refuses terminally, and
 * otherwise returns undefined and leaves the request unauthenticated.
 */
export async function authenticateRequest(req: AuthRequest): Promise<AuthenticationOutcome> {
  for (const authenticator of chain) {
    const outcome = await authenticator.authenticate(req);
    if (outcome === undefined) {
      continue;
    }

    // Terminal: return without touching req.principal, so a rejected request
    // is left unauthenticated rather than half-authenticated, and without
    // running the rest of the chain, so nothing behind it can admit the
    // caller on a different credential.
    if (isAuthenticationRejection(outcome)) {
      return outcome;
    }

    req.principal = outcome;
    if (authenticator.persistsSession) {
      writeSessionPrincipal(req, outcome);
    }
    return outcome;
  }

  return undefined;
}

/**
 * The status to reject with once the whole chain has declined. 401 unless an
 * authenticator asks for something else — Basic asks for 400 on a syntactically
 * broken `Authorization` header, which is what passport-http did.
 */
export function getAuthenticationFailureStatus(req: AuthRequest): number {
  for (const authenticator of chain) {
    const status = authenticator.getFailureStatus?.(req);
    if (status !== undefined) {
      return status;
    }
  }

  return DEFAULT_AUTHENTICATION_FAILURE_STATUS;
}
