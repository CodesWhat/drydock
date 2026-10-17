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

  // DD_X and DD_X__FILE name one setting: replaceSecrets turns the second into
  // the first. Whichever form the environment uses, the file's entry for that
  // setting is dropped, in either form.
  describe('a setting and its secret-file form are one key', () => {
    const KEY = 'DD_REGISTRY_GHCR_PRIVATE_TOKEN';
    const FILE_KEY = `${KEY}__FILE`;

    test('a file secret-file entry is dropped when the environment sets the value itself', () => {
      const envVars: Record<string, string | undefined> = { [KEY]: 'from-env' };
      const sources = mergeConfigLayers(envVars, { [FILE_KEY]: '/run/secrets/from-file' });

      expect(envVars).toStrictEqual({ [KEY]: 'from-env' });
      expect(sources).toStrictEqual({ [KEY]: 'env' });
    });

    test('a file value is dropped when the environment sets the secret-file form', () => {
      const envVars: Record<string, string | undefined> = { [FILE_KEY]: '/run/secrets/from-env' };
      const sources = mergeConfigLayers(envVars, { [KEY]: 'from-file' });

      expect(envVars).toStrictEqual({ [FILE_KEY]: '/run/secrets/from-env' });
      expect(sources).toStrictEqual({ [FILE_KEY]: 'env' });
    });

    test('a file secret-file entry is dropped when the environment sets the secret-file form', () => {
      const envVars: Record<string, string | undefined> = { [FILE_KEY]: '/run/secrets/from-env' };
      const sources = mergeConfigLayers(envVars, { [FILE_KEY]: '/run/secrets/from-file' });

      expect(envVars).toStrictEqual({ [FILE_KEY]: '/run/secrets/from-env' });
      expect(sources).toStrictEqual({ [FILE_KEY]: 'env' });
    });

    test.each([
      ['value', { [KEY]: 'from-file' }],
      ['secret-file entry', { [FILE_KEY]: '/run/secrets/from-file' }],
    ])('a file %s is dropped when the environment sets both forms', (_, fileLayer) => {
      const environment = { [KEY]: 'from-env', [FILE_KEY]: '/run/secrets/from-env' };
      const envVars: Record<string, string | undefined> = { ...environment };
      const sources = mergeConfigLayers(envVars, fileLayer);

      expect(envVars).toStrictEqual(environment);
      expect(sources).toStrictEqual({ [KEY]: 'env', [FILE_KEY]: 'env' });
    });

    test('the file supplies the secret-file form when the environment sets neither', () => {
      const envVars: Record<string, string | undefined> = {};
      const sources = mergeConfigLayers(envVars, { [FILE_KEY]: '/run/secrets/from-file' });

      expect(envVars).toStrictEqual({ [FILE_KEY]: '/run/secrets/from-file' });
      expect(sources).toStrictEqual({ [FILE_KEY]: 'file' });
    });

    test.each([
      [KEY, { [FILE_KEY]: '/run/secrets/from-file' }],
      [FILE_KEY, { [KEY]: 'from-file' }],
    ])(
      '%s explicitly set to undefined is unset, so the file still supplies the setting',
      (unsetKey, fileLayer) => {
        const envVars: Record<string, string | undefined> = { [unsetKey]: undefined };
        const sources = mergeConfigLayers(envVars, fileLayer);

        expect(envVars).toStrictEqual({ [unsetKey]: undefined, ...fileLayer });
        expect(sources).toStrictEqual(
          Object.fromEntries(Object.keys(fileLayer).map((key) => [key, 'file'])),
        );
      },
    );

    test('a dropped entry named in envSourcedFileKeys still leaves no trace in sources', () => {
      const envVars: Record<string, string | undefined> = { [KEY]: 'from-env' };
      const sources = mergeConfigLayers(
        envVars,
        { [FILE_KEY]: '/run/secrets/from-file' },
        new Set([FILE_KEY]),
      );

      expect(envVars).toStrictEqual({ [KEY]: 'from-env' });
      expect(sources).toStrictEqual({ [KEY]: 'env' });
    });

    test('a different setting that merely shares a prefix is not shadowed', () => {
      const envVars: Record<string, string | undefined> = { [`${KEY}_TTL`]: '60' };
      const sources = mergeConfigLayers(envVars, { [FILE_KEY]: '/run/secrets/from-file' });

      expect(envVars[FILE_KEY]).toBe('/run/secrets/from-file');
      expect(sources[FILE_KEY]).toBe('file');
    });
  });
});
