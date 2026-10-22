import { createHmac } from 'node:crypto';
import {
  authenticateRegistryWebhook,
  type RegistryWebhookAuthInput,
  redactRegistryWebhookPath,
  staticSecretsMatch,
} from './registry-auth.js';

const STATIC_SECRET = 'static-secret-0123456789';
const HMAC_SECRET = 'hmac-secret';

function buildInput(overrides: Partial<RegistryWebhookAuthInput> = {}): RegistryWebhookAuthInput {
  return {
    modes: ['hmac'],
    staticSecret: STATIC_SECRET,
    hmacSecret: HMAC_SECRET,
    payload: '{"a":1}',
    signature: undefined,
    pathSecret: undefined,
    querySecret: undefined,
    authorizationHeader: undefined,
    ...overrides,
  };
}

describe('api/webhooks/registry-auth', () => {
  describe('staticSecretsMatch', () => {
    test('matches equal secrets', () => {
      expect(staticSecretsMatch(STATIC_SECRET, STATIC_SECRET)).toBe(true);
    });

    test('rejects different secrets of any length', () => {
      expect(staticSecretsMatch('short', STATIC_SECRET)).toBe(false);
      expect(staticSecretsMatch(`${STATIC_SECRET}x`, STATIC_SECRET)).toBe(false);
    });

    test('never matches when nothing is configured', () => {
      expect(staticSecretsMatch('', '')).toBe(false);
    });
  });

  describe('authenticateRegistryWebhook', () => {
    test('accepts the path secret when path mode is allowed', () => {
      expect(
        authenticateRegistryWebhook(buildInput({ modes: ['path'], pathSecret: STATIC_SECRET })),
      ).toEqual({ status: 'ok', mode: 'path' });
    });

    test('accepts the query secret when query mode is allowed', () => {
      expect(
        authenticateRegistryWebhook(buildInput({ modes: ['query'], querySecret: STATIC_SECRET })),
      ).toEqual({ status: 'ok', mode: 'query' });
    });

    test('accepts a Bearer secret when bearer mode is allowed', () => {
      expect(
        authenticateRegistryWebhook(
          buildInput({ modes: ['bearer'], authorizationHeader: `Bearer ${STATIC_SECRET}` }),
        ),
      ).toEqual({ status: 'ok', mode: 'bearer' });
    });

    test('accepts a valid HMAC signature when hmac mode is allowed', () => {
      const signature = createHmac('sha256', HMAC_SECRET).update('{"a":1}').digest('hex');
      expect(authenticateRegistryWebhook(buildInput({ signature }))).toEqual({
        status: 'ok',
        mode: 'hmac',
      });
    });

    test('rejects a wrong secret as invalid', () => {
      expect(
        authenticateRegistryWebhook(buildInput({ modes: ['path'], pathSecret: 'nope' })),
      ).toEqual({ status: 'invalid' });
    });

    test('rejects a bad signature as invalid', () => {
      expect(authenticateRegistryWebhook(buildInput({ signature: 'sha256=deadbeef' }))).toEqual({
        status: 'invalid',
      });
    });

    test('reports missing when no credential is presented', () => {
      expect(
        authenticateRegistryWebhook(buildInput({ modes: ['hmac', 'path', 'query', 'bearer'] })),
      ).toEqual({ status: 'missing' });
    });

    test('ignores credentials for modes that are not allowed', () => {
      expect(
        authenticateRegistryWebhook(
          buildInput({
            modes: ['hmac'],
            pathSecret: STATIC_SECRET,
            querySecret: STATIC_SECRET,
            authorizationHeader: `Bearer ${STATIC_SECRET}`,
          }),
        ),
      ).toEqual({ status: 'missing' });
    });

    test('ignores a non-string query secret and a non-Bearer authorization header', () => {
      expect(
        authenticateRegistryWebhook(
          buildInput({
            modes: ['query', 'bearer'],
            querySecret: [STATIC_SECRET, STATIC_SECRET],
            authorizationHeader: `Basic ${STATIC_SECRET}`,
          }),
        ),
      ).toEqual({ status: 'missing' });
    });

    test('treats an empty Bearer value as not presented', () => {
      expect(
        authenticateRegistryWebhook(
          buildInput({ modes: ['bearer'], authorizationHeader: 'Bearer ' }),
        ),
      ).toEqual({ status: 'missing' });
    });

    test('never accepts a static credential when no static secret is configured', () => {
      expect(
        authenticateRegistryWebhook(
          buildInput({ modes: ['bearer'], staticSecret: '', authorizationHeader: 'Bearer x' }),
        ),
      ).toEqual({ status: 'invalid' });
    });

    test('a valid credential wins even when another presented credential is wrong', () => {
      expect(
        authenticateRegistryWebhook(
          buildInput({
            modes: ['path', 'bearer'],
            pathSecret: 'wrong',
            authorizationHeader: `Bearer ${STATIC_SECRET}`,
          }),
        ),
      ).toEqual({ status: 'ok', mode: 'bearer' });
    });
  });

  describe('redactRegistryWebhookPath', () => {
    test('masks the secret path segment and drops the query string', () => {
      expect(
        redactRegistryWebhookPath('/api/v1/webhooks/registry/dockerhub/s3cret?secret=s3cret'),
      ).toBe('/api/v1/webhooks/registry/dockerhub/***');
    });

    test('leaves provider-only and bare paths alone but still drops the query', () => {
      expect(redactRegistryWebhookPath('/api/v1/webhooks/registry/harbor?secret=abc')).toBe(
        '/api/v1/webhooks/registry/harbor',
      );
      expect(redactRegistryWebhookPath('/api/v1/webhooks/registry')).toBe(
        '/api/v1/webhooks/registry',
      );
    });

    test('handles an undefined url', () => {
      expect(redactRegistryWebhookPath(undefined)).toBe('');
    });
  });
});
