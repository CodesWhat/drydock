import type { Request } from 'express';
import { ipKeyGenerator, type ValueDeterminingMiddleware } from 'express-rate-limit';

type IdentityAwareRateLimitRequest = Request & {
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

function getIpRateLimitKey(request: Request): string {
  const requestIp = getTrimmedString(request.ip);
  if (!requestIp) {
    return 'ip:unknown';
  }
  return `ip:${ipKeyGenerator(requestIp)}`;
}

function getAuthenticatedIdentityRateLimitKey(
  request: IdentityAwareRateLimitRequest,
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

export function createAuthenticatedRouteRateLimitKeyGenerator(
  identityAwareKeyingEnabled: boolean,
): ValueDeterminingMiddleware<string> | undefined {
  if (!identityAwareKeyingEnabled) {
    return undefined;
  }

  return (request: Request) =>
    getAuthenticatedIdentityRateLimitKey(request as IdentityAwareRateLimitRequest) ||
    getIpRateLimitKey(request);
}

export function isIdentityAwareRateLimitKeyingEnabled(
  serverConfiguration: Record<string, unknown>,
): boolean {
  const rateLimitConfiguration = serverConfiguration.ratelimit as
    | Record<string, unknown>
    | undefined;
  return rateLimitConfiguration?.identitykeying === true;
}
