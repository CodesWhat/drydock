import { REDACTED_VALUE, redactDebugDump } from './redact.js';

describe('debug/redact', () => {
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
        token: REDACTED_VALUE,
        secret: REDACTED_VALUE,
      },
      watcher: {
        auth: {
          password: REDACTED_VALUE,
        },
        nested: [
          {
            api_key: REDACTED_VALUE,
          },
        ],
      },
      env: {
        DD_SERVER_PORT: '3000',
        DD_AUTH_BASIC_ADMIN_HASH: REDACTED_VALUE,
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
    expect(redacted.password).toBe(REDACTED_VALUE);
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
