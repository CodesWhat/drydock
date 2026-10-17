import { interpolateConfigTree } from './interpolate.js';

describe('interpolateConfigTree', () => {
  test('substitutes ${NAME} with the environment variable when it is set', () => {
    const result = interpolateConfigTree(
      { registry: { ghcr: { private: { token: '${GHCR_TOKEN}' } } } },
      { GHCR_TOKEN: 'secret-value' },
    );
    expect(result.tree).toStrictEqual({
      registry: { ghcr: { private: { token: 'secret-value' } } },
    });
  });

  test('records the substituted key in interpolatedKeys, DD_-prefixed', () => {
    const result = interpolateConfigTree(
      { registry: { ghcr: { private: { token: '${GHCR_TOKEN}' } } } },
      { GHCR_TOKEN: 'secret-value' },
    );
    expect(result.interpolatedKeys).toStrictEqual(new Set(['DD_REGISTRY_GHCR_PRIVATE_TOKEN']));
  });

  test('falls back to the ":-default" when the variable is unset', () => {
    const result = interpolateConfigTree({ server: { port: '${PORT:-4000}' } }, {});
    expect(result.tree).toStrictEqual({ server: { port: '4000' } });
    expect(result.interpolatedKeys).toStrictEqual(new Set(['DD_SERVER_PORT']));
  });

  test('an empty default ("${X:-}") resolves to an empty string when unset', () => {
    const result = interpolateConfigTree({ server: { name: '${SERVER_NAME:-}' } }, {});
    expect(result.tree).toStrictEqual({ server: { name: '' } });
    expect(result.interpolatedKeys).toStrictEqual(new Set(['DD_SERVER_NAME']));
  });

  test('the environment variable wins over the default when both are present', () => {
    const result = interpolateConfigTree({ server: { port: '${PORT:-4000}' } }, { PORT: '9000' });
    expect(result.tree).toStrictEqual({ server: { port: '9000' } });
  });

  test('an unset variable with no default is a load error naming the YAML path and the variable', () => {
    expect(() =>
      interpolateConfigTree({ registry: { ghcr: { private: { token: '${GHCR_TOKEN}' } } } }, {}),
    ).toThrow(/registry\.ghcr\.private\.token.*GHCR_TOKEN/s);
  });

  test('no partial substitution: a value that is not entirely a ${...} reference is left literally as is', () => {
    const result = interpolateConfigTree({ server: { name: 'prefix-${SERVER_NAME}' } }, {});
    expect(result.tree).toStrictEqual({ server: { name: 'prefix-${SERVER_NAME}' } });
    expect(result.interpolatedKeys.size).toBe(0);
  });

  test('a literal "${" inside a longer value is left untouched', () => {
    const result = interpolateConfigTree(
      { server: { name: 'contains ${ but not a whole reference' } },
      {},
    );
    expect(result.tree).toStrictEqual({
      server: { name: 'contains ${ but not a whole reference' },
    });
  });

  test('no recursion: a substituted value that itself looks like ${Y} is not substituted again', () => {
    const result = interpolateConfigTree(
      { server: { name: '${OUTER}' } },
      { OUTER: '${INNER}', INNER: 'should-not-be-reached' },
    );
    expect(result.tree).toStrictEqual({ server: { name: '${INNER}' } });
  });

  test('no recursion: a ":-default" that itself looks like ${Y} is not substituted again', () => {
    const result = interpolateConfigTree({ server: { name: '${MISSING:-${ALSO_MISSING}}' } }, {});
    // The whole-scalar pattern's default group is greedy up to the final
    // "}", so the default text here is "${ALSO_MISSING}" verbatim.
    expect(result.tree).toStrictEqual({ server: { name: '${ALSO_MISSING}' } });
  });

  test('applies to a _file node’s own value, since it is a plain scalar in the tree', () => {
    const result = interpolateConfigTree(
      { registry: { ghcr: { private: { token: { _file: '${GHCR_TOKEN_PATH}' } } } } },
      { GHCR_TOKEN_PATH: '/run/secrets/ghcr' },
    );
    expect(result.tree).toStrictEqual({
      registry: { ghcr: { private: { token: { _file: '/run/secrets/ghcr' } } } },
    });
  });

  test('a _file node’s substituted key is recorded with the __FILE suffix, dropping the marker segment', () => {
    const result = interpolateConfigTree(
      { registry: { ghcr: { private: { token: { _file: '${GHCR_TOKEN_PATH}' } } } } },
      { GHCR_TOKEN_PATH: '/run/secrets/ghcr' },
    );
    expect(result.interpolatedKeys).toStrictEqual(
      new Set(['DD_REGISTRY_GHCR_PRIVATE_TOKEN__FILE']),
    );
  });

  test('matches the _file marker case-insensitively, same as flatten.ts', () => {
    const result = interpolateConfigTree(
      { token: { _FILE: '${TOKEN_PATH}' } },
      {
        TOKEN_PATH: '/run/secrets/x',
      },
    );
    expect(result.tree).toStrictEqual({ token: { _FILE: '/run/secrets/x' } });
    expect(result.interpolatedKeys).toStrictEqual(new Set(['DD_TOKEN__FILE']));
  });

  test('an unset _file interpolation with no default throws, naming the _file path', () => {
    expect(() => interpolateConfigTree({ token: { _file: '${TOKEN_PATH}' } }, {})).toThrow(
      /token\._file.*TOKEN_PATH/s,
    );
  });

  test('a non-string _file value passes through untouched (flatten.ts owns rejecting it)', () => {
    const result = interpolateConfigTree({ token: { _file: 42 } }, {});
    expect(result.tree).toStrictEqual({ token: { _file: 42 } });
    expect(result.interpolatedKeys.size).toBe(0);
  });

  test('non-string scalars (booleans, numbers, null) are left untouched', () => {
    const result = interpolateConfigTree(
      { security: { enabled: true }, server: { port: 3000, name: null } },
      {},
    );
    expect(result.tree).toStrictEqual({
      security: { enabled: true },
      server: { port: 3000, name: null },
    });
    expect(result.interpolatedKeys.size).toBe(0);
  });

  test('a sequence value passes through untouched (flatten.ts owns rejecting it)', () => {
    const result = interpolateConfigTree({ security: { blockSeverity: ['${A}', 'HIGH'] } }, {});
    expect(result.tree).toStrictEqual({ security: { blockSeverity: ['${A}', 'HIGH'] } });
    expect(result.interpolatedKeys.size).toBe(0);
  });

  test('treats a null-prototype object as a plain mapping too, same as flatten.ts', () => {
    // yaml.parse can hand back a null-prototype object for a mapping (it's
    // how the loader itself avoids the __proto__ pitfall this module works
    // around above), so isPlainObject accepts null prototypes the same way
    // flatten.ts's own isPlainObject does.
    const nullProtoNode = Object.create(null) as Record<string, unknown>;
    nullProtoNode.name = '${SERVER_NAME}';
    const result = interpolateConfigTree({ server: nullProtoNode }, { SERVER_NAME: 'from-env' });
    expect(result.tree).toStrictEqual({ server: { name: 'from-env' } });
  });

  test('a non-mapping root passes through unchanged, letting flatten.ts reject it', () => {
    const result = interpolateConfigTree('hello', {});
    expect(result.tree).toBe('hello');
    expect(result.interpolatedKeys.size).toBe(0);
  });

  test('round-trips a real own "__proto__" key as an own property, not a prototype change', () => {
    // Computed-property syntax, same as flatten.test.ts's own reserved-key
    // tests: this creates a genuine own enumerable "__proto__" property,
    // matching what yaml.parse hands the loader for a `__proto__:` mapping
    // key (rather than triggering the object-literal special case that sets
    // the prototype instead of creating a property).
    const input: Record<string, unknown> = { ['__proto__']: { polluted: true } };
    const result = interpolateConfigTree(input);
    expect(Object.getPrototypeOf(result.tree)).toBe(Object.prototype);
    expect(Object.keys(result.tree as Record<string, unknown>)).toStrictEqual(['__proto__']);
    expect(
      Object.getOwnPropertyDescriptor(result.tree as Record<string, unknown>, '__proto__')?.value,
    ).toStrictEqual({ polluted: true });
  });

  test('does not mutate the input tree', () => {
    const input = { registry: { ghcr: { private: { token: '${GHCR_TOKEN}' } } } };
    const before = JSON.parse(JSON.stringify(input));
    interpolateConfigTree(input, { GHCR_TOKEN: 'secret-value' });
    expect(input).toStrictEqual(before);
  });

  test('defaults the env parameter to process.env', () => {
    const originalValue = process.env.DD_TEST_INTERPOLATE_DEFAULT_ENV;
    process.env.DD_TEST_INTERPOLATE_DEFAULT_ENV = 'from-process-env';
    try {
      const result = interpolateConfigTree({
        server: { name: '${DD_TEST_INTERPOLATE_DEFAULT_ENV}' },
      });
      expect(result.tree).toStrictEqual({ server: { name: 'from-process-env' } });
    } finally {
      if (originalValue === undefined) {
        delete process.env.DD_TEST_INTERPOLATE_DEFAULT_ENV;
      } else {
        process.env.DD_TEST_INTERPOLATE_DEFAULT_ENV = originalValue;
      }
    }
  });
});
