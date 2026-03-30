import { beforeEach, describe, expect, test, vi } from 'vitest';
import { daysToMs } from '../model/maturity-policy.js';

vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import * as audit from './audit.js';

function createDb() {
  function getByPath(object, path) {
    return path.split('.').reduce((acc, key) => acc?.[key], object);
  }

  function matchesQueryValue(actual, expected) {
    if (expected && typeof expected === 'object' && '$in' in expected) {
      return Array.isArray(expected.$in) && expected.$in.includes(actual);
    }
    return actual === expected;
  }

  function matchesQuery(doc, query = {}) {
    return Object.entries(query).every(([key, value]) =>
      matchesQueryValue(getByPath(doc, key), value),
    );
  }

  var collections = {};
  return {
    getCollection: (name) => collections[name] || null,
    addCollection: (name) => {
      var docs = [];
      collections[name] = {
        insert: (doc) => {
          doc.$loki = docs.length;
          docs.push(doc);
        },
        find: (query = {}) => docs.filter((doc) => matchesQuery(doc, query)),
        remove: (doc) => {
          var idx = docs.indexOf(doc);
          if (idx >= 0) docs.splice(idx, 1);
        },
      };
      return collections[name];
    },
  };
}

function createChainDb(initialDocs = []) {
  function getByPath(object, path) {
    return path.split('.').reduce((acc, key) => acc?.[key], object);
  }

  function matchesQueryValue(actual, expected) {
    if (expected && typeof expected === 'object' && '$in' in expected) {
      return Array.isArray(expected.$in) && expected.$in.includes(actual);
    }
    return actual === expected;
  }

  function matchesQuery(doc, query = {}) {
    return Object.entries(query).every(([key, value]) =>
      matchesQueryValue(getByPath(doc, key), value),
    );
  }

  const docs = initialDocs.map((doc, index) => ({
    ...doc,
    $loki: index,
  }));

  const collection = {
    insert: (doc) => {
      doc.$loki = docs.length;
      docs.push(doc);
    },
    find: (query = {}) => docs.filter((doc) => matchesQuery(doc, query)),
    remove: (doc) => {
      const idx = docs.indexOf(doc);
      if (idx >= 0) docs.splice(idx, 1);
    },
    update: vi.fn(),
    chain: () => {
      let current = [...docs];
      const chainApi = {
        find: (query = {}) => {
          if (
            query &&
            typeof query === 'object' &&
            'timestampMs' in query &&
            typeof query.timestampMs === 'object'
          ) {
            const range = query.timestampMs as { $gte?: number; $lte?: number };
            current = current.filter((entry) => {
              const timestampMs = entry.timestampMs;
              if (typeof timestampMs !== 'number') return false;
              if (range.$gte !== undefined && timestampMs < range.$gte) return false;
              if (range.$lte !== undefined && timestampMs > range.$lte) return false;
              return true;
            });
            return chainApi;
          }

          current = current.filter((entry) =>
            matchesQuery(entry, query as Record<string, unknown>),
          );
          return chainApi;
        },
        simplesort: (field, descending) => {
          current = [...current].sort((a, b) => {
            const left = Number((a as Record<string, unknown>)[field]) || 0;
            const right = Number((b as Record<string, unknown>)[field]) || 0;
            return descending ? right - left : left - right;
          });
          return chainApi;
        },
        data: () => current,
      };
      return chainApi;
    },
  };

  return {
    collection,
    getCollection: (name) => (name === 'audit' ? collection : null),
    addCollection: vi.fn(() => collection),
  };
}

function createPruneChainDb(initialDocs = []) {
  const docs = initialDocs.map((doc, index) => ({
    ...doc,
    $loki: index,
  }));

  const find = vi.fn((query = {}) => {
    if (!query || Object.keys(query).length === 0) {
      return [...docs];
    }
    return [];
  });

  const collection = {
    insert: vi.fn((doc) => {
      doc.$loki = docs.length;
      docs.push(doc);
    }),
    find,
    remove: vi.fn((doc) => {
      const idx = docs.indexOf(doc);
      if (idx >= 0) docs.splice(idx, 1);
    }),
    update: vi.fn(),
    chain: () => {
      let current = [...docs];
      const chainApi = {
        find: (query = {}) => {
          if (
            query &&
            typeof query === 'object' &&
            'timestampMs' in query &&
            typeof query.timestampMs === 'object'
          ) {
            const range = query.timestampMs as { $lt?: number };
            current = current.filter((entry) => {
              const timestampMs = entry.timestampMs;
              if (typeof timestampMs !== 'number') return false;
              if (range.$lt !== undefined && timestampMs >= range.$lt) return false;
              return true;
            });
          }
          return chainApi;
        },
        data: () => [...current],
        remove: () => {
          current.forEach((entry) => {
            const idx = docs.indexOf(entry);
            if (idx >= 0) docs.splice(idx, 1);
          });
          return chainApi;
        },
      };
      return chainApi;
    },
  };

  return {
    collection,
    docs,
    getCollection: (name) => (name === 'audit' ? collection : null),
    addCollection: vi.fn(() => collection),
  };
}

