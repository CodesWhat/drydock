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

function createArgon2Hash(
  password: string,
  params: { memory: number; passes: number; parallelism: number } = {
    memory: 65536,
    passes: 3,
    parallelism: 4,
  },
) {
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

function createShaHash(password: string) {
  const digest = createHash('sha1').update(password).digest();
  return `{SHA}${digest.toString('base64')}`;
}

const VALID_SALT_BASE64 = Buffer.alloc(16, 1).toString('base64');
const VALID_HASH_BASE64 = Buffer.alloc(32, 1).toString('base64');
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

    expect(mockTimingSafeEqual).toHaveBeenCalledTimes(1);
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
});
