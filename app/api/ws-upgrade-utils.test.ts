// Hoisted so tests can assert on log calls — the module-level `log` in
// ws-upgrade-utils.ts is `logger.child(...)`, called once at import time, so
// it always returns this same singleton.
const mockLogChild = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  isLevelEnabled: vi.fn(() => true),
}));
vi.mock('../log/index.js', () => ({
  default: {
    child: vi.fn(() => mockLogChild),
  },
}));

import { sanitizeLogParam } from '../log/sanitize.js';
import {
  applySessionMiddleware,
  createFixedWindowRateLimiter,
  createIdentityAwareUpgradeRateLimitKeyResolver,
  getDefaultRateLimitKey,
  isAuthenticatedSession,
  isOriginAllowed,
  isTrustProxyEnabled,
  writeUpgradeError,
} from './ws-upgrade-utils.js';

describe('ws-upgrade-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isTrustProxyEnabled', () => {
    test('returns false when trustproxy is false', () => {
      expect(isTrustProxyEnabled({ trustproxy: false })).toBe(false);
    });

    test('returns true when trustproxy is true', () => {
      expect(isTrustProxyEnabled({ trustproxy: true })).toBe(true);
    });

    test('returns true when trustproxy is a positive integer (hop count)', () => {
      expect(isTrustProxyEnabled({ trustproxy: 1 })).toBe(true);
      expect(isTrustProxyEnabled({ trustproxy: 2 })).toBe(true);
    });

    test('returns false when trustproxy is 0', () => {
      expect(isTrustProxyEnabled({ trustproxy: 0 })).toBe(false);
    });

    test('returns false when trustproxy is absent', () => {
      expect(isTrustProxyEnabled({})).toBe(false);
    });

    test('returns true for non-empty non-false CIDR string', () => {
      expect(isTrustProxyEnabled({ trustproxy: '10.0.0.0/8' })).toBe(true);
    });

    test('returns false for string "false"', () => {
      expect(isTrustProxyEnabled({ trustproxy: 'false' })).toBe(false);
    });

    test('returns false for string "0"', () => {
      expect(isTrustProxyEnabled({ trustproxy: '0' })).toBe(false);
    });

    test('returns false for empty string', () => {
      expect(isTrustProxyEnabled({ trustproxy: '' })).toBe(false);
    });

    test('returns false for whitespace-only string', () => {
      expect(isTrustProxyEnabled({ trustproxy: '   ' })).toBe(false);
    });
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

    test('rejects an http Origin for a TLS WebSocket on the same host', () => {
      const request = {
        headers: { origin: 'http://drydock.example.com', host: 'drydock.example.com' },
        socket: { encrypted: true },
      } as any;
      expect(isOriginAllowed(request)).toBe(false);
    });

    test('uses X-Forwarded-Proto only when trust proxy is enabled', () => {
      const request = {
        headers: {
          origin: 'https://drydock.example.com',
          host: 'drydock.example.com',
          'x-forwarded-proto': 'https',
        },
        socket: { encrypted: false },
      } as any;

      expect(isOriginAllowed(request, { trustproxy: false })).toBe(false);
      expect(isOriginAllowed(request, { trustproxy: 1 })).toBe(true);
    });

    test('rejects an unsupported forwarded protocol from a trusted proxy', () => {
      const request = {
        headers: {
          origin: 'https://drydock.example.com',
          host: 'drydock.example.com',
          'x-forwarded-proto': 'ftp',
        },
        socket: { encrypted: false },
      } as any;

      expect(isOriginAllowed(request, { trustproxy: 1 })).toBe(false);
    });

    test('accepts an http Origin when a trusted proxy forwards http', () => {
      const request = {
        headers: {
          origin: 'http://drydock.example.com',
          host: 'drydock.example.com',
          'x-forwarded-proto': 'http',
        },
        socket: { encrypted: false },
      } as any;

      expect(isOriginAllowed(request, { trustproxy: 1 })).toBe(true);
    });

    test('accepts an https Origin when a trusted proxy forwards wss (Traefik)', () => {
      const request = {
        headers: {
          origin: 'https://drydock.example.com',
          host: 'drydock.example.com',
          'x-forwarded-proto': 'wss',
        },
        socket: { encrypted: false },
      } as any;

      expect(isOriginAllowed(request, { trustproxy: 1 })).toBe(true);
    });

    test('accepts an http Origin when a trusted proxy forwards ws', () => {
      const request = {
        headers: {
          origin: 'http://drydock.example.com',
          host: 'drydock.example.com',
          'x-forwarded-proto': 'ws',
        },
        socket: { encrypted: false },
      } as any;

      expect(isOriginAllowed(request, { trustproxy: 1 })).toBe(true);
    });

    test('rejects an http Origin when a trusted proxy forwards wss', () => {
      const request = {
        headers: {
          origin: 'http://drydock.example.com',
          host: 'drydock.example.com',
          'x-forwarded-proto': 'wss',
        },
        socket: { encrypted: false },
      } as any;

      expect(isOriginAllowed(request, { trustproxy: 1 })).toBe(false);
    });

    test('rejects non-HTTP URL schemes in Origin', () => {
      const request = {
        headers: { origin: 'wss://drydock.example.com', host: 'drydock.example.com' },
      } as any;

      expect(isOriginAllowed(request)).toBe(false);
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

    describe('trust proxy disabled', () => {
      const noProxy = { trustproxy: false };

      test('rejects mismatched host even without trust proxy config', () => {
        const request = {
          headers: { origin: 'https://evil.com', host: 'localhost:3000' },
        } as any;
        expect(isOriginAllowed(request, noProxy)).toBe(false);
      });

      test('ignores forged X-Forwarded-Host when trust proxy is off', () => {
        // Direct client forges X-Forwarded-Host to match their origin — must be rejected
        const request = {
          headers: {
            origin: 'https://attacker.com',
            host: 'localhost:3000',
            'x-forwarded-host': 'attacker.com',
          },
        } as any;
        expect(isOriginAllowed(request, noProxy)).toBe(false);
      });

      test('still allows when Origin matches raw Host even with trust proxy off', () => {
        const request = {
          headers: {
            origin: 'http://localhost:3000',
            host: 'localhost:3000',
            'x-forwarded-host': 'some-proxy-host.example.com',
          },
        } as any;
        expect(isOriginAllowed(request, noProxy)).toBe(true);
      });

      test('rejects an https Origin against an unencrypted local socket, unchanged from today', () => {
        // Trust proxy off: the local socket's TLS state is still the source of
        // truth for the effective protocol, and behavior here must not change.
        const request = {
          headers: { origin: 'https://drydock.example.com', host: 'drydock.example.com' },
          socket: { encrypted: false },
        } as any;
        expect(isOriginAllowed(request, noProxy)).toBe(false);
      });
    });

    describe('trust proxy enabled', () => {
      const withProxy = { trustproxy: 1 };

      test('allows when Origin matches X-Forwarded-Host behind a proxy', () => {
        const request = {
          headers: {
            origin: 'https://drydock.example.com',
            host: '10.0.0.1:3000',
            'x-forwarded-host': 'drydock.example.com',
            'x-forwarded-proto': 'https',
          },
        } as any;
        expect(isOriginAllowed(request, withProxy)).toBe(true);
      });

      test('takes the first entry in a comma-separated X-Forwarded-Host list', () => {
        const request = {
          headers: {
            origin: 'https://drydock.example.com',
            host: '10.0.0.1:3000',
            'x-forwarded-host': 'drydock.example.com, other.example.com',
            'x-forwarded-proto': 'https',
          },
        } as any;
        expect(isOriginAllowed(request, withProxy)).toBe(true);
      });

      test('rejects when Origin does not match X-Forwarded-Host', () => {
        const request = {
          headers: {
            origin: 'https://evil.com',
            host: '10.0.0.1:3000',
            'x-forwarded-host': 'drydock.example.com',
            'x-forwarded-proto': 'https',
          },
        } as any;
        expect(isOriginAllowed(request, withProxy)).toBe(false);
      });

      test('falls back to raw Host when X-Forwarded-Host is absent', () => {
        const request = {
          headers: {
            origin: 'https://drydock.example.com',
            host: 'drydock.example.com',
            'x-forwarded-proto': 'https',
          },
        } as any;
        expect(isOriginAllowed(request, withProxy)).toBe(true);
      });

      test('falls back to raw Host when X-Forwarded-Host is empty', () => {
        const request = {
          headers: {
            origin: 'https://drydock.example.com',
            host: 'drydock.example.com',
            'x-forwarded-host': '',
            'x-forwarded-proto': 'https',
          },
        } as any;
        expect(isOriginAllowed(request, withProxy)).toBe(true);
      });

      test('rejects when both X-Forwarded-Host and raw Host are missing', () => {
        const request = {
          headers: {
            origin: 'https://drydock.example.com',
            'x-forwarded-host': '',
            'x-forwarded-proto': 'https',
          },
        } as any;
        expect(isOriginAllowed(request, withProxy)).toBe(false);
      });

      test('rejects a browser origin when X-Forwarded-Proto is absent', () => {
        const request = {
          headers: {
            origin: 'https://drydock.example.com',
            host: '10.0.0.1:3000',
            'x-forwarded-host': 'drydock.example.com',
          },
          socket: { encrypted: false },
        } as any;
        expect(isOriginAllowed(request, withProxy)).toBe(false);
      });

      test('rejects a browser origin when X-Forwarded-Proto is empty', () => {
        const request = {
          headers: {
            origin: 'https://drydock.example.com',
            host: '10.0.0.1:3000',
            'x-forwarded-host': 'drydock.example.com',
            'x-forwarded-proto': '   ',
          },
          socket: { encrypted: false },
        } as any;
        expect(isOriginAllowed(request, withProxy)).toBe(false);
      });

      test('still allows a matching origin when X-Forwarded-Proto is present alongside an unencrypted local socket', () => {
        const request = {
          headers: {
            origin: 'https://drydock.example.com',
            host: '10.0.0.1:3000',
            'x-forwarded-host': 'drydock.example.com',
            'x-forwarded-proto': 'https',
          },
          socket: { encrypted: false },
        } as any;
        expect(isOriginAllowed(request, withProxy)).toBe(true);
      });

      test('still rejects a mismatched X-Forwarded-Host with a valid forwarded protocol', () => {
        const request = {
          headers: {
            origin: 'https://evil.com',
            host: '10.0.0.1:3000',
            'x-forwarded-host': 'drydock.example.com',
            'x-forwarded-proto': 'https',
          },
          socket: { encrypted: false },
        } as any;
        expect(isOriginAllowed(request, withProxy)).toBe(false);
      });
    });

    test('logs a debug message with the mismatch details on rejection', () => {
      const request = {
        headers: {
          origin: 'https://evil.com',
          host: '10.0.0.1:3000',
          'x-forwarded-host': 'drydock.example.com',
          'x-forwarded-proto': 'https',
        },
        socket: { encrypted: false, remoteAddress: '198.51.100.10' },
      } as any;

      expect(isOriginAllowed(request, { trustproxy: 1 })).toBe(false);

      expect(mockLogChild.debug).toHaveBeenCalledTimes(1);
      const [message] = mockLogChild.debug.mock.calls[0];
      expect(message).toContain('origin=https://evil.com');
      expect(message).toContain('effectiveHost=drydock.example.com');
      expect(message).toContain('effectiveProtocol=https:');
      expect(message).toContain('trustProxy=true');
      expect(message).toContain('x-forwarded-host=drydock.example.com');
      expect(message).toContain('x-forwarded-proto=https');
    });

    test('logs an unknown effective host when the request has no host headers', () => {
      const request = {
        headers: { origin: 'https://evil.com' },
        socket: { encrypted: false, remoteAddress: '198.51.100.17' },
      } as any;

      expect(isOriginAllowed(request)).toBe(false);

      const [message] = mockLogChild.debug.mock.calls[0];
      expect(message).toContain('effectiveHost=unknown');
    });

    test('does not build a rejection diagnostic when debug logging is disabled', () => {
      mockLogChild.isLevelEnabled.mockReturnValueOnce(false);
      const request = {
        headers: { origin: 'https://evil.com', host: 'drydock.example.com' },
        socket: { encrypted: false, remoteAddress: '198.51.100.11' },
      } as any;

      expect(isOriginAllowed(request)).toBe(false);
      expect(mockLogChild.isLevelEnabled).toHaveBeenCalledWith('debug');
      expect(mockLogChild.debug).not.toHaveBeenCalled();
    });

    test('sanitizes and truncates attacker-controlled headers in rejection diagnostics', () => {
      const origin = `invalid\n${'o'.repeat(220)}`;
      const forwardedHost = `proxy\u001b[31m${'h'.repeat(220)}`;
      const forwardedProtocol = `ftp\r${'p'.repeat(220)}`;
      const request = {
        headers: {
          origin,
          host: '10.0.0.1:3000',
          'x-forwarded-host': forwardedHost,
          'x-forwarded-proto': forwardedProtocol,
        },
        socket: { encrypted: false, remoteAddress: '198.51.100.12' },
      } as any;

      expect(isOriginAllowed(request, { trustproxy: 1 })).toBe(false);

      const [message] = mockLogChild.debug.mock.calls[0];
      expect(message).toContain(`origin=${sanitizeLogParam(origin)}`);
      expect(message).toContain(`effectiveHost=${sanitizeLogParam(forwardedHost)}`);
      expect(message).toContain(`x-forwarded-host=${sanitizeLogParam(forwardedHost)}`);
      expect(message).toContain(`x-forwarded-proto=${sanitizeLogParam(forwardedProtocol)}`);
      expect(message).not.toContain('\n');
      expect(message).not.toContain('\r');
      expect(message).not.toContain('\u001b');
    });

    test('bounds rejection diagnostics per remote address within a fixed window', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      try {
        const request = {
          headers: { origin: 'https://evil.com', host: 'drydock.example.com' },
          socket: { encrypted: false, remoteAddress: '198.51.100.13' },
        } as any;

        for (let attempt = 0; attempt < 6; attempt += 1) {
          expect(isOriginAllowed(request)).toBe(false);
        }
        expect(mockLogChild.debug).toHaveBeenCalledTimes(5);

        vi.advanceTimersByTime(60_000);
        expect(isOriginAllowed(request)).toBe(false);
        expect(mockLogChild.debug).toHaveBeenCalledTimes(6);
      } finally {
        vi.useRealTimers();
      }
    });

    test('tracks rejection diagnostic allowances independently by remote address', () => {
      const createRequest = (remoteAddress: string) =>
        ({
          headers: { origin: 'https://evil.com', host: 'drydock.example.com' },
          socket: { encrypted: false, remoteAddress },
        }) as any;

      const firstAddressRequest = createRequest('198.51.100.14');
      for (let attempt = 0; attempt < 6; attempt += 1) {
        expect(isOriginAllowed(firstAddressRequest)).toBe(false);
      }
      expect(isOriginAllowed(createRequest('198.51.100.15'))).toBe(false);
      expect(isOriginAllowed(createRequest('198.51.100.16'))).toBe(false);

      expect(mockLogChild.debug).toHaveBeenCalledTimes(7);
    });

    test('does not log when the origin is allowed', () => {
      const request = {
        headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
      } as any;

      expect(isOriginAllowed(request)).toBe(true);
      expect(mockLogChild.debug).not.toHaveBeenCalled();
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

    test('returns true when anonymousAuthActive is true even without a passport user', () => {
      const request = { session: { passport: {} } } as any;
      expect(isAuthenticatedSession(request, { anonymousAuthActive: true })).toBe(true);
    });

    test('returns false when anonymousAuthActive is false and passport user is missing', () => {
      const request = { session: { passport: {} } } as any;
      expect(isAuthenticatedSession(request, { anonymousAuthActive: false })).toBe(false);
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
