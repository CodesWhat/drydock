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

  // Kills line 23 mutant: ConditionalExpression true (previousSeenAt !== undefined)
  // and EqualityOperator <=
  test('shouldSuppress returns false for unknown signature (first time seen)', () => {
    const suppressor = new RecentSignatureSuppressor({
      seenAt: new Map(),
      suppressionWindowMs: 100,
      retentionMs: 1_000,
    });
    // Never seen before — previousSeenAt is undefined, should NOT suppress
    expect(suppressor.shouldSuppress('brand-new-sig', 5_000)).toBe(false);
  });

  test('shouldSuppress: exactly at suppression window boundary does not suppress', () => {
    // now - previousSeenAt < suppressionWindowMs uses strict less-than
    // at exactly suppressionWindowMs it should NOT suppress (< not <=)
    const suppressor = new RecentSignatureSuppressor({
      seenAt: new Map([['sig', 1_000]]),
      suppressionWindowMs: 100,
      retentionMs: 10_000,
    });
    // now - 1000 = 100, which is not < 100, so should not suppress
    expect(suppressor.shouldSuppress('sig', 1_100)).toBe(false);
  });

  test('shouldSuppress: one millisecond inside window suppresses', () => {
    const suppressor = new RecentSignatureSuppressor({
      seenAt: new Map([['sig', 1_000]]),
      suppressionWindowMs: 100,
      retentionMs: 10_000,
    });
    // now - 1000 = 99 < 100, should suppress
    expect(suppressor.shouldSuppress('sig', 1_099)).toBe(true);
  });

  // Kills line 29 mutant: EqualityOperator seenAt <= oldestAllowedTimestamp
  test('prune: entry at exactly oldestAllowedTimestamp boundary is NOT pruned', () => {
    // oldestAllowedTimestamp = now - retentionMs = 2000 - 500 = 1500
    // seenAt < 1500 is pruned; seenAt === 1500 is NOT pruned
    const recentSeenAt = new Map([
      ['boundary', 1_500],
      ['just-stale', 1_499],
    ]);
    const suppressor = new RecentSignatureSuppressor({
      seenAt: recentSeenAt,
      suppressionWindowMs: 100,
      retentionMs: 500,
    });

    suppressor.prune(2_000);

    expect(recentSeenAt.has('boundary')).toBe(true);
    expect(recentSeenAt.has('just-stale')).toBe(false);
  });

  // Kills line 74 mutant: BlockStatement {} in clearByPrefix
  test('clearByPrefix removes only keys matching the prefix', () => {
    const seenKeys = new Set(['web|rejected', 'api|rejected', 'web|held']);
    const tracker = new OneShotKeyTracker({ seenKeys });
    tracker.clearByPrefix('web|');
    expect([...seenKeys]).toEqual(['api|rejected']);
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
