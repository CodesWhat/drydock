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
});
