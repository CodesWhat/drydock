import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { registerContainerUpdateApplied, registerContainerUpdateFailed } from '../event/index.js';
import { getContainerIdentityKey } from '../model/container.js';
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import type { Database } from './db/driver.js';
import * as updateOperation from './update-operation.js';

/**
 * Every fixture in this suite predates the identity cut (roadmap 7-STORE,
 * slice 10) and was written against a bare container name. Rather than touch
 * every one of the ~135 `insertOperation` call sites individually, `insertOp`
 * threads a stand-in watcher through so `deriveOperationIdentityKey` always
 * has something to resolve against, matching what a real Docker watcher
 * always supplies. A call site that needs a different agent/watcher (the
 * cross-agent disambiguation tests) overrides it by including its own
 * `watcher`/`agent` key, which the later spread wins over.
 */
const DEFAULT_WATCHER = 'watcher-test';

function insertOp(
  mod: Pick<typeof updateOperation, 'insertOperation'>,
  operation: Parameters<typeof updateOperation.insertOperation>[0],
  options?: Parameters<typeof updateOperation.insertOperation>[1],
) {
  return mod.insertOperation({ watcher: DEFAULT_WATCHER, ...operation }, options);
}

/** The identity key a container with this name resolves to under `insertOp`'s default watcher. */
function identity(name: string, scope?: { agent?: string; watcher?: string }): string | undefined {
  return getContainerIdentityKey({
    agent: scope?.agent,
    watcher: scope?.watcher ?? DEFAULT_WATCHER,
    name,
  });
}

const openDatabases: Database[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
});

/** A fresh real SQLite database with the schema applied, closed automatically after the test. */
function createDb(options?: { inactiveIds?: Set<string>; missingIds?: Set<string> }): Database {
  const database = createMigratedMemoryDatabase();
  openDatabases.push(database);

  const missingIds = options?.missingIds;
  const inactiveIds = options?.inactiveIds;
  if (!missingIds && !inactiveIds) {
    return database;
  }

  // Intercept the row-identity re-read `getFreshActiveOperation` performs
  // (roadmap 7-STORE slice 10, `expireActiveOperationWithMessage`) so a test
  // can simulate the row having disappeared or already gone inactive between
  // the outer by-identity query and this per-id re-check, the same race the
  // old Loki-backed `findOne` mock injected.
  const realPrepare = database.prepare.bind(database);
  const raceSql = 'SELECT * FROM update_operations WHERE id = ?';
  database.prepare = ((sql: string) => {
    const statement = realPrepare(sql);
    if (sql !== raceSql) {
      return statement;
    }
    return {
      ...statement,
      get: (...parameters: unknown[]) => {
        const id = parameters[0] as string;
        if (missingIds?.has(id)) {
          return undefined;
        }
        const row = statement.get(...(parameters as never[]));
        if (row && inactiveIds?.has(id)) {
          return { ...row, status: 'failed' };
        }
        return row;
      },
    };
  }) as Database['prepare'];
  return database;
}

/**
 * Seed a real database with legacy `{ data: ... }`-enveloped documents before
 * `createCollections` runs, exercising the same startup reconciliation path
 * `createDocumentBackedDb` used to under LokiJS. Reuses the collection
 * importer's own row builder (`buildImportedUpdateOperationRow`) so a seeded
 * row is exactly what `store/db/importers/update-operations.ts` would import.
 */
function createDocumentBackedDb(documents: { data: Record<string, unknown> }[]): Database {
  const database = createMigratedMemoryDatabase();
  openDatabases.push(database);
  for (const document of documents) {
    // Same default-watcher stand-in insertOp threads through inserts: these
    // fixtures predate the identity cut and never carried a watcher of their
    // own, so give buildImportedUpdateOperationRow something to derive from.
    const row = updateOperation.buildImportedUpdateOperationRow({
      watcher: DEFAULT_WATCHER,
      ...document.data,
    });
    if (row) {
      updateOperation.insertImportedUpdateOperationRow(database, row);
    }
  }
  return database;
}

describe('buildImportedUpdateOperationRow', () => {
  test('returns undefined for non-object input', () => {
    expect(updateOperation.buildImportedUpdateOperationRow(null)).toBeUndefined();
    expect(updateOperation.buildImportedUpdateOperationRow('not-an-object')).toBeUndefined();
  });
});

