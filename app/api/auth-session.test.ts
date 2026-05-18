const {
  mockLog,
  enforceConcurrentSessionLimitMock,
  mockGetStoredSessionSecret,
  mockSetStoredSessionSecret,
} = vi.hoisted(() => ({
  mockLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  enforceConcurrentSessionLimitMock: vi.fn().mockResolvedValue(undefined),
  mockGetStoredSessionSecret: vi.fn(() => null as string | null),
  mockSetStoredSessionSecret: vi.fn(),
}));

vi.mock('../log/index.js', () => ({
  default: mockLog,
}));

vi.mock('../util/session-limit.js', () => ({
  enforceConcurrentSessionLimit: enforceConcurrentSessionLimitMock,
}));

vi.mock('../store/secrets.js', () => ({
  getStoredSessionSecret: mockGetStoredSessionSecret,
  setStoredSessionSecret: mockSetStoredSessionSecret,
}));

import log from '../log/index.js';
import { enforceConcurrentSessionLimit } from '../util/session-limit.js';
import {
  configureSessionLimits,
  DEFAULT_SESSION_DAYS,
  deserializeSessionUser,
  enforceSessionLimitBeforeLogin,
  getCookieMaxAge,
  getSessionSecretKey,
  REMEMBER_ME_DAYS,
  testable_basicSessionLocks,
  testable_withBasicSessionLock,
} from './auth-session.js';

describe('getCookieMaxAge', () => {
  test('computes cookie max age for default session days', () => {
    const result = getCookieMaxAge(DEFAULT_SESSION_DAYS);
    // 7 days in milliseconds: 3600 * 1000 * 24 * 7
    expect(result).toBe(3600 * 1000 * 24 * DEFAULT_SESSION_DAYS);
  });

  test('computes cookie max age for remember-me days', () => {
    const result = getCookieMaxAge(REMEMBER_ME_DAYS);
    expect(result).toBe(3600 * 1000 * 24 * REMEMBER_ME_DAYS);
  });

  test('returns a larger value for remember-me than default session', () => {
    expect(getCookieMaxAge(REMEMBER_ME_DAYS)).toBeGreaterThan(
      getCookieMaxAge(DEFAULT_SESSION_DAYS),
    );
  });
});

describe('deserializeSessionUser', () => {
  test('throws when input is not a string', () => {
    expect(() => deserializeSessionUser(42)).toThrow('Serialized user must be a JSON string');
    expect(() => deserializeSessionUser(null)).toThrow('Serialized user must be a JSON string');
    expect(() => deserializeSessionUser(undefined)).toThrow(
      'Serialized user must be a JSON string',
    );
    expect(() => deserializeSessionUser({ username: 'alice' })).toThrow(
      'Serialized user must be a JSON string',
    );
  });

  test('throws when input is malformed JSON', () => {
    expect(() => deserializeSessionUser('not-json')).toThrow('Serialized user JSON is malformed');
  });

  test('throws when parsed value fails schema validation (missing username)', () => {
    expect(() => deserializeSessionUser('{}')).toThrow();
  });

  test('throws when convert is effectively false: numeric username is rejected', () => {
    // If convert were true, Joi would coerce numbers to strings.
    // With convert: false, a numeric username should fail validation.
    expect(() => deserializeSessionUser('{"username": 42}')).toThrow();
  });

  test('throws when stripUnknown is effectively false: extra fields cause validation error', () => {
    // With stripUnknown: false and unknown(false), extra fields trigger an error.
    expect(() => deserializeSessionUser('{"username":"alice","extra":"field"}')).toThrow();
  });

  test('returns deserialized user with valid input', () => {
    const result = deserializeSessionUser('{"username":"alice"}');
    expect(result).toEqual({ username: 'alice' });
  });
});

