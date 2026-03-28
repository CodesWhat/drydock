import type { Request } from 'express';
import { ipKeyGenerator, type ValueDeterminingMiddleware } from 'express-rate-limit';

export type IdentityAwareRateLimitRequestLike = {
  ip?: unknown;
  isAuthenticated?: () => boolean;
  sessionID?: unknown;
  user?: {
    username?: unknown;
  };
};

function getTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getIpRateLimitKey(request: Pick<IdentityAwareRateLimitRequestLike, 'ip'>): string {
  const rawRequestIp = request.ip;
  if (rawRequestIp === undefined) {
    return 'ip:unknown';
  }

  const requestIp = getTrimmedString(rawRequestIp);
  if (!requestIp) {
    return 'ip:unknown';
  }
  return `ip:${ipKeyGenerator(requestIp)}`;
}

function getAuthenticatedIdentityRateLimitKey(
  request: IdentityAwareRateLimitRequestLike,
): string | undefined {
  if (typeof request.isAuthenticated !== 'function' || !request.isAuthenticated()) {
    return undefined;
  }

  const sessionId = getTrimmedString(request.sessionID);
  if (sessionId) {
    return `session:${sessionId}`;
  }

  const username = getTrimmedString(request.user?.username);
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
