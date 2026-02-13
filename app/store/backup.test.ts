// @ts-nocheck
vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import * as backup from './backup.js';

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
        find: () => [...docs],
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
    expect(db.addCollection).toHaveBeenCalledWith('backups');
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

  test('getBackups should return backups for a specific container sorted by timestamp desc', () => {
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

    const result = backup.getBackups('c1');
    expect(result).toHaveLength(2);
    expect(result[0].imageTag).toBe('1.23');
    expect(result[1].imageTag).toBe('1.22');
  });

  test('getBackups should return empty array for unknown container', () => {
    const result = backup.getBackups('unknown');
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
    const inserted = backup.insertBackup({
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

    const pruned = backup.pruneOldBackups('c1', 2);
    expect(pruned).toBe(2);

    const remaining = backup.getBackups('c1');
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

    backup.pruneOldBackups('c1', 0);

    expect(backup.getBackups('c1')).toHaveLength(0);
    expect(backup.getBackups('c2')).toHaveLength(1);
  });

  test('pruneOldBackups should return 0 when collection not initialized', async () => {
    vi.resetModules();
    const freshBackup = await import('./backup.js');
    const count = freshBackup.pruneOldBackups('c1', 3);
    expect(count).toBe(0);
  });

  test('getBackups should return empty when collection not initialized', async () => {
    vi.resetModules();
    const freshBackup = await import('./backup.js');
    const result = freshBackup.getBackups('c1');
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
