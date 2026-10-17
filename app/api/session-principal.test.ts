const { mockCheckSessionIdentity, mockWarn, mockDebug } = vi.hoisted(() => ({
  mockCheckSessionIdentity: vi.fn(),
  mockWarn: vi.fn(),
  mockDebug: vi.fn(),
}));

vi.mock('./totp-identity.js', () => ({
  checkSessionIdentity: mockCheckSessionIdentity,
}));

vi.mock('../log/index.js', () => ({
  default: { warn: mockWarn, info: vi.fn(), debug: mockDebug, error: vi.fn() },
}));

import type { AuthRequest } from './auth-types.js';
import {
  clearSessionPrincipal,
  readSessionPrincipal,
  restoreSessionPrincipal,
  SESSION_AUTHENTICATOR_ID,
  SESSION_USER_KEY,
  sessionAuthenticator,
  validateSessionUser,
  writeSessionPrincipal,
} from './session-principal.js';

const SUBJECT_ID = 'b'.repeat(64);
const V2_LOCAL = JSON.stringify({
  v: 2,
  kind: 'local',
  username: 'admin',
  subjectId: SUBJECT_ID,
  providerId: 'basic.default',
  assurance: 'password',
  factorVersion: 0,
  issuedAt: 1_000,
});
const V2_OIDC = '{"v":2,"kind":"oidc","username":"admin"}';

function createRequest(session?: unknown): AuthRequest {
  return { session } as unknown as AuthRequest;
}

