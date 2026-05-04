import { beforeEach, describe, expect, test, vi } from 'vitest';

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

import * as updateOperation from './update-operation.js';

function createDb() {
  function getByPath(object: unknown, path: string) {
    return path.split('.').reduce<unknown>((acc, key) => {
      if (!acc || typeof acc !== 'object') {
        return undefined;
      }
      return (acc as Record<string, unknown>)[key];
    }, object);
  }

  function matchesQuery(doc: unknown, query: Record<string, unknown> = {}) {
    return Object.entries(query).every(([key, value]) => getByPath(doc, key) === value);
  }

  const collections: Record<string, unknown> = {};
  return {
    getCollection: (name: string) => collections[name] || null,
    addCollection: (name: string) => {
      const docs: unknown[] = [];
      const collection = {
        insert: (doc: unknown) => {
          docs.push(doc);
        },
        find: (query: Record<string, unknown> = {}) =>
          docs.filter((doc) => matchesQuery(doc, query)),
        findOne: (query: Record<string, unknown> = {}) =>
          docs.find((doc) => matchesQuery(doc, query)) || null,
        remove: (doc: unknown) => {
          const idx = docs.indexOf(doc);
          if (idx >= 0) {
            docs.splice(idx, 1);
          }
        },
      };
      collections[name] = collection;
      return collection;
    },
  };
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

  test('emitUpdateOperationChanged includes lastError and rollbackReason in the SSE payload', async () => {
    const inserted = updateOperation.insertOperation({
      id: 'op-sse-payload',
      containerId: 'c-sse',
      containerName: 'worker',
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
});
