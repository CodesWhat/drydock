import { type IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import {
  getAuthenticatedRouteRateLimitKey,
  type IdentityAwareRateLimitRequestLike,
  isIdentityAwareRateLimitKeyingEnabled,
} from './rate-limit-key.js';

export type SessionMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void;

export type UpgradeRequest = IncomingMessage & {
  session?: { passport?: { user?: unknown } };
  sessionID?: unknown;
  isAuthenticated?: () => boolean;
  ip?: string;
  user?: { username?: unknown };
};

/**
 * Validates the Origin header against the Host header to prevent WebSocket CSRF.
 * Browsers always send an Origin header on WebSocket upgrade requests, so a
 * browser request with a mismatched Origin indicates a cross-site connection
 * attempt. Non-browser clients (CLI tools, agents) typically omit Origin
 * entirely, which is allowed.
 */
export function isOriginAllowed(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) {
    return true;
  }

  const host = request.headers.host;
  if (!host) {
    return false;
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }

  return originHost === host;
}

export function writeUpgradeError(socket: Socket, statusCode: number, message: string): void {
  if (socket.destroyed) {
    return;
  }
  const responseBody = `${message}\n`;
  socket.write(
    `HTTP/1.1 ${statusCode} ${message}\r\n` +
      'Connection: close\r\n' +
      'Content-Type: text/plain; charset=utf-8\r\n' +
      `Content-Length: ${Buffer.byteLength(responseBody)}\r\n` +
      '\r\n' +
      responseBody,
  );
  socket.destroy();
}

export async function applySessionMiddleware(
  sessionMiddleware: SessionMiddleware,
  request: IncomingMessage,
): Promise<void> {
  const response = new ServerResponse(request);
  await new Promise<void>((resolve, reject) => {
    sessionMiddleware(request, response, (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function isAuthenticatedSession(request: UpgradeRequest): boolean {
  const passportSession = request.session?.passport;
  return passportSession?.user !== undefined;
}

export function getDefaultRateLimitKey(request: UpgradeRequest): string {
  const rawIpAddress = request.socket.remoteAddress;
  if (typeof rawIpAddress !== 'string') {
    return 'ip:unknown';
  }
  const ipAddress = rawIpAddress.trim();
  if (ipAddress.length === 0) {
    return 'ip:unknown';
  }
  return `ip:${ipAddress}`;
}

const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

const DEFAULT_MAX_ENTRIES = 10_000;

const DEFAULT_SWEEP_EVERY = 100;

export function createFixedWindowRateLimiter(options: {
  windowMs: number;
  max: number;
  cleanupIntervalMs?: number;
  maxEntries?: number;
  sweepEvery?: number;
}) {
  const {
    windowMs,
    max,
    cleanupIntervalMs = DEFAULT_CLEANUP_INTERVAL_MS,
    maxEntries = DEFAULT_MAX_ENTRIES,
    sweepEvery = DEFAULT_SWEEP_EVERY,
  } = options;
  const counters = new Map<string, { count: number; resetAt: number }>();
  let consumeCount = 0;

  function evictExpired(now: number): void {
    for (const [entryKey, entry] of counters) {
      if (now >= entry.resetAt) {
        counters.delete(entryKey);
      }
    }
  }

  function getActiveCounter(key: string, now: number) {
    const counter = counters.get(key);
    if (!counter) {
      return undefined;
    }
    if (now >= counter.resetAt) {
      counters.delete(key);
      return undefined;
    }
    return counter;
  }

  const cleanupTimer = setInterval(() => {
    evictExpired(Date.now());
  }, cleanupIntervalMs);
  cleanupTimer.unref();

  return {
    consume(key: string): boolean {
      const now = Date.now();
      consumeCount += 1;
      if (consumeCount % sweepEvery === 0) {
        evictExpired(now);
      }
      const counter = getActiveCounter(key, now);
      if (!counter) {
        if (counters.size >= maxEntries) {
          evictExpired(now);
          if (counters.size >= maxEntries) {
            return false;
          }
        }
        counters.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }
      if (counter.count >= max) {
        return false;
      }
      counter.count += 1;
      return true;
    },
    destroy(): void {
      clearInterval(cleanupTimer);
      counters.clear();
    },
  };
}

export function createIdentityAwareUpgradeRateLimitKeyResolver(
  serverConfiguration: Record<string, unknown>,
) {
  if (!isIdentityAwareRateLimitKeyingEnabled(serverConfiguration)) {
    return (request: UpgradeRequest, _authenticated: boolean) => getDefaultRateLimitKey(request);
  }

  return (request: UpgradeRequest, authenticated: boolean) => {
    return getAuthenticatedRouteRateLimitKey(
      toIdentityAwareUpgradeRateLimitRequest(request, authenticated),
    );
  };
}

function getUsernameFromPassportSessionUser(passportUser: unknown): unknown {
  if (!passportUser) {
    return undefined;
  }

  if (typeof passportUser === 'object') {
    return (passportUser as { username?: unknown }).username;
  }

  if (typeof passportUser !== 'string') {
    return undefined;
  }

  try {
    const parsedUser = JSON.parse(passportUser);
    if (!parsedUser || typeof parsedUser !== 'object') {
      return undefined;
    }
    return (parsedUser as { username?: unknown }).username;
  } catch {
    return undefined;
  }
}

function getUpgradeRateLimitUser(
  request: UpgradeRequest,
): IdentityAwareRateLimitRequestLike['user'] | undefined {
  if (request.user) {
    return request.user;
  }

  const username = getUsernameFromPassportSessionUser(request.session?.passport?.user);
  if (username === undefined) {
    return undefined;
  }

  return { username };
}

function toIdentityAwareUpgradeRateLimitRequest(
  request: UpgradeRequest,
  authenticated: boolean,
): IdentityAwareRateLimitRequestLike {
  return {
    ip: request.socket.remoteAddress,
    isAuthenticated: () => authenticated === true,
    sessionID: request.sessionID,
    user: getUpgradeRateLimitUser(request),
  };
}
