import { describe, expect, test, vi } from 'vitest';
import { sleep } from './sleep.js';

describe('sleep', () => {
  test('resolves after the given timeout', async () => {
    vi.useFakeTimers();
    try {
      const sleepPromise = sleep(25);
      await vi.advanceTimersByTimeAsync(25);
      await expect(sleepPromise).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test('rejects with an AbortError when the signal aborts', async () => {
    const controller = new AbortController();
    const sleepPromise = sleep(60_000, controller.signal);
    controller.abort();
    await expect(sleepPromise).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('rejects immediately when the signal is already aborted', async () => {
    await expect(sleep(60_000, AbortSignal.abort())).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
