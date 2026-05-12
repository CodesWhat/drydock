import { OneShotKeyTracker, RecentSignatureSuppressor } from './trigger-deduplicator.js';

describe('RecentSignatureSuppressor', () => {
  test('suppresses recent duplicate signatures within the window', () => {
    const suppressor = new RecentSignatureSuppressor({
      seenAt: new Map(),
      suppressionWindowMs: 100,
      retentionMs: 1_000,
    });

    expect(suppressor.shouldSuppress('smtp-down', 1_000)).toBe(false);
    expect(suppressor.shouldSuppress('smtp-down', 1_050)).toBe(true);
    expect(suppressor.shouldSuppress('smtp-down', 1_200)).toBe(false);
  });

  test('prunes stale recent signatures by retention window', () => {
    const recentSeenAt = new Map([
      ['stale', 1_000],
      ['fresh', 1_900],
    ]);
    const suppressor = new RecentSignatureSuppressor({
      seenAt: recentSeenAt,
      suppressionWindowMs: 100,
      retentionMs: 500,
    });

    suppressor.prune(2_000);

    expect(recentSeenAt.has('stale')).toBe(false);
    expect(recentSeenAt.has('fresh')).toBe(true);
  });

  test('clears recent signature timestamps only', () => {
    const recentSeenAt = new Map([['smtp-down', 1_000]]);
    const suppressor = new RecentSignatureSuppressor({
      seenAt: recentSeenAt,
      suppressionWindowMs: 100,
      retentionMs: 1_000,
    });

    suppressor.clear();

    expect(recentSeenAt.size).toBe(0);
  });
});

describe('OneShotKeyTracker', () => {
  test('marks one-shot keys once', () => {
    const onceSeen = new Set<string>();
    const tracker = new OneShotKeyTracker({
      seenKeys: onceSeen,
    });

    expect(tracker.markOnce('web|rejected')).toBe(true);
    expect(tracker.markOnce('web|rejected')).toBe(false);
    expect([...onceSeen]).toEqual(['web|rejected']);
  });

  test('clears one-shot keys by prefix', () => {
    const onceSeen = new Set(['web|rejected', 'web|held', 'api|rejected']);
    const tracker = new OneShotKeyTracker({
      seenKeys: onceSeen,
    });

    tracker.clearByPrefix('web|');

    expect([...onceSeen]).toEqual(['api|rejected']);
  });

  test('one-shot keys are retained until explicitly cleared by prefix', () => {
    const onceSeen = new Set(['web|rejected']);
    const tracker = new OneShotKeyTracker({
      seenKeys: onceSeen,
    });

    expect(tracker.markOnce('web|rejected')).toBe(false);
    expect(tracker.markOnce('web|held')).toBe(true);

    tracker.clearByPrefix('api|');

    expect([...onceSeen]).toEqual(['web|rejected', 'web|held']);

    tracker.clearByPrefix('web|');

    expect(onceSeen.size).toBe(0);
  });
});
