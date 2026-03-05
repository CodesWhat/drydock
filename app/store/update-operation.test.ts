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

  test('getOperationsByContainerName should return empty array when uninitialized', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    expect(fresh.getOperationsByContainerName('web')).toEqual([]);
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