describe('Audit Store', () => {
  let db;

  beforeEach(() => {
    db = createDb();
    audit.createCollections(db);
  });

  test('createCollections should create audit collection when not exist', () => {
    var db = {
      getCollection: () => null,
      addCollection: vi.fn(() => ({ insert: vi.fn(), find: vi.fn(), ensureIndex: vi.fn() })),
    };
    audit.createCollections(db);
    expect(db.addCollection).toHaveBeenCalledWith(
      'audit',
      expect.objectContaining({
        indices: expect.arrayContaining(['data.action', 'data.timestamp', 'timestampMs']),
      }),
    );
  });

  test('createCollections should not create collection when already exists and should ensure indexes', () => {
    var existing = { insert: vi.fn(), find: vi.fn(), ensureIndex: vi.fn() };
    var db = {
      getCollection: () => existing,
      addCollection: vi.fn(),
    };
    audit.createCollections(db);
    expect(db.addCollection).not.toHaveBeenCalled();
    expect(existing.ensureIndex).toHaveBeenCalledWith('data.action');
    expect(existing.ensureIndex).toHaveBeenCalledWith('data.timestamp');
    expect(existing.ensureIndex).toHaveBeenCalledWith('timestampMs');
  });

  test('createCollections should tolerate existing collections without find support', () => {
    var existing = { insert: vi.fn(), ensureIndex: vi.fn() };
    var db = {
      getCollection: () => existing,
      addCollection: vi.fn(),
    };

    expect(() => audit.createCollections(db)).not.toThrow();
  });

  test('createCollections should migrate existing entries missing timestampMs', () => {
    const timestamp = new Date().toISOString();
    const dbWithChain = createChainDb([
      {
        data: {
          id: 'existing-id',
          action: 'update-applied',
          containerName: 'api',
          status: 'success',
          timestamp,
        },
      },
    ]);

    audit.createCollections(dbWithChain as any);

    expect(dbWithChain.collection.update).toHaveBeenCalledTimes(1);
    expect(dbWithChain.collection.find()[0].timestampMs).toBe(new Date(timestamp).getTime());
  });

  test('insertAudit should insert an entry and return it with id', () => {
    var entry = {
      action: 'update-available',
      containerName: 'nginx',
      status: 'info',
    };
    var result = audit.insertAudit(entry);
    expect(result.id).toBeDefined();
    expect(result.timestamp).toBeDefined();
    expect(result.action).toBe('update-available');
    expect(result.containerName).toBe('nginx');
  });

  test('insertAudit should preserve provided id', () => {
    var entry = {
      id: 'custom-id',
      action: 'update-applied',
      containerName: 'redis',
      status: 'success',
    };
    var result = audit.insertAudit(entry);
    expect(result.id).toBe('custom-id');
  });

  test('insertAudit should pre-parse and store timestampMs for indexed date queries', () => {
    var timestamp = '2024-06-01T12:34:56.000Z';
    var result = audit.insertAudit({
      action: 'update-applied',
      containerName: 'redis',
      status: 'success',
      timestamp,
    });

    var stored = db.getCollection('audit').find({ 'data.id': result.id })[0];
    expect(stored.timestampMs).toBe(new Date(timestamp).getTime());
  });

  test('insertAudit should prune entries older than the retention window', () => {
    var oldDate = new Date(Date.now() - daysToMs(100)).toISOString();

    audit.insertAudit({
      action: 'update-available',
      containerName: 'old',
      status: 'info',
      timestamp: oldDate,
    });

    for (let i = 0; i < 99; i++) {
      audit.insertAudit({
        action: 'update-applied',
        containerName: `recent-${i}`,
        status: 'success',
      });
    }

    var oldEntries = audit.getAuditEntries({ container: 'old' });
    expect(oldEntries.total).toBe(0);
  });

  test('insertAudit should periodically prune stale entries even with low insert volume', () => {
    vi.useFakeTimers();
    try {
      audit.createCollections(db);
      const oldDate = new Date(Date.now() - daysToMs(100)).toISOString();

      audit.insertAudit({
        action: 'update-available',
        containerName: 'old',
        status: 'info',
        timestamp: oldDate,
      });
      audit.insertAudit({
        action: 'update-applied',
        containerName: 'recent',
        status: 'success',
      });

      expect(audit.getAuditEntries({ container: 'old' }).total).toBe(1);

      vi.advanceTimersByTime(daysToMs(1));

      expect(audit.getAuditEntries({ container: 'old' }).total).toBe(0);
      expect(audit.getAuditEntries({ container: 'recent' }).total).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('createCollections should tolerate timer handles without unref support', () => {
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

  test('getAuditEntries should return all entries', () => {
    audit.insertAudit({ action: 'update-available', containerName: 'nginx', status: 'info' });
    audit.insertAudit({ action: 'update-applied', containerName: 'redis', status: 'success' });

    var result = audit.getAuditEntries();
    expect(result.total).toBe(2);
    expect(result.entries).toHaveLength(2);
  });

  test('getAuditEntries should filter by action', () => {
    audit.insertAudit({ action: 'update-available', containerName: 'nginx', status: 'info' });
    audit.insertAudit({ action: 'update-applied', containerName: 'redis', status: 'success' });

    var result = audit.getAuditEntries({ action: 'update-applied' });
    expect(result.total).toBe(1);
    expect(result.entries[0].containerName).toBe('redis');
  });

  test('getAuditEntries should filter by multiple actions', () => {
    audit.insertAudit({ action: 'update-available', containerName: 'nginx', status: 'info' });
    audit.insertAudit({ action: 'update-applied', containerName: 'redis', status: 'success' });
    audit.insertAudit({ action: 'container-update', containerName: 'postgres', status: 'info' });
    audit.insertAudit({ action: 'security-alert', containerName: 'mysql', status: 'error' });

    var result = audit.getAuditEntries({ actions: ['update-available', 'security-alert'] });
    expect(result.total).toBe(2);
    const actionTypes = result.entries.map((e) => e.action);
    expect(actionTypes).toContain('update-available');
    expect(actionTypes).toContain('security-alert');
    expect(actionTypes).not.toContain('container-update');
    expect(actionTypes).not.toContain('update-applied');
  });

  test('getAuditEntries should prefer action over actions when both provided', () => {
    audit.insertAudit({ action: 'update-available', containerName: 'nginx', status: 'info' });
    audit.insertAudit({ action: 'update-applied', containerName: 'redis', status: 'success' });
    audit.insertAudit({ action: 'security-alert', containerName: 'mysql', status: 'error' });

    var result = audit.getAuditEntries({
      action: 'update-available',
      actions: ['update-applied', 'security-alert'],
    });
    expect(result.total).toBe(1);
    expect(result.entries[0].action).toBe('update-available');
  });

  test('getAuditEntries should filter by container name', () => {
    audit.insertAudit({ action: 'update-available', containerName: 'nginx', status: 'info' });
    audit.insertAudit({ action: 'update-available', containerName: 'redis', status: 'info' });

    var result = audit.getAuditEntries({ container: 'nginx' });
    expect(result.total).toBe(1);
    expect(result.entries[0].containerName).toBe('nginx');
  });

  test('getAuditEntries should support pagination', () => {
    for (let i = 0; i < 10; i++) {
      audit.insertAudit({
        action: 'update-available',
        containerName: `container-${i}`,
        status: 'info',
        timestamp: new Date(2024, 0, i + 1).toISOString(),
      });
    }

    var page1 = audit.getAuditEntries({ skip: 0, limit: 3 });
    expect(page1.entries).toHaveLength(3);
    expect(page1.total).toBe(10);

    var page2 = audit.getAuditEntries({ skip: 3, limit: 3 });
    expect(page2.entries).toHaveLength(3);
    expect(page2.total).toBe(10);
  });

  test('getAuditEntries should filter by date range', () => {
    audit.insertAudit({
      action: 'update-available',
      containerName: 'old',
      status: 'info',
      timestamp: '2024-01-01T00:00:00.000Z',
    });
    audit.insertAudit({
      action: 'update-available',
      containerName: 'new',
      status: 'info',
      timestamp: '2024-06-15T00:00:00.000Z',
    });

    var result = audit.getAuditEntries({
      from: '2024-06-01T00:00:00.000Z',
      to: '2024-12-31T00:00:00.000Z',
    });
    expect(result.total).toBe(1);
    expect(result.entries[0].containerName).toBe('new');
  });

  test('getAuditEntries should exclude fallback entries newer than the upper date bound', () => {
    audit.insertAudit({
      action: 'update-available',
      containerName: 'old',
      status: 'info',
      timestamp: '2024-01-01T00:00:00.000Z',
    });
    audit.insertAudit({
      action: 'update-available',
      containerName: 'new',
      status: 'info',
      timestamp: '2024-06-15T00:00:00.000Z',
    });

    const result = audit.getAuditEntries({
      to: '2024-03-01T00:00:00.000Z',
    });

    expect(result.total).toBe(1);
    expect(result.entries[0].containerName).toBe('old');
  });

  test('getAuditEntries should return empty when from/to timestamps are invalid', () => {
    audit.insertAudit({ action: 'update-available', containerName: 'nginx', status: 'info' });

    expect(
      audit.getAuditEntries({
        from: 'not-a-date',
      }),
    ).toEqual({ entries: [], total: 0 });
    expect(
      audit.getAuditEntries({
        to: 'also-not-a-date',
      }),
    ).toEqual({ entries: [], total: 0 });
  });

  test('getAuditEntries should use the indexed chain query path when available', () => {
    const dbWithChain = createChainDb();
    audit.createCollections(dbWithChain as any);

    audit.insertAudit({
      action: 'update-available',
      containerName: 'old',
      status: 'info',
      timestamp: '2024-01-01T00:00:00.000Z',
    });
    audit.insertAudit({
      action: 'update-applied',
      containerName: 'new',
      status: 'success',
      timestamp: '2024-06-01T00:00:00.000Z',
    });
    audit.insertAudit({
      action: 'update-failed',
      containerName: 'future',
      status: 'error',
      timestamp: '2025-01-01T00:00:00.000Z',
    });

    const result = audit.getAuditEntries({
      from: '2024-01-01T00:00:00.000Z',
      to: '2024-12-31T00:00:00.000Z',
      limit: 10,
    });

    expect(result.total).toBe(2);
    expect(result.entries.map((entry) => entry.containerName)).toEqual(['new', 'old']);
  });

  test('getAuditEntries should support indexed chain queries without date filters and with pagination', () => {
    const dbWithChain = createChainDb();
    audit.createCollections(dbWithChain as any);

    audit.insertAudit({
      action: 'update-available',
      containerName: 'first',
      status: 'info',
      timestamp: '2024-01-01T00:00:00.000Z',
    });
    audit.insertAudit({
      action: 'update-applied',
      containerName: 'second',
      status: 'success',
      timestamp: '2024-06-01T00:00:00.000Z',
    });
    audit.insertAudit({
      action: 'update-failed',
      containerName: 'third',
      status: 'error',
      timestamp: '2024-09-01T00:00:00.000Z',
    });

    const result = audit.getAuditEntries({
      skip: 1,
      limit: 1,
    });

    expect(result.total).toBe(3);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].containerName).toBe('second');
  });

  test('getAuditEntries should apply indexed chain date filters when only one bound is provided', () => {
    const dbWithChain = createChainDb();
    audit.createCollections(dbWithChain as any);

    audit.insertAudit({
      action: 'update-available',
      containerName: 'first',
      status: 'info',
      timestamp: '2024-01-01T00:00:00.000Z',
    });
    audit.insertAudit({
      action: 'update-applied',
      containerName: 'second',
      status: 'success',
      timestamp: '2024-06-01T00:00:00.000Z',
    });
    audit.insertAudit({
      action: 'update-failed',
      containerName: 'third',
      status: 'error',
      timestamp: '2025-01-01T00:00:00.000Z',
    });

    const fromOnly = audit.getAuditEntries({
      from: '2024-06-01T00:00:00.000Z',
    });
    expect(fromOnly.entries.map((entry) => entry.containerName)).toEqual(['third', 'second']);

    const toOnly = audit.getAuditEntries({
      to: '2024-06-01T00:00:00.000Z',
    });
    expect(toOnly.entries.map((entry) => entry.containerName)).toEqual(['second', 'first']);
  });

  test('getAuditEntries should fall back to collection find when chain does not expose full sort/data methods', () => {
    const docs = [] as any[];
    const chained = {
      find: () => chained,
      simplesort: () => chained,
    };
    const existing = {
      insert: (doc) => docs.push(doc),
      find: (query = {}) =>
        docs.filter((doc) =>
          Object.entries(query).every(([path, expected]) => {
            const keys = path.split('.');
            return keys.reduce((value: any, key) => value?.[key], doc) === expected;
          }),
        ),
      remove: vi.fn(),
      ensureIndex: vi.fn(),
      chain: () => chained,
    };
    const db = {
      getCollection: () => existing,
      addCollection: vi.fn(),
    };

    audit.createCollections(db);
    audit.insertAudit({
      action: 'update-applied',
      containerName: 'fallback',
      status: 'success',
      timestamp: '2024-06-01T00:00:00.000Z',
    });

    const result = audit.getAuditEntries({
      action: 'update-applied',
    });
    expect(result.total).toBe(1);
    expect(result.entries[0].containerName).toBe('fallback');
  });

  test('getAuditEntries should normalize invalid stored timestamps when update() support is absent', () => {
    const dbWithoutUpdate = createDb();
    audit.createCollections(dbWithoutUpdate);
    dbWithoutUpdate.getCollection('audit').insert({
      data: {
        id: 'legacy-invalid',
        action: 'update-applied',
        containerName: 'legacy',
        status: 'success',
        timestamp: 'not-a-date',
      },
    });

    const result = audit.getAuditEntries({
      from: '1970-01-01T00:00:00.001Z',
    });
    expect(result.total).toBe(0);
  });

  test('insertAudit should return normalized entry when collection is not initialized', async () => {
    vi.resetModules();
    const freshAudit = await import('./audit.js');

    const result = freshAudit.insertAudit({
      action: 'update-applied',
      containerName: 'standalone',
      status: 'success',
    });

    expect(result.id).toBeDefined();
    expect(result.timestamp).toBeDefined();
    expect(result.containerName).toBe('standalone');
  });

  test('getAuditEntries should return empty when collection not initialized', async () => {
    vi.resetModules();
    var freshAudit = await import('./audit.js');
    var result = freshAudit.getAuditEntries();
    expect(result).toEqual({ entries: [], total: 0 });
  });

  test('getRecentEntries should return latest N entries', () => {
    audit.insertAudit({
      action: 'update-available',
      containerName: 'a',
      status: 'info',
      timestamp: '2024-01-01T00:00:00.000Z',
    });
    audit.insertAudit({
      action: 'update-applied',
      containerName: 'b',
      status: 'success',
      timestamp: '2024-06-01T00:00:00.000Z',
    });

    var entries = audit.getRecentEntries(1);
    expect(entries).toHaveLength(1);
    expect(entries[0].containerName).toBe('b');
  });

  test('pruneOldEntries should remove entries older than N days', () => {
    var oldDate = new Date(Date.now() - daysToMs(100)).toISOString();
    var recentDate = new Date().toISOString();

    audit.insertAudit({
      action: 'update-available',
      containerName: 'old',
      status: 'info',
      timestamp: oldDate,
    });
    audit.insertAudit({
      action: 'update-applied',
      containerName: 'recent',
      status: 'success',
      timestamp: recentDate,
    });

    var pruned = audit.pruneOldEntries(30);
    expect(pruned).toBe(1);

    var result = audit.getAuditEntries();
    expect(result.total).toBe(1);
    expect(result.entries[0].containerName).toBe('recent');
  });

  test('pruneOldEntries should use indexed chain removal when available', () => {
    const oldTimestamp = Date.now() - daysToMs(100);
    const recentTimestamp = Date.now();
    const dbWithChainPrune = createPruneChainDb();
    audit.createCollections(dbWithChainPrune as any);
    audit.insertAudit({
      action: 'update-available',
      containerName: 'old',
      status: 'info',
      timestamp: new Date(oldTimestamp).toISOString(),
    });
    audit.insertAudit({
      action: 'update-applied',
      containerName: 'recent',
      status: 'success',
      timestamp: new Date(recentTimestamp).toISOString(),
    });
    dbWithChainPrune.collection.find.mockClear();

    const pruned = audit.pruneOldEntries(30);

    expect(pruned).toBe(1);
    expect(dbWithChainPrune.collection.find).not.toHaveBeenCalledWith();
    expect(dbWithChainPrune.collection.remove).not.toHaveBeenCalled();
    expect(
      dbWithChainPrune.docs
        .map((entry) => entry.data.containerName)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(['recent']);
  });

  test('pruneOldEntries should return 0 when chain data payload is not an array', () => {
    const collection = {
      find: vi.fn(() => []),
      remove: vi.fn(),
      chain: () => ({
        find: () => ({
          data: () => ({ unexpected: true }),
          remove: vi.fn(),
        }),
      }),
    };
    const db = {
      getCollection: () => collection,
      addCollection: () => collection,
    };
    audit.createCollections(db as any);

    const pruned = audit.pruneOldEntries(30);

    expect(pruned).toBe(0);
    expect(collection.remove).not.toHaveBeenCalled();
  });

  test('pruneOldEntries should return 0 when collection not initialized', async () => {
    vi.resetModules();
    var freshAudit = await import('./audit.js');
    var count = freshAudit.pruneOldEntries(30);
    expect(count).toBe(0);
  });
});
