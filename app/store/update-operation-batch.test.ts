var {
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
  emitUpdateOperationChanged: mockEmitUpdateOperationChanged,
  emitBatchUpdateCompleted: mockEmitBatchUpdateCompleted,
  emitContainerUpdateApplied: mockEmitContainerUpdateApplied,
  emitContainerUpdateFailed: mockEmitContainerUpdateFailed,
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

  test('does not emit batch-update-completed for persisted batch rows missing from the in-memory registry', () => {
    const documents: any[] = [
      {
        data: {
          id: 'preexisting-op-1',
          containerName: 'nginx',
          containerId: 'c-1',
          status: 'queued',
          phase: 'queued',
          batchId: 'batch-before-boot',
          createdAt: '2026-02-23T00:00:00.000Z',
          updatedAt: '2026-02-23T00:00:00.000Z',
        },
      },
    ];
    updateOperation.createCollections(createDocumentBackedDb(documents) as any);

    const terminal = updateOperation.markOperationTerminal('preexisting-op-1', {
      status: 'succeeded',
    });

    expect(terminal).toEqual(expect.objectContaining({ status: 'succeeded' }));
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

  test('batch completion silently skips a member whose store entry has been removed (defensive continue)', () => {
    const documents: any[] = [];
    updateOperation.createCollections(createDocumentBackedDb(documents) as any);

    const batchId = 'batch-missing-member';

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

    // Insert a third member so batchMemberRegistry has three IDs, then
    // splice its document out so getOperationById returns undefined for it.
    const op3 = updateOperation.insertOperation({
      containerName: 'postgres',
      containerId: 'c-3',
      status: 'in-progress',
      phase: 'prepare',
      batchId,
    } as any);
    const op3DocIndex = documents.findIndex((d) => d.data?.id === op3.id);
    documents.splice(op3DocIndex, 1);

    // Mark op1 terminal first — op2 is still active so no batch completion yet.
    updateOperation.markOperationTerminal(op1.id, { status: 'succeeded' });
    expect(mockEmitBatchUpdateCompleted).not.toHaveBeenCalled();

    // Mark op2 terminal — remainingActive is now 0 (op3 is absent from docs),
    // so batch completion fires. The loop hits op3.id → getOperationById returns
    // undefined → continue. Payload should include only op1 and op2.
    updateOperation.markOperationTerminal(op2.id, { status: 'succeeded' });

    expect(mockEmitBatchUpdateCompleted).toHaveBeenCalledTimes(1);
    const [payload] = mockEmitBatchUpdateCompleted.mock.calls[0];
    expect(payload.total).toBe(2);
    const itemIds = payload.items.map((i: { operationId: string }) => i.operationId);
    expect(itemIds).toContain(op1.id);
    expect(itemIds).toContain(op2.id);
    expect(itemIds).not.toContain(op3.id);
  });

  test('durationMs is 0 for operations whose createdAt is unparseable (NaN guard)', () => {
    const documents: any[] = [];
    updateOperation.createCollections(createDocumentBackedDb(documents) as any);

    const batchId = 'batch-bad-dates';

    // Use a malformed createdAt so Date.parse returns NaN for this op.
    const op1 = updateOperation.insertOperation({
      containerName: 'nginx',
      containerId: 'c-1',
      status: 'in-progress',
      phase: 'prepare',
      batchId,
      createdAt: 'not-a-valid-date',
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

    expect(mockEmitBatchUpdateCompleted).toHaveBeenCalledTimes(1);
    const [payload] = mockEmitBatchUpdateCompleted.mock.calls[0];
    // op1's NaN dates contribute 0 to duration; overall must be non-negative.
    expect(payload.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(payload.durationMs)).toBe(true);
  });

  test('falls back to markOperationTerminal completedAt when stored op.completedAt is not a string', () => {
    const documents: any[] = [];
    updateOperation.createCollections(createDocumentBackedDb(documents) as any);

    const batchId = 'batch-no-completedAt';

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

    // Mark op1 terminal so it transitions to terminal state and has completedAt set.
    updateOperation.markOperationTerminal(op1.id, { status: 'succeeded' });

    // After terminal transition, manually corrupt op1's completedAt in the documents array
    // so the completedAt property is not a string — this hits the fallback branch at line 673.
    const op1Doc = documents.find((d) => d.data?.id === op1.id);
    if (op1Doc) {
      op1Doc.data.completedAt = null;
    }

    // Mark op2 terminal — triggers batch completion, iterates op1 and op2.
    // For op1, op.completedAt is null (not a string), so completedAt (the current
    // markOperationTerminal local) is used as the fallback.
    updateOperation.markOperationTerminal(op2.id, { status: 'succeeded' });

    expect(mockEmitBatchUpdateCompleted).toHaveBeenCalledTimes(1);
    const [payload] = mockEmitBatchUpdateCompleted.mock.calls[0];
    expect(payload.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(payload.durationMs)).toBe(true);
  });
});
