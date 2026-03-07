var { mockScryptSync, mockTimingSafeEqual } = vi.hoisted(() => ({
  mockScryptSync: vi.fn(),
  mockTimingSafeEqual: vi.fn(
    (left: Buffer, right: Buffer) => left.length === right.length && left.equals(right),
  ),
}));

vi.mock('node:crypto', async () => {
  const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto');
  mockScryptSync.mockImplementation((password, salt, keylen, options) =>
    actual.scryptSync(password, salt, keylen, options),
  );
  return {
    ...actual,
    scryptSync: mockScryptSync,
    timingSafeEqual: mockTimingSafeEqual,
  };
});

import { scryptSync } from 'node:crypto';
import Basic from './Basic.js';

function createScryptHash(
  password: string,
  params: { N: number; r: number; p: number } = { N: 16384, r: 8, p: 1 },
) {
  const salt = Buffer.from('drydock-basic-auth-salt');
  const derived = scryptSync(password, salt, 64, params);
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

const VALID_SALT_BASE64 = Buffer.from('1234567890abcdef').toString('base64');
const VALID_HASH_BASE64 = Buffer.alloc(32, 1).toString('base64');

describe('Basic Authentication', () => {
  let basic;

  beforeEach(async () => {
    basic = new Basic();
    mockScryptSync.mockClear();
    mockTimingSafeEqual.mockClear();
  });

  test('should create instance', async () => {
    expect(basic).toBeDefined();
    expect(basic).toBeInstanceOf(Basic);
  });

  test('should return basic strategy', async () => {
    // Mock configuration to avoid validation errors
    basic.configuration = {
      user: 'testuser',
      hash: createScryptHash('password'),
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
      hash: createScryptHash('password'),
    };
    const masked = basic.maskConfiguration();
    expect(masked.user).toBe('testuser');
    expect(masked.hash).toBe('[REDACTED]');
  });

  test('should authenticate valid user', async () => {
    basic.configuration = {
      user: 'testuser',
      hash: createScryptHash('password'),
    };

    await new Promise<void>((resolve) => {
      basic.authenticate('testuser', 'password', (err, result) => {
        expect(result).toEqual({ username: 'testuser' });
        resolve();
      });
    });
  });

  test('should reject invalid user', async () => {
    basic.configuration = {
      user: 'testuser',
      hash: createScryptHash('password'),
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
      hash: createScryptHash('password'),
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
      hash: createScryptHash('password'),
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
      hash: createScryptHash('password'),
    };

    await new Promise<void>((resolve) => {
      basic.authenticate(null, 'password', (err, result) => {
        expect(result).toBe(false);
        resolve();
      });
    });
  });

  test('should validate configuration schema', async () => {
    expect(
      basic.validateConfiguration({
        user: 'testuser',
        hash: createScryptHash('password'),
      }),
    ).toEqual({
      user: 'testuser',
      hash: createScryptHash('password'),
    });
  });

  test('should throw on invalid configuration', async () => {
    expect(() => basic.validateConfiguration({})).toThrow('"user" is required');
  });

  test('should delegate authentication through strategy callback', async () => {
    basic.configuration = {
      user: 'testuser',
      hash: createScryptHash('password'),
    };

    const strategy = basic.getStrategy();
    // The strategy stores the verify callback; invoke it to cover line 37
    await new Promise<void>((resolve) => {
      strategy._verify('testuser', 'password', (err, result) => {
        expect(result).toEqual({ username: 'testuser' });
        resolve();
      });
    });
  });

  test('should reject legacy SHA-1 hash format', async () => {
    basic.configuration = {
      user: 'testuser',
      hash: '{SHA}W6ph5Mm5Pz8GgiULbPgzG37mj9g=',
    };

    await new Promise<void>((resolve) => {
      basic.authenticate('testuser', 'password', (err, result) => {
        expect(result).toBe(false);
        resolve();
      });
    });
  });

  test('should reject scrypt hashes with empty base64 segments', async () => {
    expect(() =>
      basic.validateConfiguration({
        user: 'testuser',
        hash: `scrypt$16384$8$1$$${VALID_HASH_BASE64}`,
      }),
    ).toThrow('must be a scrypt hash');
  });

  test('should reject scrypt hashes with malformed base64 segments', async () => {
    expect(() =>
      basic.validateConfiguration({
        user: 'testuser',
        hash: `scrypt$16384$8$1$not*base64$${VALID_HASH_BASE64}`,
      }),
    ).toThrow('must be a scrypt hash');
  });

  test('should reject scrypt hashes with invalid parameter ranges', async () => {
    expect(() =>
      basic.validateConfiguration({
        user: 'testuser',
        hash: `scrypt$1024$8$1$${VALID_SALT_BASE64}$${VALID_HASH_BASE64}`,
      }),
    ).toThrow('must be a scrypt hash');
  });

  test('should reject scrypt hashes with non-numeric parameters', async () => {
    expect(() =>
      basic.validateConfiguration({
        user: 'testuser',
        hash: `scrypt$NaN$8$1$${VALID_SALT_BASE64}$${VALID_HASH_BASE64}`,
      }),
    ).toThrow('must be a scrypt hash');
  });

  test('should reject scrypt hashes with non-positive parameters', async () => {
    expect(() =>
      basic.validateConfiguration({
        user: 'testuser',
        hash: `scrypt$16384$0$1$${VALID_SALT_BASE64}$${VALID_HASH_BASE64}`,
      }),
    ).toThrow('must be a scrypt hash');
  });

  test('should reject authentication when scrypt derivation fails', async () => {
    basic.configuration = {
      user: 'testuser',
      hash: createScryptHash('password'),
    };
    mockScryptSync.mockImplementationOnce(() => {
      throw new Error('scrypt unavailable');
    });

    await new Promise<void>((resolve) => {
      basic.authenticate('testuser', 'password', (_err, result) => {
        expect(result).toBe(false);
        resolve();
      });
    });
  });
});
