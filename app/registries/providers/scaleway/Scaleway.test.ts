import Scaleway from './Scaleway.js';

const TEST_AUTH = 'dXNlcjpwYXNz';

function createRegistry(configuration: Record<string, unknown> = {}) {
  const registry = new Scaleway();
  registry.configuration = configuration as any;
  return registry;
}

describe('Scaleway registry', () => {
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
    expect(() =>
      registry.validateConfiguration({ secretkey: 'sck-1', password: 'pass' }),
    ).toThrow();
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
    expect(registry.match({ registry: { url: 'scw.cloud' } } as any)).toBe(true);
    expect(registry.match({ registry: { url: 'https://scw.cloud/v2' } } as any)).toBe(true);
    expect(registry.match({ registry: { url: 'eu.scw.cloud' } } as any)).toBe(true);
  });

  test('rejects suffix spoofing and lookalike hosts', () => {
    const registry = createRegistry();
    expect(registry.match({ registry: { url: 'scw.cloud.attacker.com' } } as any)).toBe(false);
    expect(registry.match({ registry: { url: 'evilscw.cloud' } } as any)).toBe(false);
    expect(registry.match({ registry: { url: 'wrong.io' } } as any)).toBe(false);
    expect(registry.match({ registry: { url: undefined } } as any)).toBe(false);
    expect(registry.match({} as any)).toBe(false);
  });

  test('normalizes the registry url to the v2 endpoint', () => {
    const registry = createRegistry();
    expect(
      registry.normalizeImage({ name: 'a/b', registry: { url: 'scw.cloud' } } as any),
    ).toStrictEqual({
      name: 'a/b',
      registry: { url: 'https://scw.cloud/v2' },
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

describe('Scaleway secretkey', () => {
  test('accepts secretkey configuration and masks it', () => {
    const registry = createRegistry({ secretkey: 'sck-12345678' });
    expect(registry.validateConfiguration({ secretkey: 'sck-12345678' })).toStrictEqual({
      secretkey: 'sck-12345678',
    });
    expect((registry.maskConfiguration() as any).secretkey).not.toBe('sck-12345678');
  });

  test('init maps secretkey to nologin basic credentials', async () => {
    const registry = createRegistry({ secretkey: 'sck-12345678' });
    registry.init();
    expect(registry.configuration.login).toBe('nologin');
    expect(registry.configuration.password).toBe('sck-12345678');
    const result = await registry.authenticate({} as any, { headers: {} });
    expect((result.headers as any).Authorization).toBe(
      `Basic ${Buffer.from('nologin:sck-12345678').toString('base64')}`,
    );
  });

  test('init keeps an explicit login and ignores secretkey when auth is set', () => {
    const withLogin = createRegistry({ secretkey: 'sck-1', login: 'me' });
    withLogin.init();
    expect(withLogin.configuration.login).toBe('me');
    const withAuth = createRegistry({ secretkey: 'sck-1', auth: TEST_AUTH });
    withAuth.init();
    expect(withAuth.configuration.password).toBeUndefined();
  });

  test('init is a no-op without secretkey', () => {
    const registry = createRegistry();
    registry.init();
    expect(registry.configuration.login).toBeUndefined();
  });

  test('trusts the Scaleway token endpoint host', () => {
    expect((createRegistry() as any).getTrustedAuthHosts()).toEqual(['api.scaleway.com']);
  });
});
