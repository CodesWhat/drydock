import {
  applySessionMiddleware,
  createFixedWindowRateLimiter,
  createIdentityAwareUpgradeRateLimitKeyResolver,
  getDefaultRateLimitKey,
  isAuthenticatedSession,
  isOriginAllowed,
  writeUpgradeError,
} from './ws-upgrade-utils.js';

describe('ws-upgrade-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isOriginAllowed', () => {
    test('allows requests with no Origin header', () => {
      const request = { headers: {} } as any;
      expect(isOriginAllowed(request)).toBe(true);
    });

    test('allows requests where Origin host matches Host header', () => {
      const request = {
        headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
      } as any;
      expect(isOriginAllowed(request)).toBe(true);
    });

    test('allows https Origin matching Host', () => {
      const request = {
        headers: { origin: 'https://drydock.example.com', host: 'drydock.example.com' },
      } as any;
      expect(isOriginAllowed(request)).toBe(true);
    });

    test('rejects when Origin host does not match Host header', () => {
      const request = { headers: { origin: 'https://evil.com', host: 'localhost:3000' } } as any;
      expect(isOriginAllowed(request)).toBe(false);
    });

    test('rejects when Origin is missing required subdomain', () => {
      const request = {
        headers: { origin: 'https://example.com', host: 'api.example.com' },
      } as any;
      expect(isOriginAllowed(request)).toBe(false);
    });

    test('allows matching IPv6 Origin and Host headers', () => {
      const request = {
        headers: { origin: 'http://[::1]:3000', host: '[::1]:3000' },
      } as any;
      expect(isOriginAllowed(request)).toBe(true);
    });

    test('allows case-insensitive Origin and Host header matches', () => {
      const request = {
        headers: { origin: 'https://DryDock.Example.COM', host: 'drydock.example.com' },
      } as any;
      expect(isOriginAllowed(request)).toBe(true);
    });

    test('rejects protocol-relative Origin values', () => {
      const request = {
        headers: { origin: '//localhost:3000', host: 'localhost:3000' },
      } as any;
      expect(isOriginAllowed(request)).toBe(false);
    });

    test('rejects when Origin is present but Host header is missing', () => {
      const request = { headers: { origin: 'https://evil.com' } } as any;
      expect(isOriginAllowed(request)).toBe(false);
    });

    test('rejects when Origin is not a valid URL', () => {
      const request = { headers: { origin: 'not-a-valid-url', host: 'localhost:3000' } } as any;
      expect(isOriginAllowed(request)).toBe(false);
    });

    test('rejects when Origin port differs from Host', () => {
      const request = {
        headers: { origin: 'http://localhost:9999', host: 'localhost:3000' },
      } as any;
      expect(isOriginAllowed(request)).toBe(false);
    });
  });

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
      limiter.destroy();
    });

    test('resets counter after window expires', () => {
      vi.useFakeTimers();
      const limiter = createFixedWindowRateLimiter({ windowMs: 100, max: 1 });
      try {
        expect(limiter.consume('key1')).toBe(true);
        expect(limiter.consume('key1')).toBe(false);

        vi.advanceTimersByTime(200);
        expect(limiter.consume('key1')).toBe(true);
      } finally {
        limiter.destroy();
        vi.useRealTimers();
      }
    });

    test('tracks keys independently', () => {
      const limiter = createFixedWindowRateLimiter({ windowMs: 60000, max: 1 });

      expect(limiter.consume('key1')).toBe(true);
      expect(limiter.consume('key2')).toBe(true);
      expect(limiter.consume('key1')).toBe(false);
      expect(limiter.consume('key2')).toBe(false);
      limiter.destroy();
    });

    test('lazily expires entries when keys are accessed again', () => {
      vi.useFakeTimers();
      const limiter = createFixedWindowRateLimiter({ windowMs: 100, max: 1 });
      try {
        limiter.consume('a');
        limiter.consume('b');
        limiter.consume('c');

        // Advance past the window so all entries expire.
        vi.advanceTimersByTime(200);

        // Accessing each key lazily clears expiry and starts a new window.
        expect(limiter.consume('a')).toBe(true);
        expect(limiter.consume('b')).toBe(true);
        expect(limiter.consume('c')).toBe(true);
      } finally {
        limiter.destroy();
        vi.useRealTimers();
      }
    });

    test('periodic cleanup evicts expired entries without consume', () => {
      vi.useFakeTimers();
      const limiter = createFixedWindowRateLimiter({
        windowMs: 100,
        max: 1,
        cleanupIntervalMs: 500,
      });
      try {
        limiter.consume('a');
        limiter.consume('b');

        // Advance past window + cleanup interval so the timer fires
        vi.advanceTimersByTime(600);

        // Entries were evicted by the cleanup timer — consuming creates fresh entries
        expect(limiter.consume('a')).toBe(true);
        expect(limiter.consume('b')).toBe(true);
      } finally {
        limiter.destroy();
        vi.useRealTimers();
      }
    });

    test('rejects new keys when maxEntries cap is reached', () => {
      const limiter = createFixedWindowRateLimiter({ windowMs: 60000, max: 10, maxEntries: 3 });

      expect(limiter.consume('a')).toBe(true);
      expect(limiter.consume('b')).toBe(true);
      expect(limiter.consume('c')).toBe(true);
      // Map is full — new key is rejected
      expect(limiter.consume('d')).toBe(false);
      // Existing keys still work
      expect(limiter.consume('a')).toBe(true);
      limiter.destroy();
    });

    test('cap-triggered sweep evicts stale entries when map is full', () => {
      vi.useFakeTimers();
      const limiter = createFixedWindowRateLimiter({
        windowMs: 100,
        max: 10,
        maxEntries: 2,
        cleanupIntervalMs: 10_000,
        sweepEvery: 999_999,
      });
      try {
        expect(limiter.consume('a')).toBe(true);
        expect(limiter.consume('b')).toBe(true);

        vi.advanceTimersByTime(200);
        // Consuming "a" refreshes that key (lazy per-key expiry). "b" is stale.
        expect(limiter.consume('a')).toBe(true);
        // Map is full (a + stale b), but cap-triggered sweep evicts b and allows c.
        expect(limiter.consume('c')).toBe(true);
      } finally {
        limiter.destroy();
        vi.useRealTimers();
      }
    });

    test('allows new keys after maxEntries cap clears via periodic cleanup', () => {
      vi.useFakeTimers();
      const limiter = createFixedWindowRateLimiter({
        windowMs: 100,
        max: 10,
        maxEntries: 2,
        cleanupIntervalMs: 50,
      });
      try {
        expect(limiter.consume('a')).toBe(true);
        expect(limiter.consume('b')).toBe(true);
        expect(limiter.consume('c')).toBe(false);

        vi.advanceTimersByTime(200);
        // Periodic cleanup evicts expired keys and frees space for new keys.
        expect(limiter.consume('c')).toBe(true);
      } finally {
        limiter.destroy();
        vi.useRealTimers();
      }
    });

    test('periodic cleanup keeps non-expired entries while removing expired ones', () => {
      vi.useFakeTimers();
      const limiter = createFixedWindowRateLimiter({
        windowMs: 1000,
        max: 1,
        maxEntries: 2,
        cleanupIntervalMs: 1000,
      });
      try {
        // t=0
        expect(limiter.consume('a')).toBe(true);
        // t=500
        vi.advanceTimersByTime(500);
        expect(limiter.consume('b')).toBe(true);
        // t=1000, eviction runs: a expires, b remains
        vi.advanceTimersByTime(500);
        expect(limiter.consume('c')).toBe(true);
        // b was not evicted, so it is still at max=1 for the current window
        expect(limiter.consume('b')).toBe(false);
      } finally {
        limiter.destroy();
        vi.useRealTimers();
      }
    });

    test('sweepEvery triggers proactive eviction of stale entries', () => {
      vi.useFakeTimers();
      const limiter = createFixedWindowRateLimiter({
        windowMs: 100,
        max: 1,
        cleanupIntervalMs: 999_999,
        sweepEvery: 3,
      });
      try {
        // t=0: add a, b (calls 1-2)
        expect(limiter.consume('a')).toBe(true);
        expect(limiter.consume('b')).toBe(true);

        // t=200: both entries expire
        vi.advanceTimersByTime(200);

        // Call 3 (3 % 3 === 0): proactive sweep evicts stale a and b.
        // c is then added to a clean map.
        expect(limiter.consume('c')).toBe(true);
        // c is active, second consume hits max=1
        expect(limiter.consume('c')).toBe(false);
      } finally {
        limiter.destroy();
        vi.useRealTimers();
      }
    });

    test('sweep on maxEntries cap frees space before rejecting', () => {
      vi.useFakeTimers();
      const limiter = createFixedWindowRateLimiter({
        windowMs: 100,
        max: 1,
        maxEntries: 2,
        cleanupIntervalMs: 999_999,
        sweepEvery: 999_999, // disable periodic sweep
      });
      try {
        expect(limiter.consume('a')).toBe(true);
        expect(limiter.consume('b')).toBe(true);

        // Map is full, new key would be rejected
        vi.advanceTimersByTime(200);

        // Without cap-triggered sweep this would be false — stale entries block new keys.
        // With cap-triggered sweep, expired a and b are evicted first.
        expect(limiter.consume('c')).toBe(true);
      } finally {
        limiter.destroy();
        vi.useRealTimers();
      }
    });

    test('sweep on cap does not help when all entries are still active', () => {
      const limiter = createFixedWindowRateLimiter({
        windowMs: 60_000,
        max: 10,
        maxEntries: 2,
        sweepEvery: 999_999,
      });
      try {
        expect(limiter.consume('a')).toBe(true);
        expect(limiter.consume('b')).toBe(true);
        // Map full with active entries — sweep finds nothing to evict
        expect(limiter.consume('c')).toBe(false);
      } finally {
        limiter.destroy();
      }
    });

    test('destroy clears the cleanup interval and map', () => {
      vi.useFakeTimers();
      const limiter = createFixedWindowRateLimiter({
        windowMs: 100,
        max: 1,
        cleanupIntervalMs: 500,
      });
      try {
        limiter.consume('a');
        limiter.destroy();

        // After destroy, consume still works on an empty map (fresh entries)
        expect(limiter.consume('a')).toBe(true);
      } finally {
        vi.useRealTimers();
      }
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

    test('uses passport username when session id is missing', () => {
      const resolver = createIdentityAwareUpgradeRateLimitKeyResolver({
        ratelimit: { identitykeying: true },
      });

      const request = {
        socket: { remoteAddress: '10.0.0.1' },
        session: { passport: { user: '{"username":"alice"}' } },
      } as any;

      expect(resolver(request, true)).toBe('user:alice');
    });

    test('uses passport username when session user is already an object', () => {
      const resolver = createIdentityAwareUpgradeRateLimitKeyResolver({
        ratelimit: { identitykeying: true },
      });

      const request = {
        socket: { remoteAddress: '10.0.0.1' },
        session: { passport: { user: { username: 'alice' } } },
      } as any;

      expect(resolver(request, true)).toBe('user:alice');
    });

    test('falls back to ip key when passport user is null', () => {
      const resolver = createIdentityAwareUpgradeRateLimitKeyResolver({
        ratelimit: { identitykeying: true },
      });

      const request = {
        socket: { remoteAddress: '10.0.0.1' },
        session: { passport: { user: null } },
      } as any;

      expect(resolver(request, true)).toBe('ip:10.0.0.1');
    });

    test('falls back to ip key when passport user object has no username', () => {
      const resolver = createIdentityAwareUpgradeRateLimitKeyResolver({
        ratelimit: { identitykeying: true },
      });

      const request = {
        socket: { remoteAddress: '10.0.0.1' },
        session: { passport: { user: {} } },
      } as any;

      expect(resolver(request, true)).toBe('ip:10.0.0.1');
    });

    test('falls back to ip key when authenticated identity values are invalid', () => {
      const resolver = createIdentityAwareUpgradeRateLimitKeyResolver({
        ratelimit: { identitykeying: true },
      });

      const request = {
        socket: { remoteAddress: '10.0.0.1' },
        sessionID: '   ',
        session: { passport: { user: 'not-json' } },
      } as any;

      expect(resolver(request, true)).toBe('ip:10.0.0.1');
    });

    test('falls back to ip key when passport user is not a string or object', () => {
      const resolver = createIdentityAwareUpgradeRateLimitKeyResolver({
        ratelimit: { identitykeying: true },
      });

      const request = {
        socket: { remoteAddress: '10.0.0.1' },
        session: { passport: { user: 123 } },
      } as any;

      expect(resolver(request, true)).toBe('ip:10.0.0.1');
    });

    test('falls back to ip key when parsed passport user is not an object', () => {
      const resolver = createIdentityAwareUpgradeRateLimitKeyResolver({
        ratelimit: { identitykeying: true },
      });

      const request = {
        socket: { remoteAddress: '10.0.0.1' },
        session: { passport: { user: '"alice"' } },
      } as any;

      expect(resolver(request, true)).toBe('ip:10.0.0.1');
    });

    test('falls back to ip key when parsed passport user object has no username', () => {
      const resolver = createIdentityAwareUpgradeRateLimitKeyResolver({
        ratelimit: { identitykeying: true },
      });

      const request = {
        socket: { remoteAddress: '10.0.0.1' },
        session: { passport: { user: '{}' } },
      } as any;

      expect(resolver(request, true)).toBe('ip:10.0.0.1');
    });

    test('prefers request.user over session passport user when present', () => {
      const resolver = createIdentityAwareUpgradeRateLimitKeyResolver({
        ratelimit: { identitykeying: true },
      });

      const request = {
        socket: { remoteAddress: '10.0.0.1' },
        user: { username: 'bob' },
        session: { passport: { user: '{"username":"alice"}' } },
      } as any;

      expect(resolver(request, true)).toBe('user:bob');
    });

    test('normalizes non-boolean authenticated values to unauthenticated', () => {
      const resolver = createIdentityAwareUpgradeRateLimitKeyResolver({
        ratelimit: { identitykeying: true },
      });

      const request = {
        socket: { remoteAddress: '10.0.0.1' },
        session: { passport: { user: '{"username":"alice"}' } },
        sessionID: 'sess-abc',
      } as any;

      expect(resolver(request, 'truthy-value' as unknown as boolean)).toBe('ip:10.0.0.1');
    });
  });
});
