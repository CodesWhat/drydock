import { createMockResponse } from '../test/helpers.js';
import type { AuthenticatedPrincipal } from './principal.js';
import { refuseRecoveryAssuranceSession } from './recovery-assurance.js';

const localIdentity = (assurance: 'password' | 'totp' | 'recovery') => ({
  type: 'local' as const,
  subjectId: 's'.repeat(64),
  providerId: 'basic.default',
  assurance,
  factorVersion: 1,
  issuedAt: 1,
});

describe('refuseRecoveryAssuranceSession', () => {
  test('answers a recovery-code session with 403, the reason and what it tried to do', () => {
    const res = createMockResponse();

    const refused = refuseRecoveryAssuranceSession(
      { principal: { kind: 'session', username: 'scott', identity: localIdentity('recovery') } },
      res,
      'register agent keys',
    );

    expect(refused).toBe(true);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error:
        'A session that signed in with a recovery code cannot register agent keys. Sign in with a code from your authenticator app and try again.',
      details: { reason: 'recovery-assurance' },
    });
  });

  test.each<[string, AuthenticatedPrincipal | undefined]>([
    [
      'a session that used the authenticator app',
      { kind: 'session', username: 'scott', identity: localIdentity('totp') },
    ],
    [
      'a password-only session',
      { kind: 'session', username: 'scott', identity: localIdentity('password') },
    ],
    ['an OIDC session', { kind: 'session', username: 'scott', identity: { type: 'oidc' } }],
    ['a session from before two-factor support', { kind: 'session', username: 'scott' }],
    [
      'an API key',
      { kind: 'api-key', username: 'ci', keyId: 'k1', scopes: ['admin'], parentKeyId: null },
    ],
    ['anonymous access', { kind: 'anonymous', username: 'anonymous' }],
    ['nobody', undefined],
  ])('lets %s through and sends nothing', (_name, principal) => {
    const res = createMockResponse();

    expect(refuseRecoveryAssuranceSession({ principal }, res, 'register agent keys')).toBe(false);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
