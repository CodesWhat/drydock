import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const {
  mockEmitBatchUpdateCompleted,
  mockEmitContainerUpdateApplied,
  mockEmitContainerUpdateFailed,
  mockEmitUpdateOperationChanged,
} = vi.hoisted(() => ({
  mockEmitBatchUpdateCompleted: vi.fn().mockResolvedValue(undefined),
  mockEmitContainerUpdateApplied: vi.fn().mockResolvedValue(undefined),
  mockEmitContainerUpdateFailed: vi.fn().mockResolvedValue(undefined),
  mockEmitUpdateOperationChanged: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../event/index.js', () => ({
  emitBatchUpdateCompleted: mockEmitBatchUpdateCompleted,
  emitContainerUpdateApplied: mockEmitContainerUpdateApplied,
  emitContainerUpdateFailed: mockEmitContainerUpdateFailed,
  emitUpdateOperationChanged: mockEmitUpdateOperationChanged,
}));

import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import type { Database } from './db/driver.js';
import * as updateOperation from './update-operation.js';

const openDatabases: Database[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
});

function createDb(): Database {
  const database = createMigratedMemoryDatabase();
  openDatabases.push(database);
  return database;
}

async function flushAsyncLifecycleEvents() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('update operation lifecycle events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateOperation.createCollections(createDb());
  });

  test('markOperationTerminal emits update-applied from the terminal commit boundary', async () => {
    const inserted = updateOperation.insertOperation({
      id: 'op-1',
      containerId: 'container-1',
      containerName: 'web',
      status: 'in-progress',
      phase: 'pulling',
      batchId: 'batch-1',
      queuePosition: 1,
      queueTotal: 2,
    });

    updateOperation.markOperationTerminal(inserted.id, {
      status: 'succeeded',
      phase: 'succeeded',
      completedAt: '2026-04-29T12:00:00.000Z',
    });
    await flushAsyncLifecycleEvents();

    expect(mockEmitContainerUpdateApplied).toHaveBeenCalledTimes(1);
    expect(mockEmitContainerUpdateApplied).toHaveBeenCalledWith({
      operationId: 'op-1',
      containerId: 'container-1',
      containerName: 'web',
      batchId: 'batch-1',
    });
    expect(mockEmitContainerUpdateFailed).not.toHaveBeenCalled();
  });

  test('markOperationTerminal identifies dry-run success without claiming replacement', async () => {
    const inserted = updateOperation.insertOperation({
      id: 'op-dryrun',
      containerId: 'container-1',
      containerName: 'web',
      status: 'in-progress',
      phase: 'pulling',
    });

    updateOperation.markOperationTerminal(inserted.id, {
      status: 'succeeded',
      phase: 'dryrun',
    });
    await flushAsyncLifecycleEvents();

    expect(mockEmitContainerUpdateApplied).toHaveBeenCalledWith({
      operationId: 'op-dryrun',
      containerId: 'container-1',
      containerName: 'web',
      phase: 'dryrun',
    });
  });

  test('markOperationTerminal emits update-failed for failed and rolled-back terminals', async () => {
    const failed = updateOperation.insertOperation({
      id: 'op-failed',
      containerId: 'container-failed',
      containerName: 'api',
      status: 'in-progress',
      phase: 'pulling',
    });
    const rolledBack = updateOperation.insertOperation({
      id: 'op-rollback',
      containerName: 'worker',
      status: 'in-progress',
      phase: 'new-started',
      batchId: 'batch-rollback',
      queuePosition: 1,
      queueTotal: 1,
    });

    updateOperation.markOperationTerminal(failed.id, {
      status: 'failed',
      phase: 'pull-failed',
      lastError: 'pull denied',
    });
    updateOperation.markOperationTerminal(rolledBack.id, {
      status: 'rolled-back',
      phase: 'rolled-back',
      lastError: 'healthcheck failed',
    });
    await flushAsyncLifecycleEvents();

    expect(mockEmitContainerUpdateFailed).toHaveBeenCalledTimes(2);
    expect(mockEmitContainerUpdateFailed).toHaveBeenNthCalledWith(1, {
      operationId: 'op-failed',
      containerId: 'container-failed',
      containerName: 'api',
      error: 'pull denied',
      phase: 'pull-failed',
    });
    expect(mockEmitContainerUpdateFailed).toHaveBeenNthCalledWith(2, {
      operationId: 'op-rollback',
      containerName: 'worker',
      error: 'healthcheck failed',
      phase: 'rolled-back',
      batchId: 'batch-rollback',
    });
    expect(mockEmitContainerUpdateApplied).not.toHaveBeenCalled();
  });

  test('markOperationTerminal includes newContainerId in the update-applied payload when set on the operation', async () => {
    const inserted = updateOperation.insertOperation({
      id: 'op-recreate',
      containerId: 'c-old',
      newContainerId: 'c-new',
      containerName: 'nginx',
      status: 'in-progress',
      phase: 'new-started',
    });

    updateOperation.markOperationTerminal(inserted.id, {
      status: 'succeeded',
      phase: 'succeeded',
    });
    await flushAsyncLifecycleEvents();

    expect(mockEmitContainerUpdateApplied).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'op-recreate',
        containerId: 'c-old',
        newContainerId: 'c-new',
        containerName: 'nginx',
      }),
    );
  });

  test('markOperationTerminal omits newContainerId from update-applied payload when not set on the operation', async () => {
    const inserted = updateOperation.insertOperation({
      id: 'op-no-recreate',
      containerId: 'c-1',
      containerName: 'nginx',
      status: 'in-progress',
      phase: 'pulling',
    });

    updateOperation.markOperationTerminal(inserted.id, {
      status: 'succeeded',
      phase: 'succeeded',
    });
    await flushAsyncLifecycleEvents();

    const call = mockEmitContainerUpdateApplied.mock.calls[0];
    expect(call[0]).not.toHaveProperty('newContainerId');
  });

  test('markOperationTerminal does not re-emit lifecycle events for already terminal rows', async () => {
    const inserted = updateOperation.insertOperation({
      id: 'op-1',
      containerName: 'web',
      status: 'queued',
      phase: 'queued',
    });

    updateOperation.markOperationTerminal(inserted.id, { status: 'succeeded' });
    await flushAsyncLifecycleEvents();
    mockEmitContainerUpdateApplied.mockClear();

    updateOperation.markOperationTerminal(inserted.id, { status: 'failed', lastError: 'late' });
    await flushAsyncLifecycleEvents();

    expect(mockEmitContainerUpdateApplied).not.toHaveBeenCalled();
    expect(mockEmitContainerUpdateFailed).not.toHaveBeenCalled();
  });

  test('markOperationTerminal does not emit container lifecycle events for self-updates', async () => {
    const inserted = updateOperation.insertOperation({
      id: 'self-update-op-1',
      kind: 'self-update',
      containerName: 'drydock',
      status: 'in-progress',
      phase: 'prepare',
    });

    updateOperation.markOperationTerminal(inserted.id, {
      status: 'succeeded',
      phase: 'succeeded',
    });
    await flushAsyncLifecycleEvents();

    expect(mockEmitContainerUpdateApplied).not.toHaveBeenCalled();
    expect(mockEmitContainerUpdateFailed).not.toHaveBeenCalled();
  });

  describe('emitSelfUpdateTerminalLifecycleEvent (#1501)', () => {
    function insertSelfUpdate(id: string) {
      return updateOperation.insertOperation({
        id,
        kind: 'self-update',
        containerId: 'drydock-id',
        containerName: 'drydock',
        status: 'in-progress',
        phase: 'prepare',
        fromVersion: '1.8.0-rc.7',
        toVersion: '1.8.0-rc.8',
      });
    }

    test('emits update-applied flagged as a self-update for a succeeded operation', async () => {
      const inserted = insertSelfUpdate('self-ok');
      const terminal = updateOperation.markOperationTerminal(inserted.id, {
        status: 'succeeded',
        phase: 'succeeded',
      });
      await flushAsyncLifecycleEvents();
      expect(mockEmitContainerUpdateApplied).not.toHaveBeenCalled();

      updateOperation.emitSelfUpdateTerminalLifecycleEvent(terminal!);
      await flushAsyncLifecycleEvents();

      expect(mockEmitContainerUpdateApplied).toHaveBeenCalledTimes(1);
      expect(mockEmitContainerUpdateApplied).toHaveBeenCalledWith({
        operationId: 'self-ok',
        containerId: 'drydock-id',
        containerName: 'drydock',
        selfUpdate: true,
      });
      expect(mockEmitContainerUpdateFailed).not.toHaveBeenCalled();
    });

    test.each(['failed', 'rolled-back'] as const)(
      'emits update-failed flagged as a self-update for a %s operation',
      async (status) => {
        const inserted = insertSelfUpdate(`self-${status}`);
        const terminal = updateOperation.markOperationTerminal(inserted.id, {
          status,
          phase: status,
          lastError: 'health gate failed',
        });

        updateOperation.emitSelfUpdateTerminalLifecycleEvent(terminal!);
        await flushAsyncLifecycleEvents();

        expect(mockEmitContainerUpdateFailed).toHaveBeenCalledTimes(1);
        expect(mockEmitContainerUpdateFailed).toHaveBeenCalledWith(
          expect.objectContaining({
            operationId: `self-${status}`,
            containerName: 'drydock',
            error: 'health gate failed',
            phase: status,
            selfUpdate: true,
          }),
        );
        expect(mockEmitContainerUpdateApplied).not.toHaveBeenCalled();
      },
    );

    test('emits nothing for an expired self-update', async () => {
      const inserted = insertSelfUpdate('self-expired');
      const terminal = updateOperation.markOperationTerminal(inserted.id, { status: 'expired' });

      updateOperation.emitSelfUpdateTerminalLifecycleEvent(terminal!);
      await flushAsyncLifecycleEvents();

      expect(mockEmitContainerUpdateApplied).not.toHaveBeenCalled();
      expect(mockEmitContainerUpdateFailed).not.toHaveBeenCalled();
    });

    test('ignores operations that are not self-updates', async () => {
      const inserted = updateOperation.insertOperation({
        id: 'regular-op',
        containerName: 'web',
        status: 'in-progress',
        phase: 'pulling',
      });
      const terminal = updateOperation.markOperationTerminal(inserted.id, {
        status: 'succeeded',
        phase: 'succeeded',
      });
      mockEmitContainerUpdateApplied.mockClear();

      updateOperation.emitSelfUpdateTerminalLifecycleEvent(terminal!);
      await flushAsyncLifecycleEvents();

      expect(mockEmitContainerUpdateApplied).not.toHaveBeenCalled();
    });
  });

  test('markOperationTerminal emits no lifecycle events when terminalised as expired (issue #410)', async () => {
    // The TTL-sweep and startup-orphan paths set status:'expired'. This must
    // never emit update-applied or update-failed — emitting update-failed would
    // surface a false "update failed" notification for an operation that merely
    // got stuck or was orphaned across a restart.
    const inserted = updateOperation.insertOperation({
      id: 'op-expired',
      containerId: 'container-expired',
      containerName: 'web',
      status: 'in-progress',
      phase: 'pulling',
    });

    updateOperation.markOperationTerminal(inserted.id, {
      status: 'expired',
      lastError: 'Marked expired after exceeding active update TTL (1800000ms) while in progress',
    });
    await flushAsyncLifecycleEvents();

    expect(mockEmitContainerUpdateApplied).not.toHaveBeenCalled();
    expect(mockEmitContainerUpdateFailed).not.toHaveBeenCalled();
    // The operation-changed SSE must still fire (UI needs to know the row changed).
    expect(mockEmitUpdateOperationChanged).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'op-expired', status: 'expired' }),
    );
  });

  test('markOperationTerminal emits no lifecycle events when terminalised as skipped-dependency (#219)', async () => {
    // Dependency-ordered wave dispatch (v1.7 Phase 6.1) never attempts a
    // container whose upstream dependency failed or was window-deferred this
    // cycle. Like `expired`, this must never emit update-applied or
    // update-failed — the work was never attempted, so "update failed" would
    // be a false notification.
    const inserted = updateOperation.insertOperation({
      id: 'op-skipped-dependency',
      containerId: 'container-dependent',
      containerName: 'api',
      status: 'in-progress',
      phase: 'pulling',
    });

    updateOperation.markOperationTerminal(inserted.id, {
      status: 'skipped-dependency',
      skippedDependencyReason: 'upstream-failed',
      blockingContainerId: 'container-db',
      blockingOperationId: 'op-db-1',
      lastError: 'Skipped: upstream dependency container-db failed (operation op-db-1)',
    });
    await flushAsyncLifecycleEvents();

    expect(mockEmitContainerUpdateApplied).not.toHaveBeenCalled();
    expect(mockEmitContainerUpdateFailed).not.toHaveBeenCalled();
    expect(mockEmitUpdateOperationChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'op-skipped-dependency',
        status: 'skipped-dependency',
      }),
    );
  });

  test('emitUpdateOperationChanged includes lastError and rollbackReason in the SSE payload', async () => {
    const inserted = updateOperation.insertOperation({
      id: 'op-sse-payload',
      containerId: 'c-sse',
      containerName: 'worker',
      triggerName: 'portainer.update',
      status: 'in-progress',
      phase: 'pulling',
    });

    mockEmitUpdateOperationChanged.mockClear();

    updateOperation.markOperationTerminal(inserted.id, {
      status: 'rolled-back',
      phase: 'rolled-back',
      lastError: 'Cancelled by operator',
      rollbackReason: 'cancelled',
    });
    await flushAsyncLifecycleEvents();

    const calls = mockEmitUpdateOperationChanged.mock.calls;
    const terminalCall = calls.find(([payload]) => payload?.status === 'rolled-back');
    expect(terminalCall).toBeDefined();
    expect(terminalCall![0]).toMatchObject({
      operationId: 'op-sse-payload',
      containerName: 'worker',
      status: 'rolled-back',
      triggerName: 'portainer.update',
      lastError: 'Cancelled by operator',
      rollbackReason: 'cancelled',
    });
  });

  test('insertOperation emits update-operation-changed by default', async () => {
    mockEmitUpdateOperationChanged.mockClear();

    updateOperation.insertOperation({
      id: 'op-emit-default',
      containerName: 'web',
      status: 'queued',
      phase: 'queued',
    });
    await flushAsyncLifecycleEvents();

    expect(mockEmitUpdateOperationChanged).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'op-emit-default', status: 'queued' }),
    );
  });

  test('insertOperation emits queue sequence metadata on update-operation-changed', async () => {
    mockEmitUpdateOperationChanged.mockClear();

    updateOperation.insertOperation({
      id: 'op-emit-queue',
      containerName: 'web',
      status: 'queued',
      phase: 'queued',
      batchId: 'batch-queue',
      queuePosition: 2,
      queueTotal: 3,
    });
    await flushAsyncLifecycleEvents();

    expect(mockEmitUpdateOperationChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'op-emit-queue',
        batchId: 'batch-queue',
        queuePosition: 2,
        queueTotal: 3,
        status: 'queued',
      }),
    );
  });

  test('insertOperation suppresses update-operation-changed when skipChangeEvent is true', async () => {
    mockEmitUpdateOperationChanged.mockClear();

    updateOperation.insertOperation(
      {
        id: 'op-emit-skip',
        containerName: 'web',
        status: 'queued',
        phase: 'queued',
      },
      { skipChangeEvent: true },
    );
    await flushAsyncLifecycleEvents();

    expect(mockEmitUpdateOperationChanged).not.toHaveBeenCalled();
  });

  test('emitUpdateOperationChanged omits lastError and rollbackReason when they are empty or absent', async () => {
    const inserted = updateOperation.insertOperation({
      id: 'op-sse-no-extras',
      containerName: 'api',
      status: 'in-progress',
      phase: 'pulling',
    });

    mockEmitUpdateOperationChanged.mockClear();

    updateOperation.markOperationTerminal(inserted.id, {
      status: 'failed',
      phase: 'failed',
    });
    await flushAsyncLifecycleEvents();

    const calls = mockEmitUpdateOperationChanged.mock.calls;
    const terminalCall = calls.find(([payload]) => payload?.status === 'failed');
    expect(terminalCall).toBeDefined();
    expect(terminalCall![0].lastError).toBeUndefined();
    expect(terminalCall![0].rollbackReason).toBeUndefined();
  });

  test('update-operation-changed carries updatedAt, fromVersion and toVersion across transitions', async () => {
    mockEmitUpdateOperationChanged.mockClear();

    const inserted = updateOperation.insertOperation({
      id: 'op-sse-versions',
      containerName: 'web',
      status: 'queued',
      phase: 'queued',
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
    });
    await flushAsyncLifecycleEvents();
    expect(mockEmitUpdateOperationChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'queued',
        updatedAt: inserted.updatedAt,
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
      }),
    );

    const progressed = updateOperation.updateOperation(inserted.id, {
      status: 'in-progress',
      phase: 'pulling',
    });
    await flushAsyncLifecycleEvents();
    expect(mockEmitUpdateOperationChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'in-progress',
        updatedAt: progressed!.updatedAt,
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
      }),
    );

    const terminal = updateOperation.markOperationTerminal(inserted.id, {
      status: 'failed',
      phase: 'failed',
    });
    await flushAsyncLifecycleEvents();
    expect(mockEmitUpdateOperationChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'failed',
        updatedAt: terminal!.updatedAt,
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
      }),
    );
  });

  test('update-operation-changed omits versions when the record has none', async () => {
    mockEmitUpdateOperationChanged.mockClear();

    updateOperation.insertOperation({
      id: 'op-sse-no-versions',
      containerName: 'web',
      status: 'queued',
      phase: 'queued',
    });
    await flushAsyncLifecycleEvents();

    const payload = mockEmitUpdateOperationChanged.mock.calls.at(-1)![0];
    expect(payload).not.toHaveProperty('fromVersion');
    expect(payload).not.toHaveProperty('toVersion');
    expect(typeof payload.updatedAt).toBe('string');
  });
});
