import { REDACTED_VALUE, redactDebugDump } from './redact.js';

describe('debug/redact', () => {
  test('exports the canonical redaction marker', () => {
    expect(REDACTED_VALUE).toBe('[REDACTED]');
  });

  test('redacts values for sensitive keys recursively', () => {
    const source = {
      metadata: {
        token: 'abc123',
        secret: 'shh',
      },
      watcher: {
        auth: {
          password: 'p@ss',
        },
        nested: [
          {
            api_key: 'k',
          },
        ],
      },
      env: {
        DD_SERVER_PORT: '3000',
        DD_AUTH_BASIC_ADMIN_HASH: 'hash-value',
      },
    };

    const redacted = redactDebugDump(source);

    expect(redacted).toEqual({
      metadata: {
        token: '[REDACTED]',
        secret: '[REDACTED]',
      },
      watcher: {
        auth: {
          password: '[REDACTED]',
        },
        nested: [
          {
            api_key: '[REDACTED]',
          },
        ],
      },
      env: {
        DD_SERVER_PORT: '3000',
        DD_AUTH_BASIC_ADMIN_HASH: '[REDACTED]',
      },
    });
  });

  test('does not mutate the input payload', () => {
    const source = {
      password: 'top-secret',
      nested: {
        value: 'kept',
      },
    };

    const cloneBefore = structuredClone(source);
    const redacted = redactDebugDump(source);

    expect(source).toEqual(cloneBefore);
    expect(redacted).not.toBe(source);
    expect(redacted.password).toBe('[REDACTED]');
  });

  test('redacts env auth/login/bearer keys without wiping non-env auth fields', () => {
    const source = {
      environment: {
        ddEnvVars: {
          DD_REGISTRY_HUB_PUBLIC_AUTH: 'am9objpzZWNyZXQ=',
          DD_REGISTRY_HUB_PUBLIC_LOGIN: 'john',
          DD_WATCHER_REMOTE_AUTH_BEARER: 'bearer-token',
          DD_ANONYMOUS_AUTH_CONFIRM: 'true',
          AUTH_ERROR: 'upper-case env auth key',
          Auth_Error: 'mixed-case auth key',
          DD_WATCHER_REMOTE_URL: 'https://docker.example.com',
        },
      },
      state: {
        authentications: [{ id: 'auth.main', kind: 'authentication' }],
      },
      dockerApi: {
        authInitializationError: 'beta auth failed',
      },
    };

    const redacted = redactDebugDump(source);

    expect(redacted.environment.ddEnvVars).toEqual({
      DD_REGISTRY_HUB_PUBLIC_AUTH: '[REDACTED]',
      DD_REGISTRY_HUB_PUBLIC_LOGIN: '[REDACTED]',
      DD_WATCHER_REMOTE_AUTH_BEARER: '[REDACTED]',
      DD_ANONYMOUS_AUTH_CONFIRM: '[REDACTED]',
      AUTH_ERROR: '[REDACTED]',
      Auth_Error: 'mixed-case auth key',
      DD_WATCHER_REMOTE_URL: 'https://docker.example.com',
    });
    expect(redacted.state.authentications).toEqual([{ id: 'auth.main', kind: 'authentication' }]);
    expect(redacted.dockerApi.authInitializationError).toBe('beta auth failed');
  });

  test('redacts camelCase sensitive keys and leaves non-plain objects untouched', () => {
    const createdAt = new Date('2026-03-18T11:30:00.000Z');
    const source = {
      passwordResetUrl: 'https://example.invalid/reset',
      credentialCount: 3,
      privateKeyUrl: 'ssh://example.invalid/id_ed25519',
      apiKey: 'k-123',
      createdAt,
    };

    const redacted = redactDebugDump(source);

    expect(redacted).toEqual({
      passwordResetUrl: '[REDACTED]',
      credentialCount: '[REDACTED]',
      privateKeyUrl: '[REDACTED]',
      apiKey: '[REDACTED]',
      createdAt: new Date('2026-03-18T11:30:00.000Z'),
    });
  });

  test('redacts exact sensitive key aliases without redacting uppercase non-env keys', () => {
    const source = {
      passwd: 'legacy-pass',
      credentials: 'john:secret',
      hash: 'sha256:abc123',
      apikey: 'api-token',
      accesskey: 'access-token',
      privatekey: '-----BEGIN PRIVATE KEY-----',
      LOGIN: 'operator',
    };

    const redacted = redactDebugDump(source);

    expect(redacted).toEqual({
      passwd: '[REDACTED]',
      credentials: '[REDACTED]',
      hash: '[REDACTED]',
      apikey: '[REDACTED]',
      accesskey: '[REDACTED]',
      privatekey: '[REDACTED]',
      LOGIN: 'operator',
    });
  });

  test('redacts env-style auth aliases only when the key uses uppercase underscore segments', () => {
    const source = {
      DD_AUTH: 'basic john:secret',
      DD_BEARER: 'bearer token',
      DD_LOGIN: 'operator',
      AUTH: 'public label',
      BEARER: 'public label',
      LOGIN: 'public label',
    };

    const redacted = redactDebugDump(source);

    expect(redacted).toEqual({
      DD_AUTH: '[REDACTED]',
      DD_BEARER: '[REDACTED]',
      DD_LOGIN: '[REDACTED]',
      AUTH: 'public label',
      BEARER: 'public label',
      LOGIN: 'public label',
    });
  });

  test('passes through nullish root payloads without throwing', () => {
    expect(redactDebugDump(null)).toBeNull();
    expect(redactDebugDump(undefined)).toBeUndefined();
  });

  test('treats null-prototype objects as plain objects during redaction', () => {
    const source = Object.create(null) as Record<string, unknown>;
    source.token = 'abc123';
    source.value = 'kept';

    const redacted = redactDebugDump(source);

    expect(redacted).toEqual({
      token: '[REDACTED]',
      value: 'kept',
    });
    expect(Object.getPrototypeOf(redacted as object)).toBe(Object.prototype);
  });

  test('preserves values under keys with no alphanumeric characters', () => {
    const source = { '---': 'keep-me', ___: 42 };

    const redacted = redactDebugDump(source);

    expect(redacted).toEqual({ '---': 'keep-me', ___: 42 });
  });

  test('keeps empty and null sensitive values unchanged', () => {
    const source = {
      secret: '',
      token: null,
      nested: {
        hash: undefined,
      },
    };

    const redacted = redactDebugDump(source);

    expect(redacted).toEqual({
      secret: '',
      token: null,
      nested: {
        hash: undefined,
      },
    });
  });
});
