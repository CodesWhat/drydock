import {
  failClosedAuth,
  requireAuthString,
  withAuthorizationHeader,
  type AuthLogger,
} from './auth.js';

test('requireAuthString should return provided value', () => {
  expect(requireAuthString('secret', 'missing auth')).toBe('secret');
});

test('requireAuthString should throw on missing/blank values', () => {
  expect(() => requireAuthString(undefined, 'missing auth')).toThrow('missing auth');
  expect(() => requireAuthString('', 'missing auth')).toThrow('missing auth');
  expect(() => requireAuthString('   ', 'missing auth')).toThrow('missing auth');
});

test('withAuthorizationHeader should merge headers and set Authorization', () => {
  const result = withAuthorizationHeader(
    { headers: { Accept: 'application/json' } },
    'Bearer',
    'token-value',
    'missing token',
  );

  expect(result).toEqual({
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer token-value',
    },
  });
});

test('withAuthorizationHeader should create headers when missing', () => {
  const result = withAuthorizationHeader({}, 'Basic', 'base64-token', 'missing token');
  expect(result).toEqual({
    headers: {
      Authorization: 'Basic base64-token',
    },
  });
});

test('withAuthorizationHeader should throw when token is missing', () => {
  expect(() => withAuthorizationHeader({}, 'Bearer', undefined, 'missing token')).toThrow(
    'missing token',
  );
});

test('failClosedAuth should throw by default', () => {
  expect(() => failClosedAuth('auth failed')).toThrow('auth failed');
});

test('failClosedAuth should warn and continue when insecure mode is enabled', () => {
  const logger: AuthLogger = {
    warn: vi.fn(),
  };

  expect(() =>
    failClosedAuth('auth failed', {
      allowInsecure: true,
      logger,
      insecureFlagName: 'auth.insecure',
    }),
  ).not.toThrow();

  expect(logger.warn).toHaveBeenCalledWith(
    'auth failed; continuing because auth.insecure=true',
  );
});