describe('configureSessionLimits + enforceSessionLimitBeforeLogin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testable_basicSessionLocks.clear();
  });

  afterEach(() => {
    testable_basicSessionLocks.clear();
    vi.clearAllTimers();
    vi.useRealTimers();
    // Reset to default after each test
    configureSessionLimits({});
  });

  test('valid maxconcurrentsessions is passed through to enforceConcurrentSessionLimit', async () => {
    configureSessionLimits({ session: { maxconcurrentsessions: 3 } });
    const onSuccess = vi.fn().mockResolvedValue(undefined);
    const onFailure = vi.fn();
    const req = {
      sessionStore: { all: vi.fn(), destroy: vi.fn() },
      sessionID: 'sess-1',
    } as any;

    enforceSessionLimitBeforeLogin(req, 'alice', onSuccess, onFailure);

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(enforceConcurrentSessionLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({ maxConcurrentSessions: 3 }),
    );
  });

  test('maxconcurrentsessions of 0 falls back to default (configuredMaxSessions < 1 guard)', async () => {
    // With mutant (< 1 → false): 0 would be used as the limit instead of DEFAULT (5).
    // This test checks that the default is used when 0 is configured.
    configureSessionLimits({ session: { maxconcurrentsessions: 0 } });
    const onSuccess = vi.fn().mockResolvedValue(undefined);
    const onFailure = vi.fn();
    const req = {
      sessionStore: { all: vi.fn(), destroy: vi.fn() },
      sessionID: 'sess-1',
    } as any;

    enforceSessionLimitBeforeLogin(req, 'alice', onSuccess, onFailure);

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(enforceConcurrentSessionLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({ maxConcurrentSessions: 5 }), // DEFAULT_MAX_CONCURRENT_SESSIONS_PER_USER
    );
  });

  test('non-integer maxconcurrentsessions falls back to default', async () => {
    configureSessionLimits({ session: { maxconcurrentsessions: 1.5 } });
    const onSuccess = vi.fn().mockResolvedValue(undefined);
    const onFailure = vi.fn();
    const req = {
      sessionStore: { all: vi.fn(), destroy: vi.fn() },
      sessionID: 'sess-1',
    } as any;

    enforceSessionLimitBeforeLogin(req, 'alice', onSuccess, onFailure);

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(enforceConcurrentSessionLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({ maxConcurrentSessions: 5 }),
    );
  });
});

describe('getSessionSecretKey', () => {
  const originalEnv = process.env.DD_SESSION_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStoredSessionSecret.mockReturnValue(null);
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.DD_SESSION_SECRET;
    } else {
      process.env.DD_SESSION_SECRET = originalEnv;
    }
  });

  test('returns env var value and logs env message when DD_SESSION_SECRET is set', () => {
    process.env.DD_SESSION_SECRET = 'my-env-secret';

    const secret = getSessionSecretKey();

    expect(secret).toBe('my-env-secret');
    expect(mockLog.info).toHaveBeenCalledWith(
      'Using session secret from DD_SESSION_SECRET environment variable',
    );
    expect(mockGetStoredSessionSecret).not.toHaveBeenCalled();
    expect(mockSetStoredSessionSecret).not.toHaveBeenCalled();
  });

  test('trims whitespace-only DD_SESSION_SECRET and falls through to store', () => {
    process.env.DD_SESSION_SECRET = '   ';
    mockGetStoredSessionSecret.mockReturnValue('stored-secret');

    const secret = getSessionSecretKey();

    expect(secret).toBe('stored-secret');
    expect(mockLog.info).toHaveBeenCalledWith('Using persisted session secret from store');
    expect(mockLog.info).not.toHaveBeenCalledWith(
      'Using session secret from DD_SESSION_SECRET environment variable',
    );
  });

  test('falls through to store when DD_SESSION_SECRET is undefined', () => {
    delete process.env.DD_SESSION_SECRET;
    mockGetStoredSessionSecret.mockReturnValue('stored-secret');

    const secret = getSessionSecretKey();

    expect(secret).toBe('stored-secret');
    expect(mockLog.info).toHaveBeenCalledWith('Using persisted session secret from store');
    expect(mockSetStoredSessionSecret).not.toHaveBeenCalled();
  });

  test('falls through to store when DD_SESSION_SECRET is empty string', () => {
    process.env.DD_SESSION_SECRET = '';
    mockGetStoredSessionSecret.mockReturnValue('stored-secret');

    const secret = getSessionSecretKey();

    expect(secret).toBe('stored-secret');
    expect(mockLog.info).toHaveBeenCalledWith('Using persisted session secret from store');
  });

  test('generates and persists new secret when env var missing and store empty', () => {
    delete process.env.DD_SESSION_SECRET;
    mockGetStoredSessionSecret.mockReturnValue(null);

    const secret = getSessionSecretKey();

    expect(secret).toMatch(/^[0-9a-f]{128}$/);
    expect(mockSetStoredSessionSecret).toHaveBeenCalledWith(secret);
    expect(mockLog.info).toHaveBeenCalledWith(
      'Generated and persisted a new session secret to the store',
    );
    expect(mockLog.info).not.toHaveBeenCalledWith(
      'Using session secret from DD_SESSION_SECRET environment variable',
    );
    expect(mockLog.info).not.toHaveBeenCalledWith('Using persisted session secret from store');
  });

  test('env var takes precedence over store', () => {
    process.env.DD_SESSION_SECRET = 'env-wins';
    mockGetStoredSessionSecret.mockReturnValue('stored-value');

    const secret = getSessionSecretKey();

    expect(secret).toBe('env-wins');
    expect(mockGetStoredSessionSecret).not.toHaveBeenCalled();
  });
});

