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

export function createFixedWindowRateLimiter(options: { windowMs: number; max: number }) {
  const { windowMs, max } = options;
  const counters = new Map<string, { count: number; resetAt: number }>();

  return {
    consume(key: string): boolean {
      const now = Date.now();
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
