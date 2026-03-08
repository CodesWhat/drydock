vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import * as backup from './backup.js';

function getPathValue(document: Record<string, any>, path: string) {
  return path.split('.').reduce((value, key) => value?.[key], document);
}

function matchesQuery(document: Record<string, any>, query: Record<string, any> | undefined) {
  if (!query || Object.keys(query).length === 0) {
    return true;
  }
  return Object.entries(query).every(
    ([path, expected]) => getPathValue(document, path) === expected,
  );
}

function createDb() {
  const collections = {};
  return {
    getCollection: (name) => collections[name] || null,
    addCollection: (name) => {
      const docs = [];
      collections[name] = {
        insert: (doc) => {
          doc.$loki = docs.length;
          docs.push(doc);
        },
        find: (query = undefined) => docs.filter((doc) => matchesQuery(doc, query)),
        findOne: (query = undefined) => docs.find((doc) => matchesQuery(doc, query)) ?? null,
        ensureIndex: vi.fn(),
        remove: (doc) => {
          const idx = docs.indexOf(doc);
          if (idx >= 0) docs.splice(idx, 1);
        },
      };
      return collections[name];
    },
  };
}

describe('Backup Store', () => {
  beforeEach(() => {
    const db = createDb();
    backup.createCollections(db);
  });

  test('createCollections should create backups collection when not exist', () => {
    const db = {
      getCollection: () => null,
      addCollection: vi.fn(() => ({ insert: vi.fn(), find: vi.fn() })),
    };
    backup.createCollections(db);
    expect(db.addCollection).toHaveBeenCalledWith('backups', {
      indices: ['data.containerName', 'data.id'],
    });
  });

  test('createCollections should not create collection when already exists', () => {
    const existing = { insert: vi.fn(), find: vi.fn() };
    const db = {
      getCollection: () => existing,
      addCollection: vi.fn(),
    };
    backup.createCollections(db);
    expect(db.addCollection).not.toHaveBeenCalled();
  });

  test('insertBackup should insert a backup and return it with id', () => {
    const entry = {
      containerId: 'c1',
      containerName: 'nginx',
      imageName: 'library/nginx',
      imageTag: '1.24',
      triggerName: 'docker.default',
    };
    const result = backup.insertBackup(entry);
    expect(result.id).toBeDefined();
    expect(result.timestamp).toBeDefined();
    expect(result.containerId).toBe('c1');
    expect(result.containerName).toBe('nginx');
    expect(result.imageName).toBe('library/nginx');
    expect(result.imageTag).toBe('1.24');
  });

  test('insertBackup should preserve provided id', () => {
    const entry = {
      id: 'custom-id',
      containerId: 'c1',
      containerName: 'nginx',
      imageName: 'library/nginx',
      imageTag: '1.24',
      triggerName: 'docker.default',
    };
    const result = backup.insertBackup(entry);
    expect(result.id).toBe('custom-id');
  });

  test('getBackupsByName should return backups for a specific container sorted by timestamp desc', () => {
    backup.insertBackup({
      containerId: 'c1',
      containerName: 'nginx',
      imageName: 'library/nginx',
      imageTag: '1.22',
      triggerName: 'docker.default',
      timestamp: '2024-01-01T00:00:00.000Z',
    });
    backup.insertBackup({
      containerId: 'c1',
      containerName: 'nginx',
      imageName: 'library/nginx',
      imageTag: '1.23',
      triggerName: 'docker.default',
      timestamp: '2024-06-01T00:00:00.000Z',
    });
    backup.insertBackup({
      containerId: 'c2',
      containerName: 'redis',
      imageName: 'library/redis',
      imageTag: '7.0',
      triggerName: 'docker.default',
      timestamp: '2024-03-01T00:00:00.000Z',
    });

    const result = backup.getBackupsByName('nginx');
    expect(result).toHaveLength(2);
    expect(result[0].imageTag).toBe('1.23');
    expect(result[1].imageTag).toBe('1.22');
  });

  test('getBackupsByName should return empty array for unknown container', () => {
    const result = backup.getBackupsByName('unknown');
    expect(result).toEqual([]);
  });

  test('getAllBackups should return all backups sorted by timestamp desc', () => {
    backup.insertBackup({
      containerId: 'c1',
      containerName: 'nginx',
      imageName: 'library/nginx',
      imageTag: '1.22',
      triggerName: 'docker.default',
      timestamp: '2024-01-01T00:00:00.000Z',
    });
    backup.insertBackup({
      containerId: 'c2',
      containerName: 'redis',
      imageName: 'library/redis',
      imageTag: '7.0',
      triggerName: 'docker.default',
      timestamp: '2024-06-01T00:00:00.000Z',
    });

    const result = backup.getAllBackups();
    expect(result).toHaveLength(2);
    expect(result[0].containerName).toBe('redis');
  });

  test('getBackup should return a single backup by id', () => {
    backup.insertBackup({
      id: 'b1',
      containerId: 'c1',
      containerName: 'nginx',
      imageName: 'library/nginx',
      imageTag: '1.24',
      triggerName: 'docker.default',
    });

    const result = backup.getBackup('b1');
    expect(result).toBeDefined();
    expect(result.id).toBe('b1');
    expect(result.imageTag).toBe('1.24');
  });

  test('getBackup should return undefined for unknown id', () => {
    const result = backup.getBackup('unknown');
    expect(result).toBeUndefined();
  });

  test('deleteBackup should remove a backup by id', () => {
    backup.insertBackup({
      id: 'b1',
      containerId: 'c1',
      containerName: 'nginx',
      imageName: 'library/nginx',
      imageTag: '1.24',
      triggerName: 'docker.default',
    });

    const deleted = backup.deleteBackup('b1');
    expect(deleted).toBe(true);

    const result = backup.getBackup('b1');
    expect(result).toBeUndefined();
  });

  test('deleteBackup should return false for unknown id', () => {
    const deleted = backup.deleteBackup('unknown');
    expect(deleted).toBe(false);
  });

  test('getBackup/deleteBackup should fall back to find() when findOne is unavailable', () => {
    const docs = [] as Array<{ data: Record<string, unknown> }>;
    const db = {
      getCollection: vi.fn(() => null),
      addCollection: vi.fn(() => ({
        ensureIndex: vi.fn(),
        insert: (doc) => {
          docs.push(doc);
        },
        find: (query = {}) =>
          docs.filter((doc) =>
            Object.entries(query).every(([key, expected]) => {
              const [, path] = key.split('.');
              return (doc.data as Record<string, unknown>)[path] === expected;
            }),
          ),
        remove: (doc) => {
          const idx = docs.indexOf(doc);
          if (idx >= 0) docs.splice(idx, 1);
        },
      })),
    };

    backup.createCollections(db as any);
    backup.insertBackup({
      id: 'legacy-find-path',
      containerId: 'c1',
      containerName: 'nginx',
      imageName: 'library/nginx',
      imageTag: '1.24',
      triggerName: 'docker.default',
    });

    expect(backup.getBackup('legacy-find-path')?.id).toBe('legacy-find-path');
    expect(backup.deleteBackup('legacy-find-path')).toBe(true);
    expect(backup.getBackup('legacy-find-path')).toBeUndefined();
  });

  test('pruneOldBackups should keep only the N most recent backups', () => {
    backup.insertBackup({
      containerId: 'c1',
      containerName: 'nginx',
      imageName: 'library/nginx',
      imageTag: '1.20',
      triggerName: 'docker.default',
      timestamp: '2024-01-01T00:00:00.000Z',
    });
    backup.insertBackup({
      containerId: 'c1',
      containerName: 'nginx',
      imageName: 'library/nginx',
      imageTag: '1.21',
      triggerName: 'docker.default',
      timestamp: '2024-03-01T00:00:00.000Z',
    });
    backup.insertBackup({
      containerId: 'c1',
      containerName: 'nginx',
      imageName: 'library/nginx',
      imageTag: '1.22',
      triggerName: 'docker.default',
      timestamp: '2024-06-01T00:00:00.000Z',
    });
    backup.insertBackup({
      containerId: 'c1',
      containerName: 'nginx',
      imageName: 'library/nginx',
      imageTag: '1.23',
      triggerName: 'docker.default',
      timestamp: '2024-09-01T00:00:00.000Z',
    });

    const pruned = backup.pruneOldBackups('nginx', 2);
    expect(pruned).toBe(2);

    const remaining = backup.getBackupsByName('nginx');
    expect(remaining).toHaveLength(2);
    expect(remaining[0].imageTag).toBe('1.23');
    expect(remaining[1].imageTag).toBe('1.22');
  });

  test('pruneOldBackups should not affect other containers', () => {
    backup.insertBackup({
      containerId: 'c1',
      containerName: 'nginx',
      imageName: 'library/nginx',
      imageTag: '1.20',
      triggerName: 'docker.default',
      timestamp: '2024-01-01T00:00:00.000Z',
    });
    backup.insertBackup({
      containerId: 'c2',
      containerName: 'redis',
      imageName: 'library/redis',
      imageTag: '7.0',
      triggerName: 'docker.default',
      timestamp: '2024-01-01T00:00:00.000Z',
    });

    backup.pruneOldBackups('nginx', 0);

    expect(backup.getBackupsByName('nginx')).toHaveLength(0);
    expect(backup.getBackupsByName('redis')).toHaveLength(1);
  });

  test('pruneOldBackups should not remove backups when maxCount is undefined', () => {
    backup.insertBackup({
      containerId: 'c1',
      containerName: 'nginx',
      imageName: 'library/nginx',
      imageTag: '1.20',
      triggerName: 'docker.default',
      timestamp: '2024-01-01T00:00:00.000Z',
    });
    backup.insertBackup({
      containerId: 'c1',
      containerName: 'nginx',
      imageName: 'library/nginx',
      imageTag: '1.21',
      triggerName: 'docker.default',
      timestamp: '2024-03-01T00:00:00.000Z',
    });

    const pruned = backup.pruneOldBackups('nginx', undefined as any);

    expect(pruned).toBe(0);
    expect(backup.getBackupsByName('nginx')).toHaveLength(2);
  });

  test('pruneOldBackups should return 0 when collection not initialized', async () => {
    vi.resetModules();
    const freshBackup = await import('./backup.js');
    const count = freshBackup.pruneOldBackups('c1', 3);
    expect(count).toBe(0);
  });

  test('getBackupsByName should return empty when collection not initialized', async () => {
    vi.resetModules();
    const freshBackup = await import('./backup.js');
    const result = freshBackup.getBackupsByName('nginx');
    expect(result).toEqual([]);
  });

  test('getAllBackups should return empty when collection not initialized', async () => {
    vi.resetModules();
    const freshBackup = await import('./backup.js');
    const result = freshBackup.getAllBackups();
    expect(result).toEqual([]);
  });

  test('getBackup should return undefined when collection not initialized', async () => {
    vi.resetModules();
    const freshBackup = await import('./backup.js');
    const result = freshBackup.getBackup('b1');
    expect(result).toBeUndefined();
  });

  test('deleteBackup should return false when collection not initialized', async () => {
    vi.resetModules();
    const freshBackup = await import('./backup.js');
    const result = freshBackup.deleteBackup('b1');
    expect(result).toBe(false);
  });

  test('insertBackup should return generated values when collection not initialized', async () => {
    vi.resetModules();
    const freshBackup = await import('./backup.js');
    const result = freshBackup.insertBackup({
      containerId: 'c1',
      containerName: 'nginx',
      imageName: 'library/nginx',
      imageTag: '1.24',
      triggerName: 'docker.default',
    });
    expect(result.id).toBeDefined();
    expect(result.timestamp).toBeDefined();
  });
});
