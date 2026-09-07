import { daysToMs } from '../model/maturity-policy.js';
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import * as audit from './audit.js';
import type { Database } from './db/driver.js';

vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

let db: Database;

beforeEach(() => {
  db = createMigratedMemoryDatabase();
  audit.createCollections(db);
});

afterEach(() => {
  db.close();
});

describe('createCollections', () => {
  test('wires the store to the given database and prunes stale entries on init', () => {
    db.prepare(
      `INSERT INTO audit (id, timestamp, timestamp_ms, action, container_name, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'stale',
      new Date(0).toISOString(),
      Date.now() - daysToMs(100),
      'update-available',
      'old',
      'info',
    );

    audit.createCollections(db);

    expect(audit.getAuditEntries().total).toBe(0);
  });

  test('tolerates a timer handle without unref support', () => {
    const setIntervalSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockReturnValue(0 as unknown as NodeJS.Timeout);

    try {
      expect(() => audit.createCollections(db)).not.toThrow();
      expect(setIntervalSpy).toHaveBeenCalled();
    } finally {
      setIntervalSpy.mockRestore();
    }
  });
});

describe('insertAudit', () => {
  test('inserts an entry and returns it with id', () => {
    const result = audit.insertAudit({
      action: 'update-available',
      containerName: 'nginx',
      status: 'info',
    } as never);
    expect(result.id).toBeDefined();
    expect(result.timestamp).toBeDefined();
    expect(result.action).toBe('update-available');
    expect(result.containerName).toBe('nginx');
  });

  test('preserves a provided id', () => {
    const result = audit.insertAudit({
      id: 'custom-id',
      action: 'update-applied',
      containerName: 'redis',
      status: 'success',
    } as never);
    expect(result.id).toBe('custom-id');
  });

  test('round-trips every optional field through getAuditEntries', () => {
    const inserted = audit.insertAudit({
      id: 'full-entry',
      action: 'update-applied',
      containerName: 'web',
      containerIdentityKey: 'watcher-web',
      containerImage: 'library/web',
      fromVersion: 'one',
      toVersion: 'two',
      updateKind: 'tag',
      semverDiff: 'minor',
      triggerName: 'docker.default',
      status: 'success',
      details: 'plain details text',
    } as never);

    const result = audit.getAuditEntries({ container: 'web' });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toEqual({
      id: inserted.id,
      timestamp: inserted.timestamp,
      action: 'update-applied',
      containerName: 'web',
      containerIdentityKey: 'watcher-web',
      containerImage: 'library/web',
      fromVersion: 'one',
      toVersion: 'two',
      updateKind: 'tag',
      semverDiff: 'minor',
      triggerName: 'docker.default',
      status: 'success',
      details: 'plain details text',
    });
  });

  test('pre-parses and stores timestampMs for indexed date queries', () => {
    const timestamp = '2024-06-01T12:34:56.000Z';
    const result = audit.insertAudit({
      action: 'update-applied',
      containerName: 'redis',
      status: 'success',
      timestamp,
    } as never);

    const stored = db.prepare('SELECT timestamp_ms FROM audit WHERE id = ?').get(result.id);
    expect(stored?.timestamp_ms).toBe(new Date(timestamp).getTime());
  });

  test('falls back to a zero timestampMs when the provided timestamp does not parse', () => {
    const result = audit.insertAudit({
      action: 'update-applied',
      containerName: 'redis',
      status: 'success',
      timestamp: 'not-a-date',
    } as never);

    const stored = db.prepare('SELECT timestamp_ms FROM audit WHERE id = ?').get(result.id);
    expect(stored?.timestamp_ms).toBe(0);
  });

  test('prunes entries older than the retention window after enough inserts', () => {
    const oldDate = new Date(Date.now() - daysToMs(100)).toISOString();

    audit.insertAudit({
      action: 'update-available',
      containerName: 'old',
      status: 'info',
      timestamp: oldDate,
    } as never);

    for (let i = 0; i < 99; i++) {
      audit.insertAudit({
        action: 'update-applied',
        containerName: `recent-${i}`,
        status: 'success',
      } as never);
    }

    expect(audit.getAuditEntries({ container: 'old' }).total).toBe(0);
  });

  test('periodically prunes stale entries even with low insert volume', () => {
    vi.useFakeTimers();
    try {
      audit.createCollections(db);
      const oldDate = new Date(Date.now() - daysToMs(100)).toISOString();

      audit.insertAudit({
        action: 'update-available',
        containerName: 'old',
        status: 'info',
        timestamp: oldDate,
      } as never);
      audit.insertAudit({
        action: 'update-applied',
        containerName: 'recent',
        status: 'success',
      } as never);

      expect(audit.getAuditEntries({ container: 'old' }).total).toBe(1);

      vi.advanceTimersByTime(daysToMs(1));

      expect(audit.getAuditEntries({ container: 'old' }).total).toBe(0);
      expect(audit.getAuditEntries({ container: 'recent' }).total).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('returns a normalized entry without persisting when the store is not initialized', async () => {
    vi.resetModules();
    const freshAudit = await import('./audit.js');

    const result = freshAudit.insertAudit({
      action: 'update-applied',
      containerName: 'standalone',
      status: 'success',
    } as never);

    expect(result.id).toBeDefined();
    expect(result.timestamp).toBeDefined();
    expect(result.containerName).toBe('standalone');
  });
});

describe('getAuditEntries', () => {
  test('returns all entries', () => {
    audit.insertAudit({
      action: 'update-available',
      containerName: 'nginx',
      status: 'info',
    } as never);
    audit.insertAudit({
      action: 'update-applied',
      containerName: 'redis',
      status: 'success',
    } as never);

    const result = audit.getAuditEntries();
    expect(result.total).toBe(2);
    expect(result.entries).toHaveLength(2);
  });

  test('filters by action', () => {
    audit.insertAudit({
      action: 'update-available',
      containerName: 'nginx',
      status: 'info',
    } as never);
    audit.insertAudit({
      action: 'update-applied',
      containerName: 'redis',
      status: 'success',
    } as never);

    const result = audit.getAuditEntries({ action: 'update-applied' });
    expect(result.total).toBe(1);
    expect(result.entries[0].containerName).toBe('redis');
  });

  test('filters by multiple actions', () => {
    audit.insertAudit({
      action: 'update-available',
      containerName: 'nginx',
      status: 'info',
    } as never);
    audit.insertAudit({
      action: 'update-applied',
      containerName: 'redis',
      status: 'success',
    } as never);
    audit.insertAudit({
      action: 'container-update',
      containerName: 'postgres',
      status: 'info',
    } as never);
    audit.insertAudit({
      action: 'security-alert',
      containerName: 'mysql',
      status: 'error',
    } as never);

    const result = audit.getAuditEntries({ actions: ['update-available', 'security-alert'] });
    expect(result.total).toBe(2);
    const actionTypes = result.entries.map((e) => e.action);
    expect(actionTypes).toContain('update-available');
    expect(actionTypes).toContain('security-alert');
    expect(actionTypes).not.toContain('container-update');
    expect(actionTypes).not.toContain('update-applied');
  });

  test('dedupes repeated actions in the actions filter to a single placeholder', () => {
    audit.insertAudit({
      action: 'update-available',
      containerName: 'nginx',
      status: 'info',
    } as never);
    audit.insertAudit({
      action: 'update-applied',
      containerName: 'redis',
      status: 'success',
    } as never);

    const prepareSpy = vi.spyOn(db, 'prepare');
    try {
      const repeated = audit.getAuditEntries({
        actions: ['update-available', 'update-available', 'update-available'],
      });
      const single = audit.getAuditEntries({ actions: ['update-available'] });

      expect(repeated).toEqual(single);
      expect(repeated.total).toBe(1);

      const inClausePlaceholderCounts = prepareSpy.mock.calls
        .map(([sql]) => sql as string)
        .map((sql) => /action IN \(([^)]*)\)/.exec(sql))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => (match[1].match(/\?/g) ?? []).length);
      expect(inClausePlaceholderCounts.length).toBeGreaterThan(0);
      for (const count of inClausePlaceholderCounts) {
        expect(count).toBe(1);
      }
    } finally {
      prepareSpy.mockRestore();
    }
  });

  test('prefers action over actions when both provided', () => {
    audit.insertAudit({
      action: 'update-available',
      containerName: 'nginx',
      status: 'info',
    } as never);
    audit.insertAudit({
      action: 'update-applied',
      containerName: 'redis',
      status: 'success',
    } as never);
    audit.insertAudit({
      action: 'security-alert',
      containerName: 'mysql',
      status: 'error',
    } as never);

    const result = audit.getAuditEntries({
      action: 'update-available',
      actions: ['update-applied', 'security-alert'],
    });
    expect(result.total).toBe(1);
    expect(result.entries[0].action).toBe('update-available');
  });

  test('filters by container name', () => {
    audit.insertAudit({
      action: 'update-available',
      containerName: 'nginx',
      status: 'info',
    } as never);
    audit.insertAudit({
      action: 'update-available',
      containerName: 'redis',
      status: 'info',
    } as never);

    const result = audit.getAuditEntries({ container: 'nginx' });
    expect(result.total).toBe(1);
    expect(result.entries[0].containerName).toBe('nginx');
  });

  test('supports pagination', () => {
    for (let i = 0; i < 10; i++) {
      audit.insertAudit({
        action: 'update-available',
        containerName: `container-${i}`,
        status: 'info',
        timestamp: new Date(2024, 0, i + 1).toISOString(),
      } as never);
    }

    const page1 = audit.getAuditEntries({ skip: 0, limit: 3 });
    expect(page1.entries).toHaveLength(3);
    expect(page1.total).toBe(10);

    const page2 = audit.getAuditEntries({ skip: 3, limit: 3 });
    expect(page2.entries).toHaveLength(3);
    expect(page2.total).toBe(10);
  });

  test('filters by date range', () => {
    audit.insertAudit({
      action: 'update-available',
      containerName: 'old',
      status: 'info',
      timestamp: '2024-01-01T00:00:00.000Z',
    } as never);
    audit.insertAudit({
      action: 'update-available',
      containerName: 'new',
      status: 'info',
      timestamp: '2024-06-15T00:00:00.000Z',
    } as never);

    const result = audit.getAuditEntries({
      from: '2024-06-01T00:00:00.000Z',
      to: '2024-12-31T00:00:00.000Z',
    });
    expect(result.total).toBe(1);
    expect(result.entries[0].containerName).toBe('new');
  });

  test('excludes entries newer than the upper date bound', () => {
    audit.insertAudit({
      action: 'update-available',
      containerName: 'old',
      status: 'info',
      timestamp: '2024-01-01T00:00:00.000Z',
    } as never);
    audit.insertAudit({
      action: 'update-available',
      containerName: 'new',
      status: 'info',
      timestamp: '2024-06-15T00:00:00.000Z',
    } as never);

    const result = audit.getAuditEntries({ to: '2024-03-01T00:00:00.000Z' });

    expect(result.total).toBe(1);
    expect(result.entries[0].containerName).toBe('old');
  });

  test('returns empty when from/to timestamps are invalid', () => {
    audit.insertAudit({
      action: 'update-available',
      containerName: 'nginx',
      status: 'info',
    } as never);

    expect(audit.getAuditEntries({ from: 'not-a-date' })).toEqual({ entries: [], total: 0 });
    expect(audit.getAuditEntries({ to: 'also-not-a-date' })).toEqual({ entries: [], total: 0 });
  });

  test('sorts newest first, and preserves insertion order among ties', () => {
    audit.insertAudit({
      action: 'update-available',
      containerName: 'first',
      status: 'info',
      timestamp: '2024-01-01T00:00:00.000Z',
    } as never);
    audit.insertAudit({
      action: 'update-applied',
      containerName: 'second',
      status: 'success',
      timestamp: '2024-06-01T00:00:00.000Z',
    } as never);
    audit.insertAudit({
      action: 'update-failed',
      containerName: 'third',
      status: 'error',
      timestamp: '2024-06-01T00:00:00.000Z',
    } as never);

    const result = audit.getAuditEntries();
    expect(result.entries.map((entry) => entry.containerName)).toEqual([
      'second',
      'third',
      'first',
    ]);
  });

  test('returns empty when the store is not initialized', async () => {
    vi.resetModules();
    const freshAudit = await import('./audit.js');
    expect(freshAudit.getAuditEntries()).toEqual({ entries: [], total: 0 });
  });
});

describe('getRecentEntries', () => {
  test('returns the latest N entries', () => {
    audit.insertAudit({
      action: 'update-available',
      containerName: 'a',
      status: 'info',
      timestamp: '2024-01-01T00:00:00.000Z',
    } as never);
    audit.insertAudit({
      action: 'update-applied',
      containerName: 'b',
      status: 'success',
      timestamp: '2024-06-01T00:00:00.000Z',
    } as never);

    const entries = audit.getRecentEntries(1);
    expect(entries).toHaveLength(1);
    expect(entries[0].containerName).toBe('b');
  });
});

describe('pruneOldEntries', () => {
  test('removes entries older than N days', () => {
    const oldDate = new Date(Date.now() - daysToMs(100)).toISOString();
    const recentDate = new Date().toISOString();

    audit.insertAudit({
      action: 'update-available',
      containerName: 'old',
      status: 'info',
      timestamp: oldDate,
    } as never);
    audit.insertAudit({
      action: 'update-applied',
      containerName: 'recent',
      status: 'success',
      timestamp: recentDate,
    } as never);

    const pruned = audit.pruneOldEntries(30);
    expect(pruned).toBe(1);

    const result = audit.getAuditEntries();
    expect(result.total).toBe(1);
    expect(result.entries[0].containerName).toBe('recent');
  });

  test('returns 0 when the store is not initialized', async () => {
    vi.resetModules();
    const freshAudit = await import('./audit.js');
    expect(freshAudit.pruneOldEntries(30)).toBe(0);
  });
});