describe('auth-session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    testable_basicSessionLocks.clear();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  test('enforceSessionLimitBeforeLogin should serialize concurrent logins for the same username', async () => {
    let releaseFirst = () => undefined;
    const firstOnSuccess = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    const secondOnSuccess = vi.fn().mockResolvedValue(undefined);
    const onFailure = vi.fn();

    enforceSessionLimitBeforeLogin({} as any, 'alice', firstOnSuccess, onFailure);
    enforceSessionLimitBeforeLogin({} as any, 'alice', secondOnSuccess, onFailure);

    await vi.waitFor(() => {
      expect(firstOnSuccess).toHaveBeenCalledTimes(1);
    });
    expect(secondOnSuccess).not.toHaveBeenCalled();

    releaseFirst();

    await vi.waitFor(() => {
      expect(secondOnSuccess).toHaveBeenCalledTimes(1);
    });
    expect(onFailure).not.toHaveBeenCalled();
    expect(enforceConcurrentSessionLimit).not.toHaveBeenCalled();
  });

  test('enforceSessionLimitBeforeLogin should clear stale in-memory lock entries', async () => {
    const nativeSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      if (timeout === 60_000) {
        return nativeSetTimeout(handler, 0, ...args);
      }
      return nativeSetTimeout(handler, timeout, ...args);
    }) as typeof setTimeout);

    let releaseFirst = () => undefined;
    const firstOnSuccess = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    const secondOnSuccess = vi.fn().mockResolvedValue(undefined);
    const onFailure = vi.fn();

    enforceSessionLimitBeforeLogin({} as any, 'alice', firstOnSuccess, onFailure);
    await vi.waitFor(() => {
      expect(firstOnSuccess).toHaveBeenCalledTimes(1);
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    enforceSessionLimitBeforeLogin({} as any, 'alice', secondOnSuccess, onFailure);
    await vi.waitFor(() => {
      expect(secondOnSuccess).toHaveBeenCalledTimes(1);
    });

    expect(onFailure).not.toHaveBeenCalled();

    releaseFirst();
    await Promise.resolve();
    setTimeoutSpy.mockRestore();
  });

  test('enforceSessionLimitBeforeLogin should report blank-username success-handler failures', async () => {
    const onSuccess = vi.fn().mockRejectedValue(new Error('blank username failure'));
    const onFailure = vi.fn();

    enforceSessionLimitBeforeLogin({} as any, '   ', onSuccess, onFailure);

    await vi.waitFor(() => {
      expect(onFailure).toHaveBeenCalledWith(
        'Unable to enforce session limit before login (blank username failure)',
      );
    });
    expect(log.warn).toHaveBeenCalledWith(
      'Unable to enforce session limit before login (blank username failure)',
    );
    expect(enforceConcurrentSessionLimit).not.toHaveBeenCalled();
  });

  test('testable_withBasicSessionLock should execute immediately when lock key is blank', async () => {
    const operation = vi.fn().mockResolvedValue('ok');

    const result = await testable_withBasicSessionLock('', operation);

    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(1);
    // Blank key should NOT set any entry in the lock map (bypasses lock path entirely)
    expect(testable_basicSessionLocks.has('')).toBe(false);
  });

  test('testable_withBasicSessionLock should handle rejected previous lock promises', async () => {
    const previousLockError = new Error('previous lock failed');
    const previousLock = Promise.reject(previousLockError);
    void previousLock.catch(() => undefined);
    testable_basicSessionLocks.set('alice', previousLock);

    const operation = vi.fn().mockResolvedValue(undefined);

    await expect(testable_withBasicSessionLock('alice', operation)).resolves.toBeUndefined();

    expect(operation).toHaveBeenCalledTimes(1);
  });

  test('testable_withBasicSessionLock should not let stale cleanup from an older lock delete a newer lock', async () => {
    const nativeSetTimeout = globalThis.setTimeout;
    let acceleratedStaleCleanupTimers = 0;
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      if (timeout === 60_000 && acceleratedStaleCleanupTimers === 0) {
        acceleratedStaleCleanupTimers += 1;
        return nativeSetTimeout(handler, 0, ...args);
      }
      return nativeSetTimeout(handler, timeout, ...args);
    }) as typeof setTimeout);

    try {
      let releaseFirst = () => undefined;
      const firstOperation = vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            releaseFirst = resolve;
          }),
      );
      const secondOperation = vi.fn().mockResolvedValue('second-result');

      const firstPromise = testable_withBasicSessionLock('alice', firstOperation);
      const secondPromise = testable_withBasicSessionLock('alice', secondOperation);

      await vi.waitFor(() => {
        expect(firstOperation).toHaveBeenCalledTimes(1);
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(testable_basicSessionLocks.has('alice')).toBe(true);
      expect(secondOperation).not.toHaveBeenCalled();

      releaseFirst();

      await expect(firstPromise).resolves.toBeUndefined();
      await expect(secondPromise).resolves.toBe('second-result');
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  test('testable_withBasicSessionLock should release bookkeeping when wait timer setup throws', async () => {
    const nativeSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      if (timeout === 10_000) {
        throw new Error('wait timer unavailable');
      }
      return nativeSetTimeout(handler, timeout, ...args);
    }) as typeof setTimeout);

    try {
      const operation = vi.fn().mockResolvedValue('ok');
      await expect(testable_withBasicSessionLock('alice', operation)).rejects.toThrow(
        'wait timer unavailable',
      );
      expect(testable_basicSessionLocks.has('alice')).toBe(false);
      expect(operation).not.toHaveBeenCalled();
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  test('testable_withBasicSessionLock cleans up lock map entry after successful operation', async () => {
    const operation = vi.fn().mockResolvedValue('result');

    const result = await testable_withBasicSessionLock('bob', operation);

    expect(result).toBe('result');
    expect(testable_basicSessionLocks.has('bob')).toBe(false);
  });

  test('testable_withBasicSessionLock cleans up lock map entry after failed operation', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('operation failed'));

    await expect(testable_withBasicSessionLock('bob', operation)).rejects.toThrow(
      'operation failed',
    );
    expect(testable_basicSessionLocks.has('bob')).toBe(false);
  });

  test('testable_withBasicSessionLock: previousLockWaitTimer is cleared in finally block', async () => {
    // This test ensures the clearTimeout(previousLockWaitTimer) branch runs when the timer was set.
    // We verify indirectly: the operation completes (previous lock resolves immediately) so
    // the wait timer must be cleaned up without side-effects.
    const operation = vi.fn().mockResolvedValue('cleanup-verify');

    const result = await testable_withBasicSessionLock('charlie', operation);
    expect(result).toBe('cleanup-verify');
    expect(testable_basicSessionLocks.has('charlie')).toBe(false);
  });

  test('enforceSessionLimitBeforeLogin bypasses session store when sessionStore.all is not a function', async () => {
    const onSuccess = vi.fn().mockResolvedValue(undefined);
    const onFailure = vi.fn();
    const req = {
      sessionStore: { all: 'not-a-function', destroy: vi.fn() },
      sessionID: 'sess-123',
    } as any;

    enforceSessionLimitBeforeLogin(req, 'alice', onSuccess, onFailure);

    await vi.waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
    expect(onFailure).not.toHaveBeenCalled();
    expect(enforceConcurrentSessionLimitMock).not.toHaveBeenCalled();
  });

  test('enforceSessionLimitBeforeLogin bypasses session store when sessionStore.destroy is not a function', async () => {
    const onSuccess = vi.fn().mockResolvedValue(undefined);
    const onFailure = vi.fn();
    const req = {
      sessionStore: { all: vi.fn(), destroy: 'not-a-function' },
      sessionID: 'sess-123',
    } as any;

    enforceSessionLimitBeforeLogin(req, 'alice', onSuccess, onFailure);

    await vi.waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
    expect(onFailure).not.toHaveBeenCalled();
    expect(enforceConcurrentSessionLimitMock).not.toHaveBeenCalled();
  });

  test('enforceSessionLimitBeforeLogin bypasses session store when sessionStore is absent', async () => {
    const onSuccess = vi.fn().mockResolvedValue(undefined);
    const onFailure = vi.fn();
    const req = { sessionID: 'sess-123' } as any;

    enforceSessionLimitBeforeLogin(req, 'alice', onSuccess, onFailure);

    await vi.waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
    expect(onFailure).not.toHaveBeenCalled();
    expect(enforceConcurrentSessionLimitMock).not.toHaveBeenCalled();
  });

  test('enforceSessionLimitBeforeLogin trims username before using it', async () => {
    const onSuccess = vi.fn().mockResolvedValue(undefined);
    const onFailure = vi.fn();
    const req = {
      sessionStore: { all: vi.fn(), destroy: vi.fn() },
      sessionID: 'sess-123',
    } as any;

    // Username with whitespace — after trim it is non-empty so it should go through the lock path
    enforceSessionLimitBeforeLogin(req, '  alice  ', onSuccess, onFailure);

    await vi.waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
    expect(onFailure).not.toHaveBeenCalled();
    // enforceConcurrentSessionLimit should have been called with the trimmed username
    expect(enforceConcurrentSessionLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'alice' }),
    );
  });

  test('enforceSessionLimitBeforeLogin skips session limit enforcement for blank username even with full session store', async () => {
    // With if(false) mutant on line 157, blank username goes through the lock path.
    // With a full session store, this would call enforceConcurrentSessionLimit.
    // This test verifies that blank username bypasses the limit enforcement entirely.
    const onSuccess = vi.fn().mockResolvedValue(undefined);
    const onFailure = vi.fn();
    const req = {
      sessionStore: { all: vi.fn(), destroy: vi.fn() },
      sessionID: 'sess-abc',
    } as any;

    enforceSessionLimitBeforeLogin(req, '   ', onSuccess, onFailure);

    await vi.waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
    expect(onFailure).not.toHaveBeenCalled();
    expect(enforceConcurrentSessionLimitMock).not.toHaveBeenCalled();
  });

  test('enforceSessionLimitBeforeLogin calls onFailure when enforceConcurrentSessionLimit throws', async () => {
    enforceConcurrentSessionLimitMock.mockRejectedValueOnce(new Error('limit error'));
    const onSuccess = vi.fn().mockResolvedValue(undefined);
    const onFailure = vi.fn();
    const req = {
      sessionStore: { all: vi.fn(), destroy: vi.fn() },
      sessionID: 'sess-123',
    } as any;

    enforceSessionLimitBeforeLogin(req, 'alice', onSuccess, onFailure);

    await vi.waitFor(() => {
      expect(onFailure).toHaveBeenCalledWith(
        'Unable to enforce session limit before login (limit error)',
      );
    });
    expect(log.warn).toHaveBeenCalledWith(
      'Unable to enforce session limit before login (limit error)',
    );
  });

  test('enforceSessionLimitBeforeLogin calls onFailure when onSuccess throws (non-blank username)', async () => {
    enforceConcurrentSessionLimitMock.mockResolvedValueOnce(undefined);
    const onSuccess = vi.fn().mockRejectedValue(new Error('success handler fail'));
    const onFailure = vi.fn();
    const req = {
      sessionStore: { all: vi.fn(), destroy: vi.fn() },
      sessionID: 'sess-123',
    } as any;

    enforceSessionLimitBeforeLogin(req, 'alice', onSuccess, onFailure);

    await vi.waitFor(() => {
      expect(onFailure).toHaveBeenCalledWith(
        'Unable to enforce session limit before login (success handler fail)',
      );
    });
    expect(log.warn).toHaveBeenCalledWith(
      'Unable to enforce session limit before login (success handler fail)',
    );
  });
});
