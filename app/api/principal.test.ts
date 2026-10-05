import {
  ANONYMOUS_USERNAME,
  type AuthenticatedPrincipal,
  getIdentityUsername,
  getPrincipal,
  isAuthenticated,
  isIdentityPrincipal,
  isRecoveryAssuranceSession,
} from './principal.js';

describe('principal', () => {
  describe('getPrincipal', () => {
    test('returns the principal carried by the request', () => {
      const principal: AuthenticatedPrincipal = { kind: 'basic', username: 'admin' };

      expect(getPrincipal({ principal })).toBe(principal);
    });

    test('returns undefined when the request carries none', () => {
      expect(getPrincipal({})).toBeUndefined();
    });
  });

  describe('isAuthenticated', () => {
    test.each([
      ['session', { kind: 'session', username: 'admin' }],
      ['basic', { kind: 'basic', username: 'admin' }],
      ['oidc', { kind: 'oidc', username: 'user@example.com' }],
      ['anonymous', { kind: 'anonymous', username: ANONYMOUS_USERNAME }],
      ['api-key', { kind: 'api-key', username: 'ci', keyId: 'abc', scopes: ['read'] }],
    ] as Array<[string, AuthenticatedPrincipal]>)(
      'is true for a %s principal',
      (_kind, principal) => {
        expect(isAuthenticated({ principal })).toBe(true);
      },
    );

    test('is false when no authenticator resolved the request', () => {
      expect(isAuthenticated({})).toBe(false);
    });
  });

  describe('isIdentityPrincipal', () => {
    test('is true for a credentialed principal', () => {
      expect(isIdentityPrincipal({ kind: 'basic', username: 'admin' })).toBe(true);
    });

    test('is false for anonymous access, which carries no identity', () => {
      expect(isIdentityPrincipal({ kind: 'anonymous', username: ANONYMOUS_USERNAME })).toBe(false);
    });

    test('is false when there is no principal', () => {
      expect(isIdentityPrincipal(undefined)).toBe(false);
    });
  });

  describe('getIdentityUsername', () => {
    test('returns the username verbatim, without trimming', () => {
      expect(getIdentityUsername({ principal: { kind: 'basic', username: ' admin ' } })).toBe(
        ' admin ',
      );
    });

    test('returns undefined for anonymous access', () => {
      expect(
        getIdentityUsername({ principal: { kind: 'anonymous', username: ANONYMOUS_USERNAME } }),
      ).toBeUndefined();
    });

    test('returns undefined when the request is unauthenticated', () => {
      expect(getIdentityUsername({})).toBeUndefined();
    });

    test('returns undefined when the username is not a string', () => {
      const principal = { kind: 'basic', username: 42 } as unknown as AuthenticatedPrincipal;

      expect(getIdentityUsername({ principal })).toBeUndefined();
    });
  });

  describe('isRecoveryAssuranceSession', () => {
    const local = (assurance: 'password' | 'totp' | 'recovery') => ({
      type: 'local' as const,
      subjectId: 's'.repeat(64),
      providerId: 'basic.default',
      assurance,
      factorVersion: 1,
      issuedAt: 1,
    });

    test('is true only for a local session that signed in with a recovery code', () => {
      expect(
        isRecoveryAssuranceSession({
          kind: 'session',
          username: 'scott',
          identity: local('recovery'),
        }),
      ).toBe(true);
    });

    test.each([
      ['a TOTP-assured session', { kind: 'session', username: 'scott', identity: local('totp') }],
      ['a password session', { kind: 'session', username: 'scott', identity: local('password') }],
      ['an OIDC session', { kind: 'session', username: 'scott', identity: { type: 'oidc' } }],
      ['a legacy session', { kind: 'session', username: 'scott' }],
      [
        'an API key',
        { kind: 'api-key', username: 'ci', keyId: 'k', scopes: [], parentKeyId: null },
      ],
      ['anonymous access', { kind: 'anonymous', username: ANONYMOUS_USERNAME }],
      ['no principal', undefined],
    ])('is false for %s', (_name, principal) => {
      expect(isRecoveryAssuranceSession(principal as AuthenticatedPrincipal | undefined)).toBe(
        false,
      );
    });
  });

  test('ANONYMOUS_USERNAME is the value the API has always reported', () => {
    expect(ANONYMOUS_USERNAME).toBe('anonymous');
  });
});
