import { describe, expect, test } from 'vitest';
import {
  allSettledWithDockerWatchConcurrency,
  mapWithDockerWatchConcurrency,
} from './watch-concurrency.js';

function trackConcurrency() {
  let active = 0;
  let peak = 0;
  return {
    peak: () => peak,
    run: async (value: number) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return value * 2;
    },
  };
}

describe('docker watch concurrency helpers', () => {
  test('mapWithDockerWatchConcurrency keeps order and caps concurrency at 10', async () => {
    const tracker = trackConcurrency();
    const items = Array.from({ length: 30 }, (_, i) => i);
    const result = await mapWithDockerWatchConcurrency(items, (item) => tracker.run(item));
    expect(result).toEqual(items.map((i) => i * 2));
    expect(tracker.peak()).toBeLessThanOrEqual(10);
  });

  test('allSettledWithDockerWatchConcurrency reports rejections without aborting', async () => {
    const result = await allSettledWithDockerWatchConcurrency([1, 2, 3], async (item, index) => {
      if (item === 2) throw new Error('boom');
      return index;
    });
    expect(result.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });
});
