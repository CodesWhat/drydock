const { mockCheckSessionIdentity } = vi.hoisted(() => ({
  mockCheckSessionIdentity: vi.fn(),
}));

vi.mock('./totp-identity.js', () => ({
  checkSessionIdentity: mockCheckSessionIdentity,
}));

vi.mock('../log/index.js', () => ({
  default: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  createIdentityAwareUpgradeRateLimitKeyResolver,
  isAuthenticatedSession,
} from './ws-upgrade-utils.js';

const V2_LOCAL = JSON.stringify({
  v: 2,
  kind: 'local',
  username: 'alice',
  subjectId: 'c'.repeat(64),
  providerId: 'basic.default',
  assurance: 'password',
  factorVersion: 0,
});

function upgradeRequest(user: unknown) {
  return { session: { passport: { user } } } as never;
}

describe('isAuthenticatedSession uses the shared v2 session validator', () => {
  beforeEach(() => {
    mockCheckSessionIdentity.mockReset();
    mockCheckSessionIdentity.mockReturnValue('valid');
  });

  test('accepts a legacy session', () => {
    expect(isAuthenticatedSession(upgradeRequest('{"username":"alice"}'))).toBe(true);
  });

  test('accepts a current v2 local session and checks its identity', () => {
    expect(isAuthenticatedSession(upgradeRequest(V2_LOCAL))).toBe(true);
    expect(mockCheckSessionIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'alice',
        identity: expect.objectContaining({ type: 'local' }),
      }),
    );
  });

  test('accepts a v2 OIDC session', () => {
    expect(isAuthenticatedSession(upgradeRequest('{"v":2,"kind":"oidc","username":"a"}'))).toBe(
      true,
    );
  });

  test('refuses a stale session', () => {
    mockCheckSessionIdentity.mockReturnValue('stale');

    expect(isAuthenticatedSession(upgradeRequest(V2_LOCAL))).toBe(false);
  });

  test('refuses a session when the store cannot answer', () => {
    mockCheckSessionIdentity.mockReturnValue('unavailable');

    expect(isAuthenticatedSession(upgradeRequest(V2_LOCAL))).toBe(false);
  });

  test.each([
    ['an empty object', {}],
    ['a decoded object instead of the stored string', { username: 'alice' }],
    ['malformed JSON', 'not-json'],
    ['a schema-invalid payload', '{"username":"alice","extra":1}'],
    ['a number', 7],
  ])('refuses %s as absent', (_name, user) => {
    expect(isAuthenticatedSession(upgradeRequest(user))).toBe(false);
  });

  test('anonymous access still opens the gate without a session user', () => {
    expect(isAuthenticatedSession(upgradeRequest(undefined), { anonymousAuthActive: true })).toBe(
      true,
    );
  });

  test('a stale session does not rescue itself through anonymous access being off', () => {
    mockCheckSessionIdentity.mockReturnValue('stale');

    expect(isAuthenticatedSession(upgradeRequest(V2_LOCAL), { anonymousAuthActive: false })).toBe(
      false,
    );
  });
});

describe('upgrade rate-limit principal from a v2 session', () => {
  test('keys the upgrade by the v2 session username', () => {
    const resolve = createIdentityAwareUpgradeRateLimitKeyResolver({
      ratelimit: { identitykeying: true },
    });
    const request = {
      socket: { remoteAddress: '10.0.0.1' },
      sessionID: 'sid-1',
      session: { passport: { user: V2_LOCAL } },
    } as never;

    const key = resolve(request, true);

    expect(typeof key).toBe('string');
    expect(key).not.toBe('ip:10.0.0.1');
  });
});
