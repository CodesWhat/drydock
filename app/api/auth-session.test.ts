const { mockLog, enforceConcurrentSessionLimitMock } = vi.hoisted(() => ({
  mockLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  enforceConcurrentSessionLimitMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../log/index.js', () => ({
  default: mockLog,
}));

vi.mock('../util/session-limit.js', () => ({
  enforceConcurrentSessionLimit: enforceConcurrentSessionLimitMock,
}));

import log from '../log/index.js';
import { enforceConcurrentSessionLimit } from '../util/session-limit.js';
import {
  enforceSessionLimitBeforeLogin,
  testable_basicSessionLocks,
  testable_withBasicSessionLock,
} from './auth-session.js';

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

    await expect(testable_withBasicSessionLock('', operation)).resolves.toBe('ok');

    expect(operation).toHaveBeenCalledTimes(1);
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
});
