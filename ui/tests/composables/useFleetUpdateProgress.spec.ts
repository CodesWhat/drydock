import { createPinia, setActivePinia } from 'pinia';
import { useFleetUpdateProgress } from '@/composables/useFleetUpdateProgress';
import { useOperationStore } from '@/stores/operations';

describe('useFleetUpdateProgress', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('is empty when no fleet-wide batch is active', () => {
    const { activeBatches } = useFleetUpdateProgress();
    expect(activeBatches.value).toEqual([]);
  });

  it('reflects an active multi-container batch from the operation store', () => {
    const operations = useOperationStore();
    operations.applyOperationChanged({
      operationId: 'op-1',
      containerId: 'c1',
      containerName: 'app1',
      batchId: 'batch-fleet',
      status: 'in-progress',
    });
    operations.applyOperationChanged({
      operationId: 'op-2',
      containerId: 'c2',
      containerName: 'app2',
      batchId: 'batch-fleet',
      status: 'queued',
    });

    const { activeBatches } = useFleetUpdateProgress();

    expect(activeBatches.value).toEqual([
      {
        batchId: 'batch-fleet',
        total: 2,
        succeeded: 0,
        failed: 0,
        active: 2,
        activeContainerNames: ['app1'],
      },
    ]);
  });

  it('drops the batch reactively once every operation settles', () => {
    const operations = useOperationStore();
    operations.applyOperationChanged({
      operationId: 'op-1',
      containerId: 'c1',
      containerName: 'app1',
      batchId: 'batch-fleet',
      status: 'in-progress',
    });
    operations.applyOperationChanged({
      operationId: 'op-2',
      containerId: 'c2',
      containerName: 'app2',
      batchId: 'batch-fleet',
      status: 'in-progress',
    });

    const { activeBatches } = useFleetUpdateProgress();
    expect(activeBatches.value).toHaveLength(1);

    operations.applyUpdateApplied({
      operationId: 'op-1',
      containerId: 'c1',
      containerName: 'app1',
      batchId: 'batch-fleet',
      timestamp: '2026-04-29T12:00:00.000Z',
    });
    operations.applyUpdateApplied({
      operationId: 'op-2',
      containerId: 'c2',
      containerName: 'app2',
      batchId: 'batch-fleet',
      timestamp: '2026-04-29T12:00:01.000Z',
    });

    expect(activeBatches.value).toEqual([]);
  });

  it('falls back to installing its own Pinia instance when none is active', () => {
    setActivePinia(undefined);

    const { activeBatches } = useFleetUpdateProgress();

    expect(activeBatches.value).toEqual([]);
  });
});
