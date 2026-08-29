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
   * authenticator try. Returning undefined must be indistinguishable between
   * "no credential of my kind was presented" and "the credential was wrong",
   * so a caller cannot probe which one happened.
   */
  authenticate(req: AuthRequest): Promise<AuthenticatedPrincipal | undefined>;

  /**
   * Optional HTTP status the chain should reject with when nothing in it
   * authenticated. Mirrors Passport's per-strategy `fail(status)`: the first
   * authenticator to name a status wins, and the default is 401.
   */
  getFailureStatus?(req: AuthRequest): number | undefined;
}

const DEFAULT_AUTHENTICATION_FAILURE_STATUS = 401;

const chain: Authenticator[] = [];

export function registerAuthenticator(authenticator: Authenticator): void {
  chain.push(authenticator);
}

export function getAuthenticators(): readonly Authenticator[] {
  return [...chain];
}

export function resetAuthenticatorChainForTests(): void {
  chain.length = 0;
}

/**
 * Run the chain. Sets `req.principal` and returns it when an authenticator
 * accepts the request, otherwise returns undefined and leaves the request
 * unauthenticated.
 */
export async function authenticateRequest(
  req: AuthRequest,
): Promise<AuthenticatedPrincipal | undefined> {
  for (const authenticator of chain) {
    const principal = await authenticator.authenticate(req);
    if (principal === undefined) {
      continue;
    }

    req.principal = principal;
    if (authenticator.persistsSession) {
      writeSessionPrincipal(req, principal);
    }
    return principal;
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
