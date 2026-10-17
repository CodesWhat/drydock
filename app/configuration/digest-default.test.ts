import * as configuration from './index.js';

afterEach(() => {
  delete configuration.ddEnvVars.DD_DEFAULTS_WATCH_DIGEST;
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('digest-watch installation default', () => {
  test('leaves automatic detection unchanged when omitted', () => {
    expect(configuration.getDefaultDigestWatch()).toBeUndefined();
  });

  test.each([
    ['true', true],
    ['false', false],
    ['TRUE', true],
    ['FALSE', false],
  ])('reads %s as %s', (value, expected) => {
    configuration.ddEnvVars.DD_DEFAULTS_WATCH_DIGEST = value;
    expect(configuration.getDefaultDigestWatch()).toBe(expected);
  });

  test.each(['', 'auto', 'yes', '0', '1'])('rejects invalid value %j', (value) => {
    configuration.ddEnvVars.DD_DEFAULTS_WATCH_DIGEST = value;
    expect(() => configuration.getDefaultDigestWatch()).toThrow(/boolean/);
  });

  test('rejects an invalid environment default before any watcher starts', async () => {
    vi.stubEnv('DD_DEFAULTS_WATCH_DIGEST', 'not-a-boolean');
    vi.resetModules();
    await expect(import('./index.js')).rejects.toThrow(/boolean/);
  });

  test.each([undefined, 'true'])(
    'loads YAML defaults beneath environment value %s',
    async (env) => {
      vi.stubEnv('DD_DEFAULTS_WATCH_DIGEST', env);
      vi.resetModules();
      const { setConfigFileLayer } = await import('./file/layer.js');
      setConfigFileLayer({ DD_DEFAULTS_WATCH_DIGEST: 'false' });
      const fresh = await import('./index.js');
      expect(fresh.getDefaultDigestWatch()).toBe(env === 'true');
      expect(fresh.configFileSources.DD_DEFAULTS_WATCH_DIGEST).toBe(env ? 'env' : 'file');
    },
  );
});
