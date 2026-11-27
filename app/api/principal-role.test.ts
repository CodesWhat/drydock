import type { Authenticator } from './authenticator-chain.js';

const { mockGetAuthenticators } = vi.hoisted(() => ({
  mockGetAuthenticators: vi.fn((): Authenticator[] => []),
}));

vi.mock('./authenticator-registry.js', () => ({
  getAuthenticators: mockGetAuthenticators,
}));

vi.mock('./local-subject.js', () => ({
  deriveSubjectId: (providerId: string, username: string) => `${providerId}|${username}`,
}));

import {
  isOidcRoleMappingActive,
  resolveHumanRole,
  resolvePrincipalRole,
} from './principal-role.js';

function basicAuthenticator(
  id: string,
  username: string,
  grantedRole?: Authenticator['grantedRole'],
): Authenticator {
  return {
    id,
    persistsSession: false,
    readsBasicHeader: true,
    localSubjectId: `${id}|${username}`,
    ...(grantedRole ? { grantedRole } : {}),
    authenticate: () => Promise.resolve(undefined),
  };
}

function localIdentity(subjectId: string) {
  return {
    type: 'local' as const,
    subjectId,
    providerId: 'basic.alice',
    assurance: 'password' as const,
    factorVersion: 0,
    issuedAt: 0,
  };
}

describe('resolvePrincipalRole', () => {
  beforeEach(() => {
    mockGetAuthenticators.mockReturnValue([
      basicAuthenticator('basic.alice', 'alice', { role: 'viewer', explicit: true }),
      basicAuthenticator('basic.bob', 'bob', { role: 'operator', explicit: true }),
    ]);
  });

  test('an API key has no role; its scopes are its authority', () => {
    expect(
      resolvePrincipalRole({
        kind: 'api-key',
        username: 'ci',
        keyId: 'k',
        scopes: ['read'],
        parentKeyId: null,
      }),
    ).toBeUndefined();
  });

  test('a role set on the principal wins', () => {
    expect(resolvePrincipalRole({ kind: 'anonymous', username: 'anonymous', role: 'viewer' })).toBe(
      'viewer',
    );
  });

  test('anonymous without a role is admin', () => {
    expect(resolveHumanRole({ kind: 'anonymous', username: 'anonymous' })).toBe('admin');
  });

  test('an OIDC bearer carries the role its groups mapped to', () => {
    expect(resolveHumanRole({ kind: 'oidc', username: 'carol', role: 'viewer' })).toBe('viewer');
  });

  test('an OIDC session carries the role its groups mapped to', () => {
    expect(
      resolveHumanRole({
        kind: 'session',
        username: 'carol',
        identity: { type: 'oidc', role: 'operator' },
      }),
    ).toBe('operator');
  });

  test('role mapping is active only when an authenticator maps roles from claims', () => {
    expect(isOidcRoleMappingActive()).toBe(false);
    mockGetAuthenticators.mockReturnValue([
      {
        id: 'oidc.sso',
        persistsSession: false,
        mapsRolesFromClaims: true,
        authenticate: () => Promise.resolve(undefined),
      },
    ]);
    expect(isOidcRoleMappingActive()).toBe(true);
  });

  test('scopes the OIDC mapping check to the provider that minted a session', () => {
    const oidc = (id: string, mapsRolesFromClaims: boolean): Authenticator => ({
      id,
      persistsSession: false,
      mapsRolesFromClaims,
      authenticate: () => Promise.resolve(undefined),
    });
    mockGetAuthenticators.mockReturnValue([oidc('oidc.corp', true), oidc('oidc.partner', false)]);
    expect(isOidcRoleMappingActive('oidc.partner')).toBe(false);
    expect(isOidcRoleMappingActive('oidc.corp')).toBe(true);
    // A provider that is gone falls back to the instance-wide answer.
    expect(isOidcRoleMappingActive('oidc.removed')).toBe(true);
    expect(isOidcRoleMappingActive()).toBe(true);
  });

  test('an OIDC bearer is admin until group mapping exists', () => {
    expect(resolveHumanRole({ kind: 'oidc', username: 'carol' })).toBe('admin');
  });

  test('an OIDC session is admin until group mapping exists', () => {
    expect(
      resolveHumanRole({ kind: 'session', username: 'carol', identity: { type: 'oidc' } }),
    ).toBe('admin');
  });

  test('a Basic principal resolves through the account that verified it', () => {
    expect(
      resolveHumanRole({
        kind: 'basic',
        username: 'alice',
        identity: localIdentity('basic.alice|alice'),
      }),
    ).toBe('viewer');
  });

  test('a local session resolves through its subject, per request', () => {
    const principal = {
      kind: 'session' as const,
      username: 'bob',
      identity: localIdentity('basic.bob|bob'),
    };
    expect(resolveHumanRole(principal)).toBe('operator');

    // A config change plus restart applies to the same session at once.
    mockGetAuthenticators.mockReturnValue([
      basicAuthenticator('basic.bob', 'bob', { role: 'viewer', explicit: true }),
    ]);
    expect(resolveHumanRole(principal)).toBe('viewer');
  });

  test('an account whose authenticator states no role is admin', () => {
    mockGetAuthenticators.mockReturnValue([basicAuthenticator('basic.dave', 'dave')]);
    expect(
      resolveHumanRole({
        kind: 'session',
        username: 'dave',
        identity: localIdentity('basic.dave|dave'),
      }),
    ).toBe('admin');
  });

  test('a session that outlived its account is the least role once roles are in use', () => {
    expect(
      resolveHumanRole({
        kind: 'session',
        username: 'gone',
        identity: localIdentity('basic.gone|gone'),
      }),
    ).toBe('viewer');
  });

  test('a session that outlived its account stays admin while no role is configured', () => {
    mockGetAuthenticators.mockReturnValue([
      basicAuthenticator('basic.alice', 'alice', { role: 'admin', explicit: false }),
    ]);
    expect(
      resolveHumanRole({
        kind: 'session',
        username: 'gone',
        identity: localIdentity('basic.gone|gone'),
      }),
    ).toBe('admin');
  });

  test('a Basic principal missing its subject is treated as an unknown account', () => {
    expect(resolveHumanRole({ kind: 'basic', username: 'alice' } as never)).toBe('viewer');
  });

  test('a legacy session resolves by username', () => {
    expect(resolveHumanRole({ kind: 'session', username: 'bob' })).toBe('operator');
  });

  test('a legacy name shared by several accounts gets the least of their roles', () => {
    mockGetAuthenticators.mockReturnValue([
      basicAuthenticator('basic.one', 'sam', { role: 'admin', explicit: true }),
      basicAuthenticator('basic.two', 'sam', { role: 'viewer', explicit: true }),
    ]);
    expect(resolveHumanRole({ kind: 'session', username: 'sam' })).toBe('viewer');
  });

  test('a legacy session naming no account follows the unknown-account rule', () => {
    expect(resolveHumanRole({ kind: 'session', username: 'nobody' })).toBe('viewer');

    mockGetAuthenticators.mockReturnValue([
      { id: 'oidc.google', persistsSession: false, authenticate: () => Promise.resolve(undefined) },
    ]);
    expect(resolveHumanRole({ kind: 'session', username: 'nobody' })).toBe('admin');
  });
});
