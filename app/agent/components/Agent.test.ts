import { describe, expect, test } from 'vitest';
import Agent from './Agent.js';

vi.mock('../../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

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
});
