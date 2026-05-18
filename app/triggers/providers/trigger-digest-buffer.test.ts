import { DigestBuffer } from './trigger-digest-buffer.js';

describe('DigestBuffer', () => {
  test('stores entries with timestamps after pruning stale entries', () => {
    const entries = new Map<string, string>([['stale', 'old']]);
    const timestamps = new Map([['stale', 1_000]]);
    const log = { debug: vi.fn(), warn: vi.fn() };
    const buffer = new DigestBuffer({
      name: 'digest buffer',
      entries,
      timestamps,
      retentionMs: 100,
      maxEntries: 10,
      log,
    });

    buffer.set('fresh', 'new', 1_500);

    expect([...entries.entries()]).toEqual([['fresh', 'new']]);
    expect([...timestamps.entries()]).toEqual([['fresh', 1_500]]);
    expect(log.debug).toHaveBeenCalledWith('Evicted stale digest buffer entry stale');
  });

  test('keeps entries when retention is disabled', () => {
    const entries = new Map<string, string>([['stale', 'old']]);
    const timestamps = new Map([['stale', 1_000]]);
    const buffer = new DigestBuffer({
      name: 'digest buffer',
      entries,
      timestamps,
      retentionMs: 0,
      maxEntries: 10,
      log: { debug: vi.fn(), warn: vi.fn() },
    });

    buffer.prune(1_500);

    expect(entries.get('stale')).toBe('old');
    expect(timestamps.get('stale')).toBe(1_000);
  });

  test('treats missing timestamps as newly observed during stale pruning', () => {
    const entries = new Map<string, string>([['missing', 'entry']]);
    const timestamps = new Map<string, number>();
    const buffer = new DigestBuffer({
      name: 'digest buffer',
      entries,
      timestamps,
      retentionMs: 100,
      maxEntries: 10,
      log: { debug: vi.fn(), warn: vi.fn() },
    });

    buffer.pruneStale(1_500);

    expect(entries.get('missing')).toBe('entry');
    expect(timestamps.get('missing')).toBe(1_500);
  });

  test('evicts the oldest entries when over capacity', () => {
    const entries = new Map<string, string>([
      ['old', 'first'],
      ['newer', 'second'],
      ['missing', 'third'],
    ]);
    const timestamps = new Map([
      ['old', 1_000],
      ['newer', 2_000],
    ]);
    const log = { debug: vi.fn(), warn: vi.fn() };
    const buffer = new DigestBuffer({
      name: 'digest buffer',
      entries,
      timestamps,
      retentionMs: 100,
      maxEntries: 1,
      log,
    });

    buffer.enforceLimit();

    expect([...entries.keys()]).toEqual(['newer']);
    expect([...timestamps.keys()]).toEqual(['newer']);
    expect(log.warn).toHaveBeenCalledWith(
      'Evicted oldest digest buffer entry missing after reaching the 1-entry limit',
    );
    expect(log.warn).toHaveBeenCalledWith(
      'Evicted oldest digest buffer entry old after reaching the 1-entry limit',
    );
  });

  test('clears all entries when max entries is zero', () => {
    const entries = new Map<string, string>([['entry', 'value']]);
    const timestamps = new Map([['entry', 1_000]]);
    const buffer = new DigestBuffer({
      name: 'digest buffer',
      entries,
      timestamps,
      retentionMs: 100,
      maxEntries: 0,
      log: { debug: vi.fn(), warn: vi.fn() },
    });

    buffer.enforceLimit();

    expect(entries.size).toBe(0);
    expect(timestamps.size).toBe(0);
  });

  test('deleteEntry removes the entry and timestamp', () => {
    const entries = new Map<string, string>([['entry', 'value']]);
    const timestamps = new Map([['entry', 1_000]]);

    expect(DigestBuffer.deleteEntry(entries, timestamps, 'entry')).toBe(true);
    expect(entries.size).toBe(0);
    expect(timestamps.size).toBe(0);
  });

  // Kills line 78 mutant: EqualityOperator updatedAt <= oldestAllowedTimestamp
  test('pruneStale: entry at exactly oldest-allowed boundary is NOT pruned', () => {
    // oldestAllowedTimestamp = now - retentionMs = 2000 - 500 = 1500
    // condition is: updatedAt < oldestAllowedTimestamp
    // updatedAt === 1500 should NOT be pruned
    const entries = new Map<string, string>([
      ['boundary', 'keep'],
      ['just-stale', 'remove'],
    ]);
    const timestamps = new Map([
      ['boundary', 1_500],
      ['just-stale', 1_499],
    ]);
    const log = { debug: vi.fn(), warn: vi.fn() };
    const buffer = new DigestBuffer({
      name: 'digest buffer',
      entries,
      timestamps,
      retentionMs: 500,
      maxEntries: 10,
      log,
    });

    buffer.pruneStale(2_000);

    expect(entries.has('boundary')).toBe(true);
    expect(entries.has('just-stale')).toBe(false);
    expect(log.debug).toHaveBeenCalledWith('Evicted stale digest buffer entry just-stale');
    expect(log.debug).toHaveBeenCalledTimes(1);
  });

  // Kills line 87 mutants: ConditionalExpression false and EqualityOperator maxEntries < 0
  test('enforceLimit: maxEntries=1 keeps exactly one entry (the newest)', () => {
    const entries = new Map<string, string>([
      ['a', 'first'],
      ['b', 'second'],
    ]);
    const timestamps = new Map([
      ['a', 1_000],
      ['b', 2_000],
    ]);
    const log = { debug: vi.fn(), warn: vi.fn() };
    const buffer = new DigestBuffer({
      name: 'digest buffer',
      entries,
      timestamps,
      retentionMs: 0,
      maxEntries: 1,
      log,
    });

    buffer.enforceLimit();

    expect(entries.size).toBe(1);
    expect(entries.has('b')).toBe(true);
    expect(log.warn).toHaveBeenCalledWith(
      'Evicted oldest digest buffer entry a after reaching the 1-entry limit',
    );
  });

  test('enforceLimit: maxEntries=-1 clears all entries', () => {
    // maxEntries <= 0 triggers a full clear — this kills the < 0 vs <= 0 mutant
    const entries = new Map<string, string>([['x', 'value']]);
    const timestamps = new Map([['x', 1_000]]);
    const buffer = new DigestBuffer({
      name: 'digest buffer',
      entries,
      timestamps,
      retentionMs: 0,
      maxEntries: -1,
      log: { debug: vi.fn(), warn: vi.fn() },
    });

    buffer.enforceLimit();

    expect(entries.size).toBe(0);
    expect(timestamps.size).toBe(0);
  });

  // Kills line 87 BlockStatement {} mutant: if (maxEntries <= 0) { ... }
  test('enforceLimit: maxEntries=2 does not evict when count equals limit', () => {
    const entries = new Map<string, string>([
      ['a', 'first'],
      ['b', 'second'],
    ]);
    const timestamps = new Map([
      ['a', 1_000],
      ['b', 2_000],
    ]);
    const log = { debug: vi.fn(), warn: vi.fn() };
    const buffer = new DigestBuffer({
      name: 'digest buffer',
      entries,
      timestamps,
      retentionMs: 0,
      maxEntries: 2,
      log,
    });

    buffer.enforceLimit();

    expect(entries.size).toBe(2);
    expect(log.warn).not.toHaveBeenCalled();
  });
});
