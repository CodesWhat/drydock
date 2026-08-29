/**
 * Reading and writing the authenticated identity inside the express-session
 * payload, plus the session authenticator that fronts the chain.
 *
 * This is the only module that knows the on-disk session shape.
 */

import type { NextFunction, Request, Response } from 'express';
import log from '../log/index.js';
import { getErrorMessage } from '../util/error.js';
import { deserializeSessionUser } from './auth-session.js';
import type { AuthRequest } from './auth-types.js';
import type { Authenticator } from './authenticator-chain.js';
import type { AuthenticatedPrincipal } from './principal.js';

/**
 * Key the serialized user is stored under inside the session payload.
 *
 * It is literally `passport` because that is the key Passport wrote for every
 * release up to and including v1.7. Renaming it would invalidate every session
 * already persisted in /store/dd.json and log every user out on upgrade, so the
 * name stays: it is an on-disk format, not a dependency. `util/session-limit.ts`
 * and `api/ws-upgrade-utils.ts` read the same key.
 */
export const SESSION_USER_KEY = 'passport';

export const SESSION_AUTHENTICATOR_ID = 'session';

const MISSING_SESSION_SUPPORT_MESSAGE =
  'Login sessions require session support. Did you forget to use `express-session` middleware?';

type SessionUserContainer = { user?: unknown };

function getSession(req: AuthRequest): Record<string, unknown> | undefined {
  return req.session as unknown as Record<string, unknown> | undefined;
}

function getSessionUserContainer(req: AuthRequest): SessionUserContainer | undefined {
  const container = getSession(req)?.[SESSION_USER_KEY];
  if (!container || typeof container !== 'object') {
    return undefined;
  }
  return container as SessionUserContainer;
}

function serializePrincipal(principal: AuthenticatedPrincipal): string {
  return JSON.stringify({ username: principal.username });
}

/**
 * Restore the identity a previous login persisted, or undefined when there is
 * none. A payload that no longer deserializes is dropped from the session so
 * the next request starts clean, which is what Passport's SessionStrategy did.
 */
export function readSessionPrincipal(req: AuthRequest): AuthenticatedPrincipal | undefined {
  const container = getSessionUserContainer(req);
  if (!container || container.user === undefined) {
    return undefined;
  }

  try {
    return { kind: 'session', username: deserializeSessionUser(container.user).username };
  } catch (error: unknown) {
    log.warn(`Unable to deserialize session user (${getErrorMessage(error)})`);
    delete container.user;
    return undefined;
  }
}

/**
 * Persist an identity into the session. Writing the same value twice would mark
 * the session dirty and force a needless store round-trip on every request, so
 * an unchanged payload is left alone.
 */
export function writeSessionPrincipal(req: AuthRequest, principal: AuthenticatedPrincipal): void {
  const session = getSession(req);
  if (!session) {
    return;
  }

  const serialized = serializePrincipal(principal);
  const container = getSessionUserContainer(req);
  if (container) {
    if (container.user === serialized) {
      return;
    }
    container.user = serialized;
    return;
  }

  session[SESSION_USER_KEY] = { user: serialized };
}

/**
 * Drop the identity from the session, the way Passport's `req.logout()` did.
 * Throws when there is no session at all, which is the error `req.logout()`
 * reported and which the logout route turns into a 500.
 */
export function clearSessionPrincipal(req: AuthRequest): void {
  req.principal = undefined;

  if (!getSession(req)) {
    throw new Error(MISSING_SESSION_SUPPORT_MESSAGE);
  }

  const container = getSessionUserContainer(req);
  if (container) {
    delete container.user;
  }
}

/**
 * First link in the chain: a request that already carries a valid session
 * resolves to that identity before any credential is inspected.
 *
 * This is the only authenticator that declares `persistsSession: true` — its
 * credential *is* the session.
 */
export const sessionAuthenticator: Authenticator = {
  id: SESSION_AUTHENTICATOR_ID,
  persistsSession: true,
  authenticate: (req: AuthRequest) => Promise.resolve(readSessionPrincipal(req)),
};

/**
 * Express middleware replacing `passport.session()`. Mounted immediately after
 * express-session so that everything downstream — rate limiters included — sees
 * the same session identity Passport used to publish as `req.user`.
 */
export function restoreSessionPrincipal(req: Request, _res: Response, next: NextFunction): void {
  const principal = readSessionPrincipal(req as AuthRequest);
  if (principal !== undefined) {
    req.principal = principal;
  }
  next();
}
