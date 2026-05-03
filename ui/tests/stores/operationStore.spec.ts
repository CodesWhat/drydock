import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEventStreamStore } from '@/stores/eventStream';
import { useOperationStore } from '@/stores/operations';

describe('useOperationStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('indexes active operations from event stream phase events', () => {
    const operations = useOperationStore();
    operations.start();

    operations.applyOperationChanged({
      operationId: 'op-1',
      containerId: 'c1',
      containerName: 'web',
      batchId: 'batch-1',
      status: 'in-progress',
      phase: 'pulling',
    });

    expect(operations.getOperationByContainerId('c1')).toEqual(
      expect.objectContaining({
        operationId: 'op-1',
        containerId: 'c1',
        containerName: 'web',
        batchId: 'batch-1',
        status: 'in-progress',
        phase: 'pulling',
      }),
    );
    expect(operations.getBatchProgress('batch-1')).toEqual({
      batchId: 'batch-1',
      total: 1,
      succeeded: 0,
      failed: 0,
      active: 1,
    });
  });

  it('terminal update events close active operation indexes', () => {
    const operations = useOperationStore();
    operations.applyOperationChanged({
      operationId: 'op-1',
      containerId: 'c1',
      containerName: 'web',
      batchId: 'batch-1',
      status: 'in-progress',
      phase: 'pulling',
    });

    operations.applyUpdateApplied({
      operationId: 'op-1',
      containerId: 'c1',
      containerName: 'web',
      batchId: 'batch-1',
      timestamp: '2026-04-29T12:00:00.000Z',
    });

    expect(operations.getOperationByContainerId('c1')).toBeUndefined();
    expect(operations.byId['op-1']).toEqual(
      expect.objectContaining({
        status: 'succeeded',
        phase: 'succeeded',
      }),
    );
    expect(operations.getBatchProgress('batch-1')).toEqual({
      batchId: 'batch-1',
      total: 1,
      succeeded: 1,
      failed: 0,
      active: 0,
    });
  });

  it('looks up active operations by container id without scanning all operations', () => {
    const operations = useOperationStore();
    operations.applyOperationChanged({
      operationId: 'op-indexed',
      containerId: 'c-indexed',
      containerName: 'web',
      status: 'in-progress',
      phase: 'pulling',
    });

    const valuesSpy = vi.spyOn(Object, 'values');
    try {
      const result = operations.getOperationByContainerId('c-indexed');
      expect(valuesSpy).not.toHaveBeenCalled();
      expect(result?.operationId).toBe('op-indexed');
    } finally {
      valuesSpy.mockRestore();
    }
  });

  it('removes operations from the id and container indexes', () => {
    const operations = useOperationStore();
    operations.applyOperationChanged({
      operationId: 'op-remove',
      containerId: 'c-old',
      newContainerId: 'c-new',
      containerName: 'web',
      status: 'in-progress',
    });

    expect(operations.getOperationByContainerId('c-old')?.operationId).toBe('op-remove');
    expect(operations.getOperationByContainerId('c-new')?.operationId).toBe('op-remove');

    operations.removeOperation('op-remove');

    expect(operations.byId['op-remove']).toBeUndefined();
    expect(operations.getOperationByContainerId('c-old')).toBeUndefined();
    expect(operations.getOperationByContainerId('c-new')).toBeUndefined();
  });

  it('batch completion summaries replace derived batch progress', () => {
    const operations = useOperationStore();

    operations.applyBatchCompleted({
      batchId: 'batch-1',
      total: 3,
      succeeded: 2,
      failed: 1,
      durationMs: 1_000,
      timestamp: '2026-04-29T12:00:00.000Z',
      items: [
        { operationId: 'op-1', containerId: 'c1', containerName: 'web', status: 'succeeded' },
        { operationId: 'op-2', containerId: 'c2', containerName: 'api', status: 'succeeded' },
        { operationId: 'op-3', containerId: 'c3', containerName: 'db', status: 'failed' },
      ],
    });

    expect(operations.getBatchProgress('batch-1')).toEqual({
      batchId: 'batch-1',
      total: 3,
      succeeded: 2,
      failed: 1,
      active: 0,
    });
  });

  it('uses captured display batches as the live group progress source', () => {
    const operations = useOperationStore();

    operations.captureDisplayBatch('stack-a', 3);
    operations.incrementDisplayBatchSucceeded('stack-a');
    operations.incrementDisplayBatchFailed('stack-a');

    expect(operations.getDisplayBatch('stack-a')).toEqual({
      frozenTotal: 3,
      startedAt: expect.any(Number),
      succeededCount: 1,
      failedCount: 1,
    });
    expect(operations.getBatchProgress('stack-a')).toEqual({
      batchId: 'stack-a',
      total: 3,
      succeeded: 1,
      failed: 1,
      active: 1,
    });

    operations.incrementDisplayBatchSucceeded('stack-a');
    operations.incrementDisplayBatchFailed('stack-a');
    expect(operations.getBatchProgress('stack-a')?.active).toBe(0);

    operations.clearDisplayBatch('stack-a');
    expect(operations.getDisplayBatch('stack-a')).toBeUndefined();
  });

  it('handles no-op display batch and unknown progress lookups', () => {
    const operations = useOperationStore();

    operations.applyOperationChanged({ operationId: '', status: 'queued' });
    operations.removeOperation('missing-operation');
    operations.clearDisplayBatch('missing-stack');
    operations.incrementDisplayBatchSucceeded('missing-stack');
    operations.incrementDisplayBatchFailed('missing-stack');

    expect(Object.keys(operations.byId)).toEqual([]);
    expect(operations.getDisplayBatch('missing-stack')).toBeUndefined();
    expect(operations.getBatchProgress('missing-stack')).toBeUndefined();
  });

  it('stores operations that do not yet have container ids without indexing them', () => {
    const operations = useOperationStore();

    operations.applyOperationChanged({
      operationId: 'op-without-container',
      containerName: 'web',
      status: 'queued',
    });

    expect(operations.byId['op-without-container']).toEqual(
      expect.objectContaining({
        containerName: 'web',
        status: 'queued',
      }),
    );
    expect(operations.getOperationByContainerId('missing-container')).toBeUndefined();

    operations.removeOperation('op-without-container');

    expect(operations.byId['op-without-container']).toBeUndefined();
  });

  describe('upsertOperation status-rank guard', () => {
    it('allows forward transition queued → in-progress → succeeded', () => {
      const operations = useOperationStore();

      operations.applyOperationChanged({
        operationId: 'op-forward',
        containerId: 'c1',
        containerName: 'web',
        status: 'queued',
      });
      expect(operations.byId['op-forward']?.status).toBe('queued');

      operations.applyOperationChanged({
        operationId: 'op-forward',
        containerId: 'c1',
        containerName: 'web',
        status: 'in-progress',
        phase: 'pulling',
      });
      expect(operations.byId['op-forward']?.status).toBe('in-progress');
      expect(operations.byId['op-forward']?.phase).toBe('pulling');

      operations.applyUpdateApplied({
        operationId: 'op-forward',
        containerId: 'c1',
        containerName: 'web',
        batchId: null,
        timestamp: '2026-05-01T12:00:00.000Z',
      });
      expect(operations.byId['op-forward']?.status).toBe('succeeded');
    });

    it('drops status but merges metadata when stale queued event arrives after in-progress', () => {
      const operations = useOperationStore();

      operations.applyOperationChanged({
        operationId: 'op-stale',
        containerId: 'c1',
        containerName: 'web',
        status: 'in-progress',
        phase: 'pulling',
      });

      // Stale queued event — would regress status
      operations.applyOperationChanged({
        operationId: 'op-stale',
        containerId: 'c1',
        containerName: 'web-renamed',
        status: 'queued',
      });

      // Status must NOT regress; but containerName update should apply
      expect(operations.byId['op-stale']?.status).toBe('in-progress');
      expect(operations.byId['op-stale']?.containerName).toBe('web-renamed');
    });

    it('drops status when stale in-progress event arrives after succeeded', () => {
      const operations = useOperationStore();

      operations.applyUpdateApplied({
        operationId: 'op-terminal',
        containerId: 'c1',
        containerName: 'web',
        batchId: null,
        timestamp: '2026-05-01T12:00:00.000Z',
      });
      expect(operations.byId['op-terminal']?.status).toBe('succeeded');

      // Stale in-progress event arrives after succeeded
      operations.applyOperationChanged({
        operationId: 'op-terminal',
        containerId: 'c1',
        containerName: 'web',
        status: 'in-progress',
        phase: 'creating',
      });

      // Terminal status is sticky; phase must not regress either
      expect(operations.byId['op-terminal']?.status).toBe('succeeded');
      expect(operations.byId['op-terminal']?.phase).toBe('succeeded');
    });

    it('merges non-status metadata even when status is gated', () => {
      const operations = useOperationStore();

      operations.applyUpdateFailed({
        operationId: 'op-meta',
        containerId: 'c1',
        containerName: 'web',
        error: 'pull failed',
        phase: 'failed',
        batchId: null,
        timestamp: '2026-05-01T12:00:00.000Z',
      });
      expect(operations.byId['op-meta']?.status).toBe('failed');

      // Stale in-progress with a newContainerId that we DO want to merge
      operations.applyOperationChanged({
        operationId: 'op-meta',
        containerId: 'c1',
        newContainerId: 'c1-new',
        containerName: 'web',
        status: 'in-progress',
        phase: 'creating',
      });

      // Status stays terminal; newContainerId merges through
      expect(operations.byId['op-meta']?.status).toBe('failed');
      expect(operations.byId['op-meta']?.phase).toBe('failed');
      expect(operations.byId['op-meta']?.newContainerId).toBe('c1-new');
    });

    it('defaults update-failed payloads with unknown phases to failed', () => {
      const operations = useOperationStore();

      operations.applyUpdateFailed({
        operationId: 'op-invalid-failed-phase',
        containerId: 'c1',
        containerName: 'web',
        error: 'pull failed',
        phase: 'not-a-phase',
        batchId: null,
        timestamp: '2026-05-01T12:00:00.000Z',
      });

      expect(operations.byId['op-invalid-failed-phase']?.phase).toBe('failed');
    });

    it('first insert (no existing operation) applies without guard', () => {
      const operations = useOperationStore();

      operations.applyOperationChanged({
        operationId: 'op-first',
        containerId: 'c1',
        containerName: 'web',
        status: 'in-progress',
        phase: 'pulling',
      });

      expect(operations.byId['op-first']?.status).toBe('in-progress');
      expect(operations.byId['op-first']?.phase).toBe('pulling');
    });

    it('preserves first terminal status when a different terminal arrives (succeeded → failed is rejected)', () => {
      const operations = useOperationStore();

      operations.applyUpdateApplied({
        operationId: 'op-two-terminals',
        containerId: 'c1',
        containerName: 'web',
        batchId: null,
        timestamp: '2026-05-01T12:00:00.000Z',
      });
      expect(operations.byId['op-two-terminals']?.status).toBe('succeeded');

      // A spurious failed event (should not happen, but guard it)
      operations.applyUpdateFailed({
        operationId: 'op-two-terminals',
        containerId: 'c1',
        containerName: 'web',
        error: 'unexpected',
        phase: 'failed',
        batchId: null,
        timestamp: '2026-05-01T12:00:01.000Z',
      });

      expect(operations.byId['op-two-terminals']?.status).toBe('succeeded');
    });

    it('ignores operation changes with unknown statuses', () => {
      const operations = useOperationStore();

      operations.applyOperationChanged({
        operationId: 'op-unknown',
        containerId: 'c1',
        containerName: 'web',
        status: 'custom-status',
      });
      expect(operations.byId['op-unknown']).toBeUndefined();

      operations.applyOperationChanged({
        operationId: 'op-unknown',
        containerId: 'c1',
        containerName: 'web',
        status: 'in-progress',
        phase: 'pulling',
      });
      expect(operations.byId['op-unknown']?.status).toBe('in-progress');
    });
  });

  it('supports display batch replacement and new-container operation lookup', () => {
    const operations = useOperationStore();

    operations.replaceDisplayBatches(
      new Map([
        [
          'stack-replaced',
          {
            frozenTotal: 2,
            startedAt: 1,
            succeededCount: 1,
            failedCount: 0,
          },
        ],
      ]),
    );
    operations.applyOperationChanged({
      operationId: 'op-new-container',
      containerId: 'old-container',
      newContainerId: 'new-container',
      containerName: 'web',
      status: 'in-progress',
    });

    expect(operations.getDisplayBatch('stack-replaced')).toEqual({
      frozenTotal: 2,
      startedAt: 1,
      succeededCount: 1,
      failedCount: 0,
    });
    expect(operations.getOperationByContainerId('new-container')).toEqual(
      expect.objectContaining({ operationId: 'op-new-container' }),
    );
  });

  it('subscribes to event stream updates once and stops cleanly', () => {
    const operations = useOperationStore();
    const eventStream = useEventStreamStore();

    operations.start();
    operations.start();
    eventStream.publish('update-operation-changed', {
      operationId: 'op-stream-1',
      containerId: 'c-stream-1',
      containerName: 'web',
      status: 'queued',
    });
    eventStream.publish('update-operation-changed', {
      operationId: 'op-stream-invalid-status',
      containerId: 'c-stream-invalid-status',
      containerName: 'invalid-status',
      status: 'not-a-status',
    });
    eventStream.publish('update-operation-changed', 'invalid');
    eventStream.publish('update-operation-changed', { operationId: '', status: 'queued' });
    eventStream.publish('update-applied', {
      operationId: 'op-stream-1',
      containerId: 'c-stream-1',
      containerName: 'web',
      batchId: 'batch-stream-applied',
      timestamp: '2026-04-29T12:00:00.000Z',
    });
    eventStream.publish('update-applied', {
      operationId: 'op-stream-applied-no-batch',
      containerId: 'c-stream-applied-no-batch',
      containerName: 'web-no-batch',
      batchId: '',
      timestamp: '2026-04-29T12:00:00.000Z',
    });
    eventStream.publish('update-applied', 'invalid');
    eventStream.publish('update-applied', { operationId: 'missing-container' });
    eventStream.publish('update-failed', {
      operationId: 'op-stream-2',
      containerId: 'c-stream-2',
      containerName: 'api',
      error: 'pull failed',
      batchId: 'batch-stream-failed',
      timestamp: '2026-04-29T12:00:01.000Z',
    });
    eventStream.publish('update-failed', {
      operationId: 'op-stream-failed-no-batch',
      containerId: 'c-stream-failed-no-batch',
      containerName: 'api-no-batch',
      error: 'pull failed',
      batchId: '',
      timestamp: '2026-04-29T12:00:01.000Z',
    });
    eventStream.publish('update-failed', 'invalid');
    eventStream.publish('update-failed', { operationId: 'missing-error' });
    eventStream.publish('batch-update-completed', {
      batchId: 'batch-stream-1',
      total: 1,
      succeeded: 0,
      failed: 1,
      durationMs: 100,
      timestamp: '2026-04-29T12:00:02.000Z',
      items: [
        {
          operationId: 'op-stream-3',
          containerId: 'c-stream-3',
          containerName: 'worker',
          status: 'failed',
        },
      ],
    });
    eventStream.publish('batch-update-completed', {
      batchId: 'batch-stream-defaults',
      items: [
        'invalid-item',
        { operationId: 'op-stream-4', status: 'succeeded' },
        { containerId: 'missing-operation-id', containerName: 'ignored', status: 'failed' },
      ],
    });
    eventStream.publish('batch-update-completed', 'invalid');
    eventStream.publish('batch-update-completed', { batchId: 'invalid' });

    expect(operations.byId['op-stream-1']).toEqual(
      expect.objectContaining({ status: 'succeeded' }),
    );
    expect(operations.byId['op-stream-invalid-status']).toBeUndefined();
    expect(operations.byId['op-stream-2']).toEqual(
      expect.objectContaining({ status: 'failed', phase: 'failed' }),
    );
    expect(operations.getBatchProgress('batch-stream-1')).toEqual({
      batchId: 'batch-stream-1',
      total: 1,
      succeeded: 0,
      failed: 1,
      active: 0,
    });
    expect(operations.getBatchProgress('batch-stream-defaults')).toEqual({
      batchId: 'batch-stream-defaults',
      total: 3,
      succeeded: 0,
      failed: 0,
      active: 0,
    });
    expect(operations.byId['op-stream-4']).toEqual(
      expect.objectContaining({
        containerId: '',
        containerName: '',
        status: 'succeeded',
      }),
    );

    operations.stop();
    eventStream.publish('update-operation-changed', {
      operationId: 'op-after-stop',
      containerName: 'stopped',
      status: 'queued',
    });

    expect(operations.byId['op-after-stop']).toBeUndefined();
  });
});
