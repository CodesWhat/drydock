import type { Request, Response } from 'express';
import { createAuthenticatedRouteRateLimitKeyGenerator } from './rate-limit-key.js';

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
});
