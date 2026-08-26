import { type IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import logger from '../log/index.js';
import {
  getAuthenticatedRouteRateLimitKey,
  type IdentityAwareRateLimitRequestLike,
  isIdentityAwareRateLimitKeyingEnabled,
} from './rate-limit-key.js';

const log = logger.child({ component: 'ws-upgrade-utils' });

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
 * Returns true when the server configuration has trust proxy enabled.
 * Mirrors the semantics used by isTrustProxyEnabled in auth.ts and by Express's
 * "trust proxy" setting: numeric hops ≥ 1 are enabled, boolean true is enabled,
 * any non-empty/non-false/non-zero string is enabled.
 */
export function isTrustProxyEnabled(serverConfiguration: Record<string, unknown>): boolean {
  const trustproxy = serverConfiguration.trustproxy;
  if (trustproxy === true) {
    return true;
  }
  if (typeof trustproxy === 'number') {
    return trustproxy > 0;
  }
  if (typeof trustproxy === 'string') {
    const normalized = trustproxy.trim().toLowerCase();
    return normalized !== '' && normalized !== '0' && normalized !== 'false';
  }
  return false;
}

function getFirstForwardedValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const firstValue = value
    .split(',')
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.length > 0);
  return firstValue || undefined;
}

function normalizeForwardedProtocol(forwardedProtocol: string): 'http:' | 'https:' | undefined {
  // Some proxies forward the WebSocket upgrade's client-facing scheme as
  // ws/wss rather than http/https (Traefik does, see traefik/traefik#6388).
  // Each pair carries the same security level, so map ws(s) to its HTTP
  // equivalent before comparing against the browser's http(s) Origin (#867).
  switch (forwardedProtocol.toLowerCase()) {
    case 'http':
    case 'ws':
      return 'http:';
    case 'https':
    case 'wss':
      return 'https:';
    default:
      return undefined;
  }
}

function getSocketOriginProtocol(request: IncomingMessage): 'http:' | 'https:' | undefined {
  const socket = request.socket as (Socket & { encrypted?: boolean }) | undefined;
  if (!socket) {
    return undefined;
  }
  return socket.encrypted === true ? 'https:' : 'http:';
}

/**
 * Validates the Origin header against the effective origin to prevent WebSocket CSRF.
 * Browsers always send an Origin header on WebSocket upgrade requests, so a
 * browser request with a mismatched Origin indicates a cross-site connection
 * attempt. Non-browser clients (CLI tools, agents) typically omit Origin
 * entirely, which is allowed.
 *
 * When serverConfiguration has trust proxy enabled, the effective host and
 * protocol can come from the first X-Forwarded-Host / X-Forwarded-Proto values.
 * Otherwise forwarded headers are ignored and the socket transport is used.
 */
export function isOriginAllowed(
  request: IncomingMessage,
  serverConfiguration?: Record<string, unknown>,
): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) {
    return true;
  }

  const trustProxy = serverConfiguration !== undefined && isTrustProxyEnabled(serverConfiguration);
  const effectiveHost =
    (trustProxy ? getFirstForwardedValue(request.headers['x-forwarded-host']) : undefined) ??
    request.headers.host;

  const forwardedProtocol = trustProxy
    ? getFirstForwardedValue(request.headers['x-forwarded-proto'])
    : undefined;
  let effectiveProtocol: 'http:' | 'https:' | undefined;
  let allowed = true;

  if (!effectiveHost) {
    allowed = false;
  } else if (forwardedProtocol !== undefined) {
    const normalizedProtocol = normalizeForwardedProtocol(forwardedProtocol);
    if (normalizedProtocol === undefined) {
      allowed = false;
    } else {
      effectiveProtocol = normalizedProtocol;
    }
  } else {
    // When trust proxy is enabled but X-Forwarded-Proto is absent, the local
    // socket's TLS state does not reflect the client-facing protocol behind a
    // TLS-terminating proxy (the backend socket is typically plain HTTP).
    // Treat the protocol as unknown rather than falling back to the socket,
    // which would otherwise reject a same-origin request purely because the
    // proxy stripped the protocol header (see #867).
    effectiveProtocol = trustProxy ? undefined : getSocketOriginProtocol(request);
  }

  let parsedOrigin: URL | undefined;
  if (allowed) {
    try {
      parsedOrigin = new URL(origin);
    } catch {
      allowed = false;
    }
  }

  if (allowed && parsedOrigin !== undefined) {
    if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') {
      allowed = false;
    } else {
      allowed =
        parsedOrigin.host === effectiveHost &&
        (effectiveProtocol === undefined || parsedOrigin.protocol === effectiveProtocol);
    }
  }

  if (!allowed) {
    log.debug(
      `WebSocket origin rejected: origin=${origin} effectiveHost=${effectiveHost ?? 'unknown'} ` +
        `effectiveProtocol=${effectiveProtocol ?? 'unknown'} trustProxy=${trustProxy} ` +
        `x-forwarded-host=${request.headers['x-forwarded-host'] ?? 'absent'} ` +
        `x-forwarded-proto=${request.headers['x-forwarded-proto'] ?? 'absent'}`,
    );
  }

  return allowed;
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

export interface IsAuthenticatedSessionOptions {
  anonymousAuthActive?: boolean;
}

export function isAuthenticatedSession(
  request: UpgradeRequest,
  options: IsAuthenticatedSessionOptions = {},
): boolean {
  const { anonymousAuthActive = false } = options;
  const passportSession = request.session?.passport;
  return passportSession?.user !== undefined || anonymousAuthActive;
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
