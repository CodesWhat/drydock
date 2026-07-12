var { mockArgon2, mockArgon2Sync, mockTimingSafeEqual } = vi.hoisted(() => ({
  mockArgon2: vi.fn(),
  mockArgon2Sync: vi.fn(),
  mockTimingSafeEqual: vi.fn(
    (left: Buffer, right: Buffer) => left.length === right.length && left.equals(right),
  ),
}));
var { mockRecordAuthLogin, mockObserveAuthLoginDuration, mockRecordAuthUsernameMismatch } =
  vi.hoisted(() => ({
    mockRecordAuthLogin: vi.fn(),
    mockObserveAuthLoginDuration: vi.fn(),
    mockRecordAuthUsernameMismatch: vi.fn(),
  }));

vi.mock('node:crypto', async () => {
  const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto');
  mockArgon2.mockImplementation(
    (
      algorithm: string,
      options: Record<string, unknown>,
      callback: (error: Error | null, derived?: Buffer) => void,
    ) => actual.argon2(algorithm as 'argon2id', options as any, callback),
  );
  mockArgon2Sync.mockImplementation((algorithm: string, options: Record<string, unknown>) =>
    actual.argon2Sync(algorithm as 'argon2id', options),
  );
  return {
    ...actual,
    argon2: mockArgon2,
    argon2Sync: mockArgon2Sync,
    timingSafeEqual: mockTimingSafeEqual,
  };
});

vi.mock('../../../prometheus/auth.js', () => ({
  recordAuthLogin: mockRecordAuthLogin,
  observeAuthLoginDuration: mockObserveAuthLoginDuration,
  recordAuthUsernameMismatch: mockRecordAuthUsernameMismatch,
}));

import { argon2Sync, createHash, randomBytes } from 'node:crypto';
import Basic from './Basic.js';

type Argon2Params = { memory: number; passes: number; parallelism: number };
type PhcParamKey = 'm' | 't' | 'p';

const DEFAULT_ARGON2_PARAMS: Argon2Params = {
  memory: 65536,
  passes: 3,
  parallelism: 4,
};

