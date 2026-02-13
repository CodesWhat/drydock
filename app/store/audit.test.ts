import { beforeEach, describe, expect, test, vi } from 'vitest';
vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import * as audit from './audit.js';

function createDb() {
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
        find: () => [...docs],
        remove: (doc) => {
          var idx = docs.indexOf(doc);
          if (idx >= 0) docs.splice(idx, 1);
        },
      };
      return collections[name];
    },
  };
}

describe('Audit Store', () => {
  beforeEach(() => {
    var db = createDb();
    audit.createCollections(db);
  });

  test('createCollections should create audit collection when not exist', () => {
    var db = {
      getCollection: () => null,
      addCollection: vi.fn(() => ({ insert: vi.fn(), find: vi.fn() })),
    };
    audit.createCollections(db);
    expect(db.addCollection).toHaveBeenCalledWith('audit');
  });

  test('createCollections should not create collection when already exists', () => {
    var existing = { insert: vi.fn(), find: vi.fn() };
    var db = {
      getCollection: () => existing,
      addCollection: vi.fn(),
    };
    audit.createCollections(db);
    expect(db.addCollection).not.toHaveBeenCalled();
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
    var oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
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

  test('pruneOldEntries should return 0 when collection not initialized', async () => {
    vi.resetModules();
    var freshAudit = await import('./audit.js');
    var count = freshAudit.pruneOldEntries(30);
    expect(count).toBe(0);
  });
});
