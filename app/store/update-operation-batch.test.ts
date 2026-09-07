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

import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import type { Database } from './db/driver.js';
import * as updateOperation from './update-operation.js';

// ---------------------------------------------------------------------------
// In-memory SQLite DB helpers (mirrors update-operation.test.ts)
// ---------------------------------------------------------------------------

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

/** Seed a row directly into storage, as if it were written before this process started. */
function seedRow(database: Database, data: Record<string, unknown>): void {
  const row = updateOperation.buildImportedUpdateOperationRow(data);
  if (row) {
    updateOperation.insertImportedUpdateOperationRow(database, row);
  }
}

describe('update-operation batch completion', () => {
  let database: Database;

  beforeEach(() => {
    vi.clearAllMocks();
    database = createDb();
    updateOperation.createCollections(database);
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

  test('rehydrates persisted batch membership and emits completion once after restart', () => {
    // Seed a queued row directly into storage before createCollections runs,
    // simulating a document that was already persisted at the last restart.
    seedRow(database, {
      id: 'preexisting-op-1',
      containerName: 'nginx',
      containerId: 'c-1',
      status: 'queued',
      phase: 'queued',
      batchId: 'batch-before-boot',
      queuePosition: 1,
      queueTotal: 1,
      createdAt: '2026-02-23T00:00:00.000Z',
      updatedAt: '2026-02-23T00:00:00.000Z',
    });
    updateOperation.createCollections(database);

    const terminal = updateOperation.markOperationTerminal('preexisting-op-1', {
      status: 'succeeded',
    });

    expect(terminal).toEqual(expect.objectContaining({ status: 'succeeded' }));
    expect(mockEmitBatchUpdateCompleted).toHaveBeenCalledTimes(1);
    expect(mockEmitBatchUpdateCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: 'batch-before-boot',
        total: 1,
        succeeded: 1,
      }),
    );

    // Re-running startup reconciliation against the same (now-terminal) row
    // must not re-fire batch completion.
    updateOperation.createCollections(database);
    updateOperation.markOperationTerminal('preexisting-op-1', { status: 'succeeded' });
    expect(mockEmitBatchUpdateCompleted).toHaveBeenCalledTimes(1);
  });

  test('does not emit a misleading partial batch for legacy rows missing persisted identity', () => {
    seedRow(database, {
      id: 'legacy-terminal-op',
      containerName: 'nginx',
      containerId: 'c-1',
      status: 'succeeded',
      phase: 'succeeded',
      completedAt: '2026-02-23T00:01:00.000Z',
      createdAt: '2026-02-23T00:00:00.000Z',
      updatedAt: '2026-02-23T00:01:00.000Z',
    });
    seedRow(database, {
      id: 'active-op',
      containerName: 'redis',
      containerId: 'c-2',
      status: 'queued',
      phase: 'queued',
      batchId: 'legacy-batch',
      queuePosition: 2,
      queueTotal: 2,
      createdAt: '2026-02-23T00:00:00.000Z',
      updatedAt: '2026-02-23T00:00:00.000Z',
    });
    updateOperation.createCollections(database);

    updateOperation.markOperationTerminal('active-op', { status: 'succeeded' });

    expect(mockEmitBatchUpdateCompleted).not.toHaveBeenCalled();
  });

  test('emits batch-update-completed when the last operation in a 2-op batch succeeds', async () => {
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

  test('omits expired operations from batch completion counts and items', () => {
    const batchId = 'batch-success-expired';

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
    updateOperation.markOperationTerminal(op2.id, { status: 'expired' });

    expect(mockEmitBatchUpdateCompleted).toHaveBeenCalledTimes(1);

    const [payload] = mockEmitBatchUpdateCompleted.mock.calls[0];
    expect(payload.total).toBe(1);
    expect(payload.succeeded).toBe(1);
    expect(payload.failed).toBe(0);
    expect(payload.items).toEqual([
      expect.objectContaining({
        operationId: op1.id,
        status: 'succeeded',
      }),
    ]);
  });

  test('does not emit batch-update-completed when every batch operation expires silently', () => {
    const batchId = 'batch-all-expired';

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

    updateOperation.markOperationTerminal(op1.id, { status: 'expired' });
    updateOperation.markOperationTerminal(op2.id, { status: 'expired' });

    expect(mockEmitBatchUpdateCompleted).not.toHaveBeenCalled();
  });

  test('durationMs in batch payload is a non-negative number', () => {
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
    const unrelated = updateOperation.insertOperation({
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
    expect(itemIds).not.toContain(unrelated.id);
  });

  test('batch completion silently skips a member whose store entry has been removed (defensive continue)', () => {
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
    // delete its row directly so getOperationById returns undefined for it.
    const op3 = updateOperation.insertOperation({
      containerName: 'postgres',
      containerId: 'c-3',
      status: 'in-progress',
      phase: 'prepare',
      batchId,
    } as any);
    database.prepare('DELETE FROM update_operations WHERE id = ?').run(op3.id);

    // Mark op1 terminal first — op2 is still active so no batch completion yet.
    updateOperation.markOperationTerminal(op1.id, { status: 'succeeded' });
    expect(mockEmitBatchUpdateCompleted).not.toHaveBeenCalled();

    // Mark op2 terminal — remainingActive is now 0 (op3's row is gone), so
    // batch completion fires. The loop hits op3.id → getOperationById returns
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

    // After terminal transition, corrupt op1's stored completed_at directly so
    // the column reads back as undefined — this hits the fallback branch.
    database.prepare('UPDATE update_operations SET completed_at = NULL WHERE id = ?').run(op1.id);

    // Mark op2 terminal — triggers batch completion, iterates op1 and op2.
    // For op1, op.completedAt is undefined, so completedAt (the current
    // markOperationTerminal local) is used as the fallback.
    updateOperation.markOperationTerminal(op2.id, { status: 'succeeded' });

    expect(mockEmitBatchUpdateCompleted).toHaveBeenCalledTimes(1);
    const [payload] = mockEmitBatchUpdateCompleted.mock.calls[0];
    expect(payload.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(payload.durationMs)).toBe(true);
  });
});
