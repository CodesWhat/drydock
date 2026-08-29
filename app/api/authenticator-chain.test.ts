const { mockWriteSessionPrincipal } = vi.hoisted(() => ({
  mockWriteSessionPrincipal: vi.fn(),
}));

vi.mock('./session-principal.js', () => ({
  writeSessionPrincipal: mockWriteSessionPrincipal,
}));

import type { AuthRequest } from './auth-types.js';
import {
  type Authenticator,
  authenticateRequest,
  getAuthenticationFailureStatus,
  getAuthenticators,
  registerAuthenticator,
  resetAuthenticatorChainForTests,
} from './authenticator-chain.js';
import type { AuthenticatedPrincipal } from './principal.js';

function createAuthenticator(
  id: string,
  principal: AuthenticatedPrincipal | undefined,
  overrides: Partial<Authenticator> = {},
): Authenticator {
  return {
    id,
    persistsSession: false,
    authenticate: vi.fn(async () => principal),
    ...overrides,
  };
}

function createRequest(): AuthRequest {
  return {} as AuthRequest;
}

describe('authenticator-chain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthenticatorChainForTests();
  });

  afterEach(() => {
    resetAuthenticatorChainForTests();
  });

  describe('registration', () => {
    test('preserves registration order', () => {
      registerAuthenticator(createAuthenticator('first', undefined));
      registerAuthenticator(createAuthenticator('second', undefined));

      expect(getAuthenticators().map((authenticator) => authenticator.id)).toEqual([
        'first',
        'second',
      ]);
    });

    test('hands back a copy, so a caller cannot reorder the live chain', () => {
      registerAuthenticator(createAuthenticator('first', undefined));

      const authenticators = getAuthenticators() as Authenticator[];
      authenticators.length = 0;

      expect(getAuthenticators()).toHaveLength(1);
    });

    test('resets to empty', () => {
      registerAuthenticator(createAuthenticator('first', undefined));

      resetAuthenticatorChainForTests();

      expect(getAuthenticators()).toEqual([]);
    });
  });

  describe('authenticateRequest', () => {
    test('returns undefined when nothing is registered', async () => {
      await expect(authenticateRequest(createRequest())).resolves.toBeUndefined();
    });

    test('returns undefined when every authenticator declines', async () => {
      const first = createAuthenticator('first', undefined);
      const second = createAuthenticator('second', undefined);
      registerAuthenticator(first);
      registerAuthenticator(second);
      const req = createRequest();

      await expect(authenticateRequest(req)).resolves.toBeUndefined();
      expect(first.authenticate).toHaveBeenCalledWith(req);
      expect(second.authenticate).toHaveBeenCalledWith(req);
      expect(req.principal).toBeUndefined();
    });

    test('the first authenticator to resolve wins and later ones never run', async () => {
      const principal: AuthenticatedPrincipal = { kind: 'basic', username: 'admin' };
      const first = createAuthenticator('first', principal);
      const second = createAuthenticator('second', { kind: 'oidc', username: 'other' });
      registerAuthenticator(first);
      registerAuthenticator(second);
      const req = createRequest();

      await expect(authenticateRequest(req)).resolves.toEqual(principal);
      expect(req.principal).toEqual(principal);
      expect(second.authenticate).not.toHaveBeenCalled();
    });

    test('skips a declining authenticator and keeps going', async () => {
      const principal: AuthenticatedPrincipal = { kind: 'oidc', username: 'user@example.com' };
      registerAuthenticator(createAuthenticator('first', undefined));
      registerAuthenticator(createAuthenticator('second', principal));

      await expect(authenticateRequest(createRequest())).resolves.toEqual(principal);
    });

    test('never writes a session for an authenticator that declares persistsSession false', async () => {
      registerAuthenticator(
        createAuthenticator(
          'basic',
          { kind: 'basic', username: 'admin' },
          {
            persistsSession: false,
          },
        ),
      );

      await authenticateRequest(createRequest());

      expect(mockWriteSessionPrincipal).not.toHaveBeenCalled();
    });

    test('writes a session for an authenticator that declares persistsSession true', async () => {
      const principal: AuthenticatedPrincipal = { kind: 'session', username: 'admin' };
      registerAuthenticator(createAuthenticator('session', principal, { persistsSession: true }));
      const req = createRequest();

      await authenticateRequest(req);

      expect(mockWriteSessionPrincipal).toHaveBeenCalledWith(req, principal);
    });

    test('propagates an authenticator failure to the caller', async () => {
      registerAuthenticator(
        createAuthenticator('broken', undefined, {
          authenticate: vi.fn(async () => {
            throw new Error('registry unavailable');
          }),
        }),
      );

      await expect(authenticateRequest(createRequest())).rejects.toThrow('registry unavailable');
    });
  });

  describe('getAuthenticationFailureStatus', () => {
    test('defaults to 401 when nothing is registered', () => {
      expect(getAuthenticationFailureStatus(createRequest())).toBe(401);
    });

    test('defaults to 401 when no authenticator names a status', () => {
      registerAuthenticator(createAuthenticator('first', undefined));

      expect(getAuthenticationFailureStatus(createRequest())).toBe(401);
    });

    test('defaults to 401 when an authenticator declines to name one', () => {
      registerAuthenticator(
        createAuthenticator('first', undefined, { getFailureStatus: () => undefined }),
      );

      expect(getAuthenticationFailureStatus(createRequest())).toBe(401);
    });

    test('the first authenticator to name a status wins', () => {
      registerAuthenticator(
        createAuthenticator('first', undefined, { getFailureStatus: () => undefined }),
      );
      registerAuthenticator(
        createAuthenticator('second', undefined, { getFailureStatus: () => 400 }),
      );
      registerAuthenticator(
        createAuthenticator('third', undefined, { getFailureStatus: () => 403 }),
      );

      expect(getAuthenticationFailureStatus(createRequest())).toBe(400);
    });
  });
});