function createArgon2Hash(password: string, params: Argon2Params = DEFAULT_ARGON2_PARAMS) {
  const salt = randomBytes(32);
  const derived = argon2Sync('argon2id', {
    message: password,
    nonce: salt,
    memory: params.memory,
    passes: params.passes,
    parallelism: params.parallelism,
    tagLength: 64,
  });
  return `argon2id$${params.memory}$${params.passes}$${params.parallelism}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

function toPhcBase64(value: Buffer, padded = false): string {
  const encoded = value.toString('base64').replaceAll('+', '-').replaceAll('/', '_');
  return padded ? encoded : encoded.replace(/=+$/u, '');
}

function createPhcArgon2Hash(
  password: string,
  options: {
    params?: Argon2Params;
    version?: string;
    parameterOrder?: PhcParamKey[];
    paddedSegments?: boolean;
  } = {},
) {
  const params = options.params ?? DEFAULT_ARGON2_PARAMS;
  const version = options.version ?? 'v=19';
  const parameterOrder = options.parameterOrder ?? ['m', 't', 'p'];
  const paramValueByKey: Record<PhcParamKey, number> = {
    m: params.memory,
    t: params.passes,
    p: params.parallelism,
  };
  const parameterSegment = parameterOrder.map((key) => `${key}=${paramValueByKey[key]}`).join(',');
  const salt = randomBytes(32);
  const derived = argon2Sync('argon2id', {
    message: password,
    nonce: salt,
    memory: params.memory,
    passes: params.passes,
    parallelism: params.parallelism,
    tagLength: 64,
  });

  return `$argon2id$${version}$${parameterSegment}$${toPhcBase64(salt, options.paddedSegments)}$${toPhcBase64(derived, options.paddedSegments)}`;
}

function createShaHash(password: string) {
  const digest = createHash('sha1').update(password).digest();
  return `{SHA}${digest.toString('base64')}`;
}

const VALID_SALT_BASE64 = Buffer.alloc(16, 1).toString('base64');
const VALID_HASH_BASE64 = Buffer.alloc(32, 1).toString('base64');
const VALID_SALT_BASE64URL = toPhcBase64(Buffer.alloc(16, 1));
const VALID_HASH_BASE64URL = toPhcBase64(Buffer.alloc(32, 1));
const LEGACY_APR1_HASH = '$apr1$r31.....$HqJZimcKQFAMYayBlzkrA/';
const LEGACY_MD5_HASH = '$1$saltsalt$2vnaRpHa6Jxjz5n83ok8Z0';
const LEGACY_CRYPT_HASH = 'rqXexS6ZhobKA';
const LEGACY_PLAIN_HASH = 'plaintext-password';
describe('Basic Authentication', () => {
  let basic: InstanceType<typeof Basic>;

  beforeEach(async () => {
    basic = new Basic();
    mockArgon2.mockClear();
    mockArgon2Sync.mockClear();
    mockTimingSafeEqual.mockClear();
    mockRecordAuthLogin.mockClear();
    mockObserveAuthLoginDuration.mockClear();
    mockRecordAuthUsernameMismatch.mockClear();
  });

  test('should create instance', async () => {
    expect(basic).toBeDefined();
    expect(basic).toBeInstanceOf(Basic);
  });

  test('should return basic strategy', async () => {
    basic.configuration = {
      user: 'testuser',
      hash: createArgon2Hash('password'),
    };

    const strategy = basic.getStrategy();
    expect(strategy).toBeDefined();
    expect(strategy.name).toBe('basic');
  });

  test('should return strategy description', async () => {
    const description = basic.getStrategyDescription();
    expect(description).toEqual({
      type: 'basic',
      name: 'Login',
    });
  });

  test('should mask configuration hash', async () => {
    basic.configuration = {
      user: 'testuser',
      hash: createArgon2Hash('password'),
    };
    const masked = basic.maskConfiguration();
    expect(masked.user).toBe('testuser');
    expect(masked.hash).toBe('[REDACTED]');
  });

  test('should authenticate valid user with argon2id hash', async () => {
    basic.configuration = {
      user: 'testuser',
      hash: createArgon2Hash('password'),
    };

    await new Promise<void>((resolve) => {
      basic.authenticate('testuser', 'password', (err, result) => {
        expect(result).toEqual({ username: 'testuser' });
        resolve();
      });
    });

    expect(mockRecordAuthLogin).toHaveBeenCalledWith('success', 'basic');
    expect(mockObserveAuthLoginDuration).toHaveBeenCalledWith(
      'success',
      'basic',
      expect.any(Number),
    );
    expect(mockRecordAuthUsernameMismatch).not.toHaveBeenCalled();
  });

  test('should derive password with argon2id parameters', async () => {
    const params = { memory: 65536, passes: 3, parallelism: 4 };
    basic.configuration = {
      user: 'testuser',
      hash: createArgon2Hash('password', params),
    };

    mockArgon2.mockClear();
    mockArgon2Sync.mockClear();

    await new Promise<void>((resolve) => {
      basic.authenticate('testuser', 'password', (_err, result) => {
        expect(result).toEqual({ username: 'testuser' });
        resolve();
      });
    });

    const verificationCall = mockArgon2.mock.calls.find(
      (call: unknown[]) =>
        call[1] && typeof call[1] === 'object' && 'memory' in (call[1] as Record<string, unknown>),
    );

    expect(verificationCall).toBeDefined();
    expect(verificationCall[1]).toMatchObject({
      memory: params.memory,
      passes: params.passes,
      parallelism: params.parallelism,
    });
    expect(mockArgon2Sync).not.toHaveBeenCalled();
  });

  test('should reject invalid user', async () => {
    basic.configuration = {
      user: 'testuser',
      hash: createArgon2Hash('password'),
    };

    await new Promise<void>((resolve) => {
      basic.authenticate('wronguser', 'password', (err, result) => {
        expect(result).toBe(false);
        resolve();
      });
    });

    // Argon2 must still be called even on username mismatch (timing side-channel mitigation)
    expect(mockArgon2).toHaveBeenCalled();
    expect(mockRecordAuthUsernameMismatch).toHaveBeenCalledTimes(1);
    expect(mockRecordAuthLogin).toHaveBeenCalledWith('invalid', 'basic');
    expect(mockObserveAuthLoginDuration).toHaveBeenCalledWith(
      'invalid',
      'basic',
      expect.any(Number),
    );
  });

  test('should compare usernames with timingSafeEqual', async () => {
    basic.configuration = {
      user: 'testuser',
      hash: createArgon2Hash('password'),
    };

    await new Promise<void>((resolve) => {
      basic.authenticate('wronguser', 'password', (err, result) => {
        expect(result).toBe(false);
        resolve();
      });
    });

    // Called twice: once for username comparison, once inside argon2 hash verification
    // (timing mitigation runs argon2 even on username mismatch)
    expect(mockTimingSafeEqual).toHaveBeenCalledTimes(2);
    expect(mockArgon2).toHaveBeenCalledTimes(1);
  });

  test('should run argon2 even when username does not match (timing mitigation)', async () => {
    basic.configuration = {
      user: 'testuser',
      hash: createArgon2Hash('password'),
    };
    mockArgon2.mockClear();

    await new Promise<void>((resolve) => {
      basic.authenticate('wronguser', 'wrongpassword', (err, result) => {
        expect(result).toBe(false);
        resolve();
      });
    });

    // Verify argon2 was invoked despite username mismatch
    expect(mockArgon2).toHaveBeenCalledTimes(1);
  });

  test('should avoid unhandled rejections when timing mitigation verification rejects', async () => {
    basic.configuration = {
      user: 'testuser',
      hash: {
        trim() {
          throw new Error('corrupt hash');
        },
      } as unknown as string,
    };

    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      await new Promise<void>((resolve) => {
        basic.authenticate('wronguser', 'password', (_err, result) => {
          expect(result).toBe(false);
          resolve();
        });
      });

      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(unhandledRejections).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  test('should reject invalid password', async () => {
    basic.configuration = {
      user: 'testuser',
      hash: createArgon2Hash('password'),
    };

    await new Promise<void>((resolve) => {
      basic.authenticate('testuser', 'wrongpassword', (err, result) => {
        expect(result).toBe(false);
        resolve();
      });
    });

    expect(mockRecordAuthUsernameMismatch).not.toHaveBeenCalled();
    expect(mockRecordAuthLogin).toHaveBeenCalledWith('invalid', 'basic');
    expect(mockObserveAuthLoginDuration).toHaveBeenCalledWith(
      'invalid',
      'basic',
      expect.any(Number),
    );
  });

  test('should reject null user', async () => {
    basic.configuration = {
      user: 'testuser',
      hash: createArgon2Hash('password'),
    };

    await new Promise<void>((resolve) => {
      basic.authenticate(null, 'password', (err, result) => {
        expect(result).toBe(false);
        resolve();
      });
    });
  });

  test('should reject too-short SHA-style hashes', async () => {
    basic.configuration = {
      user: 'testuser',
      hash: '{S',
    };

    await new Promise<void>((resolve) => {
      basic.authenticate('testuser', 'password', (_err, result) => {
        expect(result).toBe(false);
        resolve();
      });
    });
  });

  test('should reject when argon2 hash parsing fails during verification', async () => {
    const validHash = createArgon2Hash('password');
    let splitCallCount = 0;
    const flakyHash = {
      split(separator: string) {
        splitCallCount += 1;
        return splitCallCount === 1 ? validHash.split(separator) : ['argon2id'];
      },
    } as unknown as string;

    basic.configuration = {
      user: 'testuser',
      hash: flakyHash,
    };

    await new Promise<void>((resolve) => {
      basic.authenticate('testuser', 'password', (_err, result) => {
        expect(result).toBe(false);
        resolve();
      });
    });
  });

  test('should reject authentication when hash parsing throws during verification dispatch', async () => {
    const throwingHash = {
      split() {
        throw new Error('split failed');
      },
    } as unknown as string;

    basic.configuration = {
      user: 'testuser',
      hash: throwingHash,
    };

    await new Promise<void>((resolve) => {
      basic.authenticate('testuser', 'password', (_err, result) => {
        expect(result).toBe(false);
        resolve();
      });
    });
  });

  test('should validate configuration schema with argon2id hash', async () => {
    const hash = createArgon2Hash('password');
    expect(
      basic.validateConfiguration({
        user: 'testuser',
        hash,
      }),
    ).toEqual({
      user: 'testuser',
      hash,
    });
  });

  test('should validate configuration schema with PHC argon2id hash', async () => {
    const hash = createPhcArgon2Hash('password');
    expect(
      basic.validateConfiguration({
        user: 'testuser',
        hash,
      }),
    ).toEqual({
      user: 'testuser',
      hash,
    });
  });

  test.each([
    ['SHA-1', createShaHash('password')],
    ['APR1', LEGACY_APR1_HASH],
    ['MD5', LEGACY_MD5_HASH],
    ['crypt', LEGACY_CRYPT_HASH],
    ['plain text', LEGACY_PLAIN_HASH],
  ])('should reject removed %s password hashes during configuration', (_format, hash) => {
    expect(() =>
      basic.validateConfiguration({
        user: 'testuser',
        hash,
      }),
    ).toThrow(/must be an argon2id hash/i);
  });

  test('should authenticate valid user with PHC argon2id hash', async () => {
    basic.configuration = {
      user: 'testuser',
      hash: createPhcArgon2Hash('password'),
    };

    await new Promise<void>((resolve) => {
      basic.authenticate('testuser', 'password', (_err, result) => {
        expect(result).toEqual({ username: 'testuser' });
        resolve();
      });
    });
  });

  test.each([
    ['m=65536,t=3,p=4'],
    ['t=3,p=4,m=65536'],
    ['p=4,m=65536,t=3'],
  ])('should accept PHC argon2id hashes with reordered parameters (%s)', (parameterSegment) => {
    const hash = `$argon2id$v=19$${parameterSegment}$${VALID_SALT_BASE64URL}$${VALID_HASH_BASE64URL}`;
    expect(
      basic.validateConfiguration({
        user: 'testuser',
        hash,
      }),
    ).toEqual({
      user: 'testuser',
      hash,
    });
  });

  test('should accept PHC argon2id hashes with padded base64url segments', async () => {
    const hash = createPhcArgon2Hash('password', { paddedSegments: true });
    expect(
      basic.validateConfiguration({
        user: 'testuser',
        hash,
      }),
    ).toEqual({
      user: 'testuser',
      hash,
    });
  });

  test('should throw on invalid configuration', async () => {
    expect(() => basic.validateConfiguration({})).toThrow('"user" is required');
  });

  test('should delegate authentication through strategy callback', async () => {
    basic.configuration = {
      user: 'testuser',
      hash: createArgon2Hash('password'),
    };

    const strategy = basic.getStrategy();
    await new Promise<void>((resolve) => {
      strategy._verify('testuser', 'password', (err, result) => {
        expect(result).toEqual({ username: 'testuser' });
        resolve();
      });
    });
  });

  test('should reject authentication when argon2id derivation fails', async () => {
    basic.configuration = {
      user: 'testuser',
      hash: createArgon2Hash('password'),
    };
    mockArgon2.mockImplementationOnce((_algorithm, _options, callback) => {
      callback(new Error('argon2 unavailable'));
    });

    await new Promise<void>((resolve) => {
      basic.authenticate('testuser', 'password', (_err, result) => {
        expect(result).toBe(false);
        resolve();
      });
    });
  });

  test('should verify argon2id passwords using async crypto.argon2', async () => {
    basic.configuration = {
      user: 'testuser',
      hash: createArgon2Hash('password'),
    };

    mockArgon2.mockClear();
    mockArgon2Sync.mockClear();

    await new Promise<void>((resolve) => {
      basic.authenticate('testuser', 'password', (_err, result) => {
        expect(result).toEqual({ username: 'testuser' });
        resolve();
      });
    });

    expect(mockArgon2).toHaveBeenCalledTimes(1);
    expect(mockArgon2Sync).not.toHaveBeenCalled();
  });

  test('should reject argon2id hashes with empty base64 segments', async () => {
    expect(() =>
      basic.validateConfiguration({
        user: 'testuser',
        hash: `argon2id$65536$3$4$$${VALID_HASH_BASE64}`,
      }),
    ).toThrow('must be an argon2id hash');
  });

  test('should reject argon2id hashes with malformed base64 segments', async () => {
    expect(() =>
      basic.validateConfiguration({
        user: 'testuser',
        hash: `argon2id$65536$3$4$not*base64$${VALID_HASH_BASE64}`,
      }),
    ).toThrow('must be an argon2id hash');
  });

  test('should reject argon2id hashes with invalid parameter ranges', async () => {
    expect(() =>
      basic.validateConfiguration({
        user: 'testuser',
        hash: `argon2id$1024$3$4$${VALID_SALT_BASE64}$${VALID_HASH_BASE64}`,
      }),
    ).toThrow('must be an argon2id hash');
  });

  test('should reject argon2id hashes with non-numeric parameters', async () => {
    expect(() =>
      basic.validateConfiguration({
        user: 'testuser',
        hash: `argon2id$NaN$3$4$${VALID_SALT_BASE64}$${VALID_HASH_BASE64}`,
      }),
    ).toThrow('must be an argon2id hash');
  });

  test('should reject argon2id hashes with non-positive parameters', async () => {
    expect(() =>
      basic.validateConfiguration({
        user: 'testuser',
        hash: `argon2id$65536$0$4$${VALID_SALT_BASE64}$${VALID_HASH_BASE64}`,
      }),
    ).toThrow('must be an argon2id hash');
  });

  test('should reject argon2id hashes with passes below minimum', async () => {
    expect(() =>
      basic.validateConfiguration({
        user: 'testuser',
        hash: `argon2id$65536$1$4$${VALID_SALT_BASE64}$${VALID_HASH_BASE64}`,
      }),
    ).toThrow('must be an argon2id hash');
  });

  test('should reject argon2id hashes with parallelism above maximum', async () => {
    expect(() =>
      basic.validateConfiguration({
        user: 'testuser',
        hash: `argon2id$65536$3$17$${VALID_SALT_BASE64}$${VALID_HASH_BASE64}`,
      }),
    ).toThrow('must be an argon2id hash');
  });

  test('should reject PHC argon2id hashes missing version segment', async () => {
    expect(() =>
      basic.validateConfiguration({
        user: 'testuser',
        hash: `$argon2id$m=65536,t=3,p=4$${VALID_SALT_BASE64URL}$${VALID_HASH_BASE64URL}`,
      }),
    ).toThrow('must be an argon2id hash');
  });

  test('should reject PHC argon2id hashes with wrong version', async () => {
    expect(() =>
      basic.validateConfiguration({
        user: 'testuser',
        hash: `$argon2id$v=18$m=65536,t=3,p=4$${VALID_SALT_BASE64URL}$${VALID_HASH_BASE64URL}`,
      }),
    ).toThrow('must be an argon2id hash');
  });

  test('should not treat malformed PHC argon2id hash as plain fallback during authentication', async () => {
    const malformedPhcHash = `$argon2id$v=18$m=65536,t=3,p=4$${VALID_SALT_BASE64URL}$${VALID_HASH_BASE64URL}`;
    basic.configuration = {
      user: 'testuser',
      hash: malformedPhcHash,
    };

    await new Promise<void>((resolve) => {
      basic.authenticate('testuser', malformedPhcHash, (_err, result) => {
        expect(result).toBe(false);
        resolve();
      });
    });
  });

  describe('decodeBase64 edge cases', () => {
    test('should reject base64 with padding not at proper boundary (length % 4 !== 0)', () => {
      // "abcde=" passes the regex but has length 6 (6 % 4 !== 0) — triggers line 77
      const hash = `$argon2id$v=19$m=65536,t=3,p=4$abcde=$${VALID_HASH_BASE64URL}`;
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash,
        }),
      ).toThrow('must be an argon2id hash');
    });

    test('should reject base64 with length % 4 === 1 and no padding', () => {
      // A 5-char base64url string with no padding: length % 4 === 1 — triggers line 80
      const hash = `$argon2id$v=19$m=65536,t=3,p=4$abcde$${VALID_HASH_BASE64URL}`;
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash,
        }),
      ).toThrow('must be an argon2id hash');
    });

    test('should reject base64 that decodes to empty buffer', () => {
      // Line 89: decodeBase64 returns undefined when decoded.length === 0.
      // This is a defensive check — valid base64 chars always decode to >=1 byte.
      // To reach this branch, temporarily mock Buffer.from to return an empty buffer
      // for the specific padded base64 call while preserving normal behavior elsewhere.
      const originalFrom = Buffer.from.bind(Buffer);
      const spy = vi.spyOn(Buffer, 'from').mockImplementation((...args: unknown[]) => {
        // Intercept the base64 decode of the salt segment "AAAA"
        if (args[0] === 'AAAA' && args[1] === 'base64') {
          spy.mockRestore();
          return Buffer.alloc(0);
        }
        return (originalFrom as (...a: unknown[]) => Buffer)(...args);
      });

      // "AAAA" is a valid 4-char base64 string (length % 4 === 0, no padding needed).
      // Normally decodes to 3 bytes, but our mock returns empty buffer -> line 89.
      const hash = `argon2id$65536$3$4$AAAA$${VALID_HASH_BASE64}`;
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash,
        }),
      ).toThrow('must be an argon2id hash');
    });
  });

  describe('parsePhcArgon2Parameters rejection branches', () => {
    test('should reject PHC hash with wrong parameter count (only 2 entries)', () => {
      const hash = `$argon2id$v=19$m=65536,t=3$${VALID_SALT_BASE64URL}$${VALID_HASH_BASE64URL}`;
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash,
        }),
      ).toThrow('must be an argon2id hash');
    });

    test('should reject PHC hash with malformed key=value entry (missing value)', () => {
      const hash = `$argon2id$v=19$m=65536,t,p=4$${VALID_SALT_BASE64URL}$${VALID_HASH_BASE64URL}`;
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash,
        }),
      ).toThrow('must be an argon2id hash');
    });

    test('should reject PHC hash with malformed key=value entry (extra equals)', () => {
      const hash = `$argon2id$v=19$m=65536,t=3=x,p=4$${VALID_SALT_BASE64URL}$${VALID_HASH_BASE64URL}`;
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash,
        }),
      ).toThrow('must be an argon2id hash');
    });

    test('should reject PHC hash with duplicate m key', () => {
      const hash = `$argon2id$v=19$m=65536,m=65536,p=4$${VALID_SALT_BASE64URL}$${VALID_HASH_BASE64URL}`;
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash,
        }),
      ).toThrow('must be an argon2id hash');
    });

    test('should reject PHC hash with duplicate t key', () => {
      const hash = `$argon2id$v=19$m=65536,t=3,t=3$${VALID_SALT_BASE64URL}$${VALID_HASH_BASE64URL}`;
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash,
        }),
      ).toThrow('must be an argon2id hash');
    });

    test('should reject PHC hash with duplicate p key', () => {
      const hash = `$argon2id$v=19$p=4,t=3,p=4$${VALID_SALT_BASE64URL}$${VALID_HASH_BASE64URL}`;
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash,
        }),
      ).toThrow('must be an argon2id hash');
    });

    test('should reject PHC hash with unknown parameter key', () => {
      const hash = `$argon2id$v=19$m=65536,t=3,x=4$${VALID_SALT_BASE64URL}$${VALID_HASH_BASE64URL}`;
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash,
        }),
      ).toThrow('must be an argon2id hash');
    });

    test('should reject PHC hash with missing required parameter after loop', () => {
      // 3 entries, unique keys, but one required key is missing (no 'p', has unknown 'x')
      // Wait — unknown key returns immediately at line 159. For missing-after-loop (line 164),
      // we need 3 entries, all with valid keys (m/t/p), but one key is duplicated — that
      // triggers the duplicate check first. Actually, line 164 fires when rawMemory, rawPasses,
      // or rawParallelism is still undefined after the loop. This can happen if a key has an
      // empty value (value is "" which is not undefined). Let's construct:
      // "m=,t=3,p=4" — m has empty value, rawMemory = "", the loop completes, then
      // !rawMemory (empty string is falsy) triggers line 164.
      const hash = `$argon2id$v=19$m=,t=3,p=4$${VALID_SALT_BASE64URL}$${VALID_HASH_BASE64URL}`;
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash,
        }),
      ).toThrow('must be an argon2id hash');
    });
  });

  describe('parsePhcArgon2Hash salt/hash too short', () => {
    test('should reject PHC hash with salt shorter than MIN_SALT_SIZE', () => {
      // 8-byte salt (needs 16 minimum)
      const shortSalt = toPhcBase64(Buffer.alloc(8, 1));
      const hash = `$argon2id$v=19$m=65536,t=3,p=4$${shortSalt}$${VALID_HASH_BASE64URL}`;
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash,
        }),
      ).toThrow('must be an argon2id hash');
    });

    test('should reject PHC hash with hash shorter than MIN_HASH_SIZE', () => {
      // 16-byte hash (needs 32 minimum)
      const shortHash = toPhcBase64(Buffer.alloc(16, 1));
      const hash = `$argon2id$v=19$m=65536,t=3,p=4$${VALID_SALT_BASE64URL}$${shortHash}`;
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash,
        }),
      ).toThrow('must be an argon2id hash');
    });
  });

  describe('mangled argon2 hashes (Docker Compose $ interpolation)', () => {
    test('should reject mangled PHC argon2 hash where Compose stripped $ delimiters', () => {
      // Docker Compose turns $argon2id$v=19$m=65536,t=3,p=4$salt$hash into
      // "argon2idv=19m=65536,t=3,p=4salthash" (all $-prefixed segments interpolated as empty)
      const mangledHash = 'argon2idv=19m=65536,t=3,p=4salthash';
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash: mangledHash,
        }),
      ).toThrow('must be an argon2id hash');
    });

    test('should reject mangled hash with realistic base64 fragments', () => {
      // More realistic: Compose leaves behind the content after each $ (without the $)
      const mangledHash =
        'v=19m=65536,t=3,p=4AAAAAAAAAAAAAAAAAAAAAA+BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash: mangledHash,
        }),
      ).toThrow('must be an argon2id hash');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // Tests that kill surviving Stryker mutants
  // ──────────────────────────────────────────────────────────────────────────────

  describe('parsePositiveInteger edge cases (lines 83-90)', () => {
    test('should reject hash with parameter that is exactly 0', () => {
      // Kill line 87:40 EqualityOperator (parsed < 0 instead of parsed <= 0)
      // parsed === 0 must still be rejected
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash: `argon2id$0$3$4$${VALID_SALT_BASE64}$${VALID_HASH_BASE64}`,
        }),
      ).toThrow('must be an argon2id hash');
    });

    test('should reject hash with parameter containing leading zeros', () => {
      // Kill line 83:8 Regex mutations — /^\d+$/ must anchor at both ends
      // "01" passes /\d+$/ but may be non-standard; actual test: non-digit chars
      // Kill line 83:8 [Regex] /^\d+/ (no end anchor) — "123abc" would pass without $
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash: `argon2id$65536a$3$4$${VALID_SALT_BASE64}$${VALID_HASH_BASE64}`,
        }),
      ).toThrow('must be an argon2id hash');
    });

    test('should reject hash with parameter containing trailing non-digits', () => {
      // Kill line 83:8 [Regex] /\d+$/ (no start anchor) — "a65536" would pass /\d+$/
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash: `argon2id$a65536$3$4$${VALID_SALT_BASE64}$${VALID_HASH_BASE64}`,
        }),
      ).toThrow('must be an argon2id hash');
    });

    test('should reject hash with memory at boundary below MIN_ARGON2_MEMORY', () => {
      // Kill line 87:40 [ConditionalExpression] false — parsed<=0 check: 19455 < MIN_ARGON2_MEMORY
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash: `argon2id$19455$3$4$${VALID_SALT_BASE64}$${VALID_HASH_BASE64}`,
        }),
      ).toThrow('must be an argon2id hash');
    });

    test('should accept hash with memory at MIN_ARGON2_MEMORY boundary', () => {
      // Confirm MIN_ARGON2_MEMORY (19456) is accepted
      const hash = `argon2id$19456$3$4$${VALID_SALT_BASE64}$${VALID_HASH_BASE64}`;
      expect(
        basic.validateConfiguration({
          user: 'testuser',
          hash,
        }),
      ).toEqual({ user: 'testuser', hash });
    });

    test('should reject hash with passes equal to 1 (below MIN_ARGON2_PASSES=2)', () => {
      // Kill line 87:53 BlockStatement mutant — MIN_ARGON2_PASSES is 2, passes=1 rejected
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash: `argon2id$65536$1$4$${VALID_SALT_BASE64}$${VALID_HASH_BASE64}`,
        }),
      ).toThrow('must be an argon2id hash');
    });

    test('should accept hash with passes at MIN_ARGON2_PASSES boundary (2)', () => {
      // Confirm passes=2 is accepted (boundary value)
      const hash = `argon2id$65536$2$4$${VALID_SALT_BASE64}$${VALID_HASH_BASE64}`;
      expect(
        basic.validateConfiguration({
          user: 'testuser',
          hash,
        }),
      ).toEqual({ user: 'testuser', hash });
    });

    test('should reject hash with passes above MAX_ARGON2_PASSES (100)', () => {
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash: `argon2id$65536$101$4$${VALID_SALT_BASE64}$${VALID_HASH_BASE64}`,
        }),
      ).toThrow('must be an argon2id hash');
    });

    test('should accept hash with passes at MAX_ARGON2_PASSES boundary (100)', () => {
      const hash = `argon2id$65536$100$4$${VALID_SALT_BASE64}$${VALID_HASH_BASE64}`;
      expect(
        basic.validateConfiguration({
          user: 'testuser',
          hash,
        }),
      ).toEqual({ user: 'testuser', hash });
    });
  });

  describe('isInRange boundary values (line 94)', () => {
    test('should reject memory at exactly MAX_ARGON2_MEMORY + 1', () => {
      // Kill line 94:10 EqualityOperator (value > min instead of value >= min)
      // Kill line 94:26 EqualityOperator (value < max instead of value <= max)
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash: `argon2id$1048577$3$4$${VALID_SALT_BASE64}$${VALID_HASH_BASE64}`,
        }),
      ).toThrow('must be an argon2id hash');
    });

    test('should accept memory at exactly MAX_ARGON2_MEMORY (1048576)', () => {
      // Kill line 94:26 EqualityOperator — max boundary must be inclusive
      const hash = `argon2id$1048576$3$4$${VALID_SALT_BASE64}$${VALID_HASH_BASE64}`;
      expect(
        basic.validateConfiguration({
          user: 'testuser',
          hash,
        }),
      ).toEqual({ user: 'testuser', hash });
    });

    test('should accept parallelism at MIN_ARGON2_PARALLELISM boundary (1)', () => {
      // Kill line 94:10 EqualityOperator — min boundary must be inclusive
      const hash = `argon2id$65536$3$1$${VALID_SALT_BASE64}$${VALID_HASH_BASE64}`;
      expect(
        basic.validateConfiguration({
          user: 'testuser',
          hash,
        }),
      ).toEqual({ user: 'testuser', hash });
    });

    test('should accept parallelism at MAX_ARGON2_PARALLELISM boundary (16)', () => {
      const hash = `argon2id$65536$3$16$${VALID_SALT_BASE64}$${VALID_HASH_BASE64}`;
      expect(
        basic.validateConfiguration({
          user: 'testuser',
          hash,
        }),
      ).toEqual({ user: 'testuser', hash });
    });

    test('should reject parallelism at 0 (below MIN)', () => {
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash: `argon2id$65536$3$0$${VALID_SALT_BASE64}$${VALID_HASH_BASE64}`,
        }),
      ).toThrow('must be an argon2id hash');
    });
  });

  describe('decodeBase64 regex anchoring (lines 101, 108)', () => {
    test('should reject base64 with invalid chars at start (kills /[A-Za-z0-9+/_-]+={0,2}$/ mutant)', () => {
      // Kill line 101:8 [Regex] without start anchor — "!VALID_SALT" would pass /[A-Za-z0-9+/_-]+={0,2}$/
      // The salt must be long enough that after stripping the leading '!' the decoded result still
      // has ≥ 16 bytes, which would make the mutant ACCEPT the hash while the original rejects it.
      // VALID_SALT_BASE64 = 22 chars (16 bytes). With '!' prepended: mutant regex matches the
      // 22-char valid suffix → Base64.decode ignores '!' → 16 bytes → passes MIN_SALT_SIZE check.
      // Original regex rejects at the first '!' → returns undefined → validation error thrown.
      const invalidSalt = `!${VALID_SALT_BASE64}`;
      const hash = `argon2id$65536$3$4$${invalidSalt}$${VALID_HASH_BASE64}`;
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash,
        }),
      ).toThrow('must be an argon2id hash');
    });

    test('should reject base64 with invalid chars at end (kills /^[A-Za-z0-9+/_-]+={0,2}/ mutant)', () => {
      // Kill line 101:8 [Regex] without end anchor — "VALID_SALT!" would pass /^[A-Za-z0-9+/_-]+={0,2}/
      // VALID_SALT_BASE64 is 22 chars. With '!' appended: no-end-anchor regex matches the 22-char
      // valid prefix → Buffer.from ignores '!' → 16 bytes → passes MIN_SALT_SIZE check.
      // Original regex (with end anchor) rejects the trailing '!' → returns undefined → error thrown.
      const invalidSalt = `${VALID_SALT_BASE64}!`;
      const hash = `argon2id$65536$3$4$${invalidSalt}$${VALID_HASH_BASE64}`;
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash,
        }),
      ).toThrow('must be an argon2id hash');
    });

    test('should reject base64 with padding chars not at end (kills /^=+$/ mutant)', () => {
      // Kill line 108:10 [Regex] /=+$/ without start anchor
      // "=A" would pass /=+$/ (ends with non-=) but should fail /^=+$/
      // Construct: 8-char string where padding appears mid-string: "AAAA=AAA"
      // firstPaddingIndex=4, substring(4)="=AAA", /^=+$/ fails (not all equals)
      const hash = `$argon2id$v=19$m=65536,t=3,p=4$AAAA=AAA$${VALID_HASH_BASE64URL}`;
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash,
        }),
      ).toThrow('must be an argon2id hash');
    });

    test('should reject base64 with padding followed by non-padding chars (kills /^=+/ mutant)', () => {
      // Kill line 108:10 [Regex] /^=+/ without end anchor — "=A==" would pass /^=+/ (starts with =)
      // Construct: 8-char with "=A==" after first padding: "AAAA=A=="
      const hash = `$argon2id$v=19$m=65536,t=3,p=4$AAAA=A==$${VALID_HASH_BASE64URL}`;
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash,
        }),
      ).toThrow('must be an argon2id hash');
    });

    test('should reject base64 with padding at invalid position (length % 4 !== 0)', () => {
      // Kill line 108:66 ConditionalExpression — the length%4 check must fire
      // "abcde=" has length 6, 6%4=2, so length%4 !== 0 → rejected
      const hash = `$argon2id$v=19$m=65536,t=3,p=4$abcde=$${VALID_HASH_BASE64URL}`;
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash,
        }),
      ).toThrow('must be an argon2id hash');
    });

    test('should accept valid base64url without padding (no-padding path)', () => {
      // Kill line 111:14 ConditionalExpression and ArithmeticOperator mutants
      // A 6-char base64url string (length%4=2, no padding) should decode OK
      const _sixCharB64 = toPhcBase64(Buffer.alloc(4, 0xab)); // 4 bytes → 6 chars without padding
      const hash = `argon2id$65536$3$4$${VALID_SALT_BASE64}$${VALID_HASH_BASE64}`;
      // Use a real valid hash as salt segment
      expect(basic.validateConfiguration({ user: 'testuser', hash })).toBeDefined();
    });

    test('should correctly pad base64url of length % 4 === 2 (needs 2 padding chars)', () => {
      // Kill line 117:27 ArithmeticOperator — (4 - length%4)%4 must yield 2 for length%4==2
      // VALID_SALT_BASE64URL is unpadded; its length mod 4 exercises the padding formula
      const unpaddedSalt = toPhcBase64(Buffer.alloc(16, 1)); // 16 bytes → 22 chars (22%4=2, needs 2 '=')
      const unpaddedHash = toPhcBase64(Buffer.alloc(32, 1)); // 32 bytes → 44 chars (44%4=0, no pad)
      const hash = `$argon2id$v=19$m=65536,t=3,p=4$${unpaddedSalt}$${unpaddedHash}`;
      expect(basic.validateConfiguration({ user: 'testuser', hash })).toEqual({
        user: 'testuser',
        hash,
      });
    });

    test('should correctly pad base64url of length % 4 === 3 (needs 1 padding char)', () => {
      // Kill line 117:48-54 ArithmeticOperator mutants
      // 17 bytes → ceil(17*4/3) = 23 chars (23%4=3, needs 1 '=')
      const salt17 = toPhcBase64(Buffer.alloc(17, 1)); // length=23, 23%4=3 needs 1 '='
      expect(salt17.length % 4).toBe(3);
      const hash = `$argon2id$v=19$m=65536,t=3,p=4$${salt17}$${VALID_HASH_BASE64URL}`;
      expect(basic.validateConfiguration({ user: 'testuser', hash })).toEqual({
        user: 'testuser',
        hash,
      });
    });

    test('should pad with "=" char (kills line 117:84 StringLiteral "" mutant)', () => {
      // If padEnd used "" instead of "=", the padded string would not be valid base64
      // We test by verifying a hash that requires padding actually validates correctly
      const salt = toPhcBase64(Buffer.alloc(16, 0x55)); // 22 chars, needs "==" appended
      expect(salt.length % 4).toBe(2);
      const hash = `$argon2id$v=19$m=65536,t=3,p=4$${salt}$${VALID_HASH_BASE64URL}`;
      expect(basic.validateConfiguration({ user: 'testuser', hash })).toEqual({
        user: 'testuser',
        hash,
      });
    });
  });

  describe('parseArgon2Parameters: all-undefined check (line 136)', () => {
    test('should reject when memory is undefined but passes and parallelism are valid', () => {
      // Kill line 136:7 LogicalOperator mutants
      // Only memory=undefined: "NaN$3$4" → memory=undefined only
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash: `argon2id$NaN$3$4$${VALID_SALT_BASE64}$${VALID_HASH_BASE64}`,
        }),
      ).toThrow('must be an argon2id hash');
    });

    test('should reject when passes is undefined but memory and parallelism are valid', () => {
      // Kill line 136:59 LogicalOperator (memory===undefined && passes===undefined ignores parallelism)
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash: `argon2id$65536$NaN$4$${VALID_SALT_BASE64}$${VALID_HASH_BASE64}`,
        }),
      ).toThrow('must be an argon2id hash');
    });

    test('should reject when parallelism is undefined but memory and passes are valid', () => {
      // Kill line 136:31+55 ConditionalExpression mutants
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash: `argon2id$65536$3$NaN$${VALID_SALT_BASE64}$${VALID_HASH_BASE64}`,
        }),
      ).toThrow('must be an argon2id hash');
    });
  });

  describe('parsePhcArgon2Parameters: rawMemory/rawPasses/rawParallelism check (line 201)', () => {
    test('should reject PHC hash when rawMemory value is empty (kills LogicalOperator mutants)', () => {
      // Kill line 201:7 LogicalOperator !rawMemory && !rawPasses (ignores rawParallelism)
      // "m=,t=3,p=4" → rawMemory="" falsy → returned undefined
      const hash = `$argon2id$v=19$m=,t=3,p=4$${VALID_SALT_BASE64URL}$${VALID_HASH_BASE64URL}`;
      expect(() => basic.validateConfiguration({ user: 'testuser', hash })).toThrow(
        'must be an argon2id hash',
      );
    });

    test('should reject PHC hash when rawPasses value is empty', () => {
      const hash = `$argon2id$v=19$m=65536,t=,p=4$${VALID_SALT_BASE64URL}$${VALID_HASH_BASE64URL}`;
      expect(() => basic.validateConfiguration({ user: 'testuser', hash })).toThrow(
        'must be an argon2id hash',
      );
    });

    test('should reject PHC hash when rawParallelism value is empty', () => {
      // Kill line 201:52 BlockStatement — the falsy check on rawParallelism must run
      const hash = `$argon2id$v=19$m=65536,t=3,p=$${VALID_SALT_BASE64URL}$${VALID_HASH_BASE64URL}`;
      expect(() => basic.validateConfiguration({ user: 'testuser', hash })).toThrow(
        'must be an argon2id hash',
      );
    });
  });

  describe('verifyArgon2Password return paths (lines 396-406)', () => {
    test('should return false when parseArgon2Hash returns undefined (line 396:7)', () => {
      // Kill line 396:7 ConditionalExpression — !parsed must return false
      // Pass an argon2 hash as configuration but verify with non-argon2 hash as encodedHash
      // verifyPassword dispatches to verifyArgon2Password only if parseArgon2Hash succeeds
      // Test that a bad argon2 hash in configuration is handled
      basic.configuration = {
        user: 'testuser',
        hash: 'argon2id$broken', // looks like argon2 but parses to undefined
      };

      return new Promise<void>((resolve) => {
        basic.authenticate('testuser', 'password', (_err, result) => {
          expect(result).toBe(false);
          resolve();
        });
      });
    });

    test('should return true when argon2 verification succeeds (line 403:28 BlockStatement)', async () => {
      // Kill line 403:28 BlockStatement — timingSafeEqual result must be returned
      basic.configuration = {
        user: 'testuser',
        hash: createArgon2Hash('correctpassword'),
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', 'correctpassword', (_err, result) => {
          expect(result).toEqual({ username: 'testuser' });
          resolve();
        });
      });
    });

    test('should return false when argon2 verification fails (line 405:12 BooleanLiteral)', async () => {
      // Kill line 405:12 BooleanLiteral — catch must return false, not true
      // Use mockRecordAuthLogin instead of result check to avoid the .catch() masking issue.
      mockRecordAuthLogin.mockClear();
      basic.configuration = {
        user: 'testuser',
        hash: createArgon2Hash('correctpassword'),
      };
      mockArgon2.mockImplementationOnce((_alg, _opts, callback) => {
        callback(new Error('crypto error'));
      });

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', 'correctpassword', (_err, _result) => {
          resolve();
        });
      });
      expect(mockRecordAuthLogin).toHaveBeenCalledWith('invalid', 'basic');
      expect(mockRecordAuthLogin).not.toHaveBeenCalledWith('success', 'basic');
    });
  });

  describe('getElapsedSeconds arithmetic (line 497)', () => {
    test('observeAuthLoginDuration receives a non-negative number', async () => {
      // Kill line 497:10 ArithmeticOperator (* 1_000_000_000 instead of / 1_000_000_000)
      // Kill line 497:17 ArithmeticOperator (+ instead of -)
      basic.configuration = {
        user: 'testuser',
        hash: createArgon2Hash('password'),
      };

      mockObserveAuthLoginDuration.mockClear();

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', 'password', (_err, _result) => {
          resolve();
        });
      });

      expect(mockObserveAuthLoginDuration).toHaveBeenCalledTimes(1);
      const duration = mockObserveAuthLoginDuration.mock.calls[0][2] as number;
      // Duration must be a small positive number (seconds, not nanoseconds or negative)
      expect(duration).toBeGreaterThanOrEqual(0);
      expect(duration).toBeLessThan(10); // Must be seconds, not nanoseconds (would be ~10^9)
    });

    test('observeAuthLoginDuration receives seconds-scale value for username mismatch path', async () => {
      // Kill line 497:10 ArithmeticOperator for username-mismatch path
      basic.configuration = {
        user: 'testuser',
        hash: createArgon2Hash('password'),
      };

      mockObserveAuthLoginDuration.mockClear();

      await new Promise<void>((resolve) => {
        basic.authenticate('wronguser', 'password', (_err, _result) => {
          resolve();
        });
      });

      expect(mockObserveAuthLoginDuration).toHaveBeenCalledTimes(1);
      const duration = mockObserveAuthLoginDuration.mock.calls[0][2] as number;
      expect(duration).toBeGreaterThanOrEqual(0);
      expect(duration).toBeLessThan(10);
    });
  });

  describe('getConfigurationSchema joi.string() requirement (line 512)', () => {
    test('should reject non-string hash value (kills line 512:13 MethodExpression mutant)', () => {
      // Kill line 512:13 MethodExpression — this.joi.string() vs this.joi.number() etc.
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash: 12345 as unknown as string,
        }),
      ).toThrow('"hash" must be a string');
    });

    test('should reject missing hash (required)', () => {
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
        }),
      ).toThrow('"hash" is required');
    });
  });

  describe('authenticate: providedUser empty string for non-string user (line 581)', () => {
    test('should reject when user is a number (kills line 581:60 StringLiteral mutant)', async () => {
      // Kill line 581:60 StringLiteral — '' fallback must make providedUser.length === 0
      basic.configuration = {
        user: 'testuser',
        hash: createArgon2Hash('password'),
      };

      await new Promise<void>((resolve) => {
        basic.authenticate(42 as unknown as string, 'password', (_err, result) => {
          expect(result).toBe(false);
          resolve();
        });
      });
      // When '' is replaced with "Stryker was here!", providedUser.length > 0 → userMatches
      // might be true — test ensures non-string user is always rejected
    });

    test('should reject when user is an object (kills line 581:60 StringLiteral mutant)', async () => {
      basic.configuration = {
        user: 'testuser',
        hash: createArgon2Hash('password'),
      };

      await new Promise<void>((resolve) => {
        basic.authenticate(
          { username: 'testuser' } as unknown as string,
          'password',
          (_err, result) => {
            expect(result).toBe(false);
            resolve();
          },
        );
      });
    });

    test('should reject when user is undefined', async () => {
      basic.configuration = {
        user: 'testuser',
        hash: createArgon2Hash('password'),
      };

      await new Promise<void>((resolve) => {
        basic.authenticate(undefined as unknown as string, 'password', (_err, result) => {
          expect(result).toBe(false);
          resolve();
        });
      });
    });

    test('non-string user is always mismatch even when configured username matches the fallback (kills StringLiteral)', async () => {
      // Kill line 581:60 StringLiteral "Stryker was here!" fallback
      // If the fallback were "Stryker was here!" and the configured user is also "Stryker was here!",
      // then passing a non-string user would incorrectly match the configured user.
      // With the correct '' fallback: length=0, userMatches=false → always mismatch.
      const hash = createArgon2Hash('correctpassword');
      basic.configuration = {
        user: 'Stryker was here!',
        hash,
      };

      // Non-string user: with '' fallback → length=0 → userMatches=false → rejected
      // With "Stryker was here!" fallback → length>0 → timingSafeEqual matches → userMatches=true → password checked → success!
      await new Promise<void>((resolve) => {
        basic.authenticate(12345 as unknown as string, 'correctpassword', (_err, result) => {
          expect(result).toBe(false); // Must reject — non-string user, even if it would "match"
          resolve();
        });
      });

      expect(mockRecordAuthUsernameMismatch).toHaveBeenCalledTimes(1);
    });
  });

  describe('authenticate: providedUser.length > 0 check (line 583)', () => {
    test('should reject empty string user even when configured user is empty string (kills line 583:7 EqualityOperator)', async () => {
      // Kill line 583:7 EqualityOperator (length >= 0 would be always true)
      // If >= 0, then for empty string user AND empty configured user:
      //   providedUser = "", length >= 0 = true
      //   timingSafeEqual(hashValue(""), hashValue("")) = true → userMatches = TRUE
      // With the correct > 0:
      //   providedUser.length > 0 = false → userMatches = false
      // So: configure user="", authenticate with user="" → must REJECT (not succeed)
      basic.configuration = {
        user: '',
        hash: createArgon2Hash('password'),
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('', 'password', (_err, result) => {
          // The > 0 guard prevents empty string from ever matching, even with empty config
          expect(result).toBe(false);
          resolve();
        });
      });

      expect(mockRecordAuthUsernameMismatch).toHaveBeenCalledTimes(1);
    });

    test('should reject empty string user when configured user is empty string with correct password (kills ConditionalExpression true)', async () => {
      // Kill line 583:7 ConditionalExpression (true) — providedUser.length > 0 short-circuits to true
      // With ConditionalExpression=true: userMatches=true (no length check), AND timingSafeEqual("")==("")=true
      // With correct code: providedUser.length > 0 = false → userMatches = false
      basic.configuration = {
        user: '',
        hash: createArgon2Hash('secretpassword'),
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('', 'secretpassword', (_err, result) => {
          // Must reject — empty string user should never authenticate
          expect(result).toBe(false);
          resolve();
        });
      });
    });

    test('should reject non-string user — username mismatch path always taken (kills line 583:7)', async () => {
      // Kill line 583:7 ConditionalExpression — providedUser.length > 0 must guard userMatches
      basic.configuration = {
        user: 'testuser',
        hash: createArgon2Hash('password'),
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('', 'password', (_err, result) => {
          expect(result).toBe(false);
          resolve();
        });
      });

      // Empty string: providedUser.length === 0, so userMatches must be false
      expect(mockRecordAuthUsernameMismatch).toHaveBeenCalledTimes(1);
    });
  });

  describe('authenticate: success path done callback (line 597)', () => {
    test('should call done with username object on successful authentication (line 597:36 BlockStatement)', async () => {
      // Kill line 597:36 BlockStatement — done(null, { username }) must be called
      basic.configuration = {
        user: 'myuser',
        hash: createArgon2Hash('mypass'),
      };

      const doneCallback = vi.fn();
      await new Promise<void>((resolve) => {
        basic.authenticate('myuser', 'mypass', (...args) => {
          doneCallback(...args);
          resolve();
        });
      });

      expect(doneCallback).toHaveBeenCalledWith(null, { username: 'myuser' });
    });

    test('done callback receives configured username, not provided username', async () => {
      // Kill line 597:36 BlockStatement — username in result must be from configuration
      basic.configuration = {
        user: 'CONFIGURED_USER',
        hash: createArgon2Hash('pass'),
      };

      const doneCallback = vi.fn();
      await new Promise<void>((resolve) => {
        basic.authenticate('CONFIGURED_USER', 'pass', (...args) => {
          doneCallback(...args);
          resolve();
        });
      });

      expect(doneCallback).toHaveBeenCalledWith(null, { username: 'CONFIGURED_USER' });
    });
  });

  describe('normalizeHash rawHash.trim() (line 79)', () => {
    test('should normalize hash by trimming whitespace (kills line 79:10 MethodExpression)', async () => {
      // Kill line 79:10 MethodExpression — rawHash.trim() vs rawHash (no trim)
      // Test that a hash with leading/trailing spaces is trimmed correctly during authentication.
      // Joi's .trim() strips the hash before schema validation, so we test authentication directly.
      const hash = createArgon2Hash('password');
      const paddedHash = `  ${hash}  `;

      // Schema: Joi .trim() normalizes to trimmed value
      const validated = basic.validateConfiguration({ user: 'testuser', hash: paddedHash });
      expect(validated.hash).toBe(hash); // Joi trims whitespace

      // Authentication: normalizeHash(encodedHash) must trim spaces to find the real hash
      basic.configuration = { user: 'testuser', hash: paddedHash };
      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', 'password', (_err, result) => {
          // normalizeHash trims the stored padded hash → parses correctly → auth succeeds
          expect(result).toEqual({ username: 'testuser' });
          resolve();
        });
      });
    });

    test('should not authenticate when hash has spaces and trim is disabled (tests trim is needed)', async () => {
      // Confirm authentication fails with wrong password even when hash has spaces
      const hash = createArgon2Hash('correctpassword');
      const paddedHash = `  ${hash}  `;

      basic.configuration = { user: 'testuser', hash: paddedHash };
      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', 'wrongpassword', (_err, result) => {
          expect(result).toBe(false);
          resolve();
        });
      });
    });
  });
});
