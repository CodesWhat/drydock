var { mockEmitBatchUpdateCompleted, mockEmitUpdateOperationChanged } = vi.hoisted(() => ({
  mockEmitBatchUpdateCompleted: vi.fn().mockResolvedValue(undefined),
  mockEmitUpdateOperationChanged: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../event/index.js', () => ({
  emitUpdateOperationChanged: mockEmitUpdateOperationChanged,
  emitBatchUpdateCompleted: mockEmitBatchUpdateCompleted,
}));

import * as updateOperation from './update-operation.js';

// ---------------------------------------------------------------------------
// In-memory DB helpers (copied from update-operation.test.ts)
// ---------------------------------------------------------------------------

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

describe('update-operation batch completion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateOperation.createCollections(createDb());
  });

  test('does not emit batch-update-completed when operation has no batchId', () => {
    const op = updateOperation.insertOperation({
      containerName: 'nginx',
      containerId: 'c-1',
      status: 'in-progress',
      phase: 'prepare',
    });

    updateOperation.markOperationTerminal(op.id, { status: 'succeeded' });

    expect(mockEmitBatchUpdateCompleted).not.toHaveBeenCalled();
  });

  test('does not emit batch-update-completed when the operation does not exist', () => {
    updateOperation.markOperationTerminal('non-existent-op-id', { status: 'succeeded' });

    expect(mockEmitBatchUpdateCompleted).not.toHaveBeenCalled();
  });

  test('does not emit batch-update-completed when operation is already terminal (idempotent)', () => {
    const documents: any[] = [];
    updateOperation.createCollections(createDocumentBackedDb(documents) as any);

    const op = updateOperation.insertOperation({
      containerName: 'nginx',
      containerId: 'c-1',
      status: 'in-progress',
      phase: 'prepare',
      batchId: 'batch-already-done',
    } as any);

    // Mark terminal once
    updateOperation.markOperationTerminal(op.id, { status: 'succeeded' });
    mockEmitBatchUpdateCompleted.mockClear();

    // Mark terminal again — should be idempotent, no second emission
    updateOperation.markOperationTerminal(op.id, { status: 'succeeded' });
    expect(mockEmitBatchUpdateCompleted).not.toHaveBeenCalled();
  });

  test('does not emit batch-update-completed when sibling operations are still active', () => {
    const documents: any[] = [];
    updateOperation.createCollections(createDocumentBackedDb(documents) as any);

    // Insert two operations in the same batch
    const op1 = updateOperation.insertOperation({
      containerName: 'nginx',
      containerId: 'c-1',
      status: 'in-progress',
      phase: 'prepare',
      batchId: 'batch-partial',
    } as any);

    updateOperation.insertOperation({
      containerName: 'redis',
      containerId: 'c-2',
      status: 'in-progress',
      phase: 'prepare',
      batchId: 'batch-partial',
    } as any);

    // Mark only the first one terminal
    updateOperation.markOperationTerminal(op1.id, { status: 'succeeded' });

    expect(mockEmitBatchUpdateCompleted).not.toHaveBeenCalled();
  });

  test('emits batch-update-completed when the last operation in a 2-op batch succeeds', async () => {
    const documents: any[] = [];
    updateOperation.createCollections(createDocumentBackedDb(documents) as any);

    const batchId = 'batch-both-succeed';

    const op1 = updateOperation.insertOperation({
      containerName: 'nginx',
      containerId: 'c-1',
      status: 'in-progress',
      phase: 'prepare',
      batchId,
    } as any);

    const op2 = updateOperation.insertOperation({
      containerName: 'redis',
      containerId: 'c-2',
      status: 'in-progress',
      phase: 'prepare',
      batchId,
    } as any);

    updateOperation.markOperationTerminal(op1.id, { status: 'succeeded' });
    expect(mockEmitBatchUpdateCompleted).not.toHaveBeenCalled();

    updateOperation.markOperationTerminal(op2.id, { status: 'succeeded' });
    expect(mockEmitBatchUpdateCompleted).toHaveBeenCalledTimes(1);

    const [payload] = mockEmitBatchUpdateCompleted.mock.calls[0];
    expect(payload).toMatchObject({
      batchId,
      total: 2,
      succeeded: 2,
      failed: 0,
      durationMs: expect.any(Number),
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      items: expect.arrayContaining([
        expect.objectContaining({
          operationId: op1.id,
          containerId: 'c-1',
          containerName: 'nginx',
          status: 'succeeded',
        }),
        expect.objectContaining({
          operationId: op2.id,
          containerId: 'c-2',
          containerName: 'redis',
          status: 'succeeded',
        }),
      ]),
    });
    expect(payload.items).toHaveLength(2);
  });

  test('emits batch-update-completed with correct succeeded/failed counts for mixed batch', () => {
    const documents: any[] = [];
    updateOperation.createCollections(createDocumentBackedDb(documents) as any);

    const batchId = 'batch-mixed';

    const op1 = updateOperation.insertOperation({
      containerName: 'nginx',
      containerId: 'c-1',
      status: 'in-progress',
      phase: 'prepare',
      batchId,
    } as any);

    const op2 = updateOperation.insertOperation({
      containerName: 'redis',
      containerId: 'c-2',
      status: 'in-progress',
      phase: 'prepare',
      batchId,
    } as any);

    updateOperation.markOperationTerminal(op1.id, { status: 'succeeded' });
    updateOperation.markOperationTerminal(op2.id, { status: 'failed', lastError: 'timeout' });

    expect(mockEmitBatchUpdateCompleted).toHaveBeenCalledTimes(1);

    const [payload] = mockEmitBatchUpdateCompleted.mock.calls[0];
    expect(payload.total).toBe(2);
    expect(payload.succeeded).toBe(1);
    expect(payload.failed).toBe(1);
    expect(payload.items).toHaveLength(2);

    const succeededItem = payload.items.find((i) => i.operationId === op1.id);
    const failedItem = payload.items.find((i) => i.operationId === op2.id);
    expect(succeededItem.status).toBe('succeeded');
    expect(failedItem.status).toBe('failed');
  });

  test('durationMs in batch payload is a non-negative number', () => {
    const documents: any[] = [];
    updateOperation.createCollections(createDocumentBackedDb(documents) as any);

    const batchId = 'batch-duration';

    const op1 = updateOperation.insertOperation({
      containerName: 'nginx',
      containerId: 'c-1',
      status: 'in-progress',
      phase: 'prepare',
      batchId,
    } as any);

    const op2 = updateOperation.insertOperation({
      containerName: 'redis',
      containerId: 'c-2',
      status: 'in-progress',
      phase: 'prepare',
      batchId,
    } as any);

    updateOperation.markOperationTerminal(op1.id, { status: 'succeeded' });
    updateOperation.markOperationTerminal(op2.id, { status: 'succeeded' });

    const [payload] = mockEmitBatchUpdateCompleted.mock.calls[0];
    expect(payload.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof payload.durationMs).toBe('number');
    expect(Number.isFinite(payload.durationMs)).toBe(true);
  });

  test('emits batch-update-completed only once even when both ops become terminal in the same tick', () => {
    const documents: any[] = [];
    updateOperation.createCollections(createDocumentBackedDb(documents) as any);

    const batchId = 'batch-race';

    const op1 = updateOperation.insertOperation({
      containerName: 'app-a',
      containerId: 'ca-1',
      status: 'in-progress',
      phase: 'prepare',
      batchId,
    } as any);

    const op2 = updateOperation.insertOperation({
      containerName: 'app-b',
      containerId: 'ca-2',
      status: 'in-progress',
      phase: 'prepare',
      batchId,
    } as any);

    updateOperation.markOperationTerminal(op1.id, { status: 'succeeded' });
    updateOperation.markOperationTerminal(op2.id, { status: 'failed' });

    // Should be exactly 1 emission, not 2
    expect(mockEmitBatchUpdateCompleted).toHaveBeenCalledTimes(1);
  });

  test('items array in batch payload contains only operations from the batch, not unrelated ones', () => {
    const documents: any[] = [];
    updateOperation.createCollections(createDocumentBackedDb(documents) as any);

    const batchId = 'batch-scoped';

    const batchOp1 = updateOperation.insertOperation({
      containerName: 'nginx',
      containerId: 'c-1',
      status: 'in-progress',
      phase: 'prepare',
      batchId,
    } as any);

    const batchOp2 = updateOperation.insertOperation({
      containerName: 'redis',
      containerId: 'c-2',
      status: 'in-progress',
      phase: 'prepare',
      batchId,
    } as any);

    // Unrelated operation — no batchId
    updateOperation.insertOperation({
      containerName: 'postgres',
      containerId: 'c-3',
      status: 'in-progress',
      phase: 'prepare',
    });

    updateOperation.markOperationTerminal(batchOp1.id, { status: 'succeeded' });
    updateOperation.markOperationTerminal(batchOp2.id, { status: 'succeeded' });

    const [payload] = mockEmitBatchUpdateCompleted.mock.calls[0];
    expect(payload.items).toHaveLength(2);
    const itemIds = payload.items.map((i) => i.operationId);
    expect(itemIds).toContain(batchOp1.id);
    expect(itemIds).toContain(batchOp2.id);
    expect(itemIds).not.toContain(
      documents.find((d) => d.data?.containerName === 'postgres')?.data?.id,
    );
  });
});