describe('session-principal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckSessionIdentity.mockReturnValue('valid');
  });

  test('stores the user under the key Passport wrote, so live sessions survive', () => {
    expect(SESSION_USER_KEY).toBe('passport');
  });

  describe('readSessionPrincipal', () => {
    test('returns a session principal for a stored user', () => {
      const req = createRequest({ [SESSION_USER_KEY]: { user: '{"username":"admin"}' } });

      expect(readSessionPrincipal(req)).toEqual({ kind: 'session', username: 'admin' });
    });

    test('returns undefined when there is no session', () => {
      expect(readSessionPrincipal(createRequest(undefined))).toBeUndefined();
    });

    test('returns undefined when the session has no user container', () => {
      expect(readSessionPrincipal(createRequest({}))).toBeUndefined();
    });

    test('returns undefined when the user container is not an object', () => {
      expect(
        readSessionPrincipal(createRequest({ [SESSION_USER_KEY]: 'not-an-object' })),
      ).toBeUndefined();
    });

    test('returns undefined when the container holds no user', () => {
      expect(readSessionPrincipal(createRequest({ [SESSION_USER_KEY]: {} }))).toBeUndefined();
    });

    test('drops a payload that no longer deserializes and warns', () => {
      const session = { [SESSION_USER_KEY]: { user: 'not-json' } };

      expect(readSessionPrincipal(createRequest(session))).toBeUndefined();
      expect(session[SESSION_USER_KEY].user).toBeUndefined();
      expect(mockWarn).toHaveBeenCalledWith(
        'Unable to deserialize session user (Serialized user JSON is malformed)',
      );
    });

    test('restores a v2 local session with its subject identity', () => {
      const identity = {
        type: 'local',
        subjectId: SUBJECT_ID,
        providerId: 'basic.default',
        assurance: 'password',
        factorVersion: 0,
        issuedAt: 1_000,
      };
      const req = createRequest({ [SESSION_USER_KEY]: { user: V2_LOCAL } });

      expect(readSessionPrincipal(req)).toEqual({ kind: 'session', username: 'admin', identity });
      expect(mockCheckSessionIdentity).toHaveBeenCalledWith({ username: 'admin', identity });
    });

    test('restores a v2 OIDC session', () => {
      const req = createRequest({ [SESSION_USER_KEY]: { user: V2_OIDC } });

      expect(readSessionPrincipal(req)).toEqual({
        kind: 'session',
        username: 'admin',
        identity: { type: 'oidc' },
      });
    });

    test('drops a stale session so it can never come back', () => {
      mockCheckSessionIdentity.mockReturnValue('stale');
      const session = { [SESSION_USER_KEY]: { user: V2_LOCAL } };

      expect(readSessionPrincipal(createRequest(session))).toBeUndefined();
      expect(session[SESSION_USER_KEY].user).toBeUndefined();
      expect(mockDebug).toHaveBeenCalledWith('Dropped a session whose subject version is stale');
    });

    test('refuses but keeps a session when the store cannot answer', () => {
      mockCheckSessionIdentity.mockReturnValue('unavailable');
      const session = { [SESSION_USER_KEY]: { user: V2_LOCAL } };

      expect(readSessionPrincipal(createRequest(session))).toBeUndefined();
      expect(session[SESSION_USER_KEY].user).toBe(V2_LOCAL);
    });
  });

  describe('validateSessionUser', () => {
    test('is valid for a deserializable, current session', () => {
      expect(validateSessionUser('{"username":"admin"}')).toEqual({
        status: 'valid',
        user: { username: 'admin' },
      });
    });

    test('reports malformed with the deserialize error', () => {
      expect(validateSessionUser('not-json')).toEqual({
        status: 'malformed',
        message: 'Serialized user JSON is malformed',
      });
    });

    test.each(['stale', 'unavailable'] as const)('passes a %s check through', (status) => {
      mockCheckSessionIdentity.mockReturnValue(status);

      expect(validateSessionUser('{"username":"admin"}')).toEqual({ status });
    });
  });

  describe('writeSessionPrincipal', () => {
    test('creates the container when the session has none', () => {
      const session: Record<string, unknown> = {};

      writeSessionPrincipal(createRequest(session), {
        kind: 'basic',
        username: 'admin',
        identity: {
          subjectId: 'a'.repeat(64),
          providerId: 'basic.default',
          assurance: 'password',
          factorVersion: 0,
          issuedAt: 1_000,
        },
      });

      expect(JSON.parse(session[SESSION_USER_KEY].user as string)).toEqual({
        v: 2,
        kind: 'local',
        username: 'admin',
        subjectId: 'a'.repeat(64),
        providerId: 'basic.default',
        assurance: 'password',
        factorVersion: 0,
        issuedAt: 1_000,
      });
    });

    test('replaces a stale payload', () => {
      const session = { [SESSION_USER_KEY]: { user: '{"username":"old"}' } };

      writeSessionPrincipal(createRequest(session), { kind: 'session', username: 'new' });

      expect(session[SESSION_USER_KEY].user).toBe('{"username":"new"}');
    });

    test('leaves an already-current payload untouched so the session stays clean', () => {
      const container = { user: '{"username":"admin"}' };
      const session = { [SESSION_USER_KEY]: container };

      writeSessionPrincipal(createRequest(session), { kind: 'session', username: 'admin' });

      expect(session[SESSION_USER_KEY]).toBe(container);
      expect(container.user).toBe('{"username":"admin"}');
    });

    test('does nothing when there is no session', () => {
      expect(() =>
        writeSessionPrincipal(createRequest(undefined), { kind: 'basic', username: 'admin' }),
      ).not.toThrow();
    });

    test('persists a Basic principal as a v2 local session', () => {
      const session: Record<string, unknown> = {};

      writeSessionPrincipal(createRequest(session), {
        kind: 'basic',
        username: 'admin',
        identity: {
          subjectId: SUBJECT_ID,
          providerId: 'basic.default',
          assurance: 'password',
          factorVersion: 0,
          issuedAt: 1_000,
        },
      });

      expect(session[SESSION_USER_KEY]).toEqual({ user: V2_LOCAL });
    });

    test('persists an OIDC principal as a v2 OIDC session', () => {
      const session: Record<string, unknown> = {};

      writeSessionPrincipal(createRequest(session), { kind: 'oidc', username: 'admin' });

      expect(session[SESSION_USER_KEY]).toEqual({ user: V2_OIDC });
    });

    test('rewrites a restored v2 session identically, so the session stays clean', () => {
      const container = { user: V2_LOCAL };
      const session = { [SESSION_USER_KEY]: container };
      const req = createRequest(session);
      const principal = readSessionPrincipal(req);

      writeSessionPrincipal(req, principal as never);

      expect(container.user).toBe(V2_LOCAL);
    });

    test('keeps a restored legacy session legacy', () => {
      const session = { [SESSION_USER_KEY]: { user: '{"username":"admin"}' } };
      const req = createRequest(session);

      writeSessionPrincipal(req, readSessionPrincipal(req) as never);

      expect(session[SESSION_USER_KEY].user).toBe('{"username":"admin"}');
    });

    test.each([
      ['api-key', { kind: 'api-key', username: 'ci', keyId: 'k1', scopes: ['read'] }],
      ['anonymous', { kind: 'anonymous', username: 'anonymous' }],
    ] as const)(
      'refuses to persist a %s principal and leaves the session untouched',
      (_kind, principal) => {
        const session: Record<string, unknown> = {};

        expect(() => writeSessionPrincipal(createRequest(session), principal as never)).toThrow(
          /never persisted/,
        );
        expect(session[SESSION_USER_KEY]).toBeUndefined();
      },
    );

    test('refuses a Basic principal that carries no local identity rather than writing a legacy session', () => {
      const session: Record<string, unknown> = {};

      expect(() =>
        writeSessionPrincipal(createRequest(session), {
          kind: 'basic',
          username: 'admin',
        } as never),
      ).toThrow(/never persisted/);
      expect(session[SESSION_USER_KEY]).toBeUndefined();
    });
  });

  describe('clearSessionPrincipal', () => {
    test('removes the stored user and the request principal', () => {
      const session = { [SESSION_USER_KEY]: { user: '{"username":"admin"}' } };
      const req = createRequest(session);
      req.principal = { kind: 'session', username: 'admin' };

      clearSessionPrincipal(req);

      expect(req.principal).toBeUndefined();
      expect(session[SESSION_USER_KEY].user).toBeUndefined();
    });

    test('tolerates a session that never held a user', () => {
      const req = createRequest({});

      expect(() => clearSessionPrincipal(req)).not.toThrow();
    });

    test('throws the Passport-compatible error when there is no session', () => {
      expect(() => clearSessionPrincipal(createRequest(undefined))).toThrow(
        'Login sessions require session support. Did you forget to use `express-session` middleware?',
      );
    });
  });

  describe('sessionAuthenticator', () => {
    test('is the only authenticator that persists a session', () => {
      expect(sessionAuthenticator.id).toBe(SESSION_AUTHENTICATOR_ID);
      expect(sessionAuthenticator.persistsSession).toBe(true);
    });

    test('resolves the identity stored in the session', async () => {
      const req = createRequest({ [SESSION_USER_KEY]: { user: '{"username":"admin"}' } });

      await expect(sessionAuthenticator.authenticate(req)).resolves.toEqual({
        kind: 'session',
        username: 'admin',
      });
    });

    test('declines a request with no stored identity', async () => {
      await expect(sessionAuthenticator.authenticate(createRequest({}))).resolves.toBeUndefined();
    });
  });

  describe('restoreSessionPrincipal', () => {
    test('publishes the session identity on the request', () => {
      const req = createRequest({ [SESSION_USER_KEY]: { user: '{"username":"admin"}' } });
      const next = vi.fn();

      restoreSessionPrincipal(req as never, {} as never, next);

      expect(req.principal).toEqual({ kind: 'session', username: 'admin' });
      expect(next).toHaveBeenCalledWith();
    });

    test('leaves the request unauthenticated when there is no stored identity', () => {
      const req = createRequest({});
      const next = vi.fn();

      restoreSessionPrincipal(req as never, {} as never, next);

      expect(req.principal).toBeUndefined();
      expect(next).toHaveBeenCalledWith();
    });
  });
});
