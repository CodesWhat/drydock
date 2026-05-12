import { Deduplicator } from './trigger-deduplicator.js';

describe('Deduplicator', () => {
  test('suppresses recent duplicate signatures within the window', () => {
    const deduplicator = new Deduplicator({
      recentSeenAt: new Map(),
      onceSeen: new Set(),
      suppressionWindowMs: 100,
      retentionMs: 1_000,
    });

    expect(deduplicator.shouldSuppressRecent('smtp-down', 1_000)).toBe(false);
    expect(deduplicator.shouldSuppressRecent('smtp-down', 1_050)).toBe(true);
    expect(deduplicator.shouldSuppressRecent('smtp-down', 1_200)).toBe(false);
  });

  test('prunes stale recent signatures by retention window', () => {
    const recentSeenAt = new Map([
      ['stale', 1_000],
      ['fresh', 1_900],
    ]);
    const deduplicator = new Deduplicator({
      recentSeenAt,
      onceSeen: new Set(),
      suppressionWindowMs: 100,
      retentionMs: 500,
    });

    deduplicator.pruneRecent(2_000);

    expect(recentSeenAt.has('stale')).toBe(false);
    expect(recentSeenAt.has('fresh')).toBe(true);
  });

  test('marks one-shot keys once', () => {
    const onceSeen = new Set<string>();
    const deduplicator = new Deduplicator({
      recentSeenAt: new Map(),
      onceSeen,
      suppressionWindowMs: 100,
      retentionMs: 1_000,
    });

    expect(deduplicator.markOnce('web|rejected')).toBe(true);
    expect(deduplicator.markOnce('web|rejected')).toBe(false);
    expect([...onceSeen]).toEqual(['web|rejected']);
  });

  test('clears one-shot keys by prefix', () => {
    const onceSeen = new Set(['web|rejected', 'web|held', 'api|rejected']);
    const deduplicator = new Deduplicator({
      recentSeenAt: new Map(),
      onceSeen,
      suppressionWindowMs: 100,
      retentionMs: 1_000,
    });

    deduplicator.clearOnceByPrefix('web|');

    expect([...onceSeen]).toEqual(['api|rejected']);
  });

  test('clears all tracked state', () => {
    const recentSeenAt = new Map([['smtp-down', 1_000]]);
    const onceSeen = new Set(['web|rejected']);
    const deduplicator = new Deduplicator({
      recentSeenAt,
      onceSeen,
      suppressionWindowMs: 100,
      retentionMs: 1_000,
    });

    deduplicator.clear();

    expect(recentSeenAt.size).toBe(0);
    expect(onceSeen.size).toBe(0);
  });
});
