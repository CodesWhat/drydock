var { mockArgon2, mockArgon2Sync, mockTimingSafeEqual } = vi.hoisted(() => ({
  mockArgon2: vi.fn(),
  mockArgon2Sync: vi.fn(),
  mockTimingSafeEqual: vi.fn(
    (left: Buffer, right: Buffer) => left.length === right.length && left.equals(right),
  ),
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
const UNSUPPORTED_BCRYPT_HASH = '$2b$10$123456789012345678901u8Q4W2nLw8Qm7w7fA9sQ3lV7qVQX0w2.';

describe('Basic Authentication', () => {
  let basic: InstanceType<typeof Basic>;

  beforeEach(async () => {
    basic = new Basic();
    mockArgon2.mockClear();
    mockArgon2Sync.mockClear();
    mockTimingSafeEqual.mockClear();
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

  describe('legacy v1.3.9 hash support', () => {
    test('should accept SHA-1 hash in configuration schema', async () => {
      const hash = createShaHash('password');
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

    test('should authenticate valid user with SHA-1 hash', async () => {
      basic.configuration = {
        user: 'testuser',
        hash: createShaHash('password'),
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', 'password', (err, result) => {
          expect(result).toEqual({ username: 'testuser' });
          resolve();
        });
      });
    });

    test('should reject invalid password with SHA-1 hash', async () => {
      basic.configuration = {
        user: 'testuser',
        hash: createShaHash('password'),
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', 'wrongpassword', (err, result) => {
          expect(result).toBe(false);
          resolve();
        });
      });
    });

    test('should use timingSafeEqual for SHA-1 comparison', async () => {
      basic.configuration = {
        user: 'testuser',
        hash: createShaHash('password'),
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', 'password', (_err, _result) => {
          resolve();
        });
      });

      // First call is username comparison, second is SHA-1 hash comparison
      expect(mockTimingSafeEqual).toHaveBeenCalledTimes(2);
    });

    test('should accept case-insensitive {sha} prefix', async () => {
      const digest = createHash('sha1').update('password').digest();
      const hash = `{sha}${digest.toString('base64')}`;

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

    test('should authenticate with case-insensitive {sha} prefix', async () => {
      const digest = createHash('sha1').update('password').digest();
      basic.configuration = {
        user: 'testuser',
        hash: `{sha}${digest.toString('base64')}`,
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', 'password', (err, result) => {
          expect(result).toEqual({ username: 'testuser' });
          resolve();
        });
      });
    });

    test('should accept SHA-1 hash with invalid digest length in schema but reject authentication', async () => {
      const shortDigest = Buffer.alloc(10, 1).toString('base64');

      expect(
        basic.validateConfiguration({
          user: 'testuser',
          hash: `{SHA}${shortDigest}`,
        }),
      ).toEqual({
        user: 'testuser',
        hash: `{SHA}${shortDigest}`,
      });

      basic.configuration = {
        user: 'testuser',
        hash: `{SHA}${shortDigest}`,
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', 'password', (_err, result) => {
          expect(result).toBe(false);
          resolve();
        });
      });
    });

    test('should accept SHA-1 hash with malformed base64 in schema but reject authentication', async () => {
      expect(
        basic.validateConfiguration({
          user: 'testuser',
          hash: '{SHA}not*valid*base64',
        }),
      ).toEqual({
        user: 'testuser',
        hash: '{SHA}not*valid*base64',
      });

      basic.configuration = {
        user: 'testuser',
        hash: '{SHA}not*valid*base64',
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', 'password', (_err, result) => {
          expect(result).toBe(false);
          resolve();
        });
      });
    });

    test('should reject when SHA hash parsing fails during verification', async () => {
      const validHash = createShaHash('password');
      let substringCallCount = 0;
      const flakyHash = {
        length: validHash.length,
        split: () => ['not-argon2'],
        substring(start: number, end?: number) {
          substringCallCount += 1;
          if (substringCallCount === 1) {
            return '{SHA}';
          }
          if (substringCallCount === 2) {
            return validHash.substring(start, end);
          }
          return 'invalid-prefix';
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

    test('should reject SHA-1 authentication when digest generation throws', async () => {
      const hash = createShaHash('password');
      const cryptoModule = await import('node:crypto');
      const originalCreateHash = cryptoModule.createHash.bind(cryptoModule);
      let createHashCallCount = 0;
      const createHashSpy = vi.spyOn(cryptoModule, 'createHash').mockImplementation((...args) => {
        createHashCallCount += 1;
        // authenticate() hashes usernames twice before hashing the password digest.
        if (createHashCallCount === 3) {
          throw new Error('sha1 unavailable');
        }
        return originalCreateHash(...args);
      });

      basic.configuration = {
        user: 'testuser',
        hash,
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', 'password', (_err, result) => {
          expect(result).toBe(false);
          resolve();
        });
      });

      createHashSpy.mockRestore();
    });

    test('should accept APR1 hash in configuration schema', async () => {
      expect(
        basic.validateConfiguration({
          user: 'testuser',
          hash: LEGACY_APR1_HASH,
        }),
      ).toEqual({
        user: 'testuser',
        hash: LEGACY_APR1_HASH,
      });
    });

    test('should authenticate valid user with APR1 hash', async () => {
      basic.configuration = {
        user: 'testuser',
        hash: LEGACY_APR1_HASH,
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', 'myPassword', (_err, result) => {
          expect(result).toEqual({ username: 'testuser' });
          resolve();
        });
      });
    });

    test('should reject invalid password with APR1 hash', async () => {
      basic.configuration = {
        user: 'testuser',
        hash: LEGACY_APR1_HASH,
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', 'wrongpassword', (_err, result) => {
          expect(result).toBe(false);
          resolve();
        });
      });
    });

    test('should accept $1$ MD5 hash in configuration schema', async () => {
      expect(
        basic.validateConfiguration({
          user: 'testuser',
          hash: LEGACY_MD5_HASH,
        }),
      ).toEqual({
        user: 'testuser',
        hash: LEGACY_MD5_HASH,
      });
    });

    test('should authenticate valid user with $1$ MD5 hash', async () => {
      basic.configuration = {
        user: 'testuser',
        hash: LEGACY_MD5_HASH,
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', 'myPassword', (_err, result) => {
          expect(result).toEqual({ username: 'testuser' });
          resolve();
        });
      });
    });

    test('should reject invalid password with $1$ MD5 hash', async () => {
      basic.configuration = {
        user: 'testuser',
        hash: LEGACY_MD5_HASH,
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', 'wrongpassword', (_err, result) => {
          expect(result).toBe(false);
          resolve();
        });
      });
    });

    test('should accept crypt hash in configuration schema', async () => {
      expect(
        basic.validateConfiguration({
          user: 'testuser',
          hash: LEGACY_CRYPT_HASH,
        }),
      ).toEqual({
        user: 'testuser',
        hash: LEGACY_CRYPT_HASH,
      });
    });

    test('should authenticate valid user with crypt hash', async () => {
      basic.configuration = {
        user: 'testuser',
        hash: LEGACY_CRYPT_HASH,
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', 'myPassword', (_err, result) => {
          expect(result).toEqual({ username: 'testuser' });
          resolve();
        });
      });
    });

    test('should reject invalid password with crypt hash', async () => {
      basic.configuration = {
        user: 'testuser',
        hash: LEGACY_CRYPT_HASH,
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', 'wrongpassword', (_err, result) => {
          expect(result).toBe(false);
          resolve();
        });
      });
    });

    test('should accept plain hash fallback in configuration schema', async () => {
      expect(
        basic.validateConfiguration({
          user: 'testuser',
          hash: LEGACY_PLAIN_HASH,
        }),
      ).toEqual({
        user: 'testuser',
        hash: LEGACY_PLAIN_HASH,
      });
    });

    test('should authenticate valid user with plain hash fallback', async () => {
      basic.configuration = {
        user: 'testuser',
        hash: LEGACY_PLAIN_HASH,
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', LEGACY_PLAIN_HASH, (_err, result) => {
          expect(result).toEqual({ username: 'testuser' });
          resolve();
        });
      });
    });

    test('should reject invalid password with plain hash fallback', async () => {
      basic.configuration = {
        user: 'testuser',
        hash: LEGACY_PLAIN_HASH,
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', 'wrongpassword', (_err, result) => {
          expect(result).toBe(false);
          resolve();
        });
      });
    });

    test('should reject bcrypt-style hash in configuration schema', async () => {
      expect(() =>
        basic.validateConfiguration({
          user: 'testuser',
          hash: UNSUPPORTED_BCRYPT_HASH,
        }),
      ).toThrow('must be an argon2id hash');
    });

    test('should not treat bcrypt-style hash as plain fallback during authentication', async () => {
      basic.configuration = {
        user: 'testuser',
        hash: UNSUPPORTED_BCRYPT_HASH,
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', UNSUPPORTED_BCRYPT_HASH, (_err, result) => {
          expect(result).toBe(false);
          resolve();
        });
      });
    });

    test('should classify md5, crypt, plain and unsupported hashes in metadata', () => {
      basic.configuration = {
        user: 'testuser',
        hash: LEGACY_MD5_HASH,
      };
      expect(basic.getMetadata()).toEqual({ usesLegacyHash: true });

      basic.configuration = {
        user: 'testuser',
        hash: LEGACY_CRYPT_HASH,
      };
      expect(basic.getMetadata()).toEqual({ usesLegacyHash: true });

      basic.configuration = {
        user: 'testuser',
        hash: LEGACY_PLAIN_HASH,
      };
      expect(basic.getMetadata()).toEqual({ usesLegacyHash: true });

      basic.configuration = {
        user: 'testuser',
        hash: UNSUPPORTED_BCRYPT_HASH,
      };
      expect(basic.getMetadata()).toEqual({ usesLegacyHash: false });
    });

    test('should treat malformed SHA/APR1 prefixes as plain legacy metadata', () => {
      basic.configuration = {
        user: 'testuser',
        hash: '{SHA}',
      };
      expect(basic.getMetadata()).toEqual({ usesLegacyHash: true });

      basic.configuration = {
        user: 'testuser',
        hash: '$apr1$',
      };
      expect(basic.getMetadata()).toEqual({ usesLegacyHash: true });

      basic.configuration = {
        user: 'testuser',
        hash: '$apr1$$broken',
      };
      expect(basic.getMetadata()).toEqual({ usesLegacyHash: true });
    });

    test('should reject authentication when argon2 hash cannot be parsed during verification', async () => {
      const validArgon2Parts = createArgon2Hash('password').split('$');
      let splitCallCount = 0;
      const flakyArgon2Hash = {
        trim() {
          return this as unknown as string;
        },
        split(_separator: string) {
          splitCallCount += 1;
          return splitCallCount === 1 ? validArgon2Parts : ['argon2id'];
        },
      } as unknown as string;

      basic.configuration = {
        user: 'testuser',
        hash: flakyArgon2Hash,
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', 'password', (_err, result) => {
          expect(result).toBe(false);
          resolve();
        });
      });
    });

    test('should reject authentication when SHA hash becomes invalid during verification', async () => {
      const validShaHash = createShaHash('password');
      let substringCallCount = 0;
      const flakyShaHash = {
        trim() {
          return this as unknown as string;
        },
        split() {
          return ['not-argon2'];
        },
        get length() {
          return validShaHash.length;
        },
        substring(start: number, end?: number) {
          if (start === 0 && end === 5) {
            return '{SHA}';
          }
          substringCallCount += 1;
          return substringCallCount === 1 ? validShaHash.substring(5) : '';
        },
      } as unknown as string;

      basic.configuration = {
        user: 'testuser',
        hash: flakyShaHash,
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', 'password', (_err, result) => {
          expect(result).toBe(false);
          resolve();
        });
      });
    });

    test('should reject authentication when MD5 hash becomes invalid during verification', async () => {
      let splitCallCount = 0;
      const flakyMd5Hash = {
        trim() {
          return this as unknown as string;
        },
        split() {
          splitCallCount += 1;
          if (splitCallCount === 1) {
            return ['not-argon2'];
          }
          if (splitCallCount === 2) {
            return LEGACY_MD5_HASH.split('$');
          }
          return ['', '1'];
        },
        get length() {
          return 4;
        },
        startsWith(prefix: string) {
          return prefix === '$1$';
        },
      } as unknown as string;

      basic.configuration = {
        user: 'testuser',
        hash: flakyMd5Hash,
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', 'password', (_err, result) => {
          expect(result).toBe(false);
          resolve();
        });
      });
    });

    test('should reject authentication when APR1/MD5 verification throws', async () => {
      const throwingPassword = {
        [Symbol.toPrimitive]() {
          throw new Error('password coercion failed');
        },
      } as unknown as string;

      basic.configuration = {
        user: 'testuser',
        hash: LEGACY_MD5_HASH,
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', throwingPassword, (_err, result) => {
          expect(result).toBe(false);
          resolve();
        });
      });
    });

    test('should reject authentication when crypt hash becomes invalid during verification', async () => {
      let lengthReadCount = 0;
      const flakyCryptHash = {
        trim() {
          return this as unknown as string;
        },
        split() {
          return ['not-argon2'];
        },
        get length() {
          lengthReadCount += 1;
          return lengthReadCount === 3 ? 12 : 13;
        },
        substring(start: number, end?: number) {
          if (start === 0 && end === 5) {
            return 'crypt';
          }
          return LEGACY_CRYPT_HASH.substring(start, end);
        },
        startsWith() {
          return false;
        },
      } as unknown as string;

      basic.configuration = {
        user: 'testuser',
        hash: flakyCryptHash,
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', 'password', (_err, result) => {
          expect(result).toBe(false);
          resolve();
        });
      });
    });

    test('should reject authentication when crypt verification throws', async () => {
      const throwingPassword = new Proxy(
        {},
        {
          get() {
            throw new Error('password coercion failed');
          },
        },
      ) as unknown as string;

      basic.configuration = {
        user: 'testuser',
        hash: LEGACY_CRYPT_HASH,
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', throwingPassword, (_err, result) => {
          expect(result).toBe(false);
          resolve();
        });
      });
    });

    test('should reject authentication when plain comparison coercion throws', async () => {
      const throwingPassword = {
        [Symbol.toPrimitive]() {
          throw new Error('password coercion failed');
        },
      } as unknown as string;

      basic.configuration = {
        user: 'testuser',
        hash: LEGACY_PLAIN_HASH,
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', throwingPassword, (_err, result) => {
          expect(result).toBe(false);
          resolve();
        });
      });
    });

    test('should reject authentication when timingSafeEqual throws during password comparison', async () => {
      mockTimingSafeEqual
        .mockImplementationOnce(
          (left: Buffer, right: Buffer) => left.length === right.length && left.equals(right),
        )
        .mockImplementationOnce(() => {
          throw new Error('timingSafeEqual failed');
        });

      basic.configuration = {
        user: 'testuser',
        hash: LEGACY_PLAIN_HASH,
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', LEGACY_PLAIN_HASH, (_err, result) => {
          expect(result).toBe(false);
          resolve();
        });
      });
    });
  });

  describe('getMetadata', () => {
    test('should return usesLegacyHash: false for argon2id hash', () => {
      basic.configuration = {
        user: 'testuser',
        hash: createArgon2Hash('password'),
      };
      expect(basic.getMetadata()).toEqual({ usesLegacyHash: false });
    });

    test('should return usesLegacyHash: true for SHA-1 hash', () => {
      basic.configuration = {
        user: 'testuser',
        hash: createShaHash('password'),
      };
      expect(basic.getMetadata()).toEqual({ usesLegacyHash: true });
    });

    test('should return usesLegacyHash: true for APR1 hash', () => {
      basic.configuration = {
        user: 'testuser',
        hash: LEGACY_APR1_HASH,
      };
      expect(basic.getMetadata()).toEqual({ usesLegacyHash: true });
    });
  });

  describe('initAuthentication', () => {
    test('should log deprecation warning when SHA-1 hash is registered', () => {
      const warnFn = vi.fn();
      basic.log = { warn: warnFn, info: vi.fn(), debug: vi.fn(), error: vi.fn() } as any;
      basic.configuration = {
        user: 'testuser',
        hash: createShaHash('password'),
      };

      basic.initAuthentication();

      expect(warnFn).toHaveBeenCalledWith(
        expect.stringContaining('Legacy password hash format detected (sha1)'),
      );
    });

    test('should log deprecation warning when APR1 hash is registered', () => {
      const warnFn = vi.fn();
      basic.log = { warn: warnFn, info: vi.fn(), debug: vi.fn(), error: vi.fn() } as any;
      basic.configuration = {
        user: 'testuser',
        hash: LEGACY_APR1_HASH,
      };

      basic.initAuthentication();

      expect(warnFn).toHaveBeenCalledWith(
        expect.stringContaining('Legacy password hash format detected (apr1)'),
      );
    });

    test('should not log warning when argon2id hash is registered', () => {
      const warnFn = vi.fn();
      basic.log = { warn: warnFn, info: vi.fn(), debug: vi.fn(), error: vi.fn() } as any;
      basic.configuration = {
        user: 'testuser',
        hash: createArgon2Hash('password'),
      };

      basic.initAuthentication();

      expect(warnFn).not.toHaveBeenCalled();
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

  describe('getLegacyHashFormat malformed argon2id prefix', () => {
    test('should not treat malformed Drydock argon2id hash as plain fallback', () => {
      // Starts with "argon2id$" so looksLikeArgon2Hash returns true, but parsing fails
      const malformedDrydockHash = `argon2id$broken`;
      basic.configuration = {
        user: 'testuser',
        hash: malformedDrydockHash,
      };
      // getMetadata uses isLegacyHash -> getLegacyHashFormat which returns undefined for
      // hashes that look like argon2 but fail parsing — so usesLegacyHash should be false
      expect(basic.getMetadata()).toEqual({ usesLegacyHash: false });
    });

    test('should not treat malformed PHC argon2id hash as plain fallback', () => {
      // Starts with "$argon2id$" but has wrong structure
      const malformedPhcHash = `$argon2id$garbage`;
      basic.configuration = {
        user: 'testuser',
        hash: malformedPhcHash,
      };
      expect(basic.getMetadata()).toEqual({ usesLegacyHash: false });
    });

    test('should reject authentication against malformed Drydock argon2id hash', async () => {
      basic.configuration = {
        user: 'testuser',
        hash: `argon2id$broken`,
      };

      await new Promise<void>((resolve) => {
        basic.authenticate('testuser', 'password', (_err, result) => {
          expect(result).toBe(false);
          resolve();
        });
      });
    });
  });

  describe('verifyShaPassword and verifyMd5Password undefined parse results', () => {
    test('should reject SHA authentication when parseShaHash returns undefined on second call', async () => {
      // Line 362: verifyShaPassword is called but its internal parseShaHash returns undefined.
      // verifyPassword calls normalizeHash -> trim() on the hash, then uses the result for
      // all dispatch checks. If trim() returns `this` (the proxy), we can control substring()
      // calls to make the first parseShaHash succeed and the second (inside verifyShaPassword) fail.
      //
      // Call trace through proxy:
      //   verifyPassword -> normalizeHash -> trim() [returns self]
      //   parseArgon2Hash -> normalizeHash -> trim() [returns self]
      //     parseDrydockArgon2Hash -> split('$') [returns non-argon2]
      //     parsePhcArgon2Hash -> split('$') [returns non-argon2]
      //   looksLikeArgon2Hash -> normalizeHash -> trim() [returns self]
      //     startsWith('argon2id$') -> false
      //     startsWith('$argon2id$') -> false
      //   parseShaHash (dispatch) -> normalizeHash -> trim() [returns self]
      //     substring(0,5) -> '{SHA}', substring(5) -> valid 20-byte base64
      //   verifyShaPassword -> parseShaHash -> normalizeHash -> trim() [returns self]
      //     substring(0,5) -> '{SHA}', substring(5) -> '' (fails !encoded check)
      const validSha20 = Buffer.alloc(20, 1).toString('base64');
      let substringFromFiveCount = 0;
      const flakyHash = {
        trim() {
          return this;
        },
        split() {
          return ['not-argon2'];
        },
        startsWith() {
          return false;
        },
        get length() {
          return 100;
        },
        substring(start: number, end?: number) {
          if (start === 0 && end === 5) {
            return '{SHA}';
          }
          if (start === 5) {
            substringFromFiveCount += 1;
            // First call (dispatch check): return valid base64 of 20 bytes
            if (substringFromFiveCount === 1) {
              return validSha20;
            }
            // Second call (inside verifyShaPassword): return empty -> parseShaHash returns undefined
            return '';
          }
          return '';
        },
        toLowerCase() {
          return '{sha}';
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

    test('should reject MD5 authentication when parseMd5Hash returns undefined on second call', async () => {
      // Line 376: verifyMd5Password is called but its internal parseMd5Hash returns undefined.
      // Same proxy strategy: trim() returns self so we control all method calls.
      //
      // parseMd5Hash checks:
      //   normalizeHash -> trim() [returns self]
      //   startsWith('$apr1$') or startsWith('$1$') -> needs true
      //   split('$') -> needs >= 4 parts with variant='1' and valid salt
      //
      // On second call inside verifyMd5Password, split('$') returns < 4 parts.
      let splitDollarCount = 0;
      const flakyHash = {
        trim() {
          return this;
        },
        split(separator: string) {
          if (separator === '$') {
            splitDollarCount += 1;
            // parseDrydockArgon2Hash & parsePhcArgon2Hash also call split('$')
            // Calls 1-2: argon2 checks -> return non-argon2
            if (splitDollarCount <= 2) {
              return ['not-argon2'];
            }
            // parseShaHash does NOT call split — it uses substring.
            // parseMd5Hash calls split('$'):
            // Call 3 (dispatch check): return valid MD5 parts
            if (splitDollarCount === 3) {
              return LEGACY_MD5_HASH.split('$');
            }
            // Call 4 (inside verifyMd5Password): return too few parts -> undefined
            return ['', '1'];
          }
          return ['not-argon2'];
        },
        startsWith(prefix: string) {
          // For looksLikeArgon2Hash
          if (prefix === 'argon2id$' || prefix === '$argon2id$') {
            return false;
          }
          // For parseMd5Hash: $1$ or $apr1$
          return prefix === '$1$';
        },
        get length() {
          return 4;
        },
        substring(start: number, end?: number) {
          // parseShaHash calls substring(0, 5) — needs to NOT match {sha}
          if (start === 0 && end === 5) {
            return '$1$sa';
          }
          return '';
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
  });
});
