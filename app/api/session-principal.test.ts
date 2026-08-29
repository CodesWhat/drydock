const { mockDeserializeSessionUser, mockWarn } = vi.hoisted(() => ({
  mockDeserializeSessionUser: vi.fn(),
  mockWarn: vi.fn(),
}));

vi.mock('./session-user.js', () => ({
  deserializeSessionUser: mockDeserializeSessionUser,
}));

vi.mock('../log/index.js', () => ({
  default: { warn: mockWarn, info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import type { AuthRequest } from './auth-types.js';
import {
  clearSessionPrincipal,
  readSessionPrincipal,
  restoreSessionPrincipal,
  SESSION_AUTHENTICATOR_ID,
  SESSION_USER_KEY,
  sessionAuthenticator,
  writeSessionPrincipal,
} from './session-principal.js';

function createRequest(session?: unknown): AuthRequest {
  return { session } as unknown as AuthRequest;
}

describe('session-principal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeserializeSessionUser.mockImplementation((serialized: unknown) =>
      JSON.parse(serialized as string),
    );
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
      mockDeserializeSessionUser.mockImplementation(() => {
        throw new Error('Serialized user JSON is malformed');
      });
      const session = { [SESSION_USER_KEY]: { user: 'not-json' } };

      expect(readSessionPrincipal(createRequest(session))).toBeUndefined();
      expect(session[SESSION_USER_KEY].user).toBeUndefined();
      expect(mockWarn).toHaveBeenCalledWith(
        'Unable to deserialize session user (Serialized user JSON is malformed)',
      );
    });
  });

  describe('writeSessionPrincipal', () => {
    test('creates the container when the session has none', () => {
      const session: Record<string, unknown> = {};

      writeSessionPrincipal(createRequest(session), { kind: 'basic', username: 'admin' });

      expect(session[SESSION_USER_KEY]).toEqual({ user: '{"username":"admin"}' });
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

    test('persists only the username, never the principal kind', () => {
      const session: Record<string, unknown> = {};

      writeSessionPrincipal(createRequest(session), {
        kind: 'api-key',
        username: 'ci',
        keyId: 'k1',
        scopes: ['read'],
      });

      expect(session[SESSION_USER_KEY]).toEqual({ user: '{"username":"ci"}' });
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
