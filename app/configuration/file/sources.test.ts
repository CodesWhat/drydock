import { mergeConfigLayers } from './sources.js';

describe('mergeConfigLayers', () => {
  test('the no-op proof: an empty file layer leaves envVars byte-for-byte unchanged', () => {
    const envVars: Record<string, string | undefined> = {
      DD_SERVER_PORT: '3000',
      DD_LOG_LEVEL: 'info',
    };
    const before = { ...envVars };

    const sources = mergeConfigLayers(envVars, {});

    expect(envVars).toStrictEqual(before);
    expect(sources).toStrictEqual({ DD_SERVER_PORT: 'env', DD_LOG_LEVEL: 'env' });
  });

  test('env wins when both layers set the same key', () => {
    const envVars: Record<string, string | undefined> = { DD_SERVER_PORT: '3000' };
    const sources = mergeConfigLayers(envVars, { DD_SERVER_PORT: '4000' });

    expect(envVars.DD_SERVER_PORT).toBe('3000');
    expect(sources.DD_SERVER_PORT).toBe('env');
  });

  test('the file supplies a key the environment does not set', () => {
    const envVars: Record<string, string | undefined> = {};
    const sources = mergeConfigLayers(envVars, { DD_REGISTRY_GHCR_PRIVATE_USERNAME: 'scott' });

    expect(envVars.DD_REGISTRY_GHCR_PRIVATE_USERNAME).toBe('scott');
    expect(sources.DD_REGISTRY_GHCR_PRIVATE_USERNAME).toBe('file');
  });

  test('a key present but explicitly set to undefined is treated as unset, letting the file supply it', () => {
    const envVars: Record<string, string | undefined> = { DD_LOG_LEVEL: undefined };
    const sources = mergeConfigLayers(envVars, { DD_LOG_LEVEL: 'debug' });

    expect(envVars.DD_LOG_LEVEL).toBe('debug');
    expect(sources.DD_LOG_LEVEL).toBe('file');
  });

  test('a key absent from the file and absent from the environment never appears in sources (a Joi default)', () => {
    const envVars: Record<string, string | undefined> = {};
    const sources = mergeConfigLayers(envVars, {});

    expect(sources).toStrictEqual({});
    expect(Object.hasOwn(sources, 'DD_SERVER_PORT')).toBe(false);
  });

  test('mutates the envVars object in place rather than returning a new one', () => {
    const envVars: Record<string, string | undefined> = {};
    mergeConfigLayers(envVars, { DD_LOG_LEVEL: 'debug' });
    expect(envVars.DD_LOG_LEVEL).toBe('debug');
  });

  test('a file-supplied key named in envSourcedFileKeys attributes as "env", not "file"', () => {
    const envVars: Record<string, string | undefined> = {};
    const sources = mergeConfigLayers(
      envVars,
      { DD_REGISTRY_GHCR_PRIVATE_TOKEN: 'secret-value' },
      new Set(['DD_REGISTRY_GHCR_PRIVATE_TOKEN']),
    );

    expect(envVars.DD_REGISTRY_GHCR_PRIVATE_TOKEN).toBe('secret-value');
    expect(sources.DD_REGISTRY_GHCR_PRIVATE_TOKEN).toBe('env');
  });

  test('a file-supplied key not named in envSourcedFileKeys still attributes as "file"', () => {
    const envVars: Record<string, string | undefined> = {};
    const sources = mergeConfigLayers(
      envVars,
      { DD_SERVER_NAME: 'literal', DD_REGISTRY_GHCR_PRIVATE_TOKEN: 'secret-value' },
      new Set(['DD_REGISTRY_GHCR_PRIVATE_TOKEN']),
    );

    expect(sources.DD_SERVER_NAME).toBe('file');
    expect(sources.DD_REGISTRY_GHCR_PRIVATE_TOKEN).toBe('env');
  });

  test('envSourcedFileKeys naming a key env already wins on has no effect (env already won)', () => {
    const envVars: Record<string, string | undefined> = { DD_SERVER_PORT: '3000' };
    const sources = mergeConfigLayers(
      envVars,
      { DD_SERVER_PORT: '4000' },
      new Set(['DD_SERVER_PORT']),
    );

    expect(envVars.DD_SERVER_PORT).toBe('3000');
    expect(sources.DD_SERVER_PORT).toBe('env');
  });
});
