import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
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
    operations.clearDisplayBatch('missing-stack');
    operations.incrementDisplayBatchSucceeded('missing-stack');
    operations.incrementDisplayBatchFailed('missing-stack');

    expect(Object.keys(operations.byId)).toEqual([]);
    expect(operations.getDisplayBatch('missing-stack')).toBeUndefined();
    expect(operations.getBatchProgress('missing-stack')).toBeUndefined();
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
