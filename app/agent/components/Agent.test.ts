import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { get } from '../../configuration/index.js';
import Agent from './Agent.js';

vi.mock('../../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

/**
 * Generates a real PEM-encoded PKCS#8 Ed25519 private key for tests, matching
 * the format `signingkey` actually holds at runtime (Portwing's keygen output).
 */
function generateEd25519PrivateKeyPem(): string {
  const { privateKey } = generateKeyPairSync('ed25519');
  return privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
}

describe('Agent component', () => {
  test('getConfigurationSchema should validate valid config', () => {
    const agent = new Agent();
    const schema = agent.getConfigurationSchema();
    const result = schema.validate({
      host: 'localhost',
      port: 3001,
      secret: 'my-secret',
    });
    expect(result.error).toBeUndefined();
    expect(result.value.host).toBe('localhost');
    expect(result.value.port).toBe(3001);
    expect(result.value.secret).toBe('my-secret');
  });

  test('getConfigurationSchema should default port to 3000', () => {
    const agent = new Agent();
    const schema = agent.getConfigurationSchema();
    const result = schema.validate({
      host: 'localhost',
      secret: 'my-secret',
    });
    expect(result.error).toBeUndefined();
    expect(result.value.port).toBe(3000);
  });

  test('getConfigurationSchema should reject missing host', () => {
    const agent = new Agent();
    const schema = agent.getConfigurationSchema();
    const result = schema.validate({ secret: 'my-secret' });
    expect(result.error).toBeDefined();
  });

  test('getConfigurationSchema should reject missing secret', () => {
    const agent = new Agent();
    const schema = agent.getConfigurationSchema();
    const result = schema.validate({ host: 'localhost' });
    expect(result.error).toBeDefined();
  });

  test('getConfigurationSchema should accept optional tls fields', () => {
    const agent = new Agent();
    const schema = agent.getConfigurationSchema();
    const result = schema.validate({
      host: 'localhost',
      secret: 'my-secret',
      cafile: '/path/to/ca.pem',
      certfile: '/path/to/cert.pem',
      keyfile: '/path/to/key.pem',
    });
    expect(result.error).toBeUndefined();
    expect(result.value.cafile).toBe('/path/to/ca.pem');
  });

  test('maskConfiguration should mask the secret field', () => {
    const agent = new Agent();
    agent.configuration = {
      host: 'localhost',
      port: 3000,
      secret: 'supersecret',
    };
    const masked = agent.maskConfiguration();
    expect(masked.host).toBe('localhost');
    expect(masked.port).toBe(3000);
    expect(masked.secret).not.toBe('supersecret');
    expect(masked.secret).toBe('[REDACTED]');
  });

  test('maskConfiguration should accept explicit configuration', () => {
    const agent = new Agent();
    const config = {
      host: 'myhost',
      port: 3000,
      secret: 'abc123',
    };
    const masked = agent.maskConfiguration(config);
    expect(masked.host).toBe('myhost');
    expect(masked.secret).not.toBe('abc123');
    expect(masked.secret).toBe('[REDACTED]');
  });

  test('maskConfiguration should handle non-string secret values', () => {
    const agent = new Agent();
    const masked = agent.maskConfiguration({
      host: 'myhost',
      port: 3000,
      secret: 123 as unknown as string,
    });

    expect(masked.host).toBe('myhost');
    expect(masked.secret).toBeUndefined();
  });

  describe('authmode defaulting (token behavior unchanged)', () => {
    test('authmode defaults to token when omitted', () => {
      const agent = new Agent();
      const schema = agent.getConfigurationSchema();
      const result = schema.validate({ host: 'localhost', secret: 'my-secret' });
      expect(result.error).toBeUndefined();
      expect(result.value.authmode).toBe('token');
    });

    test('secret remains required by default (authmode omitted)', () => {
      const agent = new Agent();
      const schema = agent.getConfigurationSchema();
      const result = schema.validate({ host: 'localhost' });
      expect(result.error).toBeDefined();
    });

    test('signingkeyid/signingkey are not required by default (authmode omitted)', () => {
      const agent = new Agent();
      const schema = agent.getConfigurationSchema();
      const result = schema.validate({ host: 'localhost', secret: 'my-secret' });
      expect(result.error).toBeUndefined();
    });

    test('explicit authmode: token behaves identically to omitted authmode', () => {
      const agent = new Agent();
      const schema = agent.getConfigurationSchema();
      const result = schema.validate({ host: 'localhost', authmode: 'token', secret: 'my-secret' });
      expect(result.error).toBeUndefined();
      expect(result.value.authmode).toBe('token');
    });
  });

  describe('authmode: ed25519', () => {
    test('accepts a valid ed25519 config without a secret', () => {
      const agent = new Agent();
      const schema = agent.getConfigurationSchema();
      const result = schema.validate({
        host: 'localhost',
        authmode: 'ed25519',
        signingkeyid: 'deadbeefcafef00d',
        signingkey: '-----BEGIN PRIVATE KEY-----\nMC4CAQ...\n-----END PRIVATE KEY-----\n',
      });
      expect(result.error).toBeUndefined();
      expect(result.value.authmode).toBe('ed25519');
      expect(result.value.secret).toBeUndefined();
    });

    test('rejects ed25519 config missing signingkeyid', () => {
      const agent = new Agent();
      const schema = agent.getConfigurationSchema();
      const result = schema.validate({
        host: 'localhost',
        authmode: 'ed25519',
        signingkey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n',
      });
      expect(result.error).toBeDefined();
    });

    test('rejects ed25519 config missing signingkey', () => {
      const agent = new Agent();
      const schema = agent.getConfigurationSchema();
      const result = schema.validate({
        host: 'localhost',
        authmode: 'ed25519',
        signingkeyid: 'deadbeefcafef00d',
      });
      expect(result.error).toBeDefined();
    });

    test('rejects an unknown authmode value', () => {
      const agent = new Agent();
      const schema = agent.getConfigurationSchema();
      const result = schema.validate({
        host: 'localhost',
        authmode: 'bogus',
        secret: 'my-secret',
      });
      expect(result.error).toBeDefined();
    });

    test('maskConfiguration masks signingkey when present', () => {
      const agent = new Agent();
      const masked = agent.maskConfiguration({
        host: 'localhost',
        port: 3000,
        secret: '',
        authmode: 'ed25519',
        signingkeyid: 'deadbeefcafef00d',
        signingkey:
          '-----BEGIN PRIVATE KEY-----\nSUPERSECRETKEYMATERIAL\n-----END PRIVATE KEY-----\n',
      });
      expect(masked.signingkey).toBe('[REDACTED]');
      expect(masked.signingkeyid).toBe('deadbeefcafef00d');
    });

    test('maskConfiguration leaves signingkey undefined when not configured', () => {
      const agent = new Agent();
      const masked = agent.maskConfiguration({
        host: 'localhost',
        port: 3000,
        secret: 'supersecret',
      });
      expect(masked.signingkey).toBeUndefined();
    });
  });
});

describe('env → config → schema (regression: DD_AGENT_<NAME>_* must reach the schema as lowercase keys)', () => {
  // Config keys parsed from env vars are always lowercased by configuration/index.ts's
  // get() (it lowercases the whole path, regardless of underscore placement). Before the
  // fix, Agent.ts's schema/interface used camelCase keys (authMode/signingKeyId/signingKey),
  // which never matched what get() actually produces, so DD_AGENT_<NAME>_AUTHMODE=ed25519
  // silently fell back to authmode='token' instead of failing loudly or working. This suite
  // exercises the real env → get() → schema path end to end so that class of bug can't
  // reappear silently.
  const ENV_PREFIX = 'DD_AGENT_EDGE_';

  function buildEdgeEnv(omitKeys: string[] = []) {
    const signingKeyPem = generateEd25519PrivateKeyPem();
    const env: Record<string, string | undefined> = {
      [`${ENV_PREFIX}HOST`]: 'https://a:3000',
      [`${ENV_PREFIX}AUTHMODE`]: 'ed25519',
      [`${ENV_PREFIX}SIGNINGKEYID`]: 'deadbeefdeadbeef',
      [`${ENV_PREFIX}SIGNINGKEY`]: signingKeyPem,
    };
    for (const key of omitKeys) {
      delete env[key];
    }
    return { env, signingKeyPem };
  }

  test('DD_AGENT_<NAME>_AUTHMODE/SIGNINGKEYID/SIGNINGKEY parse into lowercase config keys', () => {
    const { env, signingKeyPem } = buildEdgeEnv();
    const parsed = get('dd.agent', env);
    const edgeConfig = parsed.edge as Record<string, unknown>;

    expect(edgeConfig.authmode).toBe('ed25519');
    expect(edgeConfig.signingkeyid).toBe('deadbeefdeadbeef');
    expect(edgeConfig.signingkey).toBe(signingKeyPem);
    // This is the exact thing that was broken: the old camelCase names must
    // never appear on the parsed config, because get() cannot produce them.
    expect(edgeConfig).not.toHaveProperty('authMode');
    expect(edgeConfig).not.toHaveProperty('signingKeyId');
    expect(edgeConfig).not.toHaveProperty('signingKey');
  });

  test('the parsed edge config validates through the real Agent schema with ed25519 populated', () => {
    const { env, signingKeyPem } = buildEdgeEnv();
    const parsed = get('dd.agent', env);

    const agent = new Agent();
    const result = agent.getConfigurationSchema().validate(parsed.edge);

    expect(result.error).toBeUndefined();
    expect(result.value.authmode).toBe('ed25519');
    expect(result.value.signingkeyid).toBe('deadbeefdeadbeef');
    expect(result.value.signingkey).toBe(signingKeyPem);
  });

  test('the same env without DD_AGENT_EDGE_SIGNINGKEYID fails schema validation', () => {
    const { env } = buildEdgeEnv([`${ENV_PREFIX}SIGNINGKEYID`]);
    const parsed = get('dd.agent', env);

    const agent = new Agent();
    const result = agent.getConfigurationSchema().validate(parsed.edge);

    expect(result.error).toBeDefined();
  });

  test('maskConfiguration masks the env-parsed, schema-validated signingkey', () => {
    const { env, signingKeyPem } = buildEdgeEnv();
    const parsed = get('dd.agent', env);

    const agent = new Agent();
    const { value: validatedConfig } = agent.getConfigurationSchema().validate(parsed.edge);
    const masked = agent.maskConfiguration(validatedConfig);

    expect(masked.signingkey).toBe('[REDACTED]');
    expect(masked.signingkey).not.toBe(signingKeyPem);
  });
});
