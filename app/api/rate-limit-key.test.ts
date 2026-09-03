import type { Request, Response } from 'express';
import type { AuthenticatedPrincipal } from './principal.js';

import {
  createAuthenticatedRouteRateLimitKeyGenerator,
  getAuthenticatedRouteRateLimitKey,
  isIdentityAwareRateLimitKeyingEnabled,
  isRequestAuthenticated,
} from './rate-limit-key.js';

function createRequest(
  overrides: Partial<
    Request & {
      sessionID?: unknown;
      principal?: AuthenticatedPrincipal;
    }
  >,
): Request {
  return {
    ip: '198.51.100.7',
    ...overrides,
  } as Request;
}

const response = {} as Response;

describe('isRequestAuthenticated', () => {
  test('returns true for principals that carry a real identity', () => {
    expect(isRequestAuthenticated({ principal: { kind: 'basic', username: 'alice' } })).toBe(true);
    expect(isRequestAuthenticated({ principal: { kind: 'session', username: 'alice' } })).toBe(
      true,
    );
    expect(isRequestAuthenticated({ principal: { kind: 'oidc', username: 'alice' } })).toBe(true);
  });

  test('returns false for an anonymous principal', () => {
    expect(
      isRequestAuthenticated({ principal: { kind: 'anonymous', username: 'anonymous' } }),
    ).toBe(false);
  });

  test('returns false when no principal is present', () => {
    expect(isRequestAuthenticated({})).toBe(false);
  });
});

describe('createAuthenticatedRouteRateLimitKeyGenerator', () => {
  test('should return undefined when identity-aware keying is disabled', () => {
    expect(createAuthenticatedRouteRateLimitKeyGenerator(false)).toBeUndefined();
  });

  test('should separate authenticated sessions behind the same proxy ip', async () => {
    const keyGenerator = createAuthenticatedRouteRateLimitKeyGenerator(true);
    expect(keyGenerator).toBeDefined();

    const firstUserKey = await keyGenerator!(
      createRequest({
        ip: '203.0.113.10',
        sessionID: 'session-a',
        principal: { kind: 'session', username: 'alice' },
      }),
      response,
    );
    const secondUserKey = await keyGenerator!(
      createRequest({
        ip: '203.0.113.10',
        sessionID: 'session-b',
        principal: { kind: 'session', username: 'bob' },
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
      }),
      response,
    );
    const secondKey = await keyGenerator!(
      createRequest({
        ip: '203.0.113.20',
      }),
      response,
    );

    expect(firstKey).toMatch(/^ip:/);
    expect(secondKey).toBe(firstKey);
  });

  test('should treat an anonymous principal as unauthenticated for ip keying', async () => {
    const keyGenerator = createAuthenticatedRouteRateLimitKeyGenerator(true);
    expect(keyGenerator).toBeDefined();

    const key = await keyGenerator!(
      createRequest({
        ip: '203.0.113.25',
        sessionID: 'anon-session',
        principal: { kind: 'anonymous', username: 'anonymous' },
      }),
      response,
    );

    expect(key).toBe('ip:203.0.113.25');
  });

  test('should keep login attempts IP-keyed even when a non-session principal is present', () => {
    expect(
      getAuthenticatedRouteRateLimitKey({
        path: '/login',
        ip: '203.0.113.10',
        principal: { kind: 'api-key', username: 'automation', keyId: 'abcdef012345', scopes: [] },
      }),
    ).toBe('ip:203.0.113.10');
  });

  test('should keep any request with an authorization header IP-keyed before authentication', () => {
    expect(
      getAuthenticatedRouteRateLimitKey({
        ip: '203.0.113.11',
        headers: { authorization: 'Bearer ddk_key' },
        sessionID: 'cookie-or-unsaved-session',
      }),
    ).toBe('ip:203.0.113.11');
  });

  test('should bucket an authenticated API key on its keyId, not its name', () => {
    // Two keys may share a name, and a name is operator-supplied. Bucketing on
    // it would let one key's traffic exhaust another's budget, so keyId is the
    // only identity this may key on.
    expect(
      getAuthenticatedRouteRateLimitKey({
        ip: '203.0.113.11',
        headers: { authorization: 'Bearer ddk_key' },
        sessionID: 'cookie-or-unsaved-session',
        principal: {
          kind: 'api-key',
          username: 'automation',
          keyId: 'abcdef012345',
          scopes: [],
          parentKeyId: null,
        },
      }),
    ).toBe('apikey:abcdef012345'); // gitleaks:allow — a bucket name, not a credential
  });

  test('should give two keys sharing one name independent buckets', () => {
    const keyed = (keyId: string) =>
      getAuthenticatedRouteRateLimitKey({
        ip: '203.0.113.11',
        principal: {
          kind: 'api-key',
          username: 'dashboard',
          keyId,
          scopes: [],
          parentKeyId: null,
        },
      });

    expect(keyed('aaaaaaaaaaaa')).not.toBe(keyed('bbbbbbbbbbbb'));
  });

  test('should prefer normalized request ip over proxy socket address for unauthenticated requests', async () => {
    const keyGenerator = createAuthenticatedRouteRateLimitKeyGenerator(true);
    expect(keyGenerator).toBeDefined();

    const firstKey = await keyGenerator!(
      createRequest({
        ip: '203.0.113.20',
        socket: {
          remoteAddress: '198.51.100.7',
        } as Request['socket'],
      }),
      response,
    );
    const secondKey = await keyGenerator!(
      createRequest({
        ip: '203.0.113.21',
        socket: {
          remoteAddress: '198.51.100.7',
        } as Request['socket'],
      }),
      response,
    );

    expect(firstKey).toMatch(/^ip:/);
    expect(secondKey).not.toBe(firstKey);
  });

  test('should fall back to socket remote address when normalized request ip is unavailable', async () => {
    const keyGenerator = createAuthenticatedRouteRateLimitKeyGenerator(true);
    expect(keyGenerator).toBeDefined();

    const key = await keyGenerator!(
      createRequest({
        ip: undefined,
        socket: {
          remoteAddress: '198.51.100.7',
        } as Request['socket'],
      }),
      response,
    );

    expect(key).toMatch(/^ip:/);
    expect(key).not.toBe('ip:unknown');
  });

  test('should return unknown ip key when unauthenticated request ip is undefined', async () => {
    const keyGenerator = createAuthenticatedRouteRateLimitKeyGenerator(true);
    expect(keyGenerator).toBeDefined();

    const key = await keyGenerator!(
      createRequest({
        ip: undefined,
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
        sessionID: '   ',
        principal: { kind: 'basic', username: 'alice' },
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
        sessionID: '   ',
        principal: { kind: 'basic', username: { raw: 'alice' } as unknown as string },
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
