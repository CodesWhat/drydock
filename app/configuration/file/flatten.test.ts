import { flattenConfigTree } from './flatten.js';

describe('__FILE inside a key', () => {
  test('rejects a _file node whose base key contains __FILE inside a segment', () => {
    expect(() => flattenConfigTree({ my__file_path: { _file: '/run/secrets/x' } })).toThrow(
      /my__file_path: flattens to DD_MY__FILE_PATH, which contains "__FILE"/,
    );
  });

  test('rejects a scalar whose base key contains __FILE inside a segment', () => {
    expect(() => flattenConfigTree({ my__file_path: 'x' })).toThrow(/contains "__FILE"/);
  });

  test('rejects __FILE formed across a segment boundary', () => {
    expect(() => flattenConfigTree({ a_: { _file_b: 'x' } })).toThrow(
      /a_\._file_b: flattens to DD_A___FILE_B, which contains "__FILE"/,
    );
  });
});

describe('flattenConfigTree', () => {
  test('flattens a nested mapping to DD_-prefixed uppercase keys', () => {
    const result = flattenConfigTree({
      registry: { ghcr: { private: { username: 'scott' } } },
    });
    expect(result).toStrictEqual({ DD_REGISTRY_GHCR_PRIVATE_USERNAME: 'scott' });
  });

  test('flattens a single top-level scalar', () => {
    expect(flattenConfigTree({ dnsMode: 'hostgateway' })).toStrictEqual({
      DD_DNSMODE: 'hostgateway',
    });
  });

  test('rejects a non-mapping root: string', () => {
    expect(() => flattenConfigTree('hello')).toThrow('the document root must be a mapping');
  });

  test('rejects a non-mapping root: number', () => {
    expect(() => flattenConfigTree(42)).toThrow('the document root must be a mapping');
  });

  test('rejects a non-mapping root: array', () => {
    expect(() => flattenConfigTree(['a', 'b'])).toThrow('the document root must be a mapping');
  });

  test('rejects a non-mapping root: null', () => {
    expect(() => flattenConfigTree(null)).toThrow('the document root must be a mapping');
  });

  test('rejects a non-mapping root: undefined (an empty document)', () => {
    expect(() => flattenConfigTree(undefined)).toThrow('the document root must be a mapping');
  });

  test('rejects a leaf value of an unsupported type (e.g. a parsed !!timestamp Date)', () => {
    // yaml's core schema can resolve an explicit !!timestamp tag to a Date.
    // isPlainObject rejects it (its prototype isn't Object.prototype), so it
    // falls through past the mapping/array/null branches into coerceScalar,
    // which is the one type this loader has no representation for.
    expect(() => flattenConfigTree({ server: { updatedAt: new Date() } })).toThrow(
      /unsupported value type/,
    );
  });

  test('rejects a sequence value', () => {
    expect(() => flattenConfigTree({ security: { blockSeverity: ['CRITICAL', 'HIGH'] } })).toThrow(
      /sequence values are not supported/,
    );
  });

  test('rejects a key containing punctuation', () => {
    expect(() => flattenConfigTree({ 'server-port': 3000 })).toThrow(
      /key "server-port" must match/,
    );
  });

  test('rejects a key resulting from an unrendered "<<" merge marker', () => {
    // yaml.parse({ merge: false }) leaves a literal `<<` key rather than
    // interpreting it, so this is the shape the loader hands us.
    expect(() => flattenConfigTree({ foo: { '<<': { x: 1 }, y: 2 } })).toThrow(
      /key "<<" must match/,
    );
  });

  test.each(['__proto__', 'constructor', 'prototype', 'CONSTRUCTOR'])(
    'rejects the reserved key name %s',
    (reservedKey) => {
      expect(() => flattenConfigTree({ [reservedKey]: 'x' })).toThrow(/reserved key name/);
    },
  );

  test('treats a null value as unset, omitting the key entirely', () => {
    expect(flattenConfigTree({ server: { port: null } })).toStrictEqual({});
  });

  test('coerces a boolean true to the string "true"', () => {
    expect(flattenConfigTree({ security: { enabled: true } })).toStrictEqual({
      DD_SECURITY_ENABLED: 'true',
    });
  });

  test('coerces a boolean false to the string "false"', () => {
    expect(flattenConfigTree({ security: { enabled: false } })).toStrictEqual({
      DD_SECURITY_ENABLED: 'false',
    });
  });

  test('coerces a number to its decimal string form', () => {
    expect(flattenConfigTree({ server: { port: 3000 } })).toStrictEqual({
      DD_SERVER_PORT: '3000',
    });
  });

  test('normalises key casing to lowercase before flattening, case-insensitively', () => {
    const camel = flattenConfigTree({
      watcher: { local: { maintenanceWindowTz: 'UTC' } },
    });
    const lower = flattenConfigTree({
      watcher: { local: { maintenancewindowtz: 'UTC' } },
    });
    expect(camel).toStrictEqual({ DD_WATCHER_LOCAL_MAINTENANCEWINDOWTZ: 'UTC' });
    expect(camel).toStrictEqual(lower);
  });

  test('lets a later ordinary key win over an earlier one that flattens to the same env key', () => {
    // watcher.local.maintenance_window_scope and a differently-nested path
    // that also flattens to DD_WATCHER_LOCAL_MAINTENANCE_WINDOW_SCOPE: this
    // is the underscore/nesting ambiguity the file mirrors from env, not an
    // error. Object key order is insertion order for string keys, so the
    // second literal object property below is the "later" one.
    const result = flattenConfigTree({
      watcher: {
        local: {
          maintenance_window_scope: 'install',
          maintenance: { window: { scope: 'scan' } },
        },
      },
    });
    expect(result).toStrictEqual({ DD_WATCHER_LOCAL_MAINTENANCE_WINDOW_SCOPE: 'scan' });
  });

  describe('the _file node', () => {
    test('flattens to the base key plus the __FILE suffix', () => {
      const result = flattenConfigTree({
        registry: { ghcr: { private: { token: { _file: '/run/secrets/ghcr' } } } },
      });
      expect(result).toStrictEqual({
        DD_REGISTRY_GHCR_PRIVATE_TOKEN__FILE: '/run/secrets/ghcr',
      });
    });

    test('matches the _file marker case-insensitively', () => {
      const result = flattenConfigTree({ token: { _FILE: '/run/secrets/x' } });
      expect(result).toStrictEqual({ DD_TOKEN__FILE: '/run/secrets/x' });
    });

    test('rejects a _file mapping that carries a sibling key', () => {
      expect(() => flattenConfigTree({ token: { _file: '/run/secrets/x', value: 'y' } })).toThrow(
        /a "_file" mapping must contain "_file" and nothing else/,
      );
    });

    test('rejects a _file value that is not a string', () => {
      expect(() => flattenConfigTree({ token: { _file: 42 } })).toThrow(
        /must be a non-empty string/,
      );
    });

    test('rejects an empty-string _file value', () => {
      expect(() => flattenConfigTree({ token: { _file: '' } })).toThrow(
        /must be a non-empty string/,
      );
    });

    test('rejects a whitespace-only _file value', () => {
      expect(() => flattenConfigTree({ token: { _file: '   ' } })).toThrow(
        /must be a non-empty string/,
      );
    });

    test('rejects a document where a _file node and its base key are both set', () => {
      expect(() =>
        flattenConfigTree({
          registry: {
            ghcr: {
              private: {
                token: { _file: '/run/secrets/ghcr' },
              },
            },
          },
          registry_ghcr_private_token: 'literal-value',
        }),
      ).toThrow(/sets DD_REGISTRY_GHCR_PRIVATE_TOKEN__FILE as a secret file/);
    });

    test('does not error when the base key is set only in a different layer (env, not this file)', () => {
      // Precedence between env and file is handled by the merge step, not
      // by flatten — flatten only rejects a same-file collision.
      const result = flattenConfigTree({ token: { _file: '/run/secrets/x' } });
      expect(result).toStrictEqual({ DD_TOKEN__FILE: '/run/secrets/x' });
    });
  });

  describe('a scalar key that flattens to the __FILE suffix', () => {
    test('rejects a scalar whose key segment ends in __FILE', () => {
      // `secret__file: /tmp/x` would flatten to DD_SECRET__FILE, which
      // replaceSecrets in ../index.ts treats as a secret-file pointer and
      // reads from disk — the __FILE suffix is reserved for a real "_file"
      // mapping, not a scalar an operator happened to name that way.
      expect(() => flattenConfigTree({ secret__file: '/tmp/x' })).toThrow(
        /secret__file: flattens to DD_SECRET__FILE.*reserved for a "_file" mapping/s,
      );
    });

    test('a _file node still produces the __FILE-suffixed key', () => {
      const result = flattenConfigTree({ secret: { _file: '/run/secrets/x' } });
      expect(result).toStrictEqual({ DD_SECRET__FILE: '/run/secrets/x' });
    });
  });

  test('accepts a null-prototype mapping (e.g. Object.create(null))', () => {
    const tree = Object.create(null);
    tree.dnsMode = 'hostgateway';
    expect(flattenConfigTree(tree)).toStrictEqual({ DD_DNSMODE: 'hostgateway' });
  });

  describe('UNSUPPORTED_FILE_KEYS (spec-7.1-config-file.md section 1.2)', () => {
    test('rejects a scalar that flattens to an unsupported key, naming the YAML path', () => {
      expect(() => flattenConfigTree({ agent: { secret: 'shh' } })).toThrow(
        /agent\.secret: DD_AGENT_SECRET is only read from the environment in this release/,
      );
    });

    test('rejects a _file node whose base key is unsupported', () => {
      expect(() => flattenConfigTree({ agent: { secret: { _file: '/run/secrets/x' } } })).toThrow(
        /agent\.secret\._file: DD_AGENT_SECRET is only read from the environment in this release/,
      );
    });

    test('does not reject an ordinary supported key', () => {
      expect(flattenConfigTree({ server: { port: 3000 } })).toStrictEqual({
        DD_SERVER_PORT: '3000',
      });
    });

    test('does not reject a DD_SELF_UPDATE_* key: it is app-written handoff state, not configuration', () => {
      const result = flattenConfigTree({ self: { update: { poll_interval_ms: 5000 } } });
      expect(result).toStrictEqual({ DD_SELF_UPDATE_POLL_INTERVAL_MS: '5000' });
    });
  });
});
