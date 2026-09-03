vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import {
  buildRollbackImageReference,
  createContainerBackupScope,
  RollbackDigestRequiredError,
  resolveRollbackImageReference,
} from '../util/backup.js';
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
      indices: ['data.containerName', 'data.containerIdentityKey', 'data.id'],
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

  test('isBackupInScope rejects a backup with a different container name', () => {
    expect(
      backup.isBackupInScope(
        {
          id: 'backup-other',
          containerId: 'c-other',
          containerName: 'other',
          imageName: 'library/nginx',
          imageTag: '1.24',
          triggerName: 'docker.default',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
        {
          containerName: 'nginx',
          containerIdentityKey: '::local::nginx',
          includeLegacy: true,
        },
      ),
    ).toBe(false);
  });

  test('createContainerBackupScope ignores other names and rejects ambiguous unknown identities', () => {
    const container = { id: 'target', name: 'web', watcher: 'local' } as any;

    expect(
      createContainerBackupScope(container, [
        container,
        { id: 'other-name', name: 'db' } as any,
        { id: 'unknown-web', name: 'web' } as any,
      ]),
    ).toMatchObject({ containerName: 'web', includeLegacy: false });
  });

  test('buildRollbackImageReference falls back to a tag when no digest was recorded', () => {
    expect(
      buildRollbackImageReference({ imageName: 'registry.example/app', imageTag: '1.2.3' }),
    ).toBe('registry.example/app:1.2.3');
  });

  test('buildRollbackImageReference keeps the tag alongside a recorded digest', () => {
    expect(
      buildRollbackImageReference({
        imageName: 'registry.example/app',
        imageTag: '1.2.3',
        imageDigest: 'sha256:aaa',
      }),
    ).toBe('registry.example/app:1.2.3@sha256:aaa');
  });

  test('buildRollbackImageReference uses a fallback digest when none was recorded', () => {
    expect(
      buildRollbackImageReference(
        { imageName: 'registry.example/app', imageTag: '1.2.3' },
        'sha256:fallback',
      ),
    ).toBe('registry.example/app:1.2.3@sha256:fallback');
  });

  test('buildRollbackImageReference drops the tag when the record carries no tag', () => {
    expect(
      buildRollbackImageReference({
        imageName: 'registry.example/app',
        imageTag: '',
        imageDigest: 'sha256:aaa',
      }),
    ).toBe('registry.example/app@sha256:aaa');
  });

  describe('resolveRollbackImageReference', () => {
    const backupRecord = { imageName: 'registry.example/app', imageTag: '1.2.3' };
    const logContainer = { info: vi.fn(), warn: vi.fn() };

    beforeEach(() => {
      logContainer.info.mockClear();
      logContainer.warn.mockClear();
    });

    test('uses the recorded digest without consulting the trigger', async () => {
      const trigger = { bindPulledImageIdentity: vi.fn() };

      await expect(
        resolveRollbackImageReference(
          trigger,
          {},
          {},
          { ...backupRecord, imageDigest: 'sha256:recorded' },
          logContainer,
        ),
      ).resolves.toBe('registry.example/app:1.2.3@sha256:recorded');
      expect(trigger.bindPulledImageIdentity).not.toHaveBeenCalled();
    });

    test('falls back to the tag with a warning when the trigger exposes no identity binder', async () => {
      const trigger = {};

      await expect(
        resolveRollbackImageReference(trigger, {}, {}, backupRecord, logContainer),
      ).resolves.toBe('registry.example/app:1.2.3');
      expect(logContainer.warn).toHaveBeenCalledWith(
        expect.stringContaining('No digest recorded for the backup of registry.example/app:1.2.3'),
      );
    });

    test('resolves an older record through the identity binder', async () => {
      const trigger = {
        bindPulledImageIdentity: vi
          .fn()
          .mockResolvedValue({ imageIdentity: 'registry.example/app:1.2.3@sha256:resolved' }),
      };
      const dockerApi = {};
      const container = { name: 'app' };

      await expect(
        resolveRollbackImageReference(trigger, dockerApi, container, backupRecord, logContainer),
      ).resolves.toBe('registry.example/app:1.2.3@sha256:resolved');
      expect(trigger.bindPulledImageIdentity).toHaveBeenCalledWith(
        dockerApi,
        'registry.example/app:1.2.3',
        container,
        logContainer,
      );
    });

    test('falls back to the tag with a warning when the identity binder returns a reference with no digest separator', async () => {
      const trigger = {
        bindPulledImageIdentity: vi
          .fn()
          .mockResolvedValue({ imageIdentity: 'registry.example/app:1.2.3' }),
      };

      await expect(
        resolveRollbackImageReference(trigger, {}, {}, backupRecord, logContainer),
      ).resolves.toBe('registry.example/app:1.2.3');
      expect(logContainer.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'No digest could be established for the rollback of registry.example/app:1.2.3',
        ),
      );
    });

    test('falls back to the tag with a warning when the identity binder finds no digest', async () => {
      const trigger = { bindPulledImageIdentity: vi.fn().mockResolvedValue({}) };

      await expect(
        resolveRollbackImageReference(trigger, {}, {}, backupRecord, logContainer),
      ).resolves.toBe('registry.example/app:1.2.3');
      expect(logContainer.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'No digest could be established for the rollback of registry.example/app:1.2.3',
        ),
      );
    });

    test('refuses the rollback when the identity binder refuses under a required policy', async () => {
      const trigger = {
        bindPulledImageIdentity: vi.fn().mockRejectedValue(new Error('policy required')),
      };

      const promise = resolveRollbackImageReference(trigger, {}, {}, backupRecord, logContainer);
      await expect(promise).rejects.toBeInstanceOf(RollbackDigestRequiredError);
      await expect(promise).rejects.toThrow(
        'Cannot roll back registry.example/app:1.2.3 to an immutable reference: policy required',
      );
    });

    test('refuses the rollback under a required policy when the local tag now points at the running image', async () => {
      const trigger = {
        bindPulledImageIdentity: vi.fn(),
        getRollbackIdentityBindingPolicy: vi.fn().mockReturnValue('required'),
      };
      const dockerApi = {
        getImage: vi.fn(() => ({ inspect: vi.fn().mockResolvedValue({ Id: 'sha256:running' }) })),
      };
      const container = { image: { id: 'sha256:running' } };

      const promise = resolveRollbackImageReference(
        trigger,
        dockerApi,
        container,
        backupRecord,
        logContainer,
      );
      await expect(promise).rejects.toBeInstanceOf(RollbackDigestRequiredError);
      await expect(promise).rejects.toThrow(
        'Cannot roll back registry.example/app:1.2.3 to an immutable reference: the local tag now points at the running image, not the retained backup',
      );
      expect(trigger.bindPulledImageIdentity).not.toHaveBeenCalled();
    });

    test('falls back to the tag with a warning under an optional policy when the local tag now points at the running image', async () => {
      const trigger = {
        bindPulledImageIdentity: vi.fn(),
        getRollbackIdentityBindingPolicy: vi.fn().mockReturnValue('optional'),
      };
      const dockerApi = {
        getImage: vi.fn(() => ({ inspect: vi.fn().mockResolvedValue({ Id: 'sha256:running' }) })),
      };
      const container = { image: { id: 'sha256:running' } };

      await expect(
        resolveRollbackImageReference(trigger, dockerApi, container, backupRecord, logContainer),
      ).resolves.toBe('registry.example/app:1.2.3');
      expect(trigger.bindPulledImageIdentity).not.toHaveBeenCalled();
      expect(logContainer.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'The local registry.example/app:1.2.3 tag now points at the running image',
        ),
      );
    });

    test('treats a same-tag hazard as disabled when the trigger exposes no rollback binding policy method', async () => {
      const trigger = { bindPulledImageIdentity: vi.fn() };
      const dockerApi = {
        getImage: vi.fn(() => ({ inspect: vi.fn().mockResolvedValue({ Id: 'sha256:running' }) })),
      };
      const container = { image: { id: 'sha256:running' } };

      await expect(
        resolveRollbackImageReference(trigger, dockerApi, container, backupRecord, logContainer),
      ).resolves.toBe('registry.example/app:1.2.3');
      expect(trigger.bindPulledImageIdentity).not.toHaveBeenCalled();
      expect(logContainer.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'The local registry.example/app:1.2.3 tag now points at the running image',
        ),
      );
    });

    test('still resolves through the binder when the local image inspect fails', async () => {
      const trigger = {
        bindPulledImageIdentity: vi
          .fn()
          .mockResolvedValue({ imageIdentity: 'registry.example/app:1.2.3@sha256:resolved' }),
        getRollbackIdentityBindingPolicy: vi.fn().mockReturnValue('required'),
      };
      const dockerApi = {
        getImage: vi.fn(() => ({ inspect: vi.fn().mockRejectedValue(new Error('no such image')) })),
      };
      const container = { image: { id: 'sha256:running' } };

      await expect(
        resolveRollbackImageReference(trigger, dockerApi, container, backupRecord, logContainer),
      ).resolves.toBe('registry.example/app:1.2.3@sha256:resolved');
      expect(trigger.bindPulledImageIdentity).toHaveBeenCalled();
    });

    test('still resolves through the binder when the local tag points at a different, retained image', async () => {
      const trigger = {
        bindPulledImageIdentity: vi
          .fn()
          .mockResolvedValue({ imageIdentity: 'registry.example/app:1.2.3@sha256:resolved' }),
        getRollbackIdentityBindingPolicy: vi.fn().mockReturnValue('required'),
      };
      const dockerApi = {
        getImage: vi.fn(() => ({
          inspect: vi.fn().mockResolvedValue({ Id: 'sha256:retained-old' }),
        })),
      };
      const container = { image: { id: 'sha256:running' } };

      await expect(
        resolveRollbackImageReference(trigger, dockerApi, container, backupRecord, logContainer),
      ).resolves.toBe('registry.example/app:1.2.3@sha256:resolved');
      expect(trigger.bindPulledImageIdentity).toHaveBeenCalledWith(
        dockerApi,
        'registry.example/app:1.2.3',
        container,
        logContainer,
      );
    });

    test('still resolves through the binder when the container carries no running image id', async () => {
      const trigger = {
        bindPulledImageIdentity: vi
          .fn()
          .mockResolvedValue({ imageIdentity: 'registry.example/app:1.2.3@sha256:resolved' }),
        getRollbackIdentityBindingPolicy: vi.fn().mockReturnValue('required'),
      };
      const dockerApi = {
        getImage: vi.fn(() => ({ inspect: vi.fn().mockResolvedValue({ Id: 'sha256:running' }) })),
      };
      const container = {};

      await expect(
        resolveRollbackImageReference(trigger, dockerApi, container, backupRecord, logContainer),
      ).resolves.toBe('registry.example/app:1.2.3@sha256:resolved');
      expect(trigger.bindPulledImageIdentity).toHaveBeenCalled();
    });
  });

  test('getBackupsForContainer isolates same-named containers by canonical identity', () => {
    backup.insertBackup({
      containerId: 'watcher-a-old',
      containerName: 'web',
      containerIdentityKey: '::watcher-a::web',
      imageName: 'registry.example/a-web',
      imageTag: '1.0.0',
      triggerName: 'docker.update',
      timestamp: '2024-01-01T00:00:00.000Z',
    });
    backup.insertBackup({
      containerId: 'watcher-a-new',
      containerName: 'web',
      containerIdentityKey: '::watcher-a::web',
      imageName: 'registry.example/a-web',
      imageTag: '1.1.0',
      triggerName: 'docker.update',
      timestamp: '2024-02-01T00:00:00.000Z',
    });
    backup.insertBackup({
      containerId: 'watcher-b',
      containerName: 'web',
      containerIdentityKey: '::watcher-b::web',
      imageName: 'registry.example/b-web',
      imageTag: '9.0.0',
      triggerName: 'docker.update',
      timestamp: '2024-03-01T00:00:00.000Z',
    });

    const result = backup.getBackupsForContainer({
      containerName: 'web',
      containerIdentityKey: '::watcher-a::web',
      includeLegacy: false,
    });

    expect(result.map((entry) => entry.imageTag)).toEqual(['1.1.0', '1.0.0']);
  });

  test('getBackupsForContainer includes legacy records only for an unambiguous scope', () => {
    backup.insertBackup({
      containerId: 'legacy-id',
      containerName: 'web',
      imageName: 'registry.example/legacy-web',
      imageTag: '0.9.0',
      triggerName: 'docker.update',
    });

    const ambiguous = backup.getBackupsForContainer({
      containerName: 'web',
      containerIdentityKey: '::watcher-a::web',
      includeLegacy: false,
    });
    const unambiguous = backup.getBackupsForContainer({
      containerName: 'web',
      containerIdentityKey: '::watcher-a::web',
      includeLegacy: true,
    });

    expect(ambiguous).toEqual([]);
    expect(unambiguous).toHaveLength(1);
    expect(unambiguous[0].imageTag).toBe('0.9.0');
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

  test('pruneOldBackups does not prune a same-named sibling identity', () => {
    backup.insertBackup({
      containerId: 'a-old',
      containerName: 'web',
      containerIdentityKey: '::watcher-a::web',
      imageName: 'registry.example/a-web',
      imageTag: '1.0.0',
      triggerName: 'docker.update',
      timestamp: '2024-01-01T00:00:00.000Z',
    });
    backup.insertBackup({
      containerId: 'a-new',
      containerName: 'web',
      containerIdentityKey: '::watcher-a::web',
      imageName: 'registry.example/a-web',
      imageTag: '1.1.0',
      triggerName: 'docker.update',
      timestamp: '2024-02-01T00:00:00.000Z',
    });
    backup.insertBackup({
      containerId: 'b-only',
      containerName: 'web',
      containerIdentityKey: '::watcher-b::web',
      imageName: 'registry.example/b-web',
      imageTag: '9.0.0',
      triggerName: 'docker.update',
      timestamp: '2024-03-01T00:00:00.000Z',
    });

    const pruned = backup.pruneOldBackups(
      {
        containerName: 'web',
        containerIdentityKey: '::watcher-a::web',
        includeLegacy: false,
      },
      1,
    );

    expect(pruned).toBe(1);
    expect(
      backup
        .getBackupsForContainer({
          containerName: 'web',
          containerIdentityKey: '::watcher-a::web',
          includeLegacy: false,
        })
        .map((entry) => entry.imageTag),
    ).toEqual(['1.1.0']);
    expect(
      backup
        .getBackupsForContainer({
          containerName: 'web',
          containerIdentityKey: '::watcher-b::web',
          includeLegacy: false,
        })
        .map((entry) => entry.imageTag),
    ).toEqual(['9.0.0']);
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
