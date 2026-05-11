import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, type Ref, ref } from 'vue';
import {
  OPERATION_DISPLAY_HOLD_MS,
  useOperationDisplayHold,
} from '@/composables/useOperationDisplayHold';
import { useOperationStore } from '@/stores/operations';
import type { Container, ContainerUpdateOperation } from '@/types/container';
import { useContainerSsePatchPipeline } from '@/views/containers/useContainerSsePatchPipeline';

const { mockMapApiContainer } = vi.hoisted(() => ({
  mockMapApiContainer: vi.fn((raw: unknown) => raw),
}));

vi.mock('@/utils/container-mapper', () => ({
  mapApiContainer: mockMapApiContainer,
}));

function makeOperation(
  overrides: Partial<ContainerUpdateOperation> = {},
): ContainerUpdateOperation {
  return {
    id: 'op-1',
    status: 'in-progress',
    phase: 'pulling',
    updatedAt: '2026-05-02T12:00:00.000Z',
    ...overrides,
  };
}

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'c1',
    name: 'nginx',
    image: 'nginx',
    currentTag: '1.0.0',
    status: 'running',
    updateKind: 'minor',
    updateOperation: undefined,
    ...overrides,
  } as Container;
}

function mountPipeline(args: { containers: Ref<Container[]> }) {
  const loadContainers = vi.fn().mockResolvedValue(undefined);
  const loadDetailSecurityData = vi.fn().mockResolvedValue(undefined);
  const reconcileHoldsAgainstContainers = vi.fn();
  const schedulePostTerminalReload = vi.fn();
  const containerIdMap = ref({ c1: 'c1', nginx: 'c1' });
  const containerMetaMap = ref<Record<string, unknown>>({});
  let pipeline: ReturnType<typeof useContainerSsePatchPipeline>;

  const wrapper = mount(
    defineComponent({
      setup() {
        pipeline = useContainerSsePatchPipeline({
          containers: args.containers,
          containerIdMap,
          containerMetaMap,
          selectedContainerId: ref(undefined),
          loadContainers,
          loadDetailSecurityData,
          reconcileHoldsAgainstContainers,
          schedulePostTerminalReload,
        });
        return {};
      },
      template: '<div />',
    }),
  );

  return { wrapper, schedulePostTerminalReload, pipeline: pipeline!, containerIdMap };
}

