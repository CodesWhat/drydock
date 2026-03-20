import * as rateLimitKey from './rate-limit-key.js';
import {
  applySessionMiddleware,
  createFixedWindowRateLimiter,
  createIdentityAwareUpgradeRateLimitKeyResolver,
  getDefaultRateLimitKey,
  isAuthenticatedSession,
  writeUpgradeError,
} from './ws-upgrade-utils.js';

describe('ws-upgrade-utils', () => {
  describe('writeUpgradeError', () => {
    test('writes HTTP error response and destroys the socket', () => {
      const socket = {
        destroyed: false,
        write: vi.fn(),
        destroy: vi.fn(),
      };

      writeUpgradeError(socket as any, 401, 'Unauthorized');

      expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('401 Unauthorized'));
      expect(socket.write).toHaveBeenCalledWith(
        expect.stringContaining('Content-Type: text/plain'),
      );
      expect(socket.destroy).toHaveBeenCalledTimes(1);
    });

    test('does not write when socket is already destroyed', () => {
      const socket = {
        destroyed: true,
        write: vi.fn(),
        destroy: vi.fn(),
      };

      writeUpgradeError(socket as any, 401, 'Unauthorized');

      expect(socket.write).not.toHaveBeenCalled();
      expect(socket.destroy).not.toHaveBeenCalled();
    });
  });

  describe('applySessionMiddleware', () => {
    test('resolves when middleware calls next without error', async () => {
      const middleware = (_req: any, _res: any, next: (error?: unknown) => void) => next();
      const request = { url: '/' } as any;

      await expect(applySessionMiddleware(middleware, request)).resolves.toBeUndefined();
    });

    test('rejects when middleware calls next with error', async () => {
      const middleware = (_req: any, _res: any, next: (error?: unknown) => void) =>
        next(new Error('session failed'));
      const request = { url: '/' } as any;

      await expect(applySessionMiddleware(middleware, request)).rejects.toThrow('session failed');
    });
  });

  describe('isAuthenticatedSession', () => {
    test('returns true when passport user is present', () => {
      const request = { session: { passport: { user: '{"username":"alice"}' } } } as any;
      expect(isAuthenticatedSession(request)).toBe(true);
    });

    test('returns false when passport session is empty', () => {
      const request = { session: { passport: {} } } as any;
      expect(isAuthenticatedSession(request)).toBe(false);
    });

    test('returns false when session is missing', () => {
      const request = {} as any;
      expect(isAuthenticatedSession(request)).toBe(false);
    });
  });

  describe('getDefaultRateLimitKey', () => {
    test('returns ip-based key from remote address', () => {
      const request = { socket: { remoteAddress: '192.168.1.1' } } as any;
      expect(getDefaultRateLimitKey(request)).toBe('ip:192.168.1.1');
    });

    test('returns ip:unknown when remoteAddress is not a string', () => {
      const request = { socket: {} } as any;
      expect(getDefaultRateLimitKey(request)).toBe('ip:unknown');
    });

    test('returns ip:unknown when remoteAddress is blank', () => {
      const request = { socket: { remoteAddress: '   ' } } as any;
      expect(getDefaultRateLimitKey(request)).toBe('ip:unknown');
    });
  });

  describe('createFixedWindowRateLimiter', () => {
    test('allows requests within the window limit', () => {
      const limiter = createFixedWindowRateLimiter({ windowMs: 60000, max: 3 });

      expect(limiter.consume('key1')).toBe(true);
      expect(limiter.consume('key1')).toBe(true);
      expect(limiter.consume('key1')).toBe(true);
      expect(limiter.consume('key1')).toBe(false);
    });

    test('resets counter after window expires', () => {
      const limiter = createFixedWindowRateLimiter({ windowMs: 100, max: 1 });

      expect(limiter.consume('key1')).toBe(true);
      expect(limiter.consume('key1')).toBe(false);

      vi.useFakeTimers();
      vi.advanceTimersByTime(200);
      expect(limiter.consume('key1')).toBe(true);
      vi.useRealTimers();
    });

    test('tracks keys independently', () => {
      const limiter = createFixedWindowRateLimiter({ windowMs: 60000, max: 1 });

      expect(limiter.consume('key1')).toBe(true);
      expect(limiter.consume('key2')).toBe(true);
      expect(limiter.consume('key1')).toBe(false);
      expect(limiter.consume('key2')).toBe(false);
    });
  });

  describe('createIdentityAwareUpgradeRateLimitKeyResolver', () => {
    test('returns default key resolver when identity-aware keying is disabled', () => {
      const resolver = createIdentityAwareUpgradeRateLimitKeyResolver({
        ratelimit: { identitykeying: false },
      });

      const request = { socket: { remoteAddress: '10.0.0.1' } } as any;
      expect(resolver(request, true)).toBe('ip:10.0.0.1');
    });

    test('uses identity-aware key generator when enabled', () => {
      const resolver = createIdentityAwareUpgradeRateLimitKeyResolver({
        ratelimit: { identitykeying: true },
      });

      const request = {
        socket: { remoteAddress: '10.0.0.1' },
        session: { passport: { user: '{"username":"alice"}' } },
        sessionID: 'sess-abc',
      } as any;

      const key = resolver(request, true);
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
    });

    test('falls back to ip key when identity-aware generator returns empty string', () => {
      const createKeySpy = vi
        .spyOn(rateLimitKey, 'createAuthenticatedRouteRateLimitKeyGenerator')
        .mockReturnValue(() => '' as any);

      try {
        const resolver = createIdentityAwareUpgradeRateLimitKeyResolver({
          ratelimit: { identitykeying: true },
        });

        const request = { socket: { remoteAddress: '10.0.0.1' } } as any;
        expect(resolver(request, true)).toBe('ip:10.0.0.1');
      } finally {
        createKeySpy.mockRestore();
      }
    });
  });
});