describe('Update Operation Store', () => {
  beforeEach(() => {
    updateOperation.createCollections(createDb());
  });

  test('createCollections should leave a freshly migrated update_operations table empty and queryable', () => {
    const database = createDb();
    updateOperation.createCollections(database);
    expect(database.prepare('SELECT COUNT(*) AS n FROM update_operations').get()).toEqual({ n: 0 });
  });

  test('createCollections should preserve Docker-mutating in-progress phases for runtime reconciliation', async () => {
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
          status: 'in-progress',
          phase: 'new-started',
        }),
      );

      expect(fresh.getOperationById('health-stale-op-1')).toEqual(
        expect.objectContaining({
          id: 'health-stale-op-1',
          status: 'in-progress',
          phase: 'health-gate',
        }),
      );

      expect(fresh.getOperationById('deferred-stale-op-1')).toEqual(
        expect.objectContaining({
          id: 'deferred-stale-op-1',
          status: 'in-progress',
          phase: 'rollback-deferred',
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

      expect(fresh.getActiveOperationByContainerIdentity(identity('queued-web'))).toEqual(
        expect.objectContaining({ id: 'queued-fresh-op-1', status: 'queued' }),
      );
      expect(fresh.getActiveOperationByContainerIdentity(identity('started-web'))?.status).toBe(
        'in-progress',
      );
      expect(fresh.getActiveOperationByContainerIdentity(identity('health-web'))?.status).toBe(
        'in-progress',
      );
      expect(fresh.getActiveOperationByContainerIdentity(identity('deferred-web'))?.status).toBe(
        'in-progress',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test.each([
    'prepare',
    'renamed',
    'new-created',
    'old-stopped',
    'new-started',
    'health-gate',
    'rollback-started',
    'rollback-deferred',
  ])('createCollections should keep %s operations in-progress across restart', async (phase) => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    const documents = [
      {
        data: {
          id: `op-${phase}`,
          containerId: 'container-old',
          containerName: 'web',
          status: 'in-progress',
          phase,
          oldContainerId: 'container-old',
          tempName: 'web-drydock-update',
          newContainerId: 'container-new',
          createdAt: '2026-02-23T00:00:00.000Z',
          updatedAt: '2026-02-23T00:10:00.000Z',
        },
      },
    ];

    fresh.createCollections(createDocumentBackedDb(documents) as any);

    expect(fresh.getOperationById(`op-${phase}`)).toEqual(
      expect.objectContaining({ status: 'in-progress', phase }),
    );
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

      expect(fresh.getActiveOperationByContainerIdentity(identity('pulling-web'))).toEqual(
        expect.objectContaining({ id: 'pulling-op-1', status: 'queued', phase: 'queued' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test('createCollections should still fail stale self-update operations but preserve fresh in-progress ones', async () => {
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
        {
          data: {
            id: 'self-update-fresh-inprogress',
            kind: 'self-update',
            containerName: 'drydock',
            status: 'in-progress',
            phase: 'prepare',
            // 2 minutes ago — within the 10-minute grace window
            createdAt: '2026-02-23T02:58:00.000Z',
            updatedAt: '2026-02-23T02:58:00.000Z',
          },
        },
        {
          data: {
            id: 'self-update-stale-inprogress',
            kind: 'self-update',
            containerName: 'drydock',
            status: 'in-progress',
            phase: 'prepare',
            // 15 minutes ago — older than 10-minute grace window
            createdAt: '2026-02-23T02:40:00.000Z',
            updatedAt: '2026-02-23T02:45:00.000Z',
          },
        },
      ];

      fresh.createCollections(createDocumentBackedDb(documents) as any);

      // Queued self-update ops are NOT resumable — they expire as before.
      expect(fresh.getOperationById('self-update-queued')).toEqual(
        expect.objectContaining({ status: 'expired', phase: 'expired' }),
      );
      // Pulling self-update ops are NOT resumable — they expire as before.
      expect(fresh.getOperationById('self-update-pulling')).toEqual(
        expect.objectContaining({ status: 'expired', phase: 'expired' }),
      );
      // Fresh in-progress self-update (within grace window) is preserved.
      expect(fresh.getOperationById('self-update-fresh-inprogress')).toEqual(
        expect.objectContaining({ status: 'in-progress', phase: 'prepare' }),
      );
      // Stale in-progress self-update (beyond grace window) is expired.
      expect(fresh.getOperationById('self-update-stale-inprogress')).toEqual(
        expect.objectContaining({ status: 'expired', phase: 'expired' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test('createCollections should use targeted indexed status queries for startup repair', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    const statusQuerySql = 'SELECT * FROM update_operations WHERE status = ?';
    const statusesQueried: string[] = [];
    const database = createDb();
    const realPrepare = database.prepare.bind(database);
    database.prepare = ((sql: string) => {
      const statement = realPrepare(sql);
      if (sql !== statusQuerySql) {
        return statement;
      }
      return {
        ...statement,
        all: (...parameters: unknown[]) => {
          statusesQueried.push(parameters[0] as string);
          return statement.all(...(parameters as never[]));
        },
      };
    }) as Database['prepare'];

    fresh.createCollections(database);

    // Active statuses from startup repair + terminal statuses from the startup prune call.
    expect(new Set(statusesQueried)).toEqual(
      new Set([
        'queued',
        'in-progress',
        'succeeded',
        'rolled-back',
        'failed',
        'expired',
        'skipped-dependency',
      ]),
    );
  });

  test('insertOperation should default to in-progress prepare state', () => {
    const inserted = insertOp(updateOperation, {
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

  test('insertOperation normalises empty-string agent to undefined', () => {
    const inserted = insertOp(updateOperation, {
      containerName: 'web',
      agent: '',
    });

    expect((inserted as unknown as Record<string, unknown>).agent).toBeUndefined();
  });

  test('insertOperation normalises empty-string watcher to undefined', () => {
    const inserted = insertOp(updateOperation, {
      containerName: 'web',
      watcher: '',
    });

    expect((inserted as unknown as Record<string, unknown>).watcher).toBeUndefined();
  });

  test('insertOperation normalises empty-string agent/watcher inside container snapshot to undefined', () => {
    const inputContainer = { id: 'c1', name: 'web', agent: '', watcher: '' } as any;
    const inserted = insertOp(updateOperation, {
      containerName: 'web',
      container: inputContainer,
    });

    const container = (inserted as unknown as Record<string, unknown>).container as Record<
      string,
      unknown
    >;
    expect(container.agent).toBeUndefined();
    expect(container.watcher).toBeUndefined();
    // The stored container must be a clone — the caller's object must not be mutated.
    expect(container).not.toBe(inputContainer);
    expect(inputContainer.agent).toBe('');
    expect(inputContainer.watcher).toBe('');
  });

  test('insertOperation normalises empty-string agent but preserves non-empty watcher in container snapshot', () => {
    const inserted = insertOp(updateOperation, {
      containerName: 'web',
      container: { id: 'c1', name: 'web', agent: '', watcher: 'local' } as any,
    });

    const container = (inserted as unknown as Record<string, unknown>).container as Record<
      string,
      unknown
    >;
    expect(container.agent).toBeUndefined();
    expect(container.watcher).toBe('local');
  });

  test('insertOperation normalises empty-string watcher but preserves non-empty agent in container snapshot', () => {
    const inserted = insertOp(updateOperation, {
      containerName: 'web',
      container: { id: 'c1', name: 'web', agent: 'agent-A', watcher: '' } as any,
    });

    const container = (inserted as unknown as Record<string, unknown>).container as Record<
      string,
      unknown
    >;
    expect(container.agent).toBe('agent-A');
    expect(container.watcher).toBeUndefined();
  });

  test('insertOperation preserves non-empty agent and watcher strings unchanged', () => {
    const inserted = insertOp(updateOperation, {
      containerName: 'web',
      agent: 'agent-A',
      watcher: 'local',
      container: { id: 'c1', name: 'web', agent: 'agent-A', watcher: 'local' } as any,
    });

    const op = inserted as unknown as Record<string, unknown>;
    const container = op.container as Record<string, unknown>;
    expect(op.agent).toBe('agent-A');
    expect(op.watcher).toBe('local');
    expect(container.agent).toBe('agent-A');
    expect(container.watcher).toBe('local');
  });

  test('updateOperation should merge patch and refresh updatedAt', () => {
    const inserted = insertOp(updateOperation, {
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
    const inserted = insertOp(updateOperation, {
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
    const inserted = insertOp(updateOperation, {
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
    const inserted = insertOp(updateOperation, {
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
    const inserted = insertOp(updateOperation, {
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
    const inserted = insertOp(updateOperation, {
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
    const inserted = insertOp(updateOperation, {
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
    const inserted = insertOp(updateOperation, {
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
    const inserted = insertOp(updateOperation, {
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
    const inserted = insertOp(updateOperation, {
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

    const active = insertOp(updateOperation, {
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
    const inserted = insertOp(updateOperation, {
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
    const database = createDb();
    // markOperationTerminal reads the row once via getOperationById, then
    // persistOperationPatch reads it again by id before writing. Answer the
    // first by-id read for real and simulate the row having disappeared
    // (deleted by a concurrent writer) by the second.
    const byIdSql = 'SELECT * FROM update_operations WHERE id = ?';
    const realPrepare = database.prepare.bind(database);
    let lookupCount = 0;
    database.prepare = ((sql: string) => {
      const statement = realPrepare(sql);
      if (sql !== byIdSql) {
        return statement;
      }
      return {
        ...statement,
        get: (...parameters: unknown[]) => {
          lookupCount += 1;
          return lookupCount === 1 ? statement.get(...(parameters as never[])) : undefined;
        },
      };
    }) as Database['prepare'];

    fresh.createCollections(database);
    insertOp(fresh, {
      id: 'op-1',
      containerName: 'web',
      status: 'queued',
      phase: 'queued',
    });

    expect(
      fresh.markOperationTerminal('op-1', {
        status: 'failed',
        lastError: 'lost row',
      }),
    ).toBeUndefined();
  });

  test('reopenTerminalOperation should default invalid active phases to the active default', () => {
    const inserted = insertOp(updateOperation, {
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

  test('markOperationTerminal should set completedAt, preserve batch metadata, and default failed phase', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-02-23T00:00:00.000Z'));
      const inserted = insertOp(updateOperation, {
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
          batchId: 'batch-1',
          queuePosition: 2,
          queueTotal: 4,
        }),
      );
      expect(
        updateOperation.getActiveOperationByContainerIdentity(identity('web')),
      ).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test('markOperationTerminal should normalize invalid terminal phases to the status default', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-02-23T00:00:00.000Z'));
      const inserted = insertOp(updateOperation, {
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

    const inserted = insertOp(updateOperation, {
      containerName: 'web',
      status: 'failed',
      phase: 'failed',
      completedAt: '2026-02-23T00:00:00.000Z',
      lastError: 'already done',
    });
    // Compare against a fresh read rather than insertOp's own return value:
    // insertOperation echoes back what the caller passed in, while a read
    // goes through rowToOperation's column defaults (e.g. cancelRequested
    // defaults to false), so the two are not byte-for-byte identical.
    const terminal = updateOperation.getOperationById(inserted.id);

    expect(
      updateOperation.markOperationTerminal(terminal!.id, {
        status: 'failed',
        lastError: 'new error',
      }),
    ).toEqual(terminal);
  });

  test('markOperationTerminal tolerates a persisted batch row without in-memory membership', () => {
    const database = createDb();
    updateOperation.createCollections(database);
    // Write the row straight to storage after createCollections has already run
    // its startup batch-membership rehydration, so this row was never
    // registered in the in-memory batch-tracking maps: the same situation a
    // row added by a concurrent process would produce.
    const row = updateOperation.buildImportedUpdateOperationRow({
      id: 'unregistered-batch-member',
      containerName: 'web',
      watcher: DEFAULT_WATCHER,
      status: 'in-progress',
      phase: 'pulling',
      batchId: 'unregistered-batch',
      createdAt: '2026-02-23T00:00:00.000Z',
      updatedAt: '2026-02-23T00:00:00.000Z',
    });
    updateOperation.insertImportedUpdateOperationRow(database, row!);

    expect(
      updateOperation.markOperationTerminal('unregistered-batch-member', {
        status: 'succeeded',
      }),
    ).toMatchObject({ status: 'succeeded', batchId: 'unregistered-batch' });
  });

  test('markOperationTerminal emits update-applied with stored container snapshot (issue #385)', async () => {
    // When a compose recreate races the event handler the old container is gone
    // from the store. The container snapshot persisted at enqueue time must be
    // forwarded on the update-applied payload so notification triggers can still
    // dispatch.
    const containerSnapshot = {
      id: 'ctr-1',
      name: 'myapp',
      watcher: 'local',
      updateAvailable: false,
    };
    const inserted = insertOp(updateOperation, {
      containerName: 'myapp',
      containerId: 'ctr-1',
      status: 'queued',
      phase: 'queued',
      container: containerSnapshot as any,
    });

    const capturedPayloads: unknown[] = [];
    const unsubscribe = registerContainerUpdateApplied((payload) => {
      capturedPayloads.push(payload);
    });

    try {
      updateOperation.markOperationTerminal(inserted.id, { status: 'succeeded' });
      // emitContainerUpdateApplied is async; flush the microtask queue.
      await Promise.resolve();
      await Promise.resolve();

      expect(capturedPayloads).toHaveLength(1);
      expect(capturedPayloads[0]).toEqual(
        expect.objectContaining({
          containerName: 'myapp',
          containerId: 'ctr-1',
          operationId: inserted.id,
          container: expect.objectContaining({ id: 'ctr-1', name: 'myapp' }),
        }),
      );
    } finally {
      unsubscribe();
    }
  });

  test('markOperationTerminal emits update-failed with stored container snapshot (issue #385)', async () => {
    const containerSnapshot = {
      id: 'ctr-2',
      name: 'myapp',
      watcher: 'local',
      updateAvailable: false,
    };
    const inserted = insertOp(updateOperation, {
      containerName: 'myapp',
      containerId: 'ctr-2',
      status: 'queued',
      phase: 'queued',
      container: containerSnapshot as any,
    });

    const capturedPayloads: unknown[] = [];
    const unsubscribe = registerContainerUpdateFailed((payload) => {
      capturedPayloads.push(payload);
    });

    try {
      updateOperation.markOperationTerminal(inserted.id, {
        status: 'failed',
        lastError: 'compose recreate failed',
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(capturedPayloads).toHaveLength(1);
      expect(capturedPayloads[0]).toEqual(
        expect.objectContaining({
          containerName: 'myapp',
          containerId: 'ctr-2',
          operationId: inserted.id,
          error: 'compose recreate failed',
          container: expect.objectContaining({ id: 'ctr-2', name: 'myapp' }),
        }),
      );
    } finally {
      unsubscribe();
    }
  });

  test('getInProgressOperationByContainerIdentity should return latest in-progress operation', () => {
    const older = insertOp(updateOperation, {
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

    const newer = insertOp(updateOperation, {
      containerName: 'web',
      containerId: 'abc',
      triggerName: 'docker.update',
      oldName: 'web',
      tempName: 'web-old-2',
    });

    const active = updateOperation.getInProgressOperationByContainerIdentity(identity('web'));
    expect(active.id).toBe(newer.id);
    expect(active.status).toBe('in-progress');
  });

  test('getInProgressOperationByContainerIdentity should return undefined when uninitialized', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    expect(fresh.getInProgressOperationByContainerIdentity(identity('web'))).toBeUndefined();
  });

  test('getInProgressOperationByContainerIdentity should sort by latest timestamp', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-02-23T00:00:00.000Z'));
      insertOp(updateOperation, {
        containerName: 'web',
        status: 'in-progress',
      });
      vi.setSystemTime(new Date('2026-02-23T00:01:00.000Z'));
      const second = insertOp(updateOperation, {
        containerName: 'web',
        status: 'in-progress',
      });

      const active = updateOperation.getInProgressOperationByContainerIdentity(identity('web'));
      expect(active?.id).toBe(second.id);
    } finally {
      vi.useRealTimers();
    }
  });

  test('getInProgressOperationByContainerId should ignore non-in-progress documents returned by the collection', () => {
    // Neither row matches the `status = 'in-progress'` half of the SQL
    // WHERE clause, so this exercises the same "no eligible row" path the
    // old Loki mock's inconsistent (query-matched-but-status-differs)
    // fixture was standing in for.
    insertOp(updateOperation, {
      id: 'op-1',
      containerId: 'container-1',
      containerName: 'web',
      status: 'failed',
      phase: 'failed',
    });
    insertOp(updateOperation, {
      id: 'op-2',
      newContainerId: 'container-1',
      containerName: 'web',
      status: 'succeeded',
      phase: 'succeeded',
    });

    expect(updateOperation.getInProgressOperationByContainerId('container-1')).toBeUndefined();
  });

  test('getInProgressOperationByContainerId should return operation matching the container ID', () => {
    insertOp(updateOperation, {
      containerName: 'portainer_agent',
      containerId: 'host1-abc',
    });
    insertOp(updateOperation, {
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
      insertOp(updateOperation, {
        containerName: 'web',
        containerId: 'c1',
      });
      vi.setSystemTime(new Date('2026-02-23T00:01:00.000Z'));
      const second = insertOp(updateOperation, {
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
      insertOp(fresh, {
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
    const operation = insertOp(updateOperation, {
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
      const original = insertOp(updateOperation, {
        containerName: 'web',
        containerId: 'target-123',
        status: 'in-progress',
        phase: 'pulling',
      });

      vi.setSystemTime(new Date('2026-02-23T00:01:00.000Z'));
      const replacement = insertOp(updateOperation, {
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
    const database = createDb();
    const queriesRun: Array<{ sql: string; parameters: unknown[] }> = [];
    const realPrepare = database.prepare.bind(database);
    database.prepare = ((sql: string) => {
      const statement = realPrepare(sql);
      return {
        ...statement,
        all: (...parameters: unknown[]) => {
          queriesRun.push({ sql, parameters });
          return statement.all(...(parameters as never[]));
        },
      };
    }) as Database['prepare'];

    fresh.createCollections(database);

    const operation = insertOp(fresh, {
      containerName: 'web',
      containerId: 'old-123',
    });
    fresh.updateOperation(operation.id, {
      newContainerId: 'new-456',
    });
    queriesRun.length = 0;

    const active = fresh.getInProgressOperationByContainerId('new-456');

    expect(active?.id).toBe(operation.id);
    expect(
      queriesRun.map((query) => ({
        sql: query.sql,
        parameters: query.parameters,
      })),
    ).toEqual([
      {
        sql: 'SELECT * FROM update_operations WHERE container_id = ? AND status = ?',
        parameters: ['new-456', 'in-progress'],
      },
      {
        sql: 'SELECT * FROM update_operations WHERE new_container_id = ? AND status = ?',
        parameters: ['new-456', 'in-progress'],
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

  test('getActiveOperationByContainerIdentity should expire stale queued operations', async () => {
    vi.resetModules();
    const previousActiveTtlMs = process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS;
    process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS = '60000';
    vi.useFakeTimers();

    try {
      const fresh = await import('./update-operation.js');
      fresh.createCollections(createDb());

      vi.setSystemTime(new Date('2026-02-23T00:00:00.000Z'));
      const queued = insertOp(fresh, {
        containerName: 'web',
        status: 'queued',
        phase: 'queued',
        batchId: 'batch-ttl',
        queuePosition: 1,
        queueTotal: 3,
      });

      vi.setSystemTime(new Date('2026-02-23T00:01:01.000Z'));
      const active = fresh.getActiveOperationByContainerIdentity(identity('web'));

      expect(active).toBeUndefined();
      expect(fresh.getOperationById(queued.id)).toEqual(
        expect.objectContaining({
          id: queued.id,
          status: 'expired',
          phase: 'expired',
          completedAt: '2026-02-23T00:01:01.000Z',
          batchId: 'batch-ttl',
          queuePosition: 1,
          queueTotal: 3,
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

  test('getActiveOperationByContainerIdentity should return undefined when stale operation disappears during expiration', async () => {
    vi.resetModules();
    const previousActiveTtlMs = process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS;
    process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS = '60000';
    vi.useFakeTimers();

    try {
      const missingIds = new Set<string>();
      const fresh = await import('./update-operation.js');
      fresh.createCollections(createDb({ missingIds }) as any);

      vi.setSystemTime(new Date('2026-02-23T00:00:00.000Z'));
      const queued = insertOp(fresh, {
        containerName: 'web',
        status: 'queued',
        phase: 'queued',
      });
      missingIds.add(queued.id);

      vi.setSystemTime(new Date('2026-02-23T00:01:01.000Z'));
      expect(fresh.getActiveOperationByContainerIdentity(identity('web'))).toBeUndefined();
    } finally {
      vi.useRealTimers();
      if (previousActiveTtlMs === undefined) {
        delete process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS;
      } else {
        process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS = previousActiveTtlMs;
      }
    }
  });

  test('getActiveOperationByContainerIdentity should return undefined when stale operation is already inactive', async () => {
    vi.resetModules();
    const previousActiveTtlMs = process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS;
    process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS = '60000';
    vi.useFakeTimers();

    try {
      const inactiveIds = new Set<string>();
      const fresh = await import('./update-operation.js');
      fresh.createCollections(createDb({ inactiveIds }) as any);

      vi.setSystemTime(new Date('2026-02-23T00:00:00.000Z'));
      const queued = insertOp(fresh, {
        containerName: 'web',
        status: 'queued',
        phase: 'queued',
      });
      inactiveIds.add(queued.id);

      vi.setSystemTime(new Date('2026-02-23T00:01:01.000Z'));
      expect(fresh.getActiveOperationByContainerIdentity(identity('web'))).toBeUndefined();
    } finally {
      vi.useRealTimers();
      if (previousActiveTtlMs === undefined) {
        delete process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS;
      } else {
        process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS = previousActiveTtlMs;
      }
    }
  });

  test('getActiveOperationByContainerIdentity should return latest active operation by timestamp', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-02-23T00:00:00.000Z'));
      insertOp(updateOperation, {
        containerName: 'web',
        status: 'in-progress',
        phase: 'pulling',
      });

      vi.setSystemTime(new Date('2026-02-23T00:01:00.000Z'));
      const newer = insertOp(updateOperation, {
        containerName: 'web',
        status: 'in-progress',
        phase: 'pulling',
      });

      const active = updateOperation.getActiveOperationByContainerIdentity(identity('web'));

      expect(active?.id).toBe(newer.id);
    } finally {
      vi.useRealTimers();
    }
  });

  test('getActiveOperationByContainerIdentity should ignore terminal operations and append stale errors', async () => {
    vi.resetModules();
    const previousActiveTtlMs = process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS;
    process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS = '60000';
    vi.useFakeTimers();

    try {
      const fresh = await import('./update-operation.js');
      fresh.createCollections(createDb());

      vi.setSystemTime(new Date('2026-02-23T00:00:00.000Z'));
      const queued = insertOp(fresh, {
        containerName: 'web',
        status: 'queued',
        phase: 'queued',
        lastError: 'previous failure',
      });
      insertOp(fresh, {
        containerName: 'web',
        status: 'succeeded',
        phase: 'succeeded',
      });

      vi.setSystemTime(new Date('2026-02-23T00:01:01.000Z'));
      expect(fresh.getActiveOperationByContainerIdentity(identity('web'))).toBeUndefined();
      expect(fresh.getOperationById(queued.id)?.lastError).toContain(
        'previous failure; Marked expired after exceeding active update TTL',
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

  test('getActiveOperationByContainerIdentity should return undefined when uninitialized', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    expect(fresh.getActiveOperationByContainerIdentity(identity('web'))).toBeUndefined();
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
      insertOp(updateOperation, {
        id: 'queued-op',
        containerName: 'web',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-02-23T00:00:00.000Z',
      });

      vi.setSystemTime(new Date('2026-02-23T00:01:00.000Z'));
      insertOp(updateOperation, {
        id: 'progress-op',
        containerName: 'api',
        status: 'in-progress',
        phase: 'pulling',
        updatedAt: '2026-02-23T00:01:00.000Z',
      });

      insertOp(updateOperation, {
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

  test('getActiveOperationByContainerIdentity should handle a terminal replacement returned from storage', async () => {
    vi.resetModules();
    const previousActiveTtlMs = process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS;
    process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS = '60000';
    vi.useFakeTimers();

    try {
      const fresh = await import('./update-operation.js');
      const inactiveIds = new Set<string>(['op-1']);
      const database = createDb({ inactiveIds });
      fresh.createCollections(database);
      vi.setSystemTime(new Date('2026-02-23T00:00:00.000Z'));
      insertOp(fresh, {
        id: 'op-1',
        containerName: 'web',
        status: 'queued',
        phase: 'queued',
      });

      vi.setSystemTime(new Date('2026-02-23T00:01:01.000Z'));
      expect(fresh.getActiveOperationByContainerIdentity(identity('web'))).toBeUndefined();
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
      const operation = insertOp(fresh, {
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
          status: 'expired',
          phase: 'expired',
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
      insertOp(updateOperation, {
        containerName: 'web',
        containerId: 'new-456',
        status: 'queued',
        phase: 'queued',
      });
      vi.setSystemTime(new Date('2026-02-23T00:01:00.000Z'));
      const replacement = insertOp(updateOperation, {
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

  test('getActiveOperationByContainerIdentity should ignore inactive operations', () => {
    insertOp(updateOperation, {
      containerName: 'web',
      status: 'failed',
      phase: 'rollback-failed',
    });

    expect(updateOperation.getActiveOperationByContainerIdentity(identity('web'))).toBeUndefined();
  });

  test('getOperationById should return undefined for empty string', () => {
    expect(updateOperation.getOperationById('')).toBeUndefined();
  });

  test('same-named containers should be disambiguated by container ID', () => {
    const op = insertOp(updateOperation, {
      containerName: 'portainer_agent',
      containerId: 'host1-abc',
    });

    // Looking up by the WRONG container ID should NOT find the operation
    expect(updateOperation.getInProgressOperationByContainerId('host2-def')).toBeUndefined();

    // Looking up by NAME finds it (old behavior — this is the root cause of #256)
    expect(
      updateOperation.getInProgressOperationByContainerIdentity(identity('portainer_agent')),
    ).toBeDefined();

    // Looking up by the CORRECT container ID should find it
    const found = updateOperation.getInProgressOperationByContainerId('host1-abc');
    expect(found?.id).toBe(op.id);
  });

  test('getOperationsByContainerIdentity should return container operations sorted by latest update', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-02-23T00:00:00.000Z'));
      const first = insertOp(updateOperation, {
        containerName: 'web',
        containerId: 'abc',
        triggerName: 'docker.update',
      });

      vi.setSystemTime(new Date('2026-02-23T00:01:00.000Z'));
      const second = insertOp(updateOperation, {
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
      insertOp(updateOperation, {
        containerName: 'db',
        containerId: 'ghi',
        triggerName: 'docker.update',
      });

      const operations = updateOperation.getOperationsByContainerIdentity(identity('web'));
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
        const inserted = insertOp(fresh, {
          containerName: 'web',
          status: 'succeeded',
          phase: 'succeeded',
        });
        insertedIds.push(inserted.id);
      }

      // Pruning is amortized, so the first few writes should not prune yet.
      expect(fresh.getOperationsByContainerIdentity(identity('web'))).toHaveLength(3);

      // Mutation #100 should trigger retention pruning.
      for (let i = 3; i < 100; i += 1) {
        vi.setSystemTime(new Date(2026, 1, 1, 0, 0, i));
        const inserted = insertOp(fresh, {
          containerName: 'web',
          status: 'succeeded',
          phase: 'succeeded',
        });
        insertedIds.push(inserted.id);
      }

      const operations = fresh.getOperationsByContainerIdentity(identity('web'));
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
      const first = insertOp(fresh, {
        containerName: 'web',
        status: 'succeeded',
        phase: 'succeeded',
      });

      vi.setSystemTime(new Date('2026-02-01T00:00:01.000Z'));
      const second = insertOp(fresh, {
        containerName: 'web',
        status: 'rolled-back',
        phase: 'rolled-back',
      });

      vi.setSystemTime(new Date('2026-02-01T00:00:02.000Z'));
      const third = insertOp(fresh, {
        containerName: 'web',
        status: 'failed',
        phase: 'rollback-failed',
      });
      const active = insertOp(fresh, {
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

      const operations = fresh.getOperationsByContainerIdentity(identity('web'));
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
      const inProgress = insertOp(fresh, {
        containerName: 'web',
      });

      vi.setSystemTime(new Date('2026-02-01T00:00:01.000Z'));
      insertOp(fresh, {
        containerName: 'web',
        status: 'succeeded',
        phase: 'succeeded',
      });

      vi.setSystemTime(new Date('2026-02-01T00:00:02.000Z'));
      const latestTerminal = insertOp(fresh, {
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

      const operations = fresh.getOperationsByContainerIdentity(identity('web'));
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
      const queued = insertOp(fresh, {
        containerName: 'web',
        status: 'queued',
        phase: 'queued',
      });

      vi.setSystemTime(new Date('2026-02-01T00:00:01.000Z'));
      const latestTerminal = insertOp(fresh, {
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

      const operations = fresh.getOperationsByContainerIdentity(identity('web'));
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

  test('getOperationsByContainerIdentity should return empty array when uninitialized', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    expect(fresh.getOperationsByContainerIdentity(identity('web'))).toEqual([]);
  });

  test('getOperationsByContainerId should return empty array when uninitialized', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    expect(fresh.getOperationsByContainerId('abc')).toEqual([]);
  });

  test('getOperationsByContainerId should return empty array for empty string', () => {
    expect(updateOperation.getOperationsByContainerId('')).toEqual([]);
  });

  test('getOperationsByContainerId should return empty array when no operations match', () => {
    insertOp(updateOperation, { containerName: 'web', containerId: 'other-id' });
    expect(updateOperation.getOperationsByContainerId('no-match')).toEqual([]);
  });

  test('getOperationsByContainerId should return operations matched by containerId', () => {
    insertOp(updateOperation, { containerName: 'sibling', containerId: 'sibling-id' });
    const op = insertOp(updateOperation, { containerName: 'web', containerId: 'target-id' });

    const results = updateOperation.getOperationsByContainerId('target-id');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(op.id);
  });

  test('getOperationsByContainerId should return operations matched by newContainerId', () => {
    const op = insertOp(updateOperation, { containerName: 'web', containerId: 'old-id' });
    updateOperation.updateOperation(op.id, { newContainerId: 'new-id' });

    const results = updateOperation.getOperationsByContainerId('new-id');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(op.id);
  });

  test('getOperationsByContainerId should deduplicate an operation that matches both containerId and newContainerId', () => {
    const op = insertOp(updateOperation, { containerName: 'web', containerId: 'shared-id' });
    updateOperation.updateOperation(op.id, { newContainerId: 'shared-id' });

    const results = updateOperation.getOperationsByContainerId('shared-id');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(op.id);
  });

  test('getOperationsByContainerId should sort results by timestamp descending', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-02-23T00:00:00.000Z'));
      const first = insertOp(updateOperation, { containerName: 'web', containerId: 'c1' });

      vi.setSystemTime(new Date('2026-02-23T00:01:00.000Z'));
      const second = insertOp(updateOperation, { containerName: 'web', containerId: 'c1' });

      const results = updateOperation.getOperationsByContainerId('c1');
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe(second.id);
      expect(results[1].id).toBe(first.id);
    } finally {
      vi.useRealTimers();
    }
  });

  test('insertOperation should work without initialized collection', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    const inserted = insertOp(fresh, { containerName: 'web' });
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
    fresh.createCollections(createDb());
    const inserted = insertOp(fresh, { containerName: 'web' });
    expect(inserted.containerName).toBe('web');
  });

  /**
   * `insertOperation`/`persistOperationPatch` always stamp `updatedAt` with
   * the current time, so an invalid or blank timestamp can only reach a row
   * the way a legacy import or a hand-edited store file would: written
   * straight to the column, bypassing the store API. Corrupt the row via a
   * raw UPDATE against the same database handle `createCollections` was
   * given, the SQL-backed equivalent of the old Loki mock's `insert` hook
   * that rewrote `doc.data.updatedAt` after the fact.
   */
  test('sorting helpers should handle invalid timestamps by treating them as zero', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    const database = createDb();
    fresh.createCollections(database);
    const inserted = insertOp(fresh, { containerName: 'web' });
    database
      .prepare('UPDATE update_operations SET updated_at = ? WHERE id = ?')
      .run('not-a-date', inserted.id);

    expect(fresh.getOperationsByContainerIdentity(identity('web'))).toHaveLength(1);
    expect(fresh.getInProgressOperationByContainerIdentity(identity('web'))).toBeDefined();
  });

  test('sorting should place records with invalid updatedAt behind valid timestamps', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    const database = createDb();
    fresh.createCollections(database);

    const valid = insertOp(fresh, {
      containerName: 'web',
      status: 'succeeded',
      phase: 'succeeded',
    });
    const invalid = insertOp(fresh, {
      containerName: 'web',
      status: 'failed',
      phase: 'rollback-failed',
    });
    database
      .prepare('UPDATE update_operations SET updated_at = ? WHERE id = ?')
      .run('not-a-date', invalid.id);

    const operations = fresh.getOperationsByContainerIdentity(identity('web'));
    expect(operations.map((operation) => operation.id)).toEqual([valid.id, invalid.id]);
  });

  test('sorting helpers should fallback to createdAt when updatedAt is blank', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    const database = createDb();
    fresh.createCollections(database);

    const older = insertOp(fresh, {
      containerName: 'web',
      createdAt: '2026-02-23T00:00:00.000Z',
    });
    const newer = insertOp(fresh, {
      containerName: 'web',
      createdAt: '2026-02-23T00:01:00.000Z',
    });
    database
      .prepare("UPDATE update_operations SET updated_at = '' WHERE id IN (?, ?)")
      .run(older.id, newer.id);

    const operations = fresh.getOperationsByContainerIdentity(identity('web'));
    expect(operations.map((operation) => operation.id)).toEqual([newer.id, older.id]);
  });

  test('sorting helpers should treat invalid createdAt as zero when updatedAt is blank', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    const database = createDb();
    fresh.createCollections(database);
    const inserted = insertOp(fresh, { containerName: 'web' });
    database
      .prepare("UPDATE update_operations SET updated_at = '', created_at = ? WHERE id = ?")
      .run('invalid-created-at', inserted.id);

    expect(fresh.getOperationsByContainerIdentity(identity('web'))).toHaveLength(1);
    expect(fresh.getInProgressOperationByContainerIdentity(identity('web'))).toBeDefined();
  });

  test('retention pruning stays within lightweight runtime budget for medium history', () => {
    const runs = 2;
    const insertsPerRun = 500;
    let totalMs = 0;

    for (let run = 0; run < runs; run += 1) {
      updateOperation.createCollections(createDb());
      const started = performance.now();
      for (let i = 0; i < insertsPerRun; i += 1) {
        insertOp(updateOperation, {
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
      const op = insertOp(updateOperation, {
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
      const op = insertOp(updateOperation, {
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

  describe('OperationCancelledError', () => {
    test('has the correct name, message, and operationId fields', () => {
      const err = new updateOperation.OperationCancelledError('op-abc');
      expect(err.name).toBe('OperationCancelledError');
      expect(err.message).toBe('Cancelled by operator');
      expect(err.operationId).toBe('op-abc');
      expect(err).toBeInstanceOf(Error);
    });

    test('isOperationCancelledError returns true for OperationCancelledError instances', () => {
      const err = new updateOperation.OperationCancelledError('op-xyz');
      expect(updateOperation.isOperationCancelledError(err)).toBe(true);
    });

    test('isOperationCancelledError returns false for plain Error instances', () => {
      expect(updateOperation.isOperationCancelledError(new Error('plain error'))).toBe(false);
    });

    test('isOperationCancelledError returns false for non-error values', () => {
      expect(updateOperation.isOperationCancelledError(null)).toBe(false);
      expect(updateOperation.isOperationCancelledError(undefined)).toBe(false);
      expect(updateOperation.isOperationCancelledError('string error')).toBe(false);
      expect(updateOperation.isOperationCancelledError(42)).toBe(false);
    });
  });

  describe('requestOperationCancellation', () => {
    test('returns undefined when operation does not exist', () => {
      expect(updateOperation.requestOperationCancellation('does-not-exist')).toBeUndefined();
    });

    test('returns undefined when a queued operation disappears during cancellation', () => {
      // requestOperationCancellation reads the row (1), then markOperationTerminal
      // reads it again via getOperationById (2) and once more inside
      // persistOperationPatch (3). Answer the first two for real and simulate the
      // row having disappeared (deleted by a concurrent writer) by the third.
      const database = createDb();
      const byIdSql = 'SELECT * FROM update_operations WHERE id = ?';
      const realPrepare = database.prepare.bind(database);
      let reads = 0;
      database.prepare = ((sql: string) => {
        const statement = realPrepare(sql);
        if (sql !== byIdSql) {
          return statement;
        }
        return {
          ...statement,
          get: (...parameters: unknown[]) => {
            reads += 1;
            return reads < 3 ? statement.get(...(parameters as never[])) : undefined;
          },
        };
      }) as Database['prepare'];
      updateOperation.createCollections(database);
      insertOp(updateOperation, {
        id: 'queued-race',
        containerName: 'web',
        status: 'queued',
        phase: 'queued',
      });

      expect(updateOperation.requestOperationCancellation('queued-race')).toBeUndefined();
    });

    test('cancels a queued operation immediately', () => {
      const op = insertOp(updateOperation, {
        containerName: 'web',
        status: 'queued',
        phase: 'queued',
      });

      const result = updateOperation.requestOperationCancellation(op.id);

      expect(result).toBeDefined();
      expect(result!.outcome).toBe('cancelled');
      expect(result!.operation.id).toBe(op.id);
      expect(result!.operation.status).toBe('failed');
      expect(result!.operation.lastError).toBe('Cancelled by operator');
    });

    test('flags an in-progress operation with cancelRequested', () => {
      const op = insertOp(updateOperation, {
        containerName: 'api',
        status: 'in-progress',
        phase: 'pulling',
      });

      const result = updateOperation.requestOperationCancellation(op.id);

      expect(result).toBeDefined();
      expect(result!.outcome).toBe('cancel-requested');
      expect(result!.operation.id).toBe(op.id);
      expect(result!.operation.status).toBe('in-progress');
      expect(result!.operation.cancelRequested).toBe(true);
    });

    test('returns undefined when an in-progress operation disappears during cancellation', () => {
      // requestOperationCancellation reads the row (1), then persistOperationPatch
      // reads it again (2). Answer the first for real and simulate the row having
      // disappeared (deleted by a concurrent writer) by the second.
      const database = createDb();
      const byIdSql = 'SELECT * FROM update_operations WHERE id = ?';
      const realPrepare = database.prepare.bind(database);
      let reads = 0;
      database.prepare = ((sql: string) => {
        const statement = realPrepare(sql);
        if (sql !== byIdSql) {
          return statement;
        }
        return {
          ...statement,
          get: (...parameters: unknown[]) => {
            reads += 1;
            return reads < 2 ? statement.get(...(parameters as never[])) : undefined;
          },
        };
      }) as Database['prepare'];
      updateOperation.createCollections(database);
      insertOp(updateOperation, {
        id: 'in-progress-race',
        containerName: 'api',
        status: 'in-progress',
        phase: 'pulling',
      });

      expect(updateOperation.requestOperationCancellation('in-progress-race')).toBeUndefined();
    });

    test('returns undefined for a succeeded operation', () => {
      const op = insertOp(updateOperation, {
        containerName: 'web',
        status: 'succeeded',
        phase: 'succeeded',
        completedAt: new Date().toISOString(),
      });

      expect(updateOperation.requestOperationCancellation(op.id)).toBeUndefined();
    });

    test('returns undefined for a failed operation', () => {
      const op = insertOp(updateOperation, {
        containerName: 'web',
        status: 'failed',
        phase: 'failed',
        completedAt: new Date().toISOString(),
      });

      expect(updateOperation.requestOperationCancellation(op.id)).toBeUndefined();
    });

    test('returns undefined for a rolled-back operation', () => {
      const op = insertOp(updateOperation, {
        containerName: 'web',
        status: 'rolled-back',
        phase: 'rolled-back',
        completedAt: new Date().toISOString(),
      });

      expect(updateOperation.requestOperationCancellation(op.id)).toBeUndefined();
    });

    test('returns undefined when collection is not initialized', async () => {
      vi.resetModules();
      const fresh = await import('./update-operation.js');
      expect(fresh.requestOperationCancellation('any-id')).toBeUndefined();
    });
  });

  describe('isOperationCancelRequested', () => {
    test('returns false for undefined id', () => {
      expect(updateOperation.isOperationCancelRequested(undefined)).toBe(false);
    });

    test('returns false for empty string id', () => {
      expect(updateOperation.isOperationCancelRequested('')).toBe(false);
    });

    test('returns false for a non-existent operation id', () => {
      expect(updateOperation.isOperationCancelRequested('ghost-id')).toBe(false);
    });

    test('returns false for an operation without cancelRequested set', () => {
      const op = insertOp(updateOperation, {
        containerName: 'worker',
        status: 'in-progress',
        phase: 'pulling',
      });

      expect(updateOperation.isOperationCancelRequested(op.id)).toBe(false);
    });

    test('returns true for an operation with cancelRequested set to true', () => {
      const op = insertOp(updateOperation, {
        containerName: 'worker',
        status: 'in-progress',
        phase: 'pulling',
      });

      updateOperation.requestOperationCancellation(op.id);

      expect(updateOperation.isOperationCancelRequested(op.id)).toBe(true);
    });
  });

  describe('getRecentTerminalSucceededOperationByContainerIdentity (issue #410 dedup helper)', () => {
    test('returns a succeeded terminal op within the time window', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-06-04T12:00:00.000Z'));
        const op = insertOp(updateOperation, {
          containerName: 'nginx',
          status: 'in-progress',
          phase: 'pulling',
        });
        updateOperation.markOperationTerminal(op.id, { status: 'succeeded' });

        vi.setSystemTime(new Date('2026-06-04T12:05:00.000Z'));
        const windowMs = 15 * 60 * 1000; // 15 min
        const result = updateOperation.getRecentTerminalSucceededOperationByContainerIdentity(
          identity('nginx'),
          windowMs,
        );
        expect(result).toBeDefined();
        expect(result?.status).toBe('succeeded');
        expect(result?.containerName).toBe('nginx');
      } finally {
        vi.useRealTimers();
      }
    });

    test('returns the most recent of multiple succeeded ops within the window', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-06-04T12:00:00.000Z'));
        const older = insertOp(updateOperation, {
          containerName: 'nginx',
          status: 'in-progress',
          phase: 'pulling',
        });
        updateOperation.markOperationTerminal(older.id, { status: 'succeeded' });

        vi.setSystemTime(new Date('2026-06-04T12:03:00.000Z'));
        const newer = insertOp(updateOperation, {
          containerName: 'nginx',
          status: 'in-progress',
          phase: 'pulling',
        });
        updateOperation.markOperationTerminal(newer.id, { status: 'succeeded' });

        vi.setSystemTime(new Date('2026-06-04T12:05:00.000Z'));
        const result = updateOperation.getRecentTerminalSucceededOperationByContainerIdentity(
          identity('nginx'),
          15 * 60 * 1000,
        );
        expect(result?.id).toBe(newer.id);
        expect(result?.status).toBe('succeeded');
      } finally {
        vi.useRealTimers();
      }
    });

    test('returns undefined when the succeeded op is outside the window', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-06-04T12:00:00.000Z'));
        const op = insertOp(updateOperation, {
          containerName: 'nginx',
          status: 'in-progress',
          phase: 'pulling',
        });
        updateOperation.markOperationTerminal(op.id, { status: 'succeeded' });

        vi.setSystemTime(new Date('2026-06-04T12:20:00.000Z'));
        const windowMs = 15 * 60 * 1000; // 15 min, but 20 min elapsed
        const result = updateOperation.getRecentTerminalSucceededOperationByContainerIdentity(
          identity('nginx'),
          windowMs,
        );
        expect(result).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    test('ignores failed/rolled-back ops even within the window', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-06-04T12:00:00.000Z'));
        const failed = insertOp(updateOperation, {
          containerName: 'nginx',
          status: 'in-progress',
          phase: 'pulling',
        });
        updateOperation.markOperationTerminal(failed.id, { status: 'failed' });

        vi.setSystemTime(new Date('2026-06-04T12:05:00.000Z'));
        const result = updateOperation.getRecentTerminalSucceededOperationByContainerIdentity(
          identity('nginx'),
          15 * 60 * 1000,
        );
        expect(result).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    test('returns undefined for a different container name', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-06-04T12:00:00.000Z'));
        const op = insertOp(updateOperation, {
          containerName: 'redis',
          status: 'in-progress',
          phase: 'pulling',
        });
        updateOperation.markOperationTerminal(op.id, { status: 'succeeded' });

        vi.setSystemTime(new Date('2026-06-04T12:05:00.000Z'));
        const result = updateOperation.getRecentTerminalSucceededOperationByContainerIdentity(
          identity('nginx'),
          15 * 60 * 1000,
        );
        expect(result).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    test('returns a succeeded terminal op with matching agent and watcher identity', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-06-04T12:00:00.000Z'));
        const op = insertOp(updateOperation, {
          containerName: 'web',
          status: 'in-progress',
          phase: 'pulling',
          container: { id: 'c-agent-a', name: 'web', watcher: 'local', agent: 'agent-A' } as any,
        });
        updateOperation.markOperationTerminal(op.id, { status: 'succeeded' });

        vi.setSystemTime(new Date('2026-06-04T12:05:00.000Z'));
        const result = updateOperation.getRecentTerminalSucceededOperationByContainerIdentity(
          identity('web', { agent: 'agent-A', watcher: 'local' }),
          15 * 60 * 1000,
        );
        expect(result?.id).toBe(op.id);
      } finally {
        vi.useRealTimers();
      }
    });

    test('uses top-level identity when a container snapshot lacks watcher metadata', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-06-04T12:00:00.000Z'));
        const op = insertOp(updateOperation, {
          containerName: 'web',
          status: 'in-progress',
          phase: 'pulling',
          agent: 'agent-A',
          watcher: 'local',
          container: { id: 'c-agent-a', name: 'web', agent: 'agent-A' } as any,
        });
        updateOperation.markOperationTerminal(op.id, { status: 'succeeded' });

        vi.setSystemTime(new Date('2026-06-04T12:05:00.000Z'));
        const result = updateOperation.getRecentTerminalSucceededOperationByContainerIdentity(
          identity('web', { agent: 'agent-A', watcher: 'local' }),
          15 * 60 * 1000,
        );
        expect(result?.id).toBe(op.id);
      } finally {
        vi.useRealTimers();
      }
    });

    test('returns undefined for a same-name success from another agent', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-06-04T12:00:00.000Z'));
        const op = insertOp(updateOperation, {
          containerName: 'web',
          status: 'in-progress',
          phase: 'pulling',
          container: { id: 'c-agent-b', name: 'web', watcher: 'local', agent: 'agent-B' } as any,
        });
        updateOperation.markOperationTerminal(op.id, { status: 'succeeded' });

        vi.setSystemTime(new Date('2026-06-04T12:05:00.000Z'));
        const result = updateOperation.getRecentTerminalSucceededOperationByContainerIdentity(
          identity('web', { agent: 'agent-A', watcher: 'local' }),
          15 * 60 * 1000,
        );
        expect(result).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    test('returns undefined when collection is uninitialized', async () => {
      vi.resetModules();
      const fresh = await import('./update-operation.js');
      expect(
        fresh.getRecentTerminalSucceededOperationByContainerIdentity(
          identity('nginx'),
          15 * 60 * 1000,
        ),
      ).toBeUndefined();
    });
  });

  /**
   * The old `ContainerIdentityFilter` this function took as a third
   * argument is gone (roadmap 7-STORE, slice 10): there is no more two-tier
   * "match by name, then optionally narrow by agent/watcher" logic, just one
   * identity key checked for exact equality against the row's own
   * `containerIdentityKey`. Scenarios that only made sense under the old
   * filter's short-circuit rules (an omitted watcher accepting any op, a
   * bare name with no filter matching everything) have no equivalent under
   * single-key equality and are covered below as what they actually become:
   * an unresolvable identity that never matches anything.
   */
  describe('hasOtherActiveOperationByContainerIdentity (issue #421)', () => {
    test('returns true when another in-progress op with the same identity exists', () => {
      insertOp(updateOperation, {
        containerName: 'web',
        status: 'in-progress',
        phase: 'pulling',
        container: { id: 'c-win', name: 'web', watcher: 'local', agent: 'agent-A' } as any,
      });

      expect(
        updateOperation.hasOtherActiveOperationByContainerIdentity(
          identity('web', { agent: 'agent-A', watcher: 'local' }),
          'some-other-id',
        ),
      ).toBe(true);
    });

    test('returns true for a queued op', () => {
      insertOp(updateOperation, {
        containerName: 'web',
        status: 'queued',
        phase: 'queued',
        container: { id: 'c-q', name: 'web', watcher: 'local', agent: 'agent-A' } as any,
      });

      expect(
        updateOperation.hasOtherActiveOperationByContainerIdentity(
          identity('web', { agent: 'agent-A', watcher: 'local' }),
          'some-other-id',
        ),
      ).toBe(true);
    });

    test('returns false when the only active op is the excluded id', () => {
      const op = insertOp(updateOperation, {
        containerName: 'web',
        status: 'in-progress',
        phase: 'pulling',
        container: { id: 'c-excl', name: 'web', watcher: 'local', agent: 'agent-A' } as any,
      });

      expect(
        updateOperation.hasOtherActiveOperationByContainerIdentity(
          identity('web', { agent: 'agent-A', watcher: 'local' }),
          op.id,
        ),
      ).toBe(false);
    });

    test('returns false when no active ops exist (only terminal rows)', () => {
      const op = insertOp(updateOperation, {
        containerName: 'web',
        status: 'in-progress',
        phase: 'pulling',
        container: { id: 'c-term', name: 'web', watcher: 'local', agent: 'agent-A' } as any,
      });
      updateOperation.markOperationTerminal(op.id, { status: 'succeeded' });

      expect(
        updateOperation.hasOtherActiveOperationByContainerIdentity(
          identity('web', { agent: 'agent-A', watcher: 'local' }),
          'some-other-id',
        ),
      ).toBe(false);
    });

    test('a different agent does not match the identity', () => {
      insertOp(updateOperation, {
        containerName: 'web',
        status: 'in-progress',
        phase: 'pulling',
        container: { id: 'c-agent-b', name: 'web', watcher: 'local', agent: 'agent-B' } as any,
      });

      expect(
        updateOperation.hasOtherActiveOperationByContainerIdentity(
          identity('web', { agent: 'agent-A', watcher: 'local' }),
          'some-other-id',
        ),
      ).toBe(false);
    });

    test('a row with no derivable identity is never counted', () => {
      // Bypass insertOp's default-watcher stand-in so this row genuinely has
      // no identity, matching a document written before the identity cut.
      updateOperation.insertOperation({
        containerName: 'web',
        status: 'in-progress',
        phase: 'pulling',
      });

      expect(
        updateOperation.hasOtherActiveOperationByContainerIdentity(
          identity('web', { agent: 'agent-A', watcher: 'local' }),
          'some-other-id',
        ),
      ).toBe(false);
    });

    test('both sides fall back to an empty-string agent when neither carries one', () => {
      insertOp(updateOperation, {
        containerName: 'web',
        status: 'in-progress',
        phase: 'pulling',
        container: { id: 'c-no-agent', name: 'web', watcher: 'local' } as any,
      });

      expect(
        updateOperation.hasOtherActiveOperationByContainerIdentity(
          identity('web', { watcher: 'local' }),
          'other-id',
        ),
      ).toBe(true);
    });

    test('an unresolvable identity key never matches, even with other active ops present', () => {
      insertOp(updateOperation, {
        containerName: 'web',
        status: 'in-progress',
        phase: 'pulling',
        container: { id: 'c-any', name: 'web', watcher: 'local', agent: 'agent-Z' } as any,
      });

      expect(
        updateOperation.hasOtherActiveOperationByContainerIdentity(undefined, 'some-other-id'),
      ).toBe(false);
    });

    test('returns false when collection is uninitialized', async () => {
      vi.resetModules();
      const fresh = await import('./update-operation.js');
      expect(fresh.hasOtherActiveOperationByContainerIdentity(identity('web'), 'any-id')).toBe(
        false,
      );
    });

    test('returns false and expires the winner op when it is past the active TTL', async () => {
      // Verify that a stale in-progress "winner" op (past DD_UPDATE_OPERATION_ACTIVE_TTL_MS)
      // is not counted as active: hasOtherActiveOperationByContainerIdentity must return false
      // and the freshness check inside it must terminalize the winner op as expired.
      vi.resetModules();
      const previousActiveTtlMs = process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS;
      process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS = '60000';
      vi.useFakeTimers();

      try {
        const fresh = await import('./update-operation.js');
        fresh.createCollections(createDb());

        vi.setSystemTime(new Date('2026-02-23T00:00:00.000Z'));
        const winner = insertOp(fresh, {
          containerName: 'web',
          status: 'in-progress',
          phase: 'pulling',
          container: { id: 'c-winner', name: 'web', watcher: 'local', agent: 'agent-A' } as any,
        });

        // Advance past the 60 s TTL so the winner op is stale.
        vi.setSystemTime(new Date('2026-02-23T00:01:01.000Z'));

        const result = fresh.hasOtherActiveOperationByContainerIdentity(
          identity('web', { agent: 'agent-A', watcher: 'local' }),
          'loser-op-id',
        );

        expect(result).toBe(false);

        // The freshness check inside hasOtherActiveOperationByContainerIdentity must have
        // terminalized the stale winner op as expired.
        const winnerAfter = fresh.getOperationById(winner.id);
        expect(winnerAfter?.status).toBe('expired');
      } finally {
        vi.useRealTimers();
        if (previousActiveTtlMs === undefined) {
          delete process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS;
        } else {
          process.env.DD_UPDATE_OPERATION_ACTIVE_TTL_MS = previousActiveTtlMs;
        }
      }
    });
  });

  /**
   * The old ContainerIdentityFilter parameter is gone (roadmap 7-STORE,
   * slice 10): both functions take exactly one `identityKey: string |
   * undefined` argument and do strict equality against the row's own
   * `containerIdentityKey`. There is no more "legacy op is returned
   * regardless" or "omitted watcher skips the filter" short-circuit — an
   * identity that fails to resolve (or a row with none) simply never
   * matches, via the shared `!db || !identityKey` guard.
   */
  describe('getActiveOperationByContainerIdentity identity scoping (issue #411)', () => {
    test('same agent+watcher returns the operation', () => {
      insertOp(updateOperation, {
        containerName: 'web',
        status: 'queued',
        phase: 'queued',
        container: { id: 'c1', name: 'web', watcher: 'local', agent: 'agent-A' } as any,
      });

      const result = updateOperation.getActiveOperationByContainerIdentity(
        identity('web', { agent: 'agent-A', watcher: 'local' }),
      );
      expect(result).toBeDefined();
      expect(result?.containerName).toBe('web');
    });

    test('different agent, snapshot present → returns undefined', () => {
      insertOp(updateOperation, {
        containerName: 'web',
        status: 'queued',
        phase: 'queued',
        container: { id: 'c-b', name: 'web', watcher: 'local', agent: 'agent-B' } as any,
      });

      const result = updateOperation.getActiveOperationByContainerIdentity(
        identity('web', { agent: 'agent-A', watcher: 'local' }),
      );
      expect(result).toBeUndefined();
    });

    test('different watcher, snapshot present → returns undefined', () => {
      insertOp(updateOperation, {
        containerName: 'web',
        status: 'queued',
        phase: 'queued',
        container: { id: 'c2', name: 'web', watcher: 'watcher-2' } as any,
      });

      const result = updateOperation.getActiveOperationByContainerIdentity(
        identity('web', { watcher: 'watcher-1' }),
      );
      expect(result).toBeUndefined();
    });

    test('a row with no derivable identity is never returned by identity lookup', () => {
      // Bypass insertOp's default-watcher stand-in so this row genuinely has
      // no identity, matching a document written before the identity cut.
      updateOperation.insertOperation({
        containerName: 'web',
        status: 'queued',
        phase: 'queued',
      });

      const result = updateOperation.getActiveOperationByContainerIdentity(
        identity('web', { agent: 'agent-A', watcher: 'local' }),
      );
      expect(result).toBeUndefined();
    });

    test('an op whose identity is derived from top-level agent/watcher (no container snapshot) still enforces strict matching', () => {
      insertOp(updateOperation, {
        containerName: 'web',
        status: 'queued',
        phase: 'queued',
        agent: 'agent-B',
      });

      const result = updateOperation.getActiveOperationByContainerIdentity(
        identity('web', { agent: 'agent-A', watcher: 'local' }),
      );
      expect(result).toBeUndefined();
    });

    test('returns undefined when the identity key itself is undefined', () => {
      insertOp(updateOperation, {
        containerName: 'web',
        status: 'queued',
        phase: 'queued',
        container: { id: 'c-no-watcher', name: 'web', watcher: 'local', agent: 'agent-B' } as any,
      });

      const result = updateOperation.getActiveOperationByContainerIdentity(undefined);
      expect(result).toBeUndefined();
    });
  });

  describe('getInProgressOperationByContainerIdentity identity scoping (issue #411)', () => {
    test('same agent+watcher returns the operation', () => {
      insertOp(updateOperation, {
        containerName: 'api',
        status: 'in-progress',
        phase: 'pulling',
        container: { id: 'c3', name: 'api', watcher: 'local', agent: 'agent-A' } as any,
      });

      const result = updateOperation.getInProgressOperationByContainerIdentity(
        identity('api', { agent: 'agent-A', watcher: 'local' }),
      );
      expect(result).toBeDefined();
      expect(result?.containerName).toBe('api');
    });

    test('different agent, snapshot present → returns undefined', () => {
      insertOp(updateOperation, {
        containerName: 'api',
        status: 'in-progress',
        phase: 'pulling',
        container: { id: 'c-b2', name: 'api', watcher: 'local', agent: 'agent-B' } as any,
      });

      const result = updateOperation.getInProgressOperationByContainerIdentity(
        identity('api', { agent: 'agent-A', watcher: 'local' }),
      );
      expect(result).toBeUndefined();
    });

    test('different watcher, snapshot present → returns undefined', () => {
      insertOp(updateOperation, {
        containerName: 'api',
        status: 'in-progress',
        phase: 'pulling',
        container: { id: 'c4', name: 'api', watcher: 'watcher-2' } as any,
      });

      const result = updateOperation.getInProgressOperationByContainerIdentity(
        identity('api', { watcher: 'watcher-1' }),
      );
      expect(result).toBeUndefined();
    });

    test('a row with no derivable identity is never returned by identity lookup', () => {
      // Bypass insertOp's default-watcher stand-in so this row genuinely has
      // no identity, matching a document written before the identity cut.
      updateOperation.insertOperation({
        containerName: 'api',
        status: 'in-progress',
        phase: 'pulling',
      });

      const result = updateOperation.getInProgressOperationByContainerIdentity(
        identity('api', { agent: 'agent-A', watcher: 'local' }),
      );
      expect(result).toBeUndefined();
    });

    test('returns undefined when the identity key itself is undefined', () => {
      insertOp(updateOperation, {
        containerName: 'api',
        status: 'in-progress',
        phase: 'pulling',
        container: { id: 'c-any', name: 'api', watcher: 'local', agent: 'agent-A' } as any,
      });

      const result = updateOperation.getInProgressOperationByContainerIdentity(undefined);
      expect(result).toBeUndefined();
    });
  });

  describe('listRecentSucceededOperations (restart-amnesia seed, #408)', () => {
    test('returns succeeded ops whose completedAt is within the window, sorted most-recent-first', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-06-10T10:00:00.000Z'));
        const older = insertOp(updateOperation, {
          containerName: 'nginx',
          status: 'in-progress',
          phase: 'pulling',
        });
        updateOperation.markOperationTerminal(older.id, { status: 'succeeded' });

        vi.setSystemTime(new Date('2026-06-10T10:30:00.000Z'));
        const newer = insertOp(updateOperation, {
          containerName: 'redis',
          status: 'in-progress',
          phase: 'pulling',
        });
        updateOperation.markOperationTerminal(newer.id, { status: 'succeeded' });

        vi.setSystemTime(new Date('2026-06-10T10:45:00.000Z'));
        const windowMs = 60 * 60 * 1000; // 60 min
        const result = updateOperation.listRecentSucceededOperations(windowMs);
        expect(result).toHaveLength(2);
        expect(result[0].id).toBe(newer.id);
        expect(result[1].id).toBe(older.id);
      } finally {
        vi.useRealTimers();
      }
    });

    test('excludes succeeded ops older than the window', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-06-10T08:00:00.000Z'));
        const old = insertOp(updateOperation, {
          containerName: 'nginx',
          status: 'in-progress',
          phase: 'pulling',
        });
        updateOperation.markOperationTerminal(old.id, { status: 'succeeded' });

        vi.setSystemTime(new Date('2026-06-10T10:00:00.000Z'));
        const windowMs = 60 * 60 * 1000; // 60 min, but 120 min have passed
        const result = updateOperation.listRecentSucceededOperations(windowMs);
        expect(result).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    test('excludes failed, rolled-back and expired ops even when within the window', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-06-10T10:00:00.000Z'));
        const failed = insertOp(updateOperation, {
          containerName: 'app',
          status: 'in-progress',
          phase: 'pulling',
        });
        updateOperation.markOperationTerminal(failed.id, { status: 'failed' });

        const rolledBack = insertOp(updateOperation, {
          containerName: 'app2',
          status: 'in-progress',
          phase: 'pulling',
        });
        updateOperation.markOperationTerminal(rolledBack.id, { status: 'rolled-back' });

        vi.setSystemTime(new Date('2026-06-10T10:20:00.000Z'));
        const result = updateOperation.listRecentSucceededOperations(60 * 60 * 1000);
        expect(result).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    test('returns empty array when collection is uninitialized', async () => {
      vi.resetModules();
      const fresh = await import('./update-operation.js');
      expect(fresh.listRecentSucceededOperations(60 * 60 * 1000)).toEqual([]);
    });
  });
});

describe('getFreshSelfUpdateOperationById', () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  test('returns undefined when collection is uninitialized', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    expect(fresh.getFreshSelfUpdateOperationById('op-1')).toBeUndefined();
  });

  test('returns undefined for empty/falsy id', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    fresh.createCollections(createDb());
    expect(fresh.getFreshSelfUpdateOperationById('')).toBeUndefined();
  });

  test('returns undefined when operation is not found', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    fresh.createCollections(createDb());
    expect(fresh.getFreshSelfUpdateOperationById('nonexistent')).toBeUndefined();
  });

  test('returns undefined for non-self-update kind', async () => {
    vi.resetModules();
    const fresh = await import('./update-operation.js');
    fresh.createCollections(createDb());
    const op = insertOp(fresh, {
      id: 'regular-op',
      containerName: 'web',
      kind: 'container-update',
      status: 'in-progress',
      phase: 'prepare',
    });
    expect(op.kind).toBe('container-update');
    expect(fresh.getFreshSelfUpdateOperationById('regular-op')).toBeUndefined();
  });

  test('returns an active self-update op within the grace window as-is', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T01:00:00.000Z'));
      vi.resetModules();
      const fresh = await import('./update-operation.js');
      fresh.createCollections(createDb());
      // Insert at current system time (01:00) — op is 0 minutes old, within grace window
      insertOp(fresh, {
        id: 'fresh-self-update',
        containerName: 'drydock',
        kind: 'self-update',
        status: 'in-progress',
        phase: 'prepare',
      });
      const result = fresh.getFreshSelfUpdateOperationById('fresh-self-update');
      expect(result).toMatchObject({ id: 'fresh-self-update', status: 'in-progress' });
    } finally {
      vi.useRealTimers();
    }
  });

  test('expires and returns an active self-update op older than the grace window', async () => {
    vi.useFakeTimers();
    try {
      // Insert at "40 minutes ago" timestamp
      vi.setSystemTime(new Date('2026-01-01T00:40:00.000Z'));
      vi.resetModules();
      const fresh = await import('./update-operation.js');
      fresh.createCollections(createDb());
      insertOp(fresh, {
        id: 'stale-self-update',
        containerName: 'drydock',
        kind: 'self-update',
        status: 'in-progress',
        phase: 'prepare',
      });
      // Advance time so the op is now 20 minutes old (past the 10-minute grace window)
      vi.setSystemTime(new Date('2026-01-01T01:00:00.000Z'));
      const result = fresh.getFreshSelfUpdateOperationById('stale-self-update');
      expect(result).toMatchObject({
        id: 'stale-self-update',
        status: 'expired',
        lastError: expect.stringContaining('grace window'),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test('returns a terminal self-update op unchanged regardless of age', async () => {
    vi.useFakeTimers();
    try {
      // Insert at an old time
      vi.setSystemTime(new Date('2026-01-01T00:30:00.000Z'));
      vi.resetModules();
      const fresh = await import('./update-operation.js');
      fresh.createCollections(createDb());
      // Insert, then mark terminal
      insertOp(fresh, {
        id: 'done-self-update',
        containerName: 'drydock',
        kind: 'self-update',
        status: 'in-progress',
        phase: 'prepare',
      });
      fresh.markOperationTerminal('done-self-update', { status: 'succeeded' });
      // Advance time well past grace window
      vi.setSystemTime(new Date('2026-01-01T02:00:00.000Z'));
      const result = fresh.getFreshSelfUpdateOperationById('done-self-update');
      expect(result).toMatchObject({ id: 'done-self-update', status: 'succeeded' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('toApiUpdateOperation', () => {
  beforeEach(() => {
    updateOperation.createCollections(createDb());
  });

  test('toApiUpdateOperation strips finalizeSecretHash', () => {
    const op = {
      id: 'op-1',
      containerName: 'drydock',
      status: 'in-progress' as const,
      phase: 'prepare' as const,
      kind: 'self-update',
      finalizeSecretHash: 'abc123hash',
    };
    const result = updateOperation.toApiUpdateOperation(op);
    expect(result).not.toHaveProperty('finalizeSecretHash');
    expect(result).toHaveProperty('id', 'op-1');
  });

  test('toApiUpdateOperation strips the Portainer recovery descriptor', () => {
    const result = updateOperation.toApiUpdateOperation({
      id: 'op-portainer',
      containerName: 'web',
      status: 'in-progress' as const,
      phase: 'prepare' as const,
      portainerRecovery: { originalImageId: 'sha256:old' },
    });
    expect(result).not.toHaveProperty('portainerRecovery');
  });

  test('markOperationTerminal clears the Portainer recovery descriptor', () => {
    const inserted = insertOp(updateOperation, {
      id: 'op-portainer-terminal',
      containerName: 'web',
      status: 'in-progress',
      phase: 'portainer-target',
      portainerRecovery: { originalImageId: 'sha256:old' },
    });

    updateOperation.markOperationTerminal(inserted.id, { status: 'succeeded' });

    // rowToOperation always materialises every column as an explicit key
    // (unlike the old sparse Loki document), so a cleared value now reads
    // back as an own property holding undefined rather than a missing key.
    // toApiUpdateOperation strips the key outright before it ever reaches a
    // consumer; this only needs to prove the persisted value itself is gone.
    expect(updateOperation.getOperationById(inserted.id)?.portainerRecovery).toBeUndefined();
  });

  test('updateOperation preserves Portainer recovery when the patch omits it', () => {
    const recovery = { originalImageId: 'sha256:old' };
    const inserted = insertOp(updateOperation, {
      id: 'op-portainer-preserve',
      containerName: 'web',
      status: 'in-progress',
      phase: 'portainer-target',
      portainerRecovery: recovery,
    });
    updateOperation.updateOperation(inserted.id, { phase: 'portainer-restore' });
    expect(updateOperation.getOperationById(inserted.id)).toMatchObject({
      phase: 'portainer-restore',
      portainerRecovery: recovery,
    });
  });

  test('requestOperationCancellation preserves Portainer recovery while flagging cancellation', () => {
    const recovery = { originalImageId: 'sha256:old' };
    const inserted = insertOp(updateOperation, {
      id: 'op-portainer-cancel-preserve',
      containerName: 'web',
      status: 'in-progress',
      phase: 'portainer-target',
      portainerRecovery: recovery,
    });
    updateOperation.requestOperationCancellation(inserted.id);
    expect(updateOperation.getOperationById(inserted.id)).toMatchObject({
      cancelRequested: true,
      portainerRecovery: recovery,
    });
  });
});
