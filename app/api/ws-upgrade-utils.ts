import { type IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import {
  createAuthenticatedRouteRateLimitKeyGenerator,
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
};

type IdentityAwareRateLimitKeyGenerator = NonNullable<
  ReturnType<typeof createAuthenticatedRouteRateLimitKeyGenerator>
>;
type IdentityAwareRateLimitRequest = Parameters<IdentityAwareRateLimitKeyGenerator>[0];
type IdentityAwareRateLimitResponse = Parameters<IdentityAwareRateLimitKeyGenerator>[1];

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

export function createFixedWindowRateLimiter(options: {
  windowMs: number;
  max: number;
  cleanupIntervalMs?: number;
}) {
  const { windowMs, max, cleanupIntervalMs = DEFAULT_CLEANUP_INTERVAL_MS } = options;
  const counters = new Map<string, { count: number; resetAt: number }>();
  let lastEviction = 0;

  function evictExpired(now: number): void {
    if (now - lastEviction < windowMs) {
      return;
    }
    lastEviction = now;
    for (const [entryKey, entry] of counters) {
      if (now >= entry.resetAt) {
        counters.delete(entryKey);
      }
    }
  }

  const cleanupTimer = setInterval(() => {
    evictExpired(Date.now());
  }, cleanupIntervalMs);
  cleanupTimer.unref();

  return {
    consume(key: string): boolean {
      const now = Date.now();
      evictExpired(now);
      const counter = counters.get(key);
      if (!counter || now >= counter.resetAt) {
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
  const identityAwareRateLimitKeyGenerator = createAuthenticatedRouteRateLimitKeyGenerator(
    isIdentityAwareRateLimitKeyingEnabled(serverConfiguration),
  );
  if (!identityAwareRateLimitKeyGenerator) {
    return (request: UpgradeRequest, _authenticated: boolean) => getDefaultRateLimitKey(request);
  }

  return (request: UpgradeRequest, authenticated: boolean) => {
    request.ip = request.socket.remoteAddress;
    request.isAuthenticated = () => authenticated;
    const generatedKey = identityAwareRateLimitKeyGenerator(
      request as unknown as IdentityAwareRateLimitRequest,
      {} as IdentityAwareRateLimitResponse,
    );
    if (typeof generatedKey === 'string' && generatedKey.length > 0) {
      return generatedKey;
    }
    return getDefaultRateLimitKey(request);
  };
}
