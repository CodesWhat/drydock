import type { Request, Response } from 'express';
import {
  createAuthenticatedRouteRateLimitKeyGenerator,
  isIdentityAwareRateLimitKeyingEnabled,
} from './rate-limit-key.js';

function createRequest(
  overrides: Partial<
    Request & {
      isAuthenticated?: () => boolean;
      sessionID?: unknown;
      user?: { username?: unknown };
    }
  >,
): Request {
  return {
    ip: '198.51.100.7',
    ...overrides,
  } as Request;
}

const response = {} as Response;

describe('createAuthenticatedRouteRateLimitKeyGenerator', () => {
  test('should return undefined when identity-aware keying is disabled', () => {
    expect(createAuthenticatedRouteRateLimitKeyGenerator(false)).toBeUndefined();
  });

  test('should separate authenticated users behind the same proxy ip', async () => {
    const keyGenerator = createAuthenticatedRouteRateLimitKeyGenerator(true);
    expect(keyGenerator).toBeDefined();

    const firstUserKey = await keyGenerator!(
      createRequest({
        ip: '203.0.113.10',
        isAuthenticated: () => true,
        sessionID: 'session-a',
        user: { username: 'alice' },
      }),
      response,
    );
    const secondUserKey = await keyGenerator!(
      createRequest({
        ip: '203.0.113.10',
        isAuthenticated: () => true,
        sessionID: 'session-b',
        user: { username: 'bob' },
      }),
      response,
    );

    expect(firstUserKey).toBe('session:session-a');
    expect(secondUserKey).toBe('session:session-b');
    expect(firstUserKey).not.toBe(secondUserKey);
  });

  test('should keep unauthenticated requests ip-keyed', async () => {
    const keyGenerator = createAuthenticatedRouteRateLimitKeyGenerator(true);
    expect(keyGenerator).toBeDefined();

    const firstKey = await keyGenerator!(
      createRequest({
        ip: '203.0.113.20',
        isAuthenticated: () => false,
      }),
      response,
    );
    const secondKey = await keyGenerator!(
      createRequest({
        ip: '203.0.113.20',
        isAuthenticated: () => false,
      }),
      response,
    );

    expect(firstKey).toMatch(/^ip:/);
    expect(secondKey).toBe(firstKey);
  });

  test('should prefer socket remote address over request ip for unauthenticated requests', async () => {
    const keyGenerator = createAuthenticatedRouteRateLimitKeyGenerator(true);
    expect(keyGenerator).toBeDefined();

    const firstKey = await keyGenerator!(
      createRequest({
        ip: '203.0.113.20',
        socket: {
          remoteAddress: '198.51.100.7',
        } as Request['socket'],
        isAuthenticated: () => false,
      }),
      response,
    );
    const secondKey = await keyGenerator!(
      createRequest({
        ip: '203.0.113.21',
        socket: {
          remoteAddress: '198.51.100.7',
        } as Request['socket'],
        isAuthenticated: () => false,
      }),
      response,
    );

    expect(firstKey).toMatch(/^ip:/);
    expect(secondKey).toBe(firstKey);
  });

  test('should return unknown ip key when unauthenticated request ip is undefined', async () => {
    const keyGenerator = createAuthenticatedRouteRateLimitKeyGenerator(true);
    expect(keyGenerator).toBeDefined();

    const key = await keyGenerator!(
      createRequest({
        ip: undefined,
        isAuthenticated: () => false,
      }),
      response,
    );

    expect(key).toBe('ip:unknown');
  });

  test('should use user identity when authenticated session id is blank', async () => {
    const keyGenerator = createAuthenticatedRouteRateLimitKeyGenerator(true);
    expect(keyGenerator).toBeDefined();

    const key = await keyGenerator!(
      createRequest({
        ip: '203.0.113.30',
        isAuthenticated: () => true,
        sessionID: '   ',
        user: { username: 'alice' },
      }),
      response,
    );

    expect(key).toBe('user:alice');
  });

  test('should fall back to ip key when authenticated identity values are invalid', async () => {
    const keyGenerator = createAuthenticatedRouteRateLimitKeyGenerator(true);
    expect(keyGenerator).toBeDefined();

    const key = await keyGenerator!(
      createRequest({
        ip: '   ',
        isAuthenticated: () => true,
        sessionID: '   ',
        user: { username: { raw: 'alice' } },
      }),
      response,
    );

    expect(key).toBe('ip:unknown');
  });

  test('should fall back to unknown ip key when request ip is non-string', async () => {
    const keyGenerator = createAuthenticatedRouteRateLimitKeyGenerator(true);
    expect(keyGenerator).toBeDefined();

    const key = await keyGenerator!(
      createRequest({
        ip: 42 as unknown as string,
        isAuthenticated: () => false,
      }),
      response,
    );

    expect(key).toBe('ip:unknown');
  });
});

describe('isIdentityAwareRateLimitKeyingEnabled', () => {
  test('should return true when identitykeying is explicitly set to true', () => {
    expect(
      isIdentityAwareRateLimitKeyingEnabled({
        ratelimit: { identitykeying: true },
      }),
    ).toBe(true);
  });

  test('should return false when ratelimit configuration is missing', () => {
    expect(isIdentityAwareRateLimitKeyingEnabled({})).toBe(false);
  });

  test('should return false when identitykeying is missing', () => {
    expect(
      isIdentityAwareRateLimitKeyingEnabled({
        ratelimit: {},
      }),
    ).toBe(false);
  });

  test('should return false when identitykeying is explicitly false', () => {
    expect(
      isIdentityAwareRateLimitKeyingEnabled({
        ratelimit: { identitykeying: false },
      }),
    ).toBe(false);
  });

  test('should return false for truthy non-boolean identitykeying values', () => {
    const nonBooleanTruthyValues: unknown[] = ['true', 1, '1', [], { enabled: true }];

    for (const value of nonBooleanTruthyValues) {
      expect(
        isIdentityAwareRateLimitKeyingEnabled({
          ratelimit: { identitykeying: value },
        }),
      ).toBe(false);
    }
  });

  test('should return false when ratelimit is not an object', () => {
    const invalidRateLimitConfigurations: unknown[] = [null, 'enabled', 1, true];

    for (const value of invalidRateLimitConfigurations) {
      expect(
        isIdentityAwareRateLimitKeyingEnabled({
          ratelimit: value,
        }),
      ).toBe(false);
    }
  });

  test('should return false when server configuration is nullish', () => {
    expect(isIdentityAwareRateLimitKeyingEnabled(null as unknown as Record<string, unknown>)).toBe(
      false,
    );
    expect(
      isIdentityAwareRateLimitKeyingEnabled(undefined as unknown as Record<string, unknown>),
    ).toBe(false);
  });

  test('should return false when server configuration is a primitive value', () => {
    const invalidServerConfigurations: unknown[] = ['enabled', 1, true];

    for (const value of invalidServerConfigurations) {
      expect(
        isIdentityAwareRateLimitKeyingEnabled(value as unknown as Record<string, unknown>),
      ).toBe(false);
    }
  });
});
