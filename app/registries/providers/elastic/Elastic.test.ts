import Elastic from './Elastic.js';

const TEST_AUTH = 'dXNlcjpwYXNz';

function createRegistry(configuration: Record<string, unknown> = {}) {
  const registry = new Elastic();
  registry.configuration = configuration as any;
  return registry;
}

describe('Elastic registry', () => {
  test('validates anonymous configuration', () => {
    const registry = createRegistry();
    expect(registry.validateConfiguration('')).toStrictEqual({});
    expect(registry.validateConfiguration(undefined)).toStrictEqual({});
  });

  test('validates login/password and auth configuration', () => {
    const registry = createRegistry();
    expect(registry.validateConfiguration({ login: 'user', password: 'pass' })).toStrictEqual({
      login: 'user',
      password: 'pass',
    });
    expect(registry.validateConfiguration({ auth: TEST_AUTH })).toStrictEqual({ auth: TEST_AUTH });
  });

  test('rejects ambiguous configuration', () => {
    const registry = createRegistry();
    expect(() =>
      registry.validateConfiguration({ login: 'user', password: 'pass', auth: TEST_AUTH }),
    ).toThrow();
    expect(() => registry.validateConfiguration({ login: 'user' })).toThrow();
  });

  test('masks secrets', () => {
    const registry = createRegistry({ login: 'user', password: 'supersecret', auth: TEST_AUTH });
    const masked = registry.maskConfiguration() as Record<string, string>;
    expect(masked.login).toBe('user');
    expect(masked.password).not.toBe('supersecret');
    expect(masked.auth).not.toBe(TEST_AUTH);
  });

  test('matches only its own hosts', () => {
    const registry = createRegistry();
    expect(registry.match({ registry: { url: 'docker.elastic.co' } } as any)).toBe(true);
    expect(registry.match({ registry: { url: 'https://docker.elastic.co/v2' } } as any)).toBe(true);
    expect(registry.match({ registry: { url: 'eu.docker.elastic.co' } } as any)).toBe(true);
  });

  test('rejects suffix spoofing and lookalike hosts', () => {
    const registry = createRegistry();
    expect(registry.match({ registry: { url: 'docker.elastic.co.attacker.com' } } as any)).toBe(
      false,
    );
    expect(registry.match({ registry: { url: 'evildocker.elastic.co' } } as any)).toBe(false);
    expect(registry.match({ registry: { url: 'wrong.io' } } as any)).toBe(false);
    expect(registry.match({ registry: { url: undefined } } as any)).toBe(false);
    expect(registry.match({} as any)).toBe(false);
  });

  test('normalizes the registry url to the v2 endpoint', () => {
    const registry = createRegistry();
    expect(
      registry.normalizeImage({ name: 'a/b', registry: { url: 'docker.elastic.co' } } as any),
    ).toStrictEqual({
      name: 'a/b',
      registry: { url: 'https://docker.elastic.co/v2' },
    });
  });

  test('sends basic credentials when configured', async () => {
    const registry = createRegistry({ login: 'user', password: 'pass' });
    const result = await registry.authenticate({} as any, { headers: {} });
    expect((result.headers as any).Authorization).toBe(
      `Basic ${Buffer.from('user:pass').toString('base64')}`,
    );
  });

  test('sends no Authorization header when anonymous', async () => {
    const registry = createRegistry();
    const result = await registry.authenticate({} as any, { headers: {} });
    expect((result.headers as any).Authorization).toBeUndefined();
  });
});

test('trusts the Elastic token endpoint host', () => {
  const registry = createRegistry();
  expect((registry as any).getTrustedAuthHosts()).toEqual(['docker-auth.elastic.co']);
});
