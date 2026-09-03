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
      DD_WATCHER_REMOTE_URL: '[REDACTED]',
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

  test('redacts pass field (SMTP-style credential) as a sensitive key', () => {
    const source = {
      smtp: {
        pass: 'smtp-password',
        user: 'operator@example.com',
        host: 'smtp.example.com',
      },
      nested: {
        passPhrase: 'secret-phrase',
      },
    };

    const redacted = redactDebugDump(source);

    // 'pass' is a sensitive token — direct field is masked
    expect((redacted.smtp as Record<string, unknown>).pass).toBe('[REDACTED]');
    // user and host are not credential secrets — left visible
    expect((redacted.smtp as Record<string, unknown>).user).toBe('operator@example.com');
    expect((redacted.smtp as Record<string, unknown>).host).toBe('smtp.example.com');
    // camelCase key containing 'pass' sub-token (passPhrase → ['pass','phrase']) is also caught
    expect((redacted.nested as Record<string, unknown>).passPhrase).toBe('[REDACTED]');
  });

  test('redacts DD_NOTIFICATION_SMTP_NAME_PASS env var (pass token in env-style key)', () => {
    const source = {
      DD_NOTIFICATION_SMTP_ALERTS_PASS: 'smtp-secret',
      DD_NOTIFICATION_SMTP_ALERTS_USER: 'alerts@example.com',
      DD_NOTIFICATION_SMTP_ALERTS_HOST: 'smtp.example.com',
      DD_DEBUG: 'true',
    };

    const redacted = redactDebugDump(source);

    expect(redacted).toEqual({
      DD_NOTIFICATION_SMTP_ALERTS_PASS: '[REDACTED]',
      // user and host are not credential secrets — left visible
      DD_NOTIFICATION_SMTP_ALERTS_USER: 'alerts@example.com',
      DD_NOTIFICATION_SMTP_ALERTS_HOST: 'smtp.example.com',
      DD_DEBUG: 'true',
    });
  });

  test('redacts webhook URL env vars (url token in env-style key)', () => {
    const source = {
      DD_NOTIFICATION_DISCORD_MYBOT_URL: 'https://discord.com/api/webhooks/T000/B000/XXXXSECRET',
      DD_NOTIFICATION_HTTP_ALERTS_URL: 'https://hooks.example.com/services/TOKEN',
      DD_NOTIFICATION_GOOGLECHAT_BOT_URL: 'https://chat.googleapis.com/v1/spaces/TOKEN',
      DD_WATCHER_REMOTE_URL: 'https://docker.internal:2376',
      DD_DEBUG: 'true',
    };

    const redacted = redactDebugDump(source);

    expect(redacted).toEqual({
      DD_NOTIFICATION_DISCORD_MYBOT_URL: '[REDACTED]',
      DD_NOTIFICATION_HTTP_ALERTS_URL: '[REDACTED]',
      DD_NOTIFICATION_GOOGLECHAT_BOT_URL: '[REDACTED]',
      // watcher remote URL is also redacted — URL env vars can embed secrets
      DD_WATCHER_REMOTE_URL: '[REDACTED]',
      DD_DEBUG: 'true',
    });
  });

  test('camelCase url field is not redacted (url is env-only sensitive token)', () => {
    // url as a camelCase object key is not an env-style key so it should pass through.
    // Trigger configuration url fields are separately handled by
    // redactTriggerConfigurationInfrastructureDetails in the trigger pipeline.
    const source = {
      configuration: {
        url: 'https://public.endpoint.example.com',
        topic: 'dd/container',
      },
    };

    const redacted = redactDebugDump(source);

    expect((redacted.configuration as Record<string, unknown>).url).toBe(
      'https://public.endpoint.example.com',
    );
    expect((redacted.configuration as Record<string, unknown>).topic).toBe('dd/container');
  });

  test('DD_PUBLIC_URL is redacted — intentional safe-default over-redaction', () => {
    // Adding 'url' to ENV_SENSITIVE_KEY_TOKENS means any env-style key whose last
    // segment is URL is masked, including legitimately public values like DD_PUBLIC_URL.
    // This is a deliberate safe default: the debug dump is auth-gated admin diagnostics
    // where URLs can embed secrets (webhook tokens, API keys in query strings).
    // If a future maintainer sees this and wonders whether it's a bug — it's not.
    // The trade-off is documented here so it doesn't get "fixed" accidentally.
    const source = {
      DD_PUBLIC_URL: 'https://drydock.example.com',
      DD_SERVER_PORT: '3000',
    };

    const redacted = redactDebugDump(source);

    expect(redacted).toEqual({
      DD_PUBLIC_URL: '[REDACTED]',
      DD_SERVER_PORT: '3000',
    });
  });

  test('redacts plural tokens keys (DD_SERVER_WEBHOOK_TOKENS_* and camelCase webhookTokens)', () => {
    const source = {
      DD_SERVER_WEBHOOK_TOKENS_WATCHALL: 'super-secret-webhook-token',
      DD_SERVER_WEBHOOK_TOKENS_OTHER: 'another-secret',
      webhookTokens: 'camel-tokens-value',
      DD_SERVER_PORT: '3000',
      token: 'singular-still-redacted',
    };

    const redacted = redactDebugDump(source);

    expect(redacted).toEqual({
      DD_SERVER_WEBHOOK_TOKENS_WATCHALL: REDACTED_VALUE,
      DD_SERVER_WEBHOOK_TOKENS_OTHER: REDACTED_VALUE,
      webhookTokens: REDACTED_VALUE,
      DD_SERVER_PORT: '3000',
      token: REDACTED_VALUE,
    });
  });

  test('env var pair objects keep the name visible when the name is not sensitive', () => {
    const source = { key: 'DEBIAN_FRONTEND', value: 'noninteractive' };

    const redacted = redactDebugDump(source);

    expect(redacted).toEqual({ key: 'DEBIAN_FRONTEND', value: 'noninteractive' });
  });

  test('env var pair objects redact the value (not the name) when the name is sensitive', () => {
    const source = { key: 'HF_TOKEN', value: 'xyz' };

    const redacted = redactDebugDump(source);

    expect(redacted).toEqual({ key: 'HF_TOKEN', value: '[REDACTED]' });
  });

  test('env var pair objects preserve an empty sensitive value per redactMatchedValue contract', () => {
    const source = { key: 'MY_PASSWORD', value: '' };

    const redacted = redactDebugDump(source);

    expect(redacted).toEqual({ key: 'MY_PASSWORD', value: '' });
  });

  test('env var pair objects nested inside an array are redacted by name, matching the real dump shape', () => {
    const source = {
      env: [
        { key: 'DEBIAN_FRONTEND', value: 'noninteractive' },
        { key: 'HF_TOKEN', value: 'xyz' },
      ],
    };

    const redacted = redactDebugDump(source);

    expect(redacted).toEqual({
      env: [
        { key: 'DEBIAN_FRONTEND', value: 'noninteractive' },
        { key: 'HF_TOKEN', value: '[REDACTED]' },
      ],
    });
  });

  test('a non-pair object with a key property still redacts that property as before', () => {
    const source = { key: 'some-api-key-value', other: 'kept' };

    const redacted = redactDebugDump(source);

    expect(redacted).toEqual({ key: '[REDACTED]', other: 'kept' });
  });

  test('pair objects with extra properties keep name/value pair handling and walk extras generically', () => {
    const source = {
      key: 'HF_TOKEN',
      value: 'xyz',
      extra: { token: 'nested-secret' },
      note: 'kept',
    };

    const redacted = redactDebugDump(source);

    expect(redacted).toEqual({
      key: 'HF_TOKEN',
      value: '[REDACTED]',
      extra: { token: '[REDACTED]' },
      note: 'kept',
    });
  });

  test('redacts provider-specific notification credentials without hiding ordinary URL flags', () => {
    const redacted = redactDebugDump({
      DD_NOTIFICATION_APPRISE_LOCAL_URLS: 'slack://CredentialA/CredentialB/CredentialC',
      DD_NOTIFICATION_APPRISE_ALERTS_URLS: 'sns://AKIA/secret/topic',
      DD_NOTIFICATION_APPRISE_LOCAL_URL: 'https://apprise.example.com',
      DD_NOTIFICATION_ROCKETCHAT_MAIN_USER_ID: 'rocket-user-id',
      DD_NOTIFICATION_TELEGRAM_ALERTS_CHATID: 'telegram-chat-id',
      env: [
        {
          key: 'DD_NOTIFICATION_APPRISE_LOCAL_URLS',
          value: 'slack://PairCredentialA/PairCredentialB/PairCredentialC',
        },
        { key: 'DD_NOTIFICATION_ROCKETCHAT_MAIN_USER_ID', value: 'pair-rocket-user-id' },
        { key: 'DD_NOTIFICATION_TELEGRAM_ALERTS_CHATID', value: 'pair-telegram-chat-id' },
        { key: 'DD_NOTIFICATION_ROCKETCHAT_MAIN_PARSE_URLS', value: 'true' },
      ],
      parse: { urls: true },
    }) as Record<string, unknown>;

    expect(redacted).toEqual({
      DD_NOTIFICATION_APPRISE_LOCAL_URLS: REDACTED_VALUE,
      DD_NOTIFICATION_APPRISE_ALERTS_URLS: REDACTED_VALUE,
      DD_NOTIFICATION_APPRISE_LOCAL_URL: REDACTED_VALUE,
      DD_NOTIFICATION_ROCKETCHAT_MAIN_USER_ID: REDACTED_VALUE,
      DD_NOTIFICATION_TELEGRAM_ALERTS_CHATID: REDACTED_VALUE,
      env: [
        { key: 'DD_NOTIFICATION_APPRISE_LOCAL_URLS', value: REDACTED_VALUE },
        { key: 'DD_NOTIFICATION_ROCKETCHAT_MAIN_USER_ID', value: REDACTED_VALUE },
        { key: 'DD_NOTIFICATION_TELEGRAM_ALERTS_CHATID', value: REDACTED_VALUE },
        { key: 'DD_NOTIFICATION_ROCKETCHAT_MAIN_PARSE_URLS', value: 'true' },
      ],
      parse: { urls: true },
    });
  });

  test('redacts the same provider-specific fields under the legacy DD_TRIGGER_ prefix', () => {
    const redacted = redactDebugDump({
      DD_TRIGGER_APPRISE_LOCAL_URLS: 'slack://CredentialA/CredentialB/CredentialC',
      DD_TRIGGER_ROCKETCHAT_MAIN_USER_ID: 'rocket-user-id',
      DD_TRIGGER_TELEGRAM_ALERTS_CHATID: 'telegram-chat-id',
      DD_TRIGGER_ROCKETCHAT_MAIN_PARSE_URLS: 'true',
    }) as Record<string, unknown>;

    expect(redacted).toEqual({
      DD_TRIGGER_APPRISE_LOCAL_URLS: REDACTED_VALUE,
      DD_TRIGGER_ROCKETCHAT_MAIN_USER_ID: REDACTED_VALUE,
      DD_TRIGGER_TELEGRAM_ALERTS_CHATID: REDACTED_VALUE,
      DD_TRIGGER_ROCKETCHAT_MAIN_PARSE_URLS: 'true',
    });
  });

  test("keeps a Pushover user key redacted without hiding other providers' user fields", () => {
    const redacted = redactDebugDump({
      DD_NOTIFICATION_PUSHOVER_P_USER: 'uQiRzpo4DXghDmr9QzzfQu27cmVRsG',
      DD_NOTIFICATION_PUSHOVER_P_DEVICE: 'phone',
      DD_NOTIFICATION_SMTP_ALERTS_USER: 'alerts@example.com',
    }) as Record<string, unknown>;

    expect(redacted).toEqual({
      DD_NOTIFICATION_PUSHOVER_P_USER: REDACTED_VALUE,
      DD_NOTIFICATION_PUSHOVER_P_DEVICE: 'phone',
      DD_NOTIFICATION_SMTP_ALERTS_USER: 'alerts@example.com',
    });
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
