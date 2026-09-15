vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import {
  buildRollbackImageReference,
  createContainerBackupScope,
  RollbackDigestRequiredError,
  resolveRollbackImageReference,
} from '../util/backup.js';
import * as backup from './backup.js';
import type { Database } from './db/driver.js';

describe('Backup Store', () => {
  let db: Database;

  beforeEach(() => {
    db = createMigratedMemoryDatabase();
    backup.createCollections(db);
  });

  afterEach(() => {
    db.close();
  });

  test('createCollections wires the store to the given database', () => {
    expect(() =>
      backup.insertBackup({
        containerId: 'c1',
        containerName: 'nginx',
        imageName: 'library/nginx',
        imageTag: '1.24',
        triggerName: 'docker.default',
      } as never),
    ).not.toThrow();
    expect(backup.getAllBackups()).toHaveLength(1);
  });

  test('insertBackup should insert a backup and return it with id', () => {
    const entry = {
      containerId: 'c1',
      containerName: 'nginx',
      imageName: 'library/nginx',
      imageTag: '1.24',
      triggerName: 'docker.default',
    };
    const result = backup.insertBackup(entry as never);
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
    const result = backup.insertBackup(entry as never);
    expect(result.id).toBe('custom-id');
  });

  test('insertBackup persists the containerIdentityKey when provided', () => {
    backup.insertBackup({
      id: 'with-identity',
      containerId: 'c1',
      containerName: 'nginx',
      containerIdentityKey: '::local::nginx',
      imageName: 'library/nginx',
      imageTag: '1.24',
      triggerName: 'docker.default',
    } as never);

    const row = db
      .prepare('SELECT container_identity_key FROM backups WHERE id = ?')
      .get('with-identity');
    expect(row?.container_identity_key).toBe('::local::nginx');
  });

  test('getBackupsByName should return backups for a specific container sorted by timestamp desc', () => {
    backup.insertBackup({
      containerId: 'c1',
      containerName: 'nginx',
      imageName: 'library/nginx',
      imageTag: '1.22',
      triggerName: 'docker.default',
      timestamp: '2024-01-01T00:00:00.000Z',
    } as never);
    backup.insertBackup({
      containerId: 'c1',
      containerName: 'nginx',
      imageName: 'library/nginx',
      imageTag: '1.23',
      triggerName: 'docker.default',
      timestamp: '2024-06-01T00:00:00.000Z',
    } as never);
    backup.insertBackup({
      containerId: 'c2',
      containerName: 'redis',
      imageName: 'library/redis',
      imageTag: '7.0',
      triggerName: 'docker.default',
      timestamp: '2024-03-01T00:00:00.000Z',
    } as never);

    const result = backup.getBackupsByName('nginx');
    expect(result).toHaveLength(2);
    expect(result[0].imageTag).toBe('1.23');
    expect(result[1].imageTag).toBe('1.22');
  });

  test('getBackupsByName should return empty array for unknown container', () => {
    const result = backup.getBackupsByName('unknown');
    expect(result).toEqual([]);
  });

  test('isBackupInScope rejects a backup with a different identity key', () => {
    expect(
      backup.isBackupInScope(
        {
          id: 'backup-other',
          containerId: 'c-other',
          containerName: 'other',
          containerIdentityKey: '::local::other',
          imageName: 'library/nginx',
          imageTag: '1.24',
          triggerName: 'docker.default',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
        {
          containerName: 'nginx',
          containerIdentityKey: '::local::nginx',
        },
      ),
    ).toBe(false);
  });

  test('isBackupInScope rejects a legacy backup with no identity key', () => {
    expect(
      backup.isBackupInScope(
        {
          id: 'backup-legacy',
          containerId: 'c-legacy',
          containerName: 'nginx',
          imageName: 'library/nginx',
          imageTag: '1.24',
          triggerName: 'docker.default',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
        {
          containerName: 'nginx',
          containerIdentityKey: '::local::nginx',
        },
      ),
    ).toBe(false);
  });

  test('isBackupInScope rejects when the scope itself carries no identity key', () => {
    expect(
      backup.isBackupInScope(
        {
          id: 'backup-a',
          containerId: 'c-a',
          containerName: 'web',
          containerIdentityKey: '::local::web',
          imageName: 'library/web',
          imageTag: '1.0',
          triggerName: 'docker.default',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
        { containerName: 'web' },
      ),
    ).toBe(false);
  });

  test('createContainerBackupScope derives the identity key from watcher and name', () => {
    const container = { id: 'target', name: 'web', watcher: 'local' } as any;

    expect(createContainerBackupScope(container)).toEqual({
      containerName: 'web',
      containerIdentityKey: '::local::web',
    });
  });

  test('createContainerBackupScope prefers an already-computed identityKey', () => {
    const container = {
      id: 'target',
      name: 'web',
      watcher: 'local',
      identityKey: '::local::compose:proj/web',
    } as any;

    expect(createContainerBackupScope(container)).toEqual({
      containerName: 'web',
      containerIdentityKey: '::local::compose:proj/web',
    });
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
        { preferredDigest: null },
      );
    });

    // container.result.digest is the candidate the watcher resolved for the
    // update this rollback is undoing, so it must never be what breaks a tie
    // between two RepoDigests on the retained image (DR-64).
    test('hands the binder the backup record digest rather than letting it prefer the update candidate', async () => {
      const trigger = {
        bindPulledImageIdentity: vi
          .fn()
          .mockResolvedValue({ imageIdentity: 'registry.example/app:1.2.3@sha256:resolved' }),
      };
      const dockerApi = {};
      const container = { name: 'app', result: { digest: 'sha256:candidate' } };

      await expect(
        resolveRollbackImageReference(trigger, dockerApi, container, backupRecord, logContainer),
      ).resolves.toBe('registry.example/app:1.2.3@sha256:resolved');
      expect(trigger.bindPulledImageIdentity).toHaveBeenCalledWith(
        dockerApi,
        'registry.example/app:1.2.3',
        container,
        logContainer,
        // The record carries no digest, so the binder is told to prefer
        // nothing. An explicit null, not an empty object: the field is
        // required precisely so that "no preference" cannot be typed by
        // leaving it out.
        { preferredDigest: null },
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
        { preferredDigest: null },
      );
    });

    // A local inspect that answers without an `Id`, or without a body at all,
    // proves nothing about whether the retained tag still points at the backup
    // image, so it cannot be treated as a same-tag hazard. Both shapes have to
    // reach the binder and be decided by the binding policy like any other
    // unresolvable digest.
    test('falls back to the tag with a warning under an optional policy when the local inspect reports no image id', async () => {
      const trigger = {
        bindPulledImageIdentity: vi.fn().mockResolvedValue({}),
        getRollbackIdentityBindingPolicy: vi.fn().mockReturnValue('optional'),
      };
      const dockerApi = {
        getImage: vi.fn(() => ({ inspect: vi.fn().mockResolvedValue({}) })),
      };
      const container = { image: { id: 'sha256:running' } };

      await expect(
        resolveRollbackImageReference(trigger, dockerApi, container, backupRecord, logContainer),
      ).resolves.toBe('registry.example/app:1.2.3');
      expect(trigger.bindPulledImageIdentity).toHaveBeenCalledWith(
        dockerApi,
        'registry.example/app:1.2.3',
        container,
        logContainer,
        { preferredDigest: null },
      );
      expect(trigger.getRollbackIdentityBindingPolicy).not.toHaveBeenCalled();
      expect(logContainer.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'No digest could be established for the rollback of registry.example/app:1.2.3',
        ),
      );
    });

    test('refuses the rollback under a required policy when the local inspect returns no body', async () => {
      const trigger = {
        bindPulledImageIdentity: vi.fn().mockRejectedValue(new Error('policy required')),
        getRollbackIdentityBindingPolicy: vi.fn().mockReturnValue('required'),
      };
      const dockerApi = {
        getImage: vi.fn(() => ({ inspect: vi.fn().mockResolvedValue(undefined) })),
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
        'Cannot roll back registry.example/app:1.2.3 to an immutable reference: policy required',
      );
      expect(trigger.bindPulledImageIdentity).toHaveBeenCalled();
      expect(trigger.getRollbackIdentityBindingPolicy).not.toHaveBeenCalled();
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
    } as never);
    backup.insertBackup({
      containerId: 'watcher-a-new',
      containerName: 'web',
      containerIdentityKey: '::watcher-a::web',
      imageName: 'registry.example/a-web',
      imageTag: '1.1.0',
      triggerName: 'docker.update',
      timestamp: '2024-02-01T00:00:00.000Z',
    } as never);
    backup.insertBackup({
      containerId: 'watcher-b',
      containerName: 'web',
      containerIdentityKey: '::watcher-b::web',
      imageName: 'registry.example/b-web',
      imageTag: '9.0.0',
      triggerName: 'docker.update',
      timestamp: '2024-03-01T00:00:00.000Z',
    } as never);

    const result = backup.getBackupsForContainer({
      containerName: 'web',
      containerIdentityKey: '::watcher-a::web',
    });

    expect(result.map((entry) => entry.imageTag)).toEqual(['1.1.0', '1.0.0']);
  });

  test('getBackupsForContainer never returns a legacy record with no identity key', () => {
    backup.insertBackup({
      containerId: 'legacy-id',
      containerName: 'web',
      imageName: 'registry.example/legacy-web',
      imageTag: '0.9.0',
      triggerName: 'docker.update',
    } as never);

    const result = backup.getBackupsForContainer({
      containerName: 'web',
      containerIdentityKey: '::watcher-a::web',
    });

    expect(result).toEqual([]);
  });

  test('getBackupsForContainer returns nothing for a scope with no identity key', () => {
    backup.insertBackup({
      containerId: 'c1',
      containerName: 'web',
      containerIdentityKey: '::watcher-a::web',
      imageName: 'registry.example/a-web',
      imageTag: '1.0.0',
      triggerName: 'docker.update',
    } as never);

    expect(backup.getBackupsForContainer({ containerName: 'web' })).toEqual([]);
  });

  test('getBackupsForContainer still finds a backup after the container was renamed', () => {
    backup.insertBackup({
      containerId: 'c1',
      containerName: 'web-old-name',
      containerIdentityKey: '::watcher-a::web',
      imageName: 'registry.example/a-web',
      imageTag: '1.0.0',
      triggerName: 'docker.update',
    } as never);

    const result = backup.getBackupsForContainer({
      containerName: 'web-new-name',
      containerIdentityKey: '::watcher-a::web',
    });

    expect(result.map((entry) => entry.imageTag)).toEqual(['1.0.0']);
  });

  test('getAllBackups should return all backups sorted by timestamp desc', () => {
    backup.insertBackup({
      containerId: 'c1',
      containerName: 'nginx',
      imageName: 'library/nginx',
      imageTag: '1.22',
      triggerName: 'docker.default',
      timestamp: '2024-01-01T00:00:00.000Z',
    } as never);
    backup.insertBackup({
      containerId: 'c2',
      containerName: 'redis',
      imageName: 'library/redis',
      imageTag: '7.0',
      triggerName: 'docker.default',
      timestamp: '2024-06-01T00:00:00.000Z',
    } as never);

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
    } as never);

    const result = backup.getBackup('b1');
    expect(result).toBeDefined();
    expect(result?.id).toBe('b1');
    expect(result?.imageTag).toBe('1.24');
  });

  test('getBackup should return undefined for unknown id', () => {
    const result = backup.getBackup('unknown');
    expect(result).toBeUndefined();
  });

  test('pruneOldBackups should keep only the N most recent backups', () => {
    backup.insertBackup({
      containerId: 'c1',
      containerName: 'nginx',
      containerIdentityKey: '::local::nginx',
      imageName: 'library/nginx',
      imageTag: '1.20',
      triggerName: 'docker.default',
      timestamp: '2024-01-01T00:00:00.000Z',
    } as never);
    backup.insertBackup({
      containerId: 'c1',
      containerName: 'nginx',
      containerIdentityKey: '::local::nginx',
      imageName: 'library/nginx',
      imageTag: '1.21',
      triggerName: 'docker.default',
      timestamp: '2024-03-01T00:00:00.000Z',
    } as never);
    backup.insertBackup({
      containerId: 'c1',
      containerName: 'nginx',
      containerIdentityKey: '::local::nginx',
      imageName: 'library/nginx',
      imageTag: '1.22',
      triggerName: 'docker.default',
      timestamp: '2024-06-01T00:00:00.000Z',
    } as never);
    backup.insertBackup({
      containerId: 'c1',
      containerName: 'nginx',
      containerIdentityKey: '::local::nginx',
      imageName: 'library/nginx',
      imageTag: '1.23',
      triggerName: 'docker.default',
      timestamp: '2024-09-01T00:00:00.000Z',
    } as never);

    const pruned = backup.pruneOldBackups(
      { containerName: 'nginx', containerIdentityKey: '::local::nginx' },
      2,
    );
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
      containerIdentityKey: '::local::nginx',
      imageName: 'library/nginx',
      imageTag: '1.20',
      triggerName: 'docker.default',
      timestamp: '2024-01-01T00:00:00.000Z',
    } as never);
    backup.insertBackup({
      containerId: 'c2',
      containerName: 'redis',
      containerIdentityKey: '::local::redis',
      imageName: 'library/redis',
      imageTag: '7.0',
      triggerName: 'docker.default',
      timestamp: '2024-01-01T00:00:00.000Z',
    } as never);

    backup.pruneOldBackups({ containerName: 'nginx', containerIdentityKey: '::local::nginx' }, 0);

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
    } as never);
    backup.insertBackup({
      containerId: 'a-new',
      containerName: 'web',
      containerIdentityKey: '::watcher-a::web',
      imageName: 'registry.example/a-web',
      imageTag: '1.1.0',
      triggerName: 'docker.update',
      timestamp: '2024-02-01T00:00:00.000Z',
    } as never);
    backup.insertBackup({
      containerId: 'b-only',
      containerName: 'web',
      containerIdentityKey: '::watcher-b::web',
      imageName: 'registry.example/b-web',
      imageTag: '9.0.0',
      triggerName: 'docker.update',
      timestamp: '2024-03-01T00:00:00.000Z',
    } as never);

    const pruned = backup.pruneOldBackups(
      {
        containerName: 'web',
        containerIdentityKey: '::watcher-a::web',
      },
      1,
    );

    expect(pruned).toBe(1);
    expect(
      backup
        .getBackupsForContainer({
          containerName: 'web',
          containerIdentityKey: '::watcher-a::web',
        })
        .map((entry) => entry.imageTag),
    ).toEqual(['1.1.0']);
    expect(
      backup
        .getBackupsForContainer({
          containerName: 'web',
          containerIdentityKey: '::watcher-b::web',
        })
        .map((entry) => entry.imageTag),
    ).toEqual(['9.0.0']);
  });

  test('pruneOldBackups does not prune a legacy backup with no identity key', () => {
    backup.insertBackup({
      containerId: 'legacy-id',
      containerName: 'web',
      imageName: 'registry.example/legacy-web',
      imageTag: '0.9.0',
      triggerName: 'docker.update',
      timestamp: '2024-01-01T00:00:00.000Z',
    } as never);

    const pruned = backup.pruneOldBackups(
      { containerName: 'web', containerIdentityKey: '::watcher-a::web' },
      0,
    );

    expect(pruned).toBe(0);
    expect(backup.getBackupsByName('web')).toHaveLength(1);
  });

  test('pruneOldBackups should not remove backups when maxCount is undefined', () => {
    backup.insertBackup({
      containerId: 'c1',
      containerName: 'nginx',
      containerIdentityKey: '::local::nginx',
      imageName: 'library/nginx',
      imageTag: '1.20',
      triggerName: 'docker.default',
      timestamp: '2024-01-01T00:00:00.000Z',
    } as never);
    backup.insertBackup({
      containerId: 'c1',
      containerName: 'nginx',
      containerIdentityKey: '::local::nginx',
      imageName: 'library/nginx',
      imageTag: '1.21',
      triggerName: 'docker.default',
      timestamp: '2024-03-01T00:00:00.000Z',
    } as never);

    const pruned = backup.pruneOldBackups(
      { containerName: 'nginx', containerIdentityKey: '::local::nginx' },
      undefined as any,
    );

    expect(pruned).toBe(0);
    expect(backup.getBackupsByName('nginx')).toHaveLength(2);
  });

  test('pruneOldBackups should return 0 when the store is not initialized', async () => {
    vi.resetModules();
    const freshBackup = await import('./backup.js');
    const count = freshBackup.pruneOldBackups(
      { containerName: 'c1', containerIdentityKey: '::local::c1' },
      3,
    );
    expect(count).toBe(0);
  });

  test('getBackupsByName should return empty when the store is not initialized', async () => {
    vi.resetModules();
    const freshBackup = await import('./backup.js');
    const result = freshBackup.getBackupsByName('nginx');
    expect(result).toEqual([]);
  });

  test('getAllBackups should return empty when the store is not initialized', async () => {
    vi.resetModules();
    const freshBackup = await import('./backup.js');
    const result = freshBackup.getAllBackups();
    expect(result).toEqual([]);
  });

  test('getBackup should return undefined when the store is not initialized', async () => {
    vi.resetModules();
    const freshBackup = await import('./backup.js');
    const result = freshBackup.getBackup('b1');
    expect(result).toBeUndefined();
  });

  test('insertBackup should return generated values when the store is not initialized', async () => {
    vi.resetModules();
    const freshBackup = await import('./backup.js');
    const result = freshBackup.insertBackup({
      containerId: 'c1',
      containerName: 'nginx',
      imageName: 'library/nginx',
      imageTag: '1.24',
      triggerName: 'docker.default',
    } as never);
    expect(result.id).toBeDefined();
    expect(result.timestamp).toBeDefined();
  });
});
