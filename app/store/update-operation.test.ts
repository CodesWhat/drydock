import { performance } from 'node:perf_hooks';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as updateOperation from './update-operation.js';

function createDb(options?: { inactiveIds?: Set<string>; missingIds?: Set<string> }) {
  function getByPath(object, path) {
    return path.split('.').reduce((acc, key) => acc?.[key], object);
  }

  function matchesQuery(doc, query = {}) {
    return Object.entries(query).every(([key, value]) => getByPath(doc, key) === value);
  }

  const inactiveIds = options?.inactiveIds ?? new Set<string>();
  const missingIds = options?.missingIds ?? new Set<string>();
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
        findOne: (query = {}) => {
          const id = query['data.id'];
          const doc = docs.find((item) => matchesQuery(item, query));

          if (missingIds.has(id)) {
            return null;
          }

          if (inactiveIds.has(id) && doc) {
            return {
              ...doc,
              data: {
                ...doc.data,
                status: 'failed',
              },
            };
          }

          return doc || null;
        },
        remove: (doc) => {
          const idx = docs.indexOf(doc);
          if (idx >= 0) docs.splice(idx, 1);
        },
      };
      return collections[name];
    },
  };
}

function createDocumentBackedDb(documents: any[]) {
  return {
    getCollection: () => null,
    addCollection: () => ({
      insert: (doc: any) => {
        documents.push(doc);
      },
      find: (query: Record<string, string> = {}) =>
        documents.filter((doc) =>
          Object.entries(query).every(([key, value]) => {
            const path = key.split('.');
            let current: any = doc;
            for (const segment of path) current = current?.[segment];
            return current === value;
          }),
        ),
      findOne: (query: Record<string, string>) =>
        documents.find((doc) =>
          Object.entries(query).every(([key, value]) => {
            const path = key.split('.');
            let current: any = doc;
            for (const segment of path) current = current?.[segment];
            return current === value;
          }),
        ) || null,
      remove: (doc: any) => {
        const index = documents.indexOf(doc);
        if (index >= 0) {
          documents.splice(index, 1);
        }
      },
    }),
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

  test('createCollections should fail non-resumable active operations and leave resumable ones queued for recovery', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-02-23T01:00:00.000Z'));
      vi.resetModules();
      const fresh = await import('./update-operation.js');
      const documents = [
        {
          data: {
            id: 'queued-fresh-op-1',
            containerId: 'container-queued',
            containerName: 'queued-web',
            status: 'queued',
            phase: 'queued',
            batchId: 'batch-1',
            queuePosition: 2,
            queueTotal: 4,
            createdAt: '2026-02-23T00:55:00.000Z',
            updatedAt: '2026-02-23T00:59:59.000Z',
          },
        },
        {
          data: {
            id: 'started-stale-op-1',
            containerId: 'container-started',
            containerName: 'started-web',
            status: 'in-progress',
            phase: 'new-started',
            createdAt: '2026-02-23T00:00:00.000Z',
            updatedAt: '2026-02-23T00:10:00.000Z',
          },
        },
        {
          data: {
            id: 'health-stale-op-1',
            containerId: 'container-health',
            containerName: 'health-web',
            status: 'in-progress',
            phase: 'health-gate',
            createdAt: '2026-02-23T00:05:00.000Z',
            updatedAt: '2026-02-23T00:15:00.000Z',
          },
        },
        {
          data: {
            id: 'deferred-stale-op-1',
            containerId: 'container-deferred',
            containerName: 'deferred-web',
            status: 'in-progress',
            phase: 'rollback-deferred',
            createdAt: '2026-02-23T00:20:00.000Z',
            updatedAt: '2026-02-23T00:25:00.000Z',
          },
        },
        {
          data: {
            id: 'terminal-op-1',
            containerId: 'container-terminal',
            containerName: 'done-web',
            status: 'succeeded',
            phase: 'succeeded',
            createdAt: '2026-02-23T00:30:00.000Z',
            updatedAt: '2026-02-23T00:35:00.000Z',
            completedAt: '2026-02-23T00:35:00.000Z',
          },
        },
      ];

      fresh.createCollections(createDocumentBackedDb(documents) as any);

      // Queued operations are resumable and stay queued for the recovery
      // dispatcher to pick up post-registry-init.
      expect(fresh.getOperationById('queued-fresh-op-1')).toEqual(
        expect.objectContaining({
          id: 'queued-fresh-op-1',
          status: 'queued',
          phase: 'queued',
          batchId: 'batch-1',
          queuePosition: 2,
          queueTotal: 4,
        }),
      );

      expect(fresh.getOperationById('started-stale-op-1')).toEqual(
        expect.objectContaining({
          id: 'started-stale-op-1',
          status: 'failed',
          phase: 'failed',
          completedAt: '2026-02-23T01:00:00.000Z',
          lastError: expect.stringContaining('process restart'),
        }),
      );

      expect(fresh.getOperationById('health-stale-op-1')).toEqual(
        expect.objectContaining({
          id: 'health-stale-op-1',
          status: 'failed',
          phase: 'failed',
          completedAt: '2026-02-23T01:00:00.000Z',
          lastError: expect.stringContaining('process restart'),
        }),
      );

      expect(fresh.getOperationById('deferred-stale-op-1')).toEqual(
        expect.objectContaining({
          id: 'deferred-stale-op-1',
          status: 'failed',
          phase: 'failed',
          completedAt: '2026-02-23T01:00:00.000Z',
          lastError: expect.stringContaining('process restart'),
        }),
      );

      expect(fresh.getOperationById('terminal-op-1')).toEqual(
        expect.objectContaining({
          id: 'terminal-op-1',
          status: 'succeeded',
          phase: 'succeeded',
          completedAt: '2026-02-23T00:35:00.000Z',
          updatedAt: '2026-02-23T00:35:00.000Z',
        }),
      );

      expect(fresh.getActiveOperationByContainerName('queued-web')).toEqual(
        expect.objectContaining({ id: 'queued-fresh-op-1', status: 'queued' }),
      );
      expect(fresh.getActiveOperationByContainerName('started-web')).toBeUndefined();
      expect(fresh.getActiveOperationByContainerName('health-web')).toBeUndefined();
      expect(fresh.getActiveOperationByContainerName('deferred-web')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test('createCollections should reset in-progress pulling-phase operations to queued for recovery', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-02-23T02:00:00.000Z'));
      vi.resetModules();
      const fresh = await import('./update-operation.js');
      const documents = [
        {
          data: {
            id: 'pulling-op-1',
            containerId: 'container-pulling',
            containerName: 'pulling-web',
            status: 'in-progress',
            phase: 'pulling',
            triggerName: 'docker.local',
            createdAt: '2026-02-23T01:50:00.000Z',
            updatedAt: '2026-02-23T01:55:00.000Z',
            lastError: 'partial pull',
          },
        },
      ];

      fresh.createCollections(createDocumentBackedDb(documents) as any);

      expect(fresh.getOperationById('pulling-op-1')).toEqual(
        expect.objectContaining({
          id: 'pulling-op-1',
          status: 'queued',
          phase: 'queued',
          recoveredAt: '2026-02-23T02:00:00.000Z',
          updatedAt: '2026-02-23T02:00:00.000Z',
          triggerName: 'docker.local',
          lastError: undefined,
          completedAt: undefined,
        }),
      );

      expect(fresh.getActiveOperationByContainerName('pulling-web')).toEqual(
        expect.objectContaining({ id: 'pulling-op-1', status: 'queued', phase: 'queued' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test('createCollections should still fail self-update operations even if queued or pulling', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-02-23T03:00:00.000Z'));
      vi.resetModules();
      const fresh = await import('./update-operation.js');
      const documents = [
        {
          data: {
            id: 'self-update-queued',
            kind: 'self-update',
            containerName: 'drydock',
            status: 'queued',
            phase: 'queued',
            createdAt: '2026-02-23T02:55:00.000Z',
            updatedAt: '2026-02-23T02:59:00.000Z',
          },
        },
        {
          data: {
            id: 'self-update-pulling',
            kind: 'self-update',
            containerName: 'drydock',
            status: 'in-progress',
            phase: 'pulling',
            createdAt: '2026-02-23T02:50:00.000Z',
            updatedAt: '2026-02-23T02:55:00.000Z',
          },
        },
      ];

      fresh.createCollections(createDocumentBackedDb(documents) as any);

      expect(fresh.getOperationById('self-update-queued')).toEqual(
        expect.objectContaining({ status: 'failed', phase: 'failed' }),
      );
      expect(fresh.getOperationById('self-update-pulling')).toEqual(
        expect.objectContaining({ status: 'failed', phase: 'failed' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test('createCollections should use targeted indexed status queries for startup repair', async () => {
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

    const statusQueries = findQueries.filter(
      (query): query is Record<string, string> =>
        Boolean(query) && Object.keys(query).length === 1 && 'data.status' in query,
    );

    expect(new Set(statusQueries.map((query) => query['data.status']))).toEqual(
      new Set(['queued', 'in-progress']),
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

  test('updateOperation should default queued active phases correctly', () => {
    const inserted = updateOperation.insertOperation({
      containerName: 'web',
      status: 'in-progress',
      phase: 'prepare',
    });

    const updated = updateOperation.updateOperation(inserted.id, {
      status: 'queued',
    });

    expect(updated).toEqual(
      expect.objectContaining({
        status: 'queued',
        phase: 'queued',
      }),
    );
  });

  test('updateOperation should preserve the existing status when only phase changes', () => {
    const inserted = updateOperation.insertOperation({
      containerName: 'web',
      status: 'in-progress',
      phase: 'prepare',
    });

    const updated = updateOperation.updateOperation(inserted.id, {
      phase: 'queued',
    });

    expect(updated).toEqual(
      expect.objectContaining({
        status: 'in-progress',
        phase: 'prepare',
      }),
    );
  });

  test('updateOperation should return undefined when operation id does not exist', () => {
    const result = updateOperation.updateOperation('missing-id', { status: 'in-progress' });
    expect(result).toBeUndefined();
  });

  test('updateOperation should reject terminal statuses passed at runtime', () => {
    const inserted = updateOperation.insertOperation({
      containerName: 'web',
      status: 'in-progress',
      phase: 'pulling',
    });

    expect(() =>
      updateOperation.updateOperation(inserted.id, {
        status: 'failed',
        lastError: 'runtime misuse',
      } as any),
    ).toThrow(
      'updateOperation only accepts active statuses; use markOperationTerminal() for terminal transitions',
    );

    const persisted = updateOperation.getOperationById(inserted.id);
    expect(persisted).toEqual(
      expect.objectContaining({
        id: inserted.id,
        status: 'in-progress',
        phase: 'pulling',
      }),
    );
    expect(persisted?.completedAt).toBeUndefined();
    expect(persisted?.lastError).toBeUndefined();
  });

  test('updateOperation should reject terminal phases passed at runtime', () => {
    const inserted = updateOperation.insertOperation({
      containerName: 'web',
      status: 'in-progress',
      phase: 'pulling',
    });

    expect(() =>
      updateOperation.updateOperation(inserted.id, {
        phase: 'failed',
      } as any),
    ).toThrow(
      'updateOperation only accepts active phases; use markOperationTerminal() for terminal transitions',
    );
  });

  test('updateOperation should reject completedAt passed at runtime', () => {
    const inserted = updateOperation.insertOperation({
      containerName: 'web',
      status: 'in-progress',
      phase: 'pulling',
    });

    expect(() =>
      updateOperation.updateOperation(inserted.id, {
        completedAt: '2026-02-23T00:00:00.000Z',
      } as any),
    ).toThrow(
      'updateOperation cannot set completedAt; use markOperationTerminal() for terminal transitions',
    );
  });

  test('updateOperation should reject reopening a terminal row with an explicit active patch', () => {
    const inserted = updateOperation.insertOperation({
      containerName: 'web',
      status: 'failed',
      phase: 'failed',
      completedAt: '2026-02-23T00:00:00.000Z',
      lastError: 'stale terminal state',
    });

    expect(() =>
      updateOperation.updateOperation(inserted.id, {
        status: 'in-progress',
        phase: 'pulling',
        completedAt: undefined,
        lastError: undefined,
      }),
    ).toThrow(
      'updateOperation cannot modify terminal operations; use reopenTerminalOperation() for an explicit restart',
    );
  });

  test('reopenTerminalOperation should explicitly restart a terminal row', () => {
    const inserted = updateOperation.insertOperation({
      containerName: 'web',
      status: 'failed',
      phase: 'failed',
      completedAt: '2026-02-23T00:00:00.000Z',
      lastError: 'stale terminal state',
      rollbackReason: 'stale-rollback',
      newContainerId: 'stale-new-container',
      batchId: 'stale-batch',
      queuePosition: 2,
      queueTotal: 4,
      tempName: 'web-old-stale',
      oldContainerStopped: true,
    });

    const updated = updateOperation.reopenTerminalOperation(inserted.id, {
      status: 'in-progress',
      phase: 'pulling',
      tempName: 'web-old-fresh',
      oldContainerStopped: false,
    });

    expect(updated).toEqual(
      expect.objectContaining({
        id: inserted.id,
        status: 'in-progress',
        phase: 'pulling',
        completedAt: undefined,
        lastError: undefined,
        rollbackReason: undefined,
        newContainerId: undefined,
        batchId: undefined,
        queuePosition: undefined,
        queueTotal: undefined,
        tempName: 'web-old-fresh',
        oldContainerStopped: false,
      }),
    );
  });

  test('reopenTerminalOperation should clear stale terminal fields when caller forgets', () => {
    const inserted = updateOperation.insertOperation({
      containerName: 'web',
      status: 'failed',
      phase: 'failed',
      completedAt: '2026-02-23T00:00:00.000Z',
      lastError: 'stale terminal state',
      rollbackReason: 'stale-rollback',
      newContainerId: 'stale-new-container',
      batchId: 'stale-batch',
      queuePosition: 3,
      queueTotal: 5,
      tempName: 'web-old-stale',
      oldContainerStopped: true,
    });

    const updated = updateOperation.reopenTerminalOperation(inserted.id, {
      status: 'in-progress',
      phase: 'pulling',
    });

    expect(updated).toEqual(
      expect.objectContaining({
        status: 'in-progress',
        phase: 'pulling',
        completedAt: undefined,
        lastError: undefined,
        rollbackReason: undefined,
        newContainerId: undefined,
        batchId: undefined,
        queuePosition: undefined,
        queueTotal: undefined,
        tempName: undefined,
        oldContainerStopped: undefined,
      }),
    );
  });

  test('reopenTerminalOperation should reject terminal phases and terminal completedAt strings', () => {
    const inserted = updateOperation.insertOperation({
      containerName: 'web',
      status: 'failed',
      phase: 'failed',
      completedAt: '2026-02-23T00:00:00.000Z',
    });

    expect(() =>
      updateOperation.reopenTerminalOperation(inserted.id, {
        status: 'in-progress',
        phase: 'failed',
      }),
    ).toThrow(
      'reopenTerminalOperation only accepts active phases; use markOperationTerminal() for terminal transitions',
    );

    expect(() =>
      updateOperation.reopenTerminalOperation(inserted.id, {
        status: 'in-progress',
        phase: 'pulling',
        completedAt: '2026-02-23T00:01:00.000Z',
      } as any),
    ).toThrow('reopenTerminalOperation cannot set completedAt to a string value');
  });

  test('reopenTerminalOperation should return undefined for missing rows and reject active rows', () => {
    expect(
      updateOperation.reopenTerminalOperation('missing-op', {
        status: 'in-progress',
        phase: 'pulling',
      }),
    ).toBeUndefined();

    const active = updateOperation.insertOperation({
      containerName: 'web',
      status: 'in-progress',
      phase: 'pulling',
    });

    expect(() =>
      updateOperation.reopenTerminalOperation(active.id, {
        status: 'in-progress',
        phase: 'pulling',
      }),
    ).toThrow(
      'reopenTerminalOperation only accepts terminal operations; use updateOperation() for active rows',
    );
  });

  test('reopenTerminalOperation should reject terminal statuses from a terminal row', () => {
    const inserted = updateOperation.insertOperation({
      containerName: 'web',
      status: 'failed',
      phase: 'failed',
      completedAt: '2026-02-23T00:00:00.000Z',
    });

    expect(() =>
      updateOperation.reopenTerminalOperation(inserted.id, {
        status: 'failed' as any,
        phase: 'pulling',
      }),
    ).toThrow(
      'reopenTerminalOperation only accepts active statuses; use markOperationTerminal() for terminal transitions',
    );
  });

  test('markOperationTerminal should return undefined when the row disappears between lookup and patch', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    let lookupCount = 0;
    const collection = {
      insert: vi.fn(),
      find: vi.fn(() => []),
      findOne: vi.fn(() => {
        lookupCount += 1;
        if (lookupCount === 1) {
          return {
            data: {
              id: 'op-1',
              containerName: 'web',
              status: 'queued',
              phase: 'queued',
              createdAt: '2026-02-23T00:00:00.000Z',
              updatedAt: '2026-02-23T00:00:00.000Z',
            },
          };
        }
        return null;
      }),
      remove: vi.fn(),
    };

    fresh.createCollections({
      getCollection: () => collection,
      addCollection: () => collection,
    } as any);

    expect(
      fresh.markOperationTerminal('op-1', {
        status: 'failed',
        lastError: 'lost row',
      }),
    ).toBeUndefined();
  });

  test('reopenTerminalOperation should default invalid active phases to the active default', () => {
    const inserted = updateOperation.insertOperation({
      containerName: 'web',
      status: 'failed',
      phase: 'failed',
      completedAt: '2026-02-23T00:00:00.000Z',
    });

    const reopened = updateOperation.reopenTerminalOperation(inserted.id, {
      status: 'in-progress',
      phase: 'queued',
    });

    expect(reopened).toEqual(
      expect.objectContaining({
        status: 'in-progress',
        phase: 'prepare',
      }),
    );
  });

  test('markOperationTerminal should set completedAt, clear queue metadata, and default failed phase', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-02-23T00:00:00.000Z'));
      const inserted = updateOperation.insertOperation({
        containerName: 'web',
        status: 'queued',
        phase: 'queued',
        batchId: 'batch-1',
        queuePosition: 2,
        queueTotal: 4,
      });

      vi.setSystemTime(new Date('2026-02-23T00:01:00.000Z'));
      const terminal = updateOperation.markOperationTerminal(inserted.id, {
        status: 'failed',
        lastError: 'scan failed',
      });

      expect(terminal).toEqual(
        expect.objectContaining({
          id: inserted.id,
          status: 'failed',
          phase: 'failed',
          lastError: 'scan failed',
          completedAt: '2026-02-23T00:01:00.000Z',
          batchId: undefined,
          queuePosition: undefined,
          queueTotal: undefined,
        }),
      );
      expect(updateOperation.getActiveOperationByContainerName('web')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test('markOperationTerminal should normalize invalid terminal phases to the status default', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-02-23T00:00:00.000Z'));
      const inserted = updateOperation.insertOperation({
        containerName: 'web',
        status: 'queued',
        phase: 'queued',
      });

      vi.setSystemTime(new Date('2026-02-23T00:01:00.000Z'));
      const terminal = updateOperation.markOperationTerminal(inserted.id, {
        status: 'failed',
        phase: 'rolled-back',
        lastError: 'scan failed',
      });

      expect(terminal).toEqual(
        expect.objectContaining({
          id: inserted.id,
          status: 'failed',
          phase: 'failed',
          lastError: 'scan failed',
          completedAt: '2026-02-23T00:01:00.000Z',
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test('markOperationTerminal should return undefined when the operation is missing and preserve terminal rows', () => {
    expect(
      updateOperation.markOperationTerminal('missing-op', { status: 'failed' }),
    ).toBeUndefined();

    const terminal = updateOperation.insertOperation({
      containerName: 'web',
      status: 'failed',
      phase: 'failed',
      completedAt: '2026-02-23T00:00:00.000Z',
      lastError: 'already done',
    });

    expect(
      updateOperation.markOperationTerminal(terminal.id, {
        status: 'failed',
        lastError: 'new error',
      }),
    ).toEqual(terminal);
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
    updateOperation.markOperationTerminal(older.id, {
      status: 'rolled-back',
      completedAt: '2026-02-23T00:01:00.000Z',
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

  test('getInProgressOperationByContainerId should ignore non-in-progress documents returned by the collection', () => {
    const collection = {
      insert: vi.fn(),
      remove: vi.fn(),
      find: vi.fn((query: Record<string, string> = {}) => {
        if (query['data.containerId'] === 'container-1' && query['data.status'] === 'in-progress') {
          return [
            {
              data: {
                id: 'op-1',
                containerId: 'container-1',
                status: 'failed',
                phase: 'failed',
              },
            },
          ];
        }

        if (
          query['data.newContainerId'] === 'container-1' &&
          query['data.status'] === 'in-progress'
        ) {
          return [
            {
              data: {
                id: 'op-2',
                newContainerId: 'container-1',
                status: 'succeeded',
                phase: 'succeeded',
              },
            },
          ];
        }

        return [];
      }),
      findOne: vi.fn(),
    };

    updateOperation.createCollections({
      getCollection: () => collection,
      addCollection: () => collection,
    } as any);

    expect(updateOperation.getInProgressOperationByContainerId('container-1')).toBeUndefined();
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

  test('getActiveOperationByContainerId should return undefined when direct match is stale', async () => {
    vi.resetModules();
    const previousActiveTtlMs = process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS;
    process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS = '60000';
    vi.useFakeTimers();

    try {
      const fresh = await import('./update-operation.js');
      fresh.createCollections(createDb());

      vi.setSystemTime(new Date('2026-02-23T00:00:00.000Z'));
      fresh.insertOperation({
        containerName: 'web',
        containerId: 'old-123',
        status: 'in-progress',
        phase: 'pulling',
      });

      vi.setSystemTime(new Date('2026-02-23T00:01:01.000Z'));
      expect(fresh.getActiveOperationByContainerId('old-123')).toBeUndefined();
    } finally {
      vi.useRealTimers();
      if (previousActiveTtlMs === undefined) {
        delete process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS;
      } else {
        process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS = previousActiveTtlMs;
      }
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

  test('getActiveOperationByContainerId should return latest active operation from direct and replacement IDs', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-02-23T00:00:00.000Z'));
      const original = updateOperation.insertOperation({
        containerName: 'web',
        containerId: 'target-123',
        status: 'in-progress',
        phase: 'pulling',
      });

      vi.setSystemTime(new Date('2026-02-23T00:01:00.000Z'));
      const replacement = updateOperation.insertOperation({
        containerName: 'web',
        containerId: 'other-456',
        status: 'in-progress',
        phase: 'pulling',
      });
      updateOperation.updateOperation(replacement.id, {
        newContainerId: 'target-123',
      });

      const active = updateOperation.getActiveOperationByContainerId('target-123');

      expect(active?.id).toBe(replacement.id);
      expect(active?.newContainerId).toBe('target-123');
      expect(active?.containerId).toBe('other-456');
      expect(active?.id).not.toBe(original.id);
    } finally {
      vi.useRealTimers();
    }
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

  test('getOperationById should return undefined for empty string', () => {
    expect(updateOperation.getOperationById('')).toBeUndefined();
  });

  test('getOperationById should return undefined when uninitialized', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    expect(fresh.getOperationById('op-1')).toBeUndefined();
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
        batchId: 'batch-ttl',
        queuePosition: 1,
        queueTotal: 3,
      });

      vi.setSystemTime(new Date('2026-02-23T00:01:01.000Z'));
      const active = fresh.getActiveOperationByContainerName('web');

      expect(active).toBeUndefined();
      expect(fresh.getOperationById(queued.id)).toEqual(
        expect.objectContaining({
          id: queued.id,
          status: 'failed',
          phase: 'failed',
          completedAt: '2026-02-23T00:01:01.000Z',
          batchId: undefined,
          queuePosition: undefined,
          queueTotal: undefined,
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

  test('getActiveOperationByContainerName should return undefined when stale operation disappears during expiration', async () => {
    vi.resetModules();
    const previousActiveTtlMs = process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS;
    process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS = '60000';
    vi.useFakeTimers();

    try {
      const missingIds = new Set<string>();
      const fresh = await import('./update-operation.js');
      fresh.createCollections(createDb({ missingIds }) as any);

      vi.setSystemTime(new Date('2026-02-23T00:00:00.000Z'));
      const queued = fresh.insertOperation({
        containerName: 'web',
        status: 'queued',
        phase: 'queued',
      });
      missingIds.add(queued.id);

      vi.setSystemTime(new Date('2026-02-23T00:01:01.000Z'));
      expect(fresh.getActiveOperationByContainerName('web')).toBeUndefined();
    } finally {
      vi.useRealTimers();
      if (previousActiveTtlMs === undefined) {
        delete process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS;
      } else {
        process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS = previousActiveTtlMs;
      }
    }
  });

  test('getActiveOperationByContainerName should return undefined when stale operation is already inactive', async () => {
    vi.resetModules();
    const previousActiveTtlMs = process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS;
    process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS = '60000';
    vi.useFakeTimers();

    try {
      const inactiveIds = new Set<string>();
      const fresh = await import('./update-operation.js');
      fresh.createCollections(createDb({ inactiveIds }) as any);

      vi.setSystemTime(new Date('2026-02-23T00:00:00.000Z'));
      const queued = fresh.insertOperation({
        containerName: 'web',
        status: 'queued',
        phase: 'queued',
      });
      inactiveIds.add(queued.id);

      vi.setSystemTime(new Date('2026-02-23T00:01:01.000Z'));
      expect(fresh.getActiveOperationByContainerName('web')).toBeUndefined();
    } finally {
      vi.useRealTimers();
      if (previousActiveTtlMs === undefined) {
        delete process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS;
      } else {
        process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS = previousActiveTtlMs;
      }
    }
  });

  test('getActiveOperationByContainerName should return latest active operation by timestamp', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-02-23T00:00:00.000Z'));
      updateOperation.insertOperation({
        containerName: 'web',
        status: 'in-progress',
        phase: 'pulling',
      });

      vi.setSystemTime(new Date('2026-02-23T00:01:00.000Z'));
      const newer = updateOperation.insertOperation({
        containerName: 'web',
        status: 'in-progress',
        phase: 'pulling',
      });

      const active = updateOperation.getActiveOperationByContainerName('web');

      expect(active?.id).toBe(newer.id);
    } finally {
      vi.useRealTimers();
    }
  });

  test('getActiveOperationByContainerName should ignore terminal operations and append stale errors', async () => {
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
        lastError: 'previous failure',
      });
      fresh.insertOperation({
        containerName: 'web',
        status: 'succeeded',
        phase: 'succeeded',
      });

      vi.setSystemTime(new Date('2026-02-23T00:01:01.000Z'));
      expect(fresh.getActiveOperationByContainerName('web')).toBeUndefined();
      expect(fresh.getOperationById(queued.id)?.lastError).toContain(
        'previous failure; Marked failed after exceeding active update TTL',
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

  test('getActiveOperationByContainerName should return undefined when uninitialized', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    expect(fresh.getActiveOperationByContainerName('web')).toBeUndefined();
  });

  test('listActiveOperations returns an empty list when uninitialized', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    expect(fresh.listActiveOperations()).toEqual([]);
  });

  test('listActiveOperations returns active operations sorted by latest update time', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-02-23T00:00:00.000Z'));
      updateOperation.insertOperation({
        id: 'queued-op',
        containerName: 'web',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-02-23T00:00:00.000Z',
      });

      vi.setSystemTime(new Date('2026-02-23T00:01:00.000Z'));
      updateOperation.insertOperation({
        id: 'progress-op',
        containerName: 'api',
        status: 'in-progress',
        phase: 'pulling',
        updatedAt: '2026-02-23T00:01:00.000Z',
      });

      updateOperation.insertOperation({
        id: 'failed-op',
        containerName: 'worker',
        status: 'failed',
        phase: 'failed',
        updatedAt: '2026-02-23T00:02:00.000Z',
      });

      expect(updateOperation.listActiveOperations().map((operation) => operation.id)).toEqual([
        'progress-op',
        'queued-op',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  test('getActiveOperationByContainerName should handle a terminal replacement returned from storage', async () => {
    vi.resetModules();
    const previousActiveTtlMs = process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS;
    process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS = '60000';
    vi.useFakeTimers();

    try {
      const fresh = await import('./update-operation.js');
      const staleDoc = {
        data: {
          id: 'op-1',
          containerName: 'web',
          status: 'queued',
          phase: 'queued',
          createdAt: '2026-02-23T00:00:00.000Z',
          updatedAt: '2026-02-23T00:00:00.000Z',
        },
      };
      const collection = {
        insert: vi.fn(),
        remove: vi.fn(),
        find: vi.fn((query = {}) => (query['data.containerName'] === 'web' ? [staleDoc] : [])),
        findOne: vi.fn((query = {}) =>
          query['data.id'] === 'op-1'
            ? {
                data: {
                  ...staleDoc.data,
                  status: 'failed',
                },
              }
            : null,
        ),
      };
      const db = {
        getCollection: vi.fn(() => collection),
        addCollection: vi.fn(),
      };
      fresh.createCollections(db as never);

      vi.setSystemTime(new Date('2026-02-23T00:01:01.000Z'));
      expect(fresh.getActiveOperationByContainerName('web')).toBeUndefined();
      expect(collection.findOne).toHaveBeenCalledWith({ 'data.id': 'op-1' });
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
          phase: 'failed',
          completedAt: '2026-02-23T00:01:01.000Z',
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

  test('getActiveOperationByContainerId should return the latest fresh active replacement operation', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-02-23T00:00:00.000Z'));
      updateOperation.insertOperation({
        containerName: 'web',
        containerId: 'new-456',
        status: 'queued',
        phase: 'queued',
      });
      vi.setSystemTime(new Date('2026-02-23T00:01:00.000Z'));
      const replacement = updateOperation.insertOperation({
        containerName: 'web',
        containerId: 'old-123',
        status: 'in-progress',
        phase: 'pulling',
      });
      updateOperation.updateOperation(replacement.id, {
        newContainerId: 'new-456',
      });

      const active = updateOperation.getActiveOperationByContainerId('new-456');
      expect(active?.id).toBe(replacement.id);
    } finally {
      vi.useRealTimers();
    }
  });

  test('getActiveOperationByContainerId should return undefined for empty string', () => {
    expect(updateOperation.getActiveOperationByContainerId('')).toBeUndefined();
  });

  test('getActiveOperationByContainerId should return undefined for empty string', () => {
    expect(updateOperation.getActiveOperationByContainerId('')).toBeUndefined();
  });

  test('getActiveOperationByContainerName should ignore inactive operations', () => {
    updateOperation.insertOperation({
      containerName: 'web',
      status: 'failed',
      phase: 'rollback-failed',
    });

    expect(updateOperation.getActiveOperationByContainerName('web')).toBeUndefined();
  });

  test('getOperationById should return undefined for empty string', () => {
    expect(updateOperation.getOperationById('')).toBeUndefined();
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
      updateOperation.markOperationTerminal(first.id, {
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
      const active = fresh.insertOperation({
        containerName: 'web',
        status: 'in-progress',
        phase: 'prepare',
      });

      for (let i = 0; i < 97; i += 1) {
        vi.setSystemTime(new Date(2026, 2, 1, 0, 1, i));
        fresh.updateOperation(active.id, {
          phase: i % 2 === 0 ? 'prepare' : 'health-gate',
        });
      }

      const operations = fresh.getOperationsByContainerName('web');
      const terminalOperations = operations.filter(
        (operation) => operation.status !== 'queued' && operation.status !== 'in-progress',
      );

      expect(terminalOperations).toHaveLength(2);
      expect(terminalOperations.map((operation) => operation.id)).toEqual([third.id, second.id]);
      expect(terminalOperations.find((operation) => operation.id === first.id)).toBeUndefined();
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
        fresh.updateOperation(queued.id, {
          phase: 'queued',
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
    expect(fresh.updateOperation('missing', { status: 'in-progress' })).toBeUndefined();
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

  describe('cancelQueuedOperation', () => {
    test('transitions a queued operation to failed with cancellation error', () => {
      const op = updateOperation.insertOperation({
        containerName: 'web',
        status: 'queued',
        phase: 'queued',
      });

      const result = updateOperation.cancelQueuedOperation(op.id);

      expect(result).toBeDefined();
      expect(result!.id).toBe(op.id);
      expect(result!.status).toBe('failed');
      expect(result!.phase).toBe('failed');
      expect(result!.lastError).toBe('Cancelled by operator');
      expect(result!.completedAt).toBeDefined();
    });

    test('returns undefined for an in-progress operation', () => {
      const op = updateOperation.insertOperation({
        containerName: 'web',
        status: 'in-progress',
        phase: 'pulling',
      });

      expect(updateOperation.cancelQueuedOperation(op.id)).toBeUndefined();
      expect(updateOperation.getOperationById(op.id)!.status).toBe('in-progress');
    });

    test('returns undefined for a missing id', () => {
      expect(updateOperation.cancelQueuedOperation('does-not-exist')).toBeUndefined();
    });

    test('returns undefined when collection is not initialized', async () => {
      vi.resetModules();
      const fresh = await import('./update-operation.js');
      expect(fresh.cancelQueuedOperation('any-id')).toBeUndefined();
    });
  });
});
