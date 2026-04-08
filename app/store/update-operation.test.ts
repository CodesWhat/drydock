import { performance } from 'node:perf_hooks';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as updateOperation from './update-operation.js';

function createDb() {
  function getByPath(object, path) {
    return path.split('.').reduce((acc, key) => acc?.[key], object);
  }

  function matchesQuery(doc, query = {}) {
    return Object.entries(query).every(([key, value]) => getByPath(doc, key) === value);
  }

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
        find: (query = {}) => docs.filter((doc) => matchesQuery(doc, query)),
        findOne: (query = {}) => docs.find((doc) => matchesQuery(doc, query)) || null,
        remove: (doc) => {
          const idx = docs.indexOf(doc);
          if (idx >= 0) docs.splice(idx, 1);
        },
      };
      return collections[name];
    },
  };
}

describe('Update Operation Store', () => {
  beforeEach(() => {
    updateOperation.createCollections(createDb());
  });

  test('createCollections should create updateOperations collection when missing', () => {
    const db = {
      getCollection: () => null,
      addCollection: vi.fn(() => ({ insert: vi.fn(), find: vi.fn(), remove: vi.fn() })),
    };
    updateOperation.createCollections(db);
    expect(db.addCollection).toHaveBeenCalledWith(
      'updateOperations',
      expect.objectContaining({
        indices: expect.arrayContaining(['data.id', 'data.containerName', 'data.status']),
      }),
    );
  });

  test('insertOperation should default to in-progress prepare state', () => {
    const inserted = updateOperation.insertOperation({
      containerName: 'web',
      containerId: 'abc',
      triggerName: 'docker.update',
      oldName: 'web',
      tempName: 'web-old-1',
    });

    expect(inserted.id).toBeDefined();
    expect(inserted.status).toBe('in-progress');
    expect(inserted.phase).toBe('prepare');
    expect(inserted.createdAt).toBeDefined();
    expect(inserted.updatedAt).toBeDefined();
  });

  test('updateOperation should merge patch and refresh updatedAt', () => {
    const inserted = updateOperation.insertOperation({
      containerName: 'web',
      containerId: 'abc',
      triggerName: 'docker.update',
      oldName: 'web',
      tempName: 'web-old-1',
    });

    const updated = updateOperation.updateOperation(inserted.id, {
      phase: 'new-started',
      status: 'in-progress',
      newContainerId: 'new-123',
    });

    expect(updated.phase).toBe('new-started');
    expect(updated.newContainerId).toBe('new-123');
    expect(updated.status).toBe('in-progress');
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(inserted.updatedAt).getTime(),
    );
  });

  test('updateOperation should return undefined when operation id does not exist', () => {
    const result = updateOperation.updateOperation('missing-id', { status: 'failed' });
    expect(result).toBeUndefined();
  });

  test('getInProgressOperationByContainerName should return latest in-progress operation', () => {
    const older = updateOperation.insertOperation({
      containerName: 'web',
      containerId: 'abc',
      triggerName: 'docker.update',
      oldName: 'web',
      tempName: 'web-old-1',
      createdAt: '2026-02-23T00:00:00.000Z',
      updatedAt: '2026-02-23T00:00:00.000Z',
    });
    updateOperation.updateOperation(older.id, {
      status: 'rolled-back',
      updatedAt: '2026-02-23T00:01:00.000Z',
    });

    const newer = updateOperation.insertOperation({
      containerName: 'web',
      containerId: 'abc',
      triggerName: 'docker.update',
      oldName: 'web',
      tempName: 'web-old-2',
    });

    const active = updateOperation.getInProgressOperationByContainerName('web');
    expect(active.id).toBe(newer.id);
    expect(active.status).toBe('in-progress');
  });

  test('getInProgressOperationByContainerName should return undefined when uninitialized', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    expect(fresh.getInProgressOperationByContainerName('web')).toBeUndefined();
  });

  test('getInProgressOperationByContainerName should sort by latest timestamp', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-02-23T00:00:00.000Z'));
      updateOperation.insertOperation({
        containerName: 'web',
        status: 'in-progress',
      });
      vi.setSystemTime(new Date('2026-02-23T00:01:00.000Z'));
      const second = updateOperation.insertOperation({
        containerName: 'web',
        status: 'in-progress',
      });

      const active = updateOperation.getInProgressOperationByContainerName('web');
      expect(active?.id).toBe(second.id);
    } finally {
      vi.useRealTimers();
    }
  });

  test('getInProgressOperationByContainerId should return operation matching the container ID', () => {
    updateOperation.insertOperation({
      containerName: 'portainer_agent',
      containerId: 'host1-abc',
    });
    updateOperation.insertOperation({
      containerName: 'portainer_agent',
      containerId: 'host2-def',
    });

    const host1Op = updateOperation.getInProgressOperationByContainerId('host1-abc');
    const host2Op = updateOperation.getInProgressOperationByContainerId('host2-def');
    const missing = updateOperation.getInProgressOperationByContainerId('host3-ghi');

    expect(host1Op).toBeDefined();
    expect(host1Op!.containerId).toBe('host1-abc');
    expect(host2Op).toBeDefined();
    expect(host2Op!.containerId).toBe('host2-def');
    expect(missing).toBeUndefined();
  });

  test('getInProgressOperationByContainerId should return latest when multiple ops exist', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-02-23T00:00:00.000Z'));
      updateOperation.insertOperation({
        containerName: 'web',
        containerId: 'c1',
      });
      vi.setSystemTime(new Date('2026-02-23T00:01:00.000Z'));
      const second = updateOperation.insertOperation({
        containerName: 'web',
        containerId: 'c1',
      });

      const active = updateOperation.getInProgressOperationByContainerId('c1');
      expect(active?.id).toBe(second.id);
    } finally {
      vi.useRealTimers();
    }
  });

  test('getInProgressOperationByContainerId should match replacement container IDs stored in newContainerId', () => {
    const operation = updateOperation.insertOperation({
      containerName: 'web',
      containerId: 'old-123',
    });
    updateOperation.updateOperation(operation.id, {
      newContainerId: 'new-456',
    });

    const active = updateOperation.getInProgressOperationByContainerId('new-456');

    expect(active?.id).toBe(operation.id);
    expect(active?.containerId).toBe('old-123');
    expect(active?.newContainerId).toBe('new-456');
  });

  test('getInProgressOperationByContainerId should use targeted indexed queries instead of scanning', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    const findQueries: Array<Record<string, string> | undefined> = [];
    const db = {
      getCollection: () => null,
      addCollection: () => {
        const docs: any[] = [];
        const getByPath = (object: Record<string, unknown>, path: string) =>
          path
            .split('.')
            .reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], object);
        const matchesQuery = (doc: Record<string, unknown>, query: Record<string, string> = {}) =>
          Object.entries(query).every(([key, value]) => getByPath(doc, key) === value);

        return {
          insert: (doc: any) => {
            docs.push(doc);
          },
          find: (query: Record<string, string> = {}) => {
            findQueries.push(Object.keys(query).length === 0 ? undefined : query);
            return docs.filter((doc) => matchesQuery(doc, query));
          },
          findOne: (query: Record<string, string>) =>
            docs.find((doc) => matchesQuery(doc, query)) || null,
          remove: (doc: any) => {
            const index = docs.indexOf(doc);
            if (index >= 0) {
              docs.splice(index, 1);
            }
          },
        };
      },
    };

    fresh.createCollections(db as any);

    const operation = fresh.insertOperation({
      containerName: 'web',
      containerId: 'old-123',
    });
    fresh.updateOperation(operation.id, {
      newContainerId: 'new-456',
    });
    findQueries.length = 0;

    const active = fresh.getInProgressOperationByContainerId('new-456');

    expect(active?.id).toBe(operation.id);
    expect(findQueries).toEqual([
      {
        'data.containerId': 'new-456',
        'data.status': 'in-progress',
      },
      {
        'data.newContainerId': 'new-456',
        'data.status': 'in-progress',
      },
    ]);
  });

  test('getInProgressOperationByContainerId should return undefined when uninitialized', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    expect(fresh.getInProgressOperationByContainerId('abc')).toBeUndefined();
  });

  test('getInProgressOperationByContainerId should return undefined for empty string', () => {
    expect(updateOperation.getInProgressOperationByContainerId('')).toBeUndefined();
  });

  test('getActiveOperationByContainerName should expire stale queued operations', async () => {
    vi.resetModules();
    const previousActiveTtlMs = process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS;
    process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS = '60000';
    vi.useFakeTimers();

    try {
      const fresh = await import('./update-operation.js');
      fresh.createCollections(createDb());

      vi.setSystemTime(new Date('2026-02-23T00:00:00.000Z'));
      const queued = fresh.insertOperation({
        containerName: 'web',
        status: 'queued',
        phase: 'queued',
      });

      vi.setSystemTime(new Date('2026-02-23T00:01:01.000Z'));
      const active = fresh.getActiveOperationByContainerName('web');

      expect(active).toBeUndefined();
      expect(fresh.getOperationById(queued.id)).toEqual(
        expect.objectContaining({
          id: queued.id,
          status: 'failed',
          phase: 'queued',
          lastError: expect.stringContaining('active update TTL'),
        }),
      );
    } finally {
      vi.useRealTimers();
      if (previousActiveTtlMs === undefined) {
        delete process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS;
      } else {
        process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS = previousActiveTtlMs;
      }
    }
  });

  test('getActiveOperationByContainerId should expire stale in-progress replacement operations', async () => {
    vi.resetModules();
    const previousActiveTtlMs = process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS;
    process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS = '60000';
    vi.useFakeTimers();

    try {
      const fresh = await import('./update-operation.js');
      fresh.createCollections(createDb());

      vi.setSystemTime(new Date('2026-02-23T00:00:00.000Z'));
      const operation = fresh.insertOperation({
        containerName: 'web',
        containerId: 'old-123',
        status: 'in-progress',
        phase: 'pulling',
      });
      fresh.updateOperation(operation.id, {
        newContainerId: 'new-456',
      });

      vi.setSystemTime(new Date('2026-02-23T00:01:01.000Z'));
      const active = fresh.getActiveOperationByContainerId('new-456');

      expect(active).toBeUndefined();
      expect(fresh.getOperationById(operation.id)).toEqual(
        expect.objectContaining({
          id: operation.id,
          status: 'failed',
          phase: 'pulling',
          lastError: expect.stringContaining('active update TTL'),
        }),
      );
    } finally {
      vi.useRealTimers();
      if (previousActiveTtlMs === undefined) {
        delete process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS;
      } else {
        process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS = previousActiveTtlMs;
      }
    }
  });

  test('same-named containers should be disambiguated by container ID', () => {
    const op = updateOperation.insertOperation({
      containerName: 'portainer_agent',
      containerId: 'host1-abc',
    });

    // Looking up by the WRONG container ID should NOT find the operation
    expect(updateOperation.getInProgressOperationByContainerId('host2-def')).toBeUndefined();

    // Looking up by NAME finds it (old behavior — this is the root cause of #256)
    expect(updateOperation.getInProgressOperationByContainerName('portainer_agent')).toBeDefined();

    // Looking up by the CORRECT container ID should find it
    const found = updateOperation.getInProgressOperationByContainerId('host1-abc');
    expect(found?.id).toBe(op.id);
  });

  test('getOperationsByContainerName should return container operations sorted by latest update', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-02-23T00:00:00.000Z'));
      const first = updateOperation.insertOperation({
        containerName: 'web',
        containerId: 'abc',
        triggerName: 'docker.update',
      });

      vi.setSystemTime(new Date('2026-02-23T00:01:00.000Z'));
      const second = updateOperation.insertOperation({
        containerName: 'web',
        containerId: 'def',
        triggerName: 'docker.update',
      });

      vi.setSystemTime(new Date('2026-02-23T00:02:00.000Z'));
      updateOperation.updateOperation(first.id, {
        status: 'succeeded',
        phase: 'succeeded',
      });

      vi.setSystemTime(new Date('2026-02-23T00:03:00.000Z'));
      updateOperation.insertOperation({
        containerName: 'db',
        containerId: 'ghi',
        triggerName: 'docker.update',
      });

      const operations = updateOperation.getOperationsByContainerName('web');
      expect(operations).toHaveLength(2);
      expect(operations.map((operation) => operation.id)).toEqual([first.id, second.id]);
      expect(operations.every((operation) => operation.containerName === 'web')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test('retention pruning should be amortized instead of pruning on every write', async () => {
    vi.resetModules();
    const previousMaxEntries = process.env.DD_UPDATE_OPERATION_MAX_ENTRIES;
    const previousRetentionDays = process.env.DD_UPDATE_OPERATION_RETENTION_DAYS;
    process.env.DD_UPDATE_OPERATION_MAX_ENTRIES = '2';
    process.env.DD_UPDATE_OPERATION_RETENTION_DAYS = '365';
    vi.useFakeTimers();

    try {
      const fresh = await import('./update-operation.js');
      fresh.createCollections(createDb());
      const insertedIds: string[] = [];

      for (let i = 0; i < 3; i += 1) {
        vi.setSystemTime(new Date(2026, 1, 1, 0, 0, i));
        const inserted = fresh.insertOperation({
          containerName: 'web',
          status: 'succeeded',
          phase: 'succeeded',
        });
        insertedIds.push(inserted.id);
      }

      // Pruning is amortized, so the first few writes should not prune yet.
      expect(fresh.getOperationsByContainerName('web')).toHaveLength(3);

      // Mutation #100 should trigger retention pruning.
      for (let i = 3; i < 100; i += 1) {
        vi.setSystemTime(new Date(2026, 1, 1, 0, 0, i));
        const inserted = fresh.insertOperation({
          containerName: 'web',
          status: 'succeeded',
          phase: 'succeeded',
        });
        insertedIds.push(inserted.id);
      }

      const operations = fresh.getOperationsByContainerName('web');
      expect(operations).toHaveLength(2);
      expect(operations.map((operation) => operation.id)).toEqual([
        insertedIds[insertedIds.length - 1]!,
        insertedIds[insertedIds.length - 2]!,
      ]);
    } finally {
      vi.useRealTimers();
      if (previousMaxEntries === undefined) {
        delete process.env.DD_UPDATE_OPERATION_MAX_ENTRIES;
      } else {
        process.env.DD_UPDATE_OPERATION_MAX_ENTRIES = previousMaxEntries;
      }
      if (previousRetentionDays === undefined) {
        delete process.env.DD_UPDATE_OPERATION_RETENTION_DAYS;
      } else {
        process.env.DD_UPDATE_OPERATION_RETENTION_DAYS = previousRetentionDays;
      }
    }
  });

  test('retention should keep only the newest terminal operations when max entries is exceeded', async () => {
    vi.resetModules();
    const previousMaxEntries = process.env.DD_UPDATE_OPERATION_MAX_ENTRIES;
    const previousRetentionDays = process.env.DD_UPDATE_OPERATION_RETENTION_DAYS;
    process.env.DD_UPDATE_OPERATION_MAX_ENTRIES = '2';
    process.env.DD_UPDATE_OPERATION_RETENTION_DAYS = '365';
    vi.useFakeTimers();

    try {
      const fresh = await import('./update-operation.js');
      fresh.createCollections(createDb());

      vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));
      const first = fresh.insertOperation({
        containerName: 'web',
        status: 'succeeded',
        phase: 'succeeded',
      });

      vi.setSystemTime(new Date('2026-02-01T00:00:01.000Z'));
      const second = fresh.insertOperation({
        containerName: 'web',
        status: 'rolled-back',
        phase: 'rolled-back',
      });

      vi.setSystemTime(new Date('2026-02-01T00:00:02.000Z'));
      const third = fresh.insertOperation({
        containerName: 'web',
        status: 'failed',
        phase: 'rollback-failed',
      });

      for (let i = 0; i < 97; i += 1) {
        vi.setSystemTime(new Date(2026, 2, 1, 0, 1, i));
        fresh.updateOperation(third.id, {
          lastError: `error-${i}`,
        });
      }

      const operations = fresh.getOperationsByContainerName('web');
      expect(operations).toHaveLength(2);
      expect(operations.map((operation) => operation.id)).toEqual([third.id, second.id]);
      expect(operations.find((operation) => operation.id === first.id)).toBeUndefined();
    } finally {
      vi.useRealTimers();
      if (previousMaxEntries === undefined) {
        delete process.env.DD_UPDATE_OPERATION_MAX_ENTRIES;
      } else {
        process.env.DD_UPDATE_OPERATION_MAX_ENTRIES = previousMaxEntries;
      }
      if (previousRetentionDays === undefined) {
        delete process.env.DD_UPDATE_OPERATION_RETENTION_DAYS;
      } else {
        process.env.DD_UPDATE_OPERATION_RETENTION_DAYS = previousRetentionDays;
      }
    }
  });

  test('retention should not prune in-progress operations', async () => {
    vi.resetModules();
    const previousMaxEntries = process.env.DD_UPDATE_OPERATION_MAX_ENTRIES;
    const previousRetentionDays = process.env.DD_UPDATE_OPERATION_RETENTION_DAYS;
    process.env.DD_UPDATE_OPERATION_MAX_ENTRIES = '1';
    process.env.DD_UPDATE_OPERATION_RETENTION_DAYS = '365';
    vi.useFakeTimers();

    try {
      const fresh = await import('./update-operation.js');
      fresh.createCollections(createDb());

      vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));
      const inProgress = fresh.insertOperation({
        containerName: 'web',
      });

      vi.setSystemTime(new Date('2026-02-01T00:00:01.000Z'));
      fresh.insertOperation({
        containerName: 'web',
        status: 'succeeded',
        phase: 'succeeded',
      });

      vi.setSystemTime(new Date('2026-02-01T00:00:02.000Z'));
      const latestTerminal = fresh.insertOperation({
        containerName: 'web',
        status: 'failed',
        phase: 'rollback-failed',
      });

      for (let i = 0; i < 97; i += 1) {
        vi.setSystemTime(new Date(2026, 1, 1, 0, 1, i));
        fresh.updateOperation(inProgress.id, {
          phase: i % 2 === 0 ? 'prepare' : 'health-gate',
        });
      }

      const operations = fresh.getOperationsByContainerName('web');
      expect(operations).toHaveLength(2);
      expect(operations.find((operation) => operation.id === inProgress.id)?.status).toBe(
        'in-progress',
      );
      expect(operations.find((operation) => operation.id === latestTerminal.id)?.status).toBe(
        'failed',
      );
    } finally {
      vi.useRealTimers();
      if (previousMaxEntries === undefined) {
        delete process.env.DD_UPDATE_OPERATION_MAX_ENTRIES;
      } else {
        process.env.DD_UPDATE_OPERATION_MAX_ENTRIES = previousMaxEntries;
      }
      if (previousRetentionDays === undefined) {
        delete process.env.DD_UPDATE_OPERATION_RETENTION_DAYS;
      } else {
        process.env.DD_UPDATE_OPERATION_RETENTION_DAYS = previousRetentionDays;
      }
    }
  });

  test('retention should not prune queued operations', async () => {
    vi.resetModules();
    const previousMaxEntries = process.env.DD_UPDATE_OPERATION_MAX_ENTRIES;
    const previousRetentionDays = process.env.DD_UPDATE_OPERATION_RETENTION_DAYS;
    process.env.DD_UPDATE_OPERATION_MAX_ENTRIES = '1';
    process.env.DD_UPDATE_OPERATION_RETENTION_DAYS = '365';
    vi.useFakeTimers();

    try {
      const fresh = await import('./update-operation.js');
      fresh.createCollections(createDb());

      vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));
      const queued = fresh.insertOperation({
        containerName: 'web',
        status: 'queued',
        phase: 'queued',
      });

      vi.setSystemTime(new Date('2026-02-01T00:00:01.000Z'));
      const latestTerminal = fresh.insertOperation({
        containerName: 'web',
        status: 'failed',
        phase: 'rollback-failed',
      });

      for (let i = 0; i < 98; i += 1) {
        vi.setSystemTime(new Date(2026, 1, 1, 0, 1, i));
        fresh.updateOperation(latestTerminal.id, {
          lastError: `error-${i}`,
        });
      }

      const operations = fresh.getOperationsByContainerName('web');
      expect(operations).toHaveLength(2);
      expect(operations.find((operation) => operation.id === queued.id)?.status).toBe('queued');
      expect(operations.find((operation) => operation.id === latestTerminal.id)?.status).toBe(
        'failed',
      );
    } finally {
      vi.useRealTimers();
      if (previousMaxEntries === undefined) {
        delete process.env.DD_UPDATE_OPERATION_MAX_ENTRIES;
      } else {
        process.env.DD_UPDATE_OPERATION_MAX_ENTRIES = previousMaxEntries;
      }
      if (previousRetentionDays === undefined) {
        delete process.env.DD_UPDATE_OPERATION_RETENTION_DAYS;
      } else {
        process.env.DD_UPDATE_OPERATION_RETENTION_DAYS = previousRetentionDays;
      }
    }
  });

  test('getOperationsByContainerName should return empty array when uninitialized', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    expect(fresh.getOperationsByContainerName('web')).toEqual([]);
  });

  test('insertOperation should work without initialized collection', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    const inserted = fresh.insertOperation({ containerName: 'web' });
    expect(inserted.id).toBeDefined();
    expect(inserted.status).toBe('in-progress');
    expect(inserted.phase).toBe('prepare');
  });

  test('updateOperation should return undefined when store is not initialized', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    expect(fresh.updateOperation('missing', { status: 'failed' })).toBeUndefined();
  });

  test('retention pruning should handle empty collections safely', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    const db = {
      getCollection: () => null,
      addCollection: () => ({
        insert: vi.fn(),
        find: vi.fn(() => []),
        findOne: vi.fn(() => null),
        remove: vi.fn(),
      }),
    };
    fresh.createCollections(db as any);
    const inserted = fresh.insertOperation({ containerName: 'web' });
    expect(inserted.containerName).toBe('web');
  });

  test('sorting helpers should handle invalid timestamps by treating them as zero', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    const db = {
      getCollection: () => null,
      addCollection: () => {
        const docs: any[] = [];
        return {
          insert: (doc: any) => {
            doc.data.updatedAt = 'not-a-date';
            docs.push(doc);
          },
          find: () => docs,
          findOne: (query: Record<string, string>) =>
            docs.find((doc) => doc.data.id === query['data.id']) || null,
          remove: vi.fn(),
        };
      },
    };
    fresh.createCollections(db as any);
    fresh.insertOperation({ containerName: 'web' });

    expect(fresh.getOperationsByContainerName('web')).toHaveLength(1);
    expect(fresh.getInProgressOperationByContainerName('web')).toBeDefined();
  });

  test('sorting should place records with invalid updatedAt behind valid timestamps', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    const db = {
      getCollection: () => null,
      addCollection: () => {
        const docs: any[] = [];
        return {
          insert: (doc: any) => {
            if (doc.data.phase === 'rollback-failed') {
              doc.data.updatedAt = 'not-a-date';
            }
            docs.push(doc);
          },
          find: (query: Record<string, string> = {}) =>
            docs.filter((doc) =>
              Object.entries(query).every(([key, value]) => {
                const path = key.split('.');
                let current: any = doc;
                for (const segment of path) current = current?.[segment];
                return current === value;
              }),
            ),
          findOne: (query: Record<string, string>) =>
            docs.find((doc) => doc.data.id === query['data.id']) || null,
          remove: vi.fn(),
        };
      },
    };
    fresh.createCollections(db as any);

    const valid = fresh.insertOperation({
      containerName: 'web',
      status: 'succeeded',
      phase: 'succeeded',
    });
    const invalid = fresh.insertOperation({
      containerName: 'web',
      status: 'failed',
      phase: 'rollback-failed',
    });

    const operations = fresh.getOperationsByContainerName('web');
    expect(operations.map((operation) => operation.id)).toEqual([valid.id, invalid.id]);
  });

  test('sorting helpers should fallback to createdAt when updatedAt is blank', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    const db = {
      getCollection: () => null,
      addCollection: () => {
        const docs: any[] = [];
        return {
          insert: (doc: any) => {
            doc.data.updatedAt = '';
            docs.push(doc);
          },
          find: () => docs,
          findOne: (query: Record<string, string>) =>
            docs.find((doc) => doc.data.id === query['data.id']) || null,
          remove: vi.fn(),
        };
      },
    };
    fresh.createCollections(db as any);

    const older = fresh.insertOperation({
      containerName: 'web',
      createdAt: '2026-02-23T00:00:00.000Z',
    });
    const newer = fresh.insertOperation({
      containerName: 'web',
      createdAt: '2026-02-23T00:01:00.000Z',
    });

    const operations = fresh.getOperationsByContainerName('web');
    expect(operations.map((operation) => operation.id)).toEqual([newer.id, older.id]);
  });

  test('sorting helpers should treat invalid createdAt as zero when updatedAt is blank', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    const db = {
      getCollection: () => null,
      addCollection: () => {
        const docs: any[] = [];
        return {
          insert: (doc: any) => {
            doc.data.updatedAt = '';
            doc.data.createdAt = 'invalid-created-at';
            docs.push(doc);
          },
          find: () => docs,
          findOne: (query: Record<string, string>) =>
            docs.find((doc) => doc.data.id === query['data.id']) || null,
          remove: vi.fn(),
        };
      },
    };
    fresh.createCollections(db as any);
    fresh.insertOperation({ containerName: 'web' });

    expect(fresh.getOperationsByContainerName('web')).toHaveLength(1);
    expect(fresh.getInProgressOperationByContainerName('web')).toBeDefined();
  });

  test('retention pruning stays within lightweight runtime budget for medium history', () => {
    const runs = 2;
    const insertsPerRun = 500;
    let totalMs = 0;

    for (let run = 0; run < runs; run += 1) {
      updateOperation.createCollections(createDb());
      const started = performance.now();
      for (let i = 0; i < insertsPerRun; i += 1) {
        updateOperation.insertOperation({
          containerName: `service-${i % 200}`,
          status: i % 7 === 0 ? 'failed' : 'succeeded',
          phase: i % 7 === 0 ? 'rollback-failed' : 'succeeded',
          updatedAt: new Date(2026, 0, (i % 28) + 1, i % 24, i % 60, i % 60).toISOString(),
        });
      }
      totalMs += performance.now() - started;
    }

    const avgMs = totalMs / runs;
    expect(avgMs).toBeLessThan(1500);
  });
});
