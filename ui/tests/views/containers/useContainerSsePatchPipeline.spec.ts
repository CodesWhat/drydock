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

function mountPipeline(args: { containers: Ref<Container[]>; toast?: Partial<ToastApi> }) {
  const toast: ToastApi = {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    ...args.toast,
  };
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
          toast,
          t: (key, params) => {
            if (key.endsWith('.updated')) {
              return `Updated: ${String(params?.name)}`;
            }
            if (key.endsWith('.updateFailed')) {
              return `Update failed: ${String(params?.name)}`;
            }
            return key;
          },
        });
        return {};
      },
      template: '<div />',
    }),
  );

  return { wrapper, toast, schedulePostTerminalReload, pipeline: pipeline!, containerIdMap };
}

type ToastApi = {
  error: (title: string) => void;
  success: (title: string) => void;
  warning: (title: string) => void;
};

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

  it('releases the display hold before firing the applied toast when the terminal operation-change event is missed', async () => {
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
    const { wrapper, toast, schedulePostTerminalReload } = mountPipeline({ containers });

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
    expect(toast.success).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(OPERATION_DISPLAY_HOLD_MS);
    await flushPromises();

    expect(hold.heldOperations.value.has(activeOperation.id)).toBe(false);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('Updated: nginx');
    expect(schedulePostTerminalReload).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('does not let a later terminal operation-change event move the toast ahead of the row release', async () => {
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
    const { wrapper, toast } = mountPipeline({ containers });

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
    expect(toast.success).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();

    expect(hold.heldOperations.value.has(activeOperation.id)).toBe(false);
    expect(toast.success).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('ignores malformed update-applied and update-failed lifecycle details', async () => {
    const containers = ref([makeContainer()]);
    const { wrapper, toast, schedulePostTerminalReload } = mountPipeline({ containers });

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

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(schedulePostTerminalReload).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it('fires a completion toast once when one lifecycle event releases multiple matching holds', async () => {
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
    const { wrapper, toast } = mountPipeline({ containers });

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

    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('Updated: nginx');
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
      status: 'in-progress',
      phase: 'pulling',
    });
    await flushPromises();

    expect(containers.value[0]!.updateOperation).toMatchObject({
      id: 'op-delayed',
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
});
