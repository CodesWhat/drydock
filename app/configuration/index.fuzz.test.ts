// @ts-nocheck
import { fc, test as fcTest } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';
import { get } from './index.js';

describe('configuration/index fuzz tests', () => {
  it('returns empty object when no env var matches the prefix', () => {
    const result = get('dd.trigger', {
      DD_WATCHER_MAIN_NAME: 'main',
    });
    expect(result).toStrictEqual({});
  });

  it('maps matching env vars to nested object paths', () => {
    const result = get('dd.watcher', {
      DD_WATCHER_MAIN_NAME: 'main',
      DD_WATCHER_MAIN_INTERVAL: '60',
      DD_TRIGGER_HOOK_ENABLED: 'true',
    });
    expect(result).toStrictEqual({
      main: {
        name: 'main',
        interval: '60',
      },
    });
  });

  it('maps deeper nested paths for server configuration', () => {
    const result = get('dd.server', {
      DD_SERVER_TLS_ENABLED: 'true',
      DD_SERVER_TLS_CERT: '/etc/cert.pem',
      DD_SERVER_TLS_KEY: '/etc/key.pem',
      DD_TRIGGER_HOOK_ENABLED: 'true',
    });

    expect(result).toStrictEqual({
      tls: {
        enabled: 'true',
        cert: '/etc/cert.pem',
        key: '/etc/key.pem',
      },
    });
  });

  fcTest.prop([fc.string({ minLength: 1, maxLength: 50 })])(
    'get never throws on arbitrary property paths with empty env',
    (prop) => {
      const result = get(prop, {});
      expect(typeof result).toBe('object');
    },
  );

  fcTest.prop([
    fc.string({ minLength: 1, maxLength: 30 }),
    fc.dictionary(fc.string({ minLength: 1, maxLength: 40 }), fc.string({ maxLength: 100 }), {
      minKeys: 0,
      maxKeys: 10,
    }),
  ])('get never throws on arbitrary property paths and env objects', (prop, env) => {
    const result = get(prop, env);
    expect(typeof result).toBe('object');
  });

  fcTest.prop([
    fc.constantFrom('dd.watcher', 'dd.trigger', 'dd.registry', 'dd.auth', 'dd.agent'),
    fc.dictionary(fc.stringMatching(/^DD_[A-Z_]{1,30}$/), fc.string({ maxLength: 100 }), {
      minKeys: 0,
      maxKeys: 5,
    }),
  ])('get with realistic DD_ env vars never throws', (prop, env) => {
    const result = get(prop, env);
    expect(typeof result).toBe('object');
  });

  fcTest.prop([
    fc.string({ minLength: 1, maxLength: 20 }),
    fc.dictionary(
      fc.string({ minLength: 1, maxLength: 50 }),
      fc.oneof(
        fc.string({ maxLength: 100 }),
        fc.constant(''),
        fc.constant('true'),
        fc.constant('false'),
        fc.integer().map(String),
      ),
      { minKeys: 0, maxKeys: 10 },
    ),
  ])('get handles unusual env var values without crashing', (prop, env) => {
    const result = get(prop, env);
    expect(typeof result).toBe('object');
  });
});