describe('useContainerSsePatchPipeline terminal lifecycle handling', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    mockMapApiContainer.mockReset();
    mockMapApiContainer.mockImplementation((raw: unknown) => raw);
    useOperationDisplayHold().clearAllOperationDisplayHolds();
  });

  afterEach(() => {
    useOperationDisplayHold().clearAllOperationDisplayHolds();
    vi.useRealTimers();
  });

  it('releases the display hold and clears the row updateOperation on terminal applied event', async () => {
    const activeOperation = makeOperation();
    const containers = ref([
      makeContainer({
        updateOperation: activeOperation,
      }),
    ]);
    const hold = useOperationDisplayHold();
    hold.holdOperationDisplay({
      operationId: activeOperation.id,
      operation: activeOperation,
      containerId: 'c1',
      containerName: 'nginx',
    });
    const { wrapper, schedulePostTerminalReload } = mountPipeline({ containers });

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-applied', {
        detail: {
          operationId: activeOperation.id,
          containerId: 'c1',
          containerName: 'nginx',
          batchId: null,
          timestamp: '2026-05-02T12:01:00.000Z',
        },
      }),
    );
    await flushPromises();

    expect(containers.value[0]!.updateOperation).toBeUndefined();
    expect(hold.heldOperations.value.has(activeOperation.id)).toBe(true);

    await vi.advanceTimersByTimeAsync(OPERATION_DISPLAY_HOLD_MS);
    await flushPromises();

    expect(hold.heldOperations.value.has(activeOperation.id)).toBe(false);
    expect(schedulePostTerminalReload).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('still releases the hold and schedules reload for a terminal update-applied that arrives 60s after the operation-change event', async () => {
    // Regression coverage for the "fail-safe completion toast" scenario that
    // used to live in the deleted ContainersView.spec.ts. Agent-relay paths
    // can deliver dd:sse-update-applied well after the operation already
    // transitioned via dd:sse-update-operation-changed. The hold must still
    // release and the post-terminal reload must still fire, regardless of how
    // long the gap is.
    const activeOperation = makeOperation({ id: 'op-late-applied' });
    const containers = ref([
      makeContainer({
        updateOperation: activeOperation,
      }),
    ]);
    const hold = useOperationDisplayHold();
    hold.holdOperationDisplay({
      operationId: activeOperation.id,
      operation: activeOperation,
      containerId: 'c1',
      containerName: 'nginx',
    });
    const { wrapper, schedulePostTerminalReload } = mountPipeline({ containers });

    // First the operation-change SSE marks the operation in-progress.
    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-operation-changed', {
        detail: {
          operationId: activeOperation.id,
          containerId: 'c1',
          containerName: 'nginx',
          status: 'in-progress',
          phase: 'new-started',
        },
      }),
    );
    await flushPromises();
    expect(hold.heldOperations.value.has(activeOperation.id)).toBe(true);

    // 60 seconds later — far past any plausible debounce window — the
    // dd:sse-update-applied finally arrives via the agent relay.
    await vi.advanceTimersByTimeAsync(60_000);

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-applied', {
        detail: {
          operationId: activeOperation.id,
          containerId: 'c1',
          containerName: 'nginx',
          batchId: null,
          timestamp: '2026-05-02T12:01:00.000Z',
        },
      }),
    );
    await flushPromises();

    // The row's updateOperation clears immediately; the hold releases after
    // the standard hold window; the post-terminal reload is scheduled.
    expect(containers.value[0]!.updateOperation).toBeUndefined();
    await vi.advanceTimersByTimeAsync(OPERATION_DISPLAY_HOLD_MS);
    await flushPromises();
    expect(hold.heldOperations.value.has(activeOperation.id)).toBe(false);
    expect(schedulePostTerminalReload).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('keeps the hold pinned until the settle delay elapses, even after a later terminal operation-change event', async () => {
    const activeOperation = makeOperation({ id: 'op-race' });
    const containers = ref([
      makeContainer({
        updateOperation: activeOperation,
      }),
    ]);
    const hold = useOperationDisplayHold();
    hold.holdOperationDisplay({
      operationId: activeOperation.id,
      operation: activeOperation,
      containerId: 'c1',
      containerName: 'nginx',
    });
    const { wrapper } = mountPipeline({ containers });

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-applied', {
        detail: {
          operationId: activeOperation.id,
          containerId: 'c1',
          containerName: 'nginx',
          batchId: null,
          timestamp: '2026-05-02T12:01:00.000Z',
        },
      }),
    );
    await flushPromises();

    await vi.advanceTimersByTimeAsync(500);
    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-operation-changed', {
        detail: {
          operationId: activeOperation.id,
          containerId: 'c1',
          containerName: 'nginx',
          status: 'succeeded',
          phase: 'succeeded',
        },
      }),
    );
    await flushPromises();

    await vi.advanceTimersByTimeAsync(OPERATION_DISPLAY_HOLD_MS - 500);
    expect(hold.heldOperations.value.has(activeOperation.id)).toBe(true);

    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();

    expect(hold.heldOperations.value.has(activeOperation.id)).toBe(false);

    wrapper.unmount();
  });

  it('ignores malformed update-applied and update-failed lifecycle details', async () => {
    const containers = ref([makeContainer()]);
    const { wrapper, schedulePostTerminalReload } = mountPipeline({ containers });

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-applied', {
        detail: 'not-an-object',
      }),
    );
    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-failed', {
        detail: 'not-an-object',
      }),
    );
    await flushPromises();
    await vi.advanceTimersByTimeAsync(OPERATION_DISPLAY_HOLD_MS);

    expect(schedulePostTerminalReload).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it('releases multiple matching holds when one lifecycle event resolves them all', async () => {
    const oldOperation = makeOperation({ id: 'op-old' });
    const newOperation = makeOperation({ id: 'op-new' });
    const containers = ref([
      makeContainer({
        id: 'old-c1',
        name: 'nginx-old',
        updateOperation: oldOperation,
      }),
      makeContainer({
        id: 'new-c1',
        name: 'nginx-new',
        updateOperation: newOperation,
      }),
    ]);
    const hold = useOperationDisplayHold();
    hold.holdOperationDisplay({
      operationId: oldOperation.id,
      operation: oldOperation,
      containerId: 'old-c1',
      containerName: 'nginx-old',
    });
    hold.holdOperationDisplay({
      operationId: newOperation.id,
      operation: newOperation,
      containerId: 'new-c1',
      containerName: 'nginx-new',
    });
    const { wrapper } = mountPipeline({ containers });

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-applied', {
        detail: {
          operationId: 'op-terminal-not-held',
          containerId: 'old-c1',
          newContainerId: 'new-c1',
          containerName: 'nginx',
          batchId: null,
          timestamp: '2026-05-02T12:01:00.000Z',
        },
      }),
    );
    await flushPromises();

    await vi.advanceTimersByTimeAsync(OPERATION_DISPLAY_HOLD_MS);
    await flushPromises();

    expect(hold.heldOperations.value.has(oldOperation.id)).toBe(false);
    expect(hold.heldOperations.value.has(newOperation.id)).toBe(false);

    wrapper.unmount();
  });

  it('updates index entries after removing a leading row', async () => {
    const containers = ref([
      makeContainer({ id: 'c1', name: 'one' }),
      makeContainer({ id: 'c2', name: 'two' }),
      makeContainer({ id: 'c3', name: 'three' }),
    ]);
    const { wrapper } = mountPipeline({ containers });

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-container-removed', {
        detail: { id: 'c3', name: 'three' },
      }),
    );
    await flushPromises();

    expect(containers.value.map((container) => container.id)).toEqual(['c1', 'c2']);

    mockMapApiContainer.mockReturnValueOnce(
      makeContainer({ id: 'c2', name: 'two', currentTag: '2.0.0' }),
    );
    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-container-updated', {
        detail: { id: 'c2', name: 'two' },
      }),
    );
    await flushPromises();

    expect(containers.value.map((container) => container.currentTag)).toEqual(['1.0.0', '2.0.0']);

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-container-removed', {
        detail: { id: 'c1', name: 'one' },
      }),
    );
    await flushPromises();

    expect(containers.value.map((container) => container.id)).toEqual(['c2']);

    mockMapApiContainer.mockReturnValueOnce(
      makeContainer({ id: 'c2', name: 'two', currentTag: '2.1.0' }),
    );
    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-container-updated', {
        detail: { id: 'c2', name: 'two' },
      }),
    );
    await flushPromises();

    expect(containers.value).toHaveLength(1);
    expect(containers.value[0]!.currentTag).toBe('2.1.0');

    wrapper.unmount();
  });

  it('updates index entries after removing before an idless row', async () => {
    const containers = ref([
      makeContainer({ id: 'c1', name: 'one' }),
      makeContainer({ id: '', name: 'idless' }),
      makeContainer({ id: 'c3', name: 'three' }),
    ]);
    const { wrapper } = mountPipeline({ containers });

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-container-removed', {
        detail: { id: 'c1', name: 'one' },
      }),
    );
    await flushPromises();

    expect(containers.value.map((container) => container.id)).toEqual(['', 'c3']);

    mockMapApiContainer.mockReturnValueOnce(
      makeContainer({ id: 'c3', name: 'three', currentTag: '3.1.0' }),
    );
    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-container-updated', {
        detail: { id: 'c3', name: 'three' },
      }),
    );
    await flushPromises();

    expect(containers.value).toHaveLength(2);
    expect(containers.value[1]!.currentTag).toBe('3.1.0');

    wrapper.unmount();
  });

  it('ignores removal events that only name an unmapped container', async () => {
    const containers = ref([makeContainer({ id: 'c1', name: 'one' })]);
    const { wrapper } = mountPipeline({ containers });

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-container-removed', {
        detail: { name: 'not-indexed' },
      }),
    );
    await flushPromises();

    expect(containers.value.map((container) => container.id)).toEqual(['c1']);

    wrapper.unmount();
  });

  it('resolves name-only patches through the lookup map', async () => {
    const containers = ref([makeContainer({ id: 'c1', name: 'nginx', currentTag: '1.0.0' })]);
    const { wrapper } = mountPipeline({ containers });
    mockMapApiContainer.mockReturnValueOnce(
      makeContainer({ id: 'c1', name: 'nginx', currentTag: '1.1.0' }),
    );

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-container-updated', {
        detail: { name: 'nginx' },
      }),
    );
    await flushPromises();

    expect(containers.value).toHaveLength(1);
    expect(containers.value[0]!.currentTag).toBe('1.1.0');

    wrapper.unmount();
  });

  it('does not index a mapped container with an empty id', async () => {
    const containers = ref<Container[]>([]);
    const { wrapper, pipeline } = mountPipeline({ containers });
    mockMapApiContainer.mockReturnValueOnce(makeContainer({ id: '', name: 'idless' }));

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-container-added', {
        detail: { id: 'raw-idless', name: 'idless' },
      }),
    );
    await flushPromises();

    expect(containers.value).toHaveLength(1);
    expect(containers.value[0]!.id).toBe('');
    expect(pipeline.hasPendingOperationWatcher('')).toBe(true);

    wrapper.unmount();
  });

  it('cleans up an empty-id deferred watcher when no index can be resolved', async () => {
    const containers = ref<Container[]>([]);
    const operationStore = useOperationStore();
    const { wrapper, pipeline } = mountPipeline({ containers });
    mockMapApiContainer.mockReturnValueOnce(
      makeContainer({ id: '', name: undefined, updateOperation: undefined }),
    );

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-container-added', {
        detail: { id: 'raw-empty-id', name: 'raw-empty-name' },
      }),
    );
    await flushPromises();

    expect(pipeline.hasPendingOperationWatcher('')).toBe(true);

    const getOperationByContainerId = operationStore.getOperationByContainerId.bind(operationStore);
    const getOperationSpy = vi
      .spyOn(operationStore, 'getOperationByContainerId')
      .mockImplementation((containerId: string) =>
        containerId === ''
          ? {
              operationId: 'op-empty-id',
              containerId: '',
              status: 'in-progress',
              phase: 'pulling',
            }
          : getOperationByContainerId(containerId),
      );

    operationStore.applyOperationChanged({
      operationId: 'op-trigger',
      containerId: 'trigger-c1',
      containerName: 'trigger',
      status: 'in-progress',
      phase: 'pulling',
    });
    await flushPromises();

    expect(pipeline.hasPendingOperationWatcher('')).toBe(false);
    getOperationSpy.mockRestore();
    wrapper.unmount();
  });

  it('indexes display names and falls back to name when displayName is blank', async () => {
    const containers = ref<Container[]>([]);
    const { wrapper, containerIdMap } = mountPipeline({ containers });
    mockMapApiContainer
      .mockReturnValueOnce(makeContainer({ id: 'display-c1', name: 'display-row' }))
      .mockReturnValueOnce(makeContainer({ id: 'fallback-c1', name: 'fallback-row' }));

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-container-added', {
        detail: { id: 'display-c1', name: 'raw-name', displayName: 'Display Name' },
      }),
    );
    await flushPromises();

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-container-added', {
        detail: { id: 'fallback-c1', name: 'fallback-name', displayName: '   ' },
      }),
    );
    await flushPromises();

    expect(containerIdMap.value['Display Name']).toBe('display-c1');
    expect(containerIdMap.value['fallback-name']).toBe('fallback-c1');

    wrapper.unmount();
  });

  it('replaces an existing deferred watcher and clears its timer', async () => {
    const containers = ref<Container[]>([]);
    const { wrapper, pipeline } = mountPipeline({ containers });
    mockMapApiContainer
      .mockReturnValueOnce(makeContainer({ id: 'canonical-pending-c2', name: 'pending' }))
      .mockReturnValueOnce(makeContainer({ id: 'canonical-pending-c2', name: 'pending' }));

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-container-added', {
        detail: { id: 'runtime-pending-c2', name: 'pending' },
      }),
    );
    await flushPromises();

    expect(pipeline.hasPendingOperationWatcher('canonical-pending-c2')).toBe(true);

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-container-added', {
        detail: { id: 'runtime-pending-c2', name: 'pending' },
      }),
    );
    await flushPromises();

    expect(containers.value).toHaveLength(2);
    expect(pipeline.hasPendingOperationWatcher('canonical-pending-c2')).toBe(true);

    wrapper.unmount();
  });

  it('replaces an existing deferred watcher when its timer entry is absent', async () => {
    const containers = ref<Container[]>([]);
    const { wrapper } = mountPipeline({ containers });
    mockMapApiContainer
      .mockReturnValueOnce(makeContainer({ id: 'canonical-pending-c1', name: 'pending' }))
      .mockReturnValueOnce(makeContainer({ id: 'canonical-pending-c1', name: 'pending' }));
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(() => undefined as any);

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-container-added', {
        detail: { id: 'runtime-pending-c1', name: 'pending' },
      }),
    );
    setTimeoutSpy.mockRestore();
    await flushPromises();

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-container-added', {
        detail: { id: 'runtime-pending-c1', name: 'pending' },
      }),
    );
    await flushPromises();

    expect(containers.value).toHaveLength(2);

    wrapper.unmount();
  });

  it('attaches a delayed operation and clears the deferred watcher timer', async () => {
    const containers = ref<Container[]>([]);
    const operationStore = useOperationStore();
    const { wrapper, pipeline } = mountPipeline({ containers });
    mockMapApiContainer.mockReturnValueOnce(
      makeContainer({ id: 'pending-delayed-op', name: 'pending-delayed' }),
    );

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-container-added', {
        detail: { id: 'pending-delayed-op', name: 'pending-delayed' },
      }),
    );
    await flushPromises();

    expect(pipeline.hasPendingOperationWatcher('pending-delayed-op')).toBe(true);

    operationStore.applyOperationChanged({
      operationId: 'op-delayed',
      containerId: 'pending-delayed-op',
      containerName: 'pending-delayed',
      batchId: 'batch-delayed',
      queuePosition: 2,
      queueTotal: 5,
      status: 'in-progress',
      phase: 'pulling',
    });
    await flushPromises();

    expect(containers.value[0]!.updateOperation).toMatchObject({
      id: 'op-delayed',
      batchId: 'batch-delayed',
      queuePosition: 2,
      queueTotal: 5,
      status: 'in-progress',
      phase: 'pulling',
    });
    expect(pipeline.hasPendingOperationWatcher('pending-delayed-op')).toBe(false);

    wrapper.unmount();
  });

  it('cleans up a timerless deferred watcher without replacing an existing row operation', async () => {
    const containers = ref<Container[]>([]);
    const operationStore = useOperationStore();
    const { wrapper } = mountPipeline({ containers });
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(() => undefined as any);

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-container-added', {
        detail: makeContainer({ id: 'pending-existing-op', name: 'pending-existing' }),
      }),
    );
    setTimeoutSpy.mockRestore();
    await flushPromises();

    const existingOperation = makeOperation({ id: 'op-existing-row' });
    containers.value[0]!.updateOperation = existingOperation;
    operationStore.applyOperationChanged({
      operationId: 'op-delayed',
      containerId: 'pending-existing-op',
      containerName: 'pending-existing',
      status: 'in-progress',
      phase: 'pulling',
    });
    await flushPromises();

    expect(containers.value[0]!.updateOperation).toStrictEqual(existingOperation);

    wrapper.unmount();
  });

  it('schedules a post-terminal reload for non-batch update-applied events with no operationId', async () => {
    const containers = ref([makeContainer()]);
    const { wrapper, schedulePostTerminalReload } = mountPipeline({ containers });

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-applied', {
        detail: {
          containerId: 'c1',
          containerName: 'nginx',
          batchId: null,
          // operationId intentionally omitted
        },
      }),
    );
    await flushPromises();

    expect(schedulePostTerminalReload).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('schedules a post-terminal reload for update-applied events with batchId set', async () => {
    const containers = ref([makeContainer()]);
    const { wrapper, schedulePostTerminalReload } = mountPipeline({ containers });

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-applied', {
        detail: {
          containerId: 'c1',
          containerName: 'nginx',
          operationId: 'op-batch',
          batchId: 'batch-1',
        },
      }),
    );
    await flushPromises();

    expect(schedulePostTerminalReload).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('schedules a post-terminal reload on dd:sse-update-failed for non-batch events', async () => {
    const containers = ref([makeContainer()]);
    const { wrapper, schedulePostTerminalReload } = mountPipeline({ containers });

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-failed', {
        detail: {
          containerId: 'c1',
          containerName: 'nginx',
          operationId: 'op-fail',
          error: 'docker pull failed',
          batchId: null,
        },
      }),
    );
    await flushPromises();

    expect(schedulePostTerminalReload).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('ignores dd:sse-update-applied with no detail', async () => {
    const containers = ref([makeContainer()]);
    const { wrapper, schedulePostTerminalReload } = mountPipeline({ containers });

    globalThis.dispatchEvent(new Event('dd:sse-update-applied'));
    await flushPromises();

    expect(schedulePostTerminalReload).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it('ignores dd:sse-update-failed with no detail', async () => {
    const containers = ref([makeContainer()]);
    const { wrapper, schedulePostTerminalReload } = mountPipeline({ containers });

    globalThis.dispatchEvent(new Event('dd:sse-update-failed'));
    await flushPromises();

    expect(schedulePostTerminalReload).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it('records lastUpdateFailureReason on rolled-back terminal events that are not cancellations', async () => {
    const containers = ref([
      makeContainer({
        lastUpdateFailureReason: undefined,
        lastUpdateFailureAt: undefined,
      } as Partial<Container>),
    ]);
    const { wrapper } = mountPipeline({ containers });

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-failed', {
        detail: {
          containerId: 'c1',
          containerName: 'nginx',
          operationId: 'op-rb',
          error: 'health-check failed',
          rollbackReason: 'health-check',
          batchId: null,
        },
      }),
    );
    await flushPromises();

    expect((containers.value[0] as Container).lastUpdateFailureReason).toBeDefined();
    expect((containers.value[0] as Container).lastUpdateFailureAt).toEqual(expect.any(Number));

    wrapper.unmount();
  });

  it('does not record lastUpdateFailureReason when the operation was cancelled', async () => {
    const containers = ref([
      makeContainer({
        lastUpdateFailureReason: undefined,
        lastUpdateFailureAt: undefined,
      } as Partial<Container>),
    ]);
    const { wrapper } = mountPipeline({ containers });

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-failed', {
        detail: {
          containerId: 'c1',
          containerName: 'nginx',
          operationId: 'op-cancel',
          error: 'Cancelled by operator',
          rollbackReason: 'cancelled',
          batchId: null,
        },
      }),
    );
    await flushPromises();

    expect((containers.value[0] as Container).lastUpdateFailureReason).toBeUndefined();
    expect((containers.value[0] as Container).lastUpdateFailureAt).toBeUndefined();

    wrapper.unmount();
  });

  it('resolves the target container by newContainerId when containerId is absent', async () => {
    const containers = ref([makeContainer({ id: 'c-new' })]);
    const { wrapper, schedulePostTerminalReload } = mountPipeline({ containers });

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-applied', {
        detail: {
          newContainerId: 'c-new',
          containerName: 'nginx',
          operationId: 'op-new-id',
          batchId: null,
        },
      }),
    );
    await flushPromises();

    expect(schedulePostTerminalReload).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('resolves the target container by containerName when no ids are present', async () => {
    const containers = ref([makeContainer({ id: 'c-rename', name: 'redis' })]);
    const { wrapper, schedulePostTerminalReload } = mountPipeline({ containers });

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-applied', {
        detail: {
          containerName: 'redis',
          operationId: 'op-name-only',
          batchId: null,
        },
      }),
    );
    await flushPromises();

    expect(schedulePostTerminalReload).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('falls through to name lookup when newContainerId is a string not in the index', async () => {
    // Line 391 falsy branch: target.newContainerId is a string but
    // containerIndexById.get(newContainerId) returns undefined, so the early-
    // return is skipped and findContainerForOperationTarget falls through to
    // the linear name scan at line 397.
    const containers = ref([makeContainer({ id: 'c-name-fallback', name: 'myapp' })]);
    const { wrapper, schedulePostTerminalReload } = mountPipeline({ containers });

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-applied', {
        detail: {
          // containerId absent so the first branch (line 385) is skipped.
          // newContainerId is a string but not in the index.
          newContainerId: 'unknown-new-id',
          containerName: 'myapp',
          operationId: 'op-name-fb',
          batchId: null,
        },
      }),
    );
    await flushPromises();

    // The container was resolved by name (line 399), so the terminal patch
    // applied successfully and schedulePostTerminalReload was called.
    expect(schedulePostTerminalReload).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });
});
