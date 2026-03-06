var { mockTimingSafeEqual } = vi.hoisted(() => ({
  mockTimingSafeEqual: vi.fn(
    (left: Buffer, right: Buffer) => left.length === right.length && left.equals(right),
  ),
}));

vi.mock('node:crypto', async () => {
  const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto');
  return {
    ...actual,
    timingSafeEqual: mockTimingSafeEqual,
  };
});

import Basic from './Basic.js';

describe('Basic Authentication', () => {
  let basic;

  beforeEach(async () => {
    basic = new Basic();
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
      hash: '$2b$10$test.hash.value',
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
      hash: '$2b$10$test.hash.value',
    };
    const masked = basic.maskConfiguration();
    expect(masked.user).toBe('testuser');
    expect(masked.hash).toBe('$********************e');
  });

  test('should authenticate valid user', async () => {
    const { default: passJs } = await import('pass');
    basic.configuration = {
      user: 'testuser',
      hash: '$2b$10$test.hash.value',
    };

    passJs.validate = vi.fn((pass, hash, callback) => {
      callback(null, true);
    });

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
      hash: '$2b$10$test.hash.value',
    };

    await new Promise<void>((resolve) => {
      basic.authenticate('wronguser', 'password', (err, result) => {
        expect(result).toBe(false);
        resolve();
      });
    });
  });

  test('should compare usernames with timingSafeEqual', async () => {
    const { default: passJs } = await import('pass');
    basic.configuration = {
      user: 'testuser',
      hash: '$2b$10$test.hash.value',
    };
    passJs.validate = vi.fn();

    await new Promise<void>((resolve) => {
      basic.authenticate('wronguser', 'password', (err, result) => {
        expect(result).toBe(false);
        resolve();
      });
    });

    expect(mockTimingSafeEqual).toHaveBeenCalledTimes(1);
    expect(passJs.validate).not.toHaveBeenCalled();
  });

  test('should reject invalid password', async () => {
    const { default: passJs } = await import('pass');
    basic.configuration = {
      user: 'testuser',
      hash: '$2b$10$test.hash.value',
    };

    passJs.validate = vi.fn((pass, hash, callback) => {
      callback(null, false);
    });

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
      hash: '$2b$10$test.hash.value',
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
        hash: 'somehash',
      }),
    ).toEqual({
      user: 'testuser',
      hash: 'somehash',
    });
  });

  test('should throw on invalid configuration', async () => {
    expect(() => basic.validateConfiguration({})).toThrow('"user" is required');
  });

  test('should delegate authentication through strategy callback', async () => {
    const { default: passJs } = await import('pass');
    basic.configuration = {
      user: 'testuser',
      hash: '$2b$10$test.hash.value',
    };

    passJs.validate = vi.fn((pass, hash, callback) => {
      callback(null, true);
    });

    const strategy = basic.getStrategy();
    // The strategy stores the verify callback; invoke it to cover line 37
    await new Promise<void>((resolve) => {
      strategy._verify('testuser', 'password', (err, result) => {
        expect(result).toEqual({ username: 'testuser' });
        resolve();
      });
    });
  });
});
