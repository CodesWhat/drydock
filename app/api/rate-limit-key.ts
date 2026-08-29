import type { Request } from 'express';
import { ipKeyGenerator, type ValueDeterminingMiddleware } from 'express-rate-limit';
import {
  type AuthenticatedPrincipal,
  getIdentityUsername,
  isIdentityPrincipal,
} from './principal.js';

export type IdentityAwareRateLimitRequestLike = {
  ip?: unknown;
  socket?: {
    remoteAddress?: unknown;
  };
  principal?: AuthenticatedPrincipal;
  sessionID?: unknown;
};

/**
 * Whether this request carries an identity a budget can be charged to.
 *
 * Anonymous access does not count. It produces a principal so that the access
 * gate has something to read, but every anonymous caller is the same caller,
 * and express-session mints a fresh sessionID per cookie-less request — keying
 * on it would hand every request its own budget. This is the same answer
 * passport's `req.isAuthenticated()` gave, which was `!!req.user`, and
 * passport-anonymous never set a user.
 */
export function isRequestAuthenticated(
  request: Pick<IdentityAwareRateLimitRequestLike, 'principal'>,
): boolean {
  return isIdentityPrincipal(request.principal);
}

function getTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getIpRateLimitKey(
  request: Pick<IdentityAwareRateLimitRequestLike, 'ip' | 'socket'>,
): string {
  const requestIp = getTrimmedString(request.ip) || getTrimmedString(request.socket?.remoteAddress);
  if (!requestIp) {
    return 'ip:unknown';
  }
  return `ip:${ipKeyGenerator(requestIp)}`;
}

function getAuthenticatedIdentityRateLimitKey(
  request: IdentityAwareRateLimitRequestLike,
): string | undefined {
  if (!isRequestAuthenticated(request)) {
    return undefined;
  }

  const sessionId = getTrimmedString(request.sessionID);
  if (sessionId) {
    return `session:${sessionId}`;
  }

  const username = getTrimmedString(getIdentityUsername(request));
  if (username) {
    return `user:${username}`;
  }

  return undefined;
}

export function getAuthenticatedRouteRateLimitKey(
  request: IdentityAwareRateLimitRequestLike,
): string {
  return getAuthenticatedIdentityRateLimitKey(request) || getIpRateLimitKey(request);
}

export function createAuthenticatedRouteRateLimitKeyGenerator(
  identityAwareKeyingEnabled: boolean,
): ValueDeterminingMiddleware<string> | undefined {
  if (!identityAwareKeyingEnabled) {
    return undefined;
  }

  return (request: Request) => getAuthenticatedRouteRateLimitKey(request);
}

export function isIdentityAwareRateLimitKeyingEnabled(
  serverConfiguration: Record<string, unknown> | null | undefined,
): boolean {
  if (!serverConfiguration || typeof serverConfiguration !== 'object') {
    return false;
  }
  const rateLimitConfiguration = serverConfiguration.ratelimit as
    | Record<string, unknown>
    | undefined;
  return rateLimitConfiguration?.identitykeying === true;
}
