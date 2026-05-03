import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import type { Container } from '@/types/container';
import { useDashboardData } from '@/views/dashboard/useDashboardData';

const mocks = vi.hoisted(() => {
  // Shared controller instance so tests can access it after mount
  let summaryController: {
    pause: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    isPaused: ReturnType<typeof vi.fn>;
  } | null = null;

  const connectStatsSummaryStream = vi.fn((_handlers?: unknown) => {
    summaryController = {
      pause: vi.fn(),
      resume: vi.fn(),
      disconnect: vi.fn(),
      isPaused: vi.fn().mockReturnValue(false),
    };
    return summaryController;
  });

  return {
    getAgents: vi.fn(),
    getAllContainers: vi.fn(),
    getContainerRecentStatus: vi.fn(),
    getContainerSummary: vi.fn(),
    getAllRegistries: vi.fn(),
    getAllWatchers: vi.fn(),
    getServer: vi.fn(),
    getStatsSummary: vi.fn(),
    connectStatsSummaryStream,
    getSummaryController: () => summaryController,
    mapApiContainers: vi.fn(),
    mapApiContainer: vi.fn(),
  };
});

vi.mock('@/services/agent', () => ({
  getAgents: mocks.getAgents,
}));

vi.mock('@/services/container', () => ({
  getAllContainers: mocks.getAllContainers,
  getContainerRecentStatus: mocks.getContainerRecentStatus,
  getContainerSummary: mocks.getContainerSummary,
}));

vi.mock('@/services/stats', () => ({
  getStatsSummary: mocks.getStatsSummary,
  connectStatsSummaryStream: mocks.connectStatsSummaryStream,
}));

vi.mock('@/services/registry', () => ({
  getAllRegistries: mocks.getAllRegistries,
}));

vi.mock('@/services/server', () => ({
  getServer: mocks.getServer,
}));

vi.mock('@/services/watcher', () => ({
  getAllWatchers: mocks.getAllWatchers,
}));

vi.mock('@/utils/container-mapper', () => ({
  mapApiContainers: mocks.mapApiContainers,
  mapApiContainer: mocks.mapApiContainer,
}));

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'c1',
    identityKey: '::local::nginx',
    name: 'nginx',
    image: 'nginx:latest',
    icon: 'docker',
    currentTag: '1.0.0',
    newTag: null,
    status: 'running',
    registry: 'dockerhub',
    updateKind: null,
    updateMaturity: null,
    bouncer: 'safe',
    server: 'Local',
    details: { ports: [], volumes: [], env: [], labels: [] },
    ...overrides,
  };
}

const mountedWrappers: VueWrapper[] = [];

async function mountDashboardData() {
  let state: ReturnType<typeof useDashboardData> | undefined;
  const Harness = defineComponent({
    setup() {
      state = useDashboardData();
      return () => h('div');
    },
  });

  const wrapper = mount(Harness);
  mountedWrappers.push(wrapper);
  await flushPromises();

  if (!state) {
    throw new Error('Dashboard data composable did not initialize');
  }

  return { state, wrapper };
}

describe('useDashboardData', () => {
  let originalVisibilityState: PropertyDescriptor | undefined;

  const setVisibilityState = (state: DocumentVisibilityState) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => state,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  };

  beforeEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();

    mocks.getAllContainers.mockResolvedValue([{ id: 'api-c1' }]);
    mocks.getStatsSummary.mockResolvedValue({
      timestamp: '2026-04-30T00:00:00.000Z',
      watchedCount: 0,
      avgCpuPercent: 0,
      totalMemoryUsageBytes: 0,
      totalMemoryLimitBytes: 0,
      totalMemoryPercent: 0,
      topCpu: [],
      topMemory: [],
    });
    // Re-initialize the connectStatsSummaryStream mock each time (reset wipes it)
    mocks.connectStatsSummaryStream.mockImplementation((_handlers?: unknown) => ({
      pause: vi.fn(),
      resume: vi.fn(),
      disconnect: vi.fn(),
      isPaused: vi.fn().mockReturnValue(false),
    }));
    mocks.getServer.mockResolvedValue({ configuration: { webhook: { enabled: true } } });
    mocks.getAgents.mockResolvedValue([{ name: 'agent-1', connected: true }]);
    mocks.getAllWatchers.mockResolvedValue([]);
    mocks.getAllRegistries.mockResolvedValue([{ name: 'hub' }]);
    mocks.getContainerSummary.mockResolvedValue({
      containers: { total: 0, running: 0, stopped: 0 },
      security: { issues: 0 },
    });
    mocks.getContainerRecentStatus.mockResolvedValue({ statuses: {}, statusesByIdentity: {} });
    mocks.mapApiContainers.mockReturnValue([makeContainer()]);
    mocks.mapApiContainer.mockImplementation((raw: Record<string, unknown>) =>
      makeContainer({
        id: typeof raw.id === 'string' ? raw.id : 'c1',
        name: typeof raw.name === 'string' ? raw.name : 'nginx',
        status: raw.status === 'running' ? 'running' : 'stopped',
      }),
    );

    originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    setVisibilityState('visible');
  });

  afterEach(() => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
    if (originalVisibilityState) {
      Object.defineProperty(document, 'visibilityState', originalVisibilityState);
    } else {
      Reflect.deleteProperty(document, 'visibilityState');
    }
    vi.useRealTimers();
  });

  it('loads dashboard data, maps recent statuses, and manages maintenance timer', async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');

    mocks.getAllWatchers.mockResolvedValue([
      { configuration: { maintenanceWindow: 'Sun 02:00-03:00 UTC' } },
      { config: { maintenancewindow: 'Mon 01:00-02:00 UTC' } },
      { configuration: { maintenanceWindow: '   ' } },
      null,
    ]);
    mocks.getContainerRecentStatus.mockResolvedValue({
      statuses: {
        api: 'failed',
        worker: 'updated',
        cache: 'pending',
        ignored: 'nope',
        '': 'failed',
      },
      statusesByIdentity: {
        '::local::cache': 'pending',
        'edge-a::docker-prod::api': 'failed',
        'edge-b::docker-prod::worker': 'updated',
        invalid: 'nope',
        '': 'failed',
      },
    });

    const { state, wrapper } = await mountDashboardData();

    expect(state.loading.value).toBe(false);
    expect(state.error.value).toBeNull();
    expect(state.containers.value).toEqual([makeContainer()]);
    expect(state.serverInfo.value).toEqual({ configuration: { webhook: { enabled: true } } });
    expect(state.agents.value).toEqual([{ name: 'agent-1', connected: true }]);
    expect(state.watchers.value).toHaveLength(4);
    expect(state.registries.value).toEqual([{ name: 'hub' }]);
    expect(state.recentStatusByContainer.value).toEqual({
      api: 'failed',
      cache: 'pending',
      worker: 'updated',
    });
    expect(state.recentStatusByIdentity.value).toEqual({
      '::local::cache': 'pending',
      'edge-a::docker-prod::api': 'failed',
      'edge-b::docker-prod::worker': 'updated',
    });

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);
    const beforeTick = state.maintenanceCountdownNow.value;
    vi.advanceTimersByTime(30_000);
    expect(state.maintenanceCountdownNow.value).toBeGreaterThanOrEqual(beforeTick);

    wrapper.unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('normalizes malformed watcher/registry/status responses', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    mocks.getAllWatchers.mockResolvedValue(['not-an-object']);
    mocks.getAllRegistries.mockResolvedValue({ data: [] });
    mocks.getContainerRecentStatus.mockResolvedValue(null);

    const { state } = await mountDashboardData();

    expect(state.watchers.value).toEqual(['not-an-object']);
    expect(state.registries.value).toEqual([]);
    expect(state.recentStatusByContainer.value).toEqual({});
    expect(state.recentStatusByIdentity.value).toEqual({});
    expect(setIntervalSpy).not.toHaveBeenCalled();

    mocks.getAllWatchers.mockResolvedValueOnce({ data: [] });
    mocks.getContainerRecentStatus.mockResolvedValueOnce({ statuses: [], statusesByIdentity: [] });
    await state.fetchDashboardData();

    expect(state.watchers.value).toEqual([]);
    expect(state.recentStatusByContainer.value).toEqual({});
    expect(state.recentStatusByIdentity.value).toEqual({});
  });

  it('registers granular container SSE listeners and patches state in-place without a full refetch', async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    mocks.getAllWatchers.mockResolvedValue([{ id: 'watcher-without-config' }]);
    mocks.mapApiContainers.mockReturnValue([
      makeContainer({ id: 'c1', name: 'nginx', status: 'running' }),
    ]);

    const { state } = await mountDashboardData();

    // All three granular events must be wired (they were added at mount time)
    expect(state.containers.value[0]?.id).toBe('c1');

    // Reset call counts from initial mount fetch
    mocks.getAllContainers.mockClear();

    // Dispatch a well-formed container-updated event — should patch in-place, no HTTP
    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-container-added', {
        detail: {
          id: 'c2',
          name: 'redis',
          image: 'redis:latest',
          status: 'running',
          watcher: 'local',
        },
      }),
    );
    await nextTick();

    // No full refetch fired
    expect(mocks.getAllContainers).not.toHaveBeenCalled();
    expect(state.error.value).toBeNull();
    expect(setIntervalSpy).not.toHaveBeenCalled();

    // A malformed granular event (no id/name) falls back to full debounced refresh
    mocks.getAllContainers.mockClear();
    globalThis.dispatchEvent(new CustomEvent('dd:sse-container-updated', { detail: {} }));
    globalThis.dispatchEvent(new CustomEvent('dd:sse-container-updated', { detail: {} }));
    vi.advanceTimersByTime(1_000);
    await flushPromises();

    // Two malformed events were debounced into one full refresh
    expect(mocks.getAllContainers).toHaveBeenCalledTimes(1);
  });

  it('patches queued/in-progress dashboard operation state without fetch fan-out', async () => {
    vi.useFakeTimers();

    mocks.mapApiContainers.mockReturnValue([makeContainer({ id: 'c1' })]);
    const { state } = await mountDashboardData();
    mocks.getAllContainers.mockClear();

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-operation-changed', {
        detail: {
          operationId: 'op-1',
          containerId: 'c1',
          status: 'queued',
          phase: 'queued',
        },
      }),
    );
    await nextTick();

    expect(state.containers.value[0]?.updateOperation).toMatchObject({
      id: 'op-1',
      status: 'queued',
      phase: 'queued',
    });

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-operation-changed', {
        detail: {
          operationId: 'op-1',
          containerId: 'c1',
          status: 'in-progress',
          phase: 'pulling',
        },
      }),
    );
    await nextTick();

    expect(state.containers.value[0]?.updateOperation).toMatchObject({
      id: 'op-1',
      status: 'in-progress',
      phase: 'pulling',
    });

    expect(mocks.getAllContainers).not.toHaveBeenCalled();
    expect(state.error.value).toBeNull();
  });

  it('triggers fetchDashboardData on dd:sse-connected to resolve staleness after reconnect', async () => {
    vi.useFakeTimers();

    await mountDashboardData();
    mocks.getAllContainers.mockClear();

    globalThis.dispatchEvent(new CustomEvent('dd:sse-connected'));
    vi.advanceTimersByTime(1_000);
    await flushPromises();

    expect(mocks.getAllContainers).toHaveBeenCalledTimes(1);
  });

  it('triggers fetchDashboardData on dd:sse-resync-required to recover missed state', async () => {
    vi.useFakeTimers();

    await mountDashboardData();
    mocks.getAllContainers.mockClear();

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-resync-required', { detail: { reason: 'boot-mismatch' } }),
    );
    vi.advanceTimersByTime(1_000);
    await flushPromises();

    expect(mocks.getAllContainers).toHaveBeenCalledTimes(1);
  });

  it('removes container, operation, connected, and resync listeners on unmount (symmetric with add)', async () => {
    const addSpy = vi.spyOn(globalThis, 'addEventListener');
    const removeSpy = vi.spyOn(globalThis, 'removeEventListener');

    const { wrapper } = await mountDashboardData();

    const addedEvents = addSpy.mock.calls.map((c) => c[0]);
    expect(addedEvents).toContain('dd:sse-container-added');
    expect(addedEvents).toContain('dd:sse-container-updated');
    expect(addedEvents).toContain('dd:sse-container-removed');
    expect(addedEvents).toContain('dd:sse-update-operation-changed');
    expect(addedEvents).toContain('dd:sse-connected');
    expect(addedEvents).toContain('dd:sse-resync-required');
    expect(addedEvents).not.toContain('dd:sse-container-changed');
    expect(addedEvents).not.toContain('dd:sse-scan-completed');

    wrapper.unmount();

    const removedEvents = removeSpy.mock.calls.map((c) => c[0]);
    expect(removedEvents).toContain('dd:sse-container-added');
    expect(removedEvents).toContain('dd:sse-container-updated');
    expect(removedEvents).toContain('dd:sse-container-removed');
    expect(removedEvents).toContain('dd:sse-update-operation-changed');
    expect(removedEvents).toContain('dd:sse-connected');
    expect(removedEvents).toContain('dd:sse-resync-required');
    expect(removedEvents).not.toContain('dd:sse-container-changed');
    expect(removedEvents).not.toContain('dd:sse-scan-completed');
  });

  it('sets error for a failed foreground fetch and clears loading', async () => {
    mocks.getAllContainers.mockRejectedValue(new Error('containers failed'));

    const { state } = await mountDashboardData();

    expect(state.loading.value).toBe(false);
    expect(state.error.value).toBe('containers failed');
  });

  it('debounces fallback-triggered refresh and logs background errors when prior data exists', async () => {
    vi.useFakeTimers();
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    mocks.mapApiContainers.mockReturnValue([makeContainer({ id: 'c-rendered' })]);

    const { state, wrapper } = await mountDashboardData();
    expect(state.error.value).toBeNull();
    expect(mocks.getAllContainers).toHaveBeenCalledTimes(1);

    mocks.getAllContainers.mockRejectedValueOnce(new Error('background refresh failed'));

    // Two rapid malformed granular events each trigger fallback → debouncer → clearTimeout fires on second
    globalThis.dispatchEvent(new CustomEvent('dd:sse-container-updated', { detail: {} }));
    const clearTimeoutCallsBeforeSecondEvent = clearTimeoutSpy.mock.calls.length;
    globalThis.dispatchEvent(new CustomEvent('dd:sse-container-updated', { detail: {} }));
    expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(clearTimeoutCallsBeforeSecondEvent);

    vi.advanceTimersByTime(999);
    await flushPromises();
    expect(mocks.getAllContainers).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await flushPromises();

    expect(mocks.getAllContainers).toHaveBeenCalledTimes(2);
    expect(state.error.value).toBeNull();
    expect(debugSpy).toHaveBeenCalledWith('background refresh failed');

    wrapper.unmount();
  });

  it('does NOT trigger fetchDashboardData on dd:sse-scan-completed events', async () => {
    vi.useFakeTimers();

    const { state } = await mountDashboardData();
    mocks.getAllContainers.mockClear();

    // scan-completed fires every watcher cron tick (~every 2 min). dd:sse-container-changed
    // already fires when scan finds new state, so scan-completed must NOT independently
    // trigger a dashboard refresh (would cause 14 fetches per cron tick).
    globalThis.dispatchEvent(new CustomEvent('dd:sse-scan-completed'));
    globalThis.dispatchEvent(new CustomEvent('dd:sse-scan-completed'));

    vi.advanceTimersByTime(5_000);
    await flushPromises();

    expect(mocks.getAllContainers).not.toHaveBeenCalled();
    expect(state.error.value).toBeNull();
  });

  it('logs full refresh failures when a malformed granular SSE event triggers the fallback path', async () => {
    vi.useFakeTimers();
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    await mountDashboardData();
    mocks.getAllContainers.mockRejectedValueOnce(new Error('background refresh failed'));

    // A malformed payload (no id/name) on a granular event invokes the fallback which schedules a full refresh
    globalThis.dispatchEvent(new CustomEvent('dd:sse-container-updated', { detail: {} }));
    vi.advanceTimersByTime(1_000);
    await flushPromises();

    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('background refresh failed'));
  });

  it('surfaces background errors when no data has rendered yet', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = useDashboardData();
    const failure = new Error('background bootstrap failed');
    mocks.getAllContainers.mockRejectedValueOnce(failure);
    mocks.getServer.mockRejectedValueOnce(failure);
    await state.fetchDashboardData({ background: true });

    expect(state.error.value).toBe('background bootstrap failed');
    expect(debugSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('treats registries as rendered data for background refresh error handling', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = useDashboardData();
    state.registries.value = [{ name: 'hub' }];
    const failure = new Error('background refresh failed');

    mocks.getAllContainers.mockRejectedValueOnce(failure);
    mocks.getServer.mockRejectedValueOnce(failure);
    await state.fetchDashboardData({ background: true });

    expect(state.error.value).toBeNull();
    expect(debugSpy).toHaveBeenCalledWith('background refresh failed');
    warnSpy.mockRestore();
  });

  it('surfaces full refresh errors when no dashboard data has rendered yet', async () => {
    vi.useFakeTimers();
    mocks.getAllContainers.mockRejectedValue(new Error('initial load failed'));

    const { state } = await mountDashboardData();

    globalThis.dispatchEvent(new CustomEvent('dd:sse-container-changed'));
    vi.advanceTimersByTime(1_000);
    await flushPromises();

    expect(state.error.value).toBe('initial load failed');
  });

  it('pauses timer while hidden, resumes when visible, and clears pending realtime timer on unmount', async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    mocks.getAllWatchers.mockResolvedValue([
      { configuration: { maintenanceWindow: 'Tue 00:00-01:00 UTC' } },
    ]);

    const { state, wrapper } = await mountDashboardData();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    const timerId = setIntervalSpy.mock.results[0]?.value;

    setVisibilityState('hidden');
    expect(clearIntervalSpy).toHaveBeenCalledWith(timerId);

    setVisibilityState('visible');
    expect(setIntervalSpy).toHaveBeenCalledTimes(2);

    document.dispatchEvent(new Event('visibilitychange'));
    expect(setIntervalSpy).toHaveBeenCalledTimes(2);

    const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    state.watchers.value = [];
    await nextTick();
    state.watchers.value = [{ config: { maintenancewindow: 'Fri 03:00-04:00 UTC' } }];
    await nextTick();

    if (originalDocumentDescriptor) {
      Object.defineProperty(globalThis, 'document', originalDocumentDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'document');
    }

    // Dispatch a malformed granular event to arm the debounce timer, then unmount to clear it
    globalThis.dispatchEvent(new CustomEvent('dd:sse-container-updated', { detail: {} }));
    wrapper.unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('ignores operation-patch events with null or non-object payload (line 157 guard)', async () => {
    mocks.mapApiContainers.mockReturnValue([makeContainer({ id: 'c1' })]);
    const { state } = await mountDashboardData();
    mocks.getAllContainers.mockClear();

    // null detail — payload is falsy, should return early without throwing
    globalThis.dispatchEvent(new CustomEvent('dd:sse-update-operation-changed', { detail: null }));
    await nextTick();
    expect(state.containers.value[0]?.updateOperation).toBeUndefined();

    // string detail — payload is not an object, should return early
    globalThis.dispatchEvent(new CustomEvent('dd:sse-update-operation-changed', { detail: 'bad' }));
    await nextTick();
    expect(state.containers.value[0]?.updateOperation).toBeUndefined();
    expect(mocks.getAllContainers).not.toHaveBeenCalled();
  });

  it('ignores operation-patch events with an invalid status value (line 163 guard)', async () => {
    mocks.mapApiContainers.mockReturnValue([makeContainer({ id: 'c1' })]);
    const { state } = await mountDashboardData();
    mocks.getAllContainers.mockClear();

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-operation-changed', {
        detail: { containerId: 'c1', status: 'not-a-valid-status' },
      }),
    );
    await nextTick();

    expect(state.containers.value[0]?.updateOperation).toBeUndefined();
    expect(mocks.getAllContainers).not.toHaveBeenCalled();
  });

  it('ignores operation-patch events when no container matches (line 173 guard)', async () => {
    mocks.mapApiContainers.mockReturnValue([makeContainer({ id: 'c1' })]);
    const { state } = await mountDashboardData();
    mocks.getAllContainers.mockClear();

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-operation-changed', {
        detail: { containerId: 'no-such-container', status: 'queued', phase: 'queued' },
      }),
    );
    await nextTick();

    expect(state.containers.value[0]?.updateOperation).toBeUndefined();
    expect(mocks.getAllContainers).not.toHaveBeenCalled();
  });

  it('clears updateOperation on terminal status patch (line 192 — succeeded/failed/rolled-back)', async () => {
    mocks.mapApiContainers.mockReturnValue([makeContainer({ id: 'c1' })]);
    const { state } = await mountDashboardData();

    // First set an active operation so there is something to clear
    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-operation-changed', {
        detail: { operationId: 'op-1', containerId: 'c1', status: 'in-progress', phase: 'pulling' },
      }),
    );
    await nextTick();
    expect(state.containers.value[0]?.updateOperation).toBeDefined();

    // Now a terminal status should clear it
    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-operation-changed', {
        detail: { operationId: 'op-1', containerId: 'c1', status: 'succeeded' },
      }),
    );
    await nextTick();
    expect(state.containers.value[0]?.updateOperation).toBeUndefined();
  });

  it('finds container by newContainerId when containerId does not match', async () => {
    mocks.mapApiContainers.mockReturnValue([makeContainer({ id: 'c-new', name: 'nginx' })]);
    const { state } = await mountDashboardData();

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-operation-changed', {
        detail: {
          operationId: 'op-2',
          newContainerId: 'c-new',
          status: 'in-progress',
          phase: 'pulling',
        },
      }),
    );
    await nextTick();

    expect(state.containers.value[0]?.updateOperation).toMatchObject({
      id: 'op-2',
      status: 'in-progress',
      phase: 'pulling',
    });
  });

  it('finds container by containerName when neither id field matches', async () => {
    mocks.mapApiContainers.mockReturnValue([makeContainer({ id: 'c1', name: 'my-app' })]);
    const { state } = await mountDashboardData();

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-operation-changed', {
        detail: { operationId: 'op-3', containerName: 'my-app', status: 'queued', phase: 'queued' },
      }),
    );
    await nextTick();

    expect(state.containers.value[0]?.updateOperation).toMatchObject({
      status: 'queued',
      phase: 'queued',
    });
  });

  it('falls back to previousPhase when incoming phase is invalid for the status (lines 145-149)', async () => {
    mocks.mapApiContainers.mockReturnValue([makeContainer({ id: 'c1' })]);
    const { state } = await mountDashboardData();

    // Establish a valid in-progress operation with phase 'pulling'
    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-operation-changed', {
        detail: { operationId: 'op-1', containerId: 'c1', status: 'in-progress', phase: 'pulling' },
      }),
    );
    await nextTick();
    expect(state.containers.value[0]?.updateOperation?.phase).toBe('pulling');

    // Send in-progress with an invalid phase for in-progress ('queued' is only valid for 'queued' status)
    // previousPhase is 'pulling' which IS valid for in-progress → should fall back to 'pulling'
    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-operation-changed', {
        detail: { operationId: 'op-1', containerId: 'c1', status: 'in-progress', phase: 'queued' },
      }),
    );
    await nextTick();

    expect(state.containers.value[0]?.updateOperation?.phase).toBe('pulling');
  });

  it('uses row.updateOperation.id when operationId in payload is not a string (line 180 branch)', async () => {
    mocks.mapApiContainers.mockReturnValue([makeContainer({ id: 'c1' })]);
    const { state } = await mountDashboardData();

    // Establish existing operation with a known id
    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-operation-changed', {
        detail: {
          operationId: 'existing-op',
          containerId: 'c1',
          status: 'queued',
          phase: 'queued',
        },
      }),
    );
    await nextTick();
    expect(state.containers.value[0]?.updateOperation?.id).toBe('existing-op');

    // Send patch with non-string operationId — should retain existing id
    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-operation-changed', {
        detail: { operationId: 42, containerId: 'c1', status: 'queued', phase: 'queued' },
      }),
    );
    await nextTick();
    expect(state.containers.value[0]?.updateOperation?.id).toBe('existing-op');

    // Also test: non-string operationId with no prior updateOperation → id defaults to ''
    mocks.mapApiContainers.mockReturnValue([makeContainer({ id: 'c2' })]);
    await state.fetchDashboardData();
    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-operation-changed', {
        detail: { operationId: null, containerId: 'c2', status: 'queued', phase: 'queued' },
      }),
    );
    await nextTick();
    expect(state.containers.value[0]?.updateOperation?.id).toBe('');
  });

  it('defaults phase to queued/pulling when both phase and previousPhase are invalid (line 151)', async () => {
    mocks.mapApiContainers.mockReturnValue([makeContainer({ id: 'c1' })]);
    const { state } = await mountDashboardData();

    // No prior updateOperation — previousPhase is undefined. Phase is also invalid.
    // status 'queued' + invalid phase → default 'queued'
    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-operation-changed', {
        detail: {
          operationId: 'op-1',
          containerId: 'c1',
          status: 'queued',
          phase: 'invalid-phase',
        },
      }),
    );
    await nextTick();
    expect(state.containers.value[0]?.updateOperation?.phase).toBe('queued');

    // Clear it
    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-operation-changed', {
        detail: { containerId: 'c1', status: 'succeeded' },
      }),
    );
    await nextTick();

    // status 'in-progress' + invalid phase and no valid previousPhase → default 'pulling'
    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-operation-changed', {
        detail: {
          operationId: 'op-2',
          containerId: 'c1',
          status: 'in-progress',
          phase: 'invalid-phase',
        },
      }),
    );
    await nextTick();
    expect(state.containers.value[0]?.updateOperation?.phase).toBe('pulling');
  });

  it('applyDashboardContainerPatch: removes container and recomputes summary on dd:sse-container-removed', async () => {
    mocks.mapApiContainers.mockReturnValue([
      makeContainer({ id: 'c1', name: 'nginx', status: 'running' }),
      makeContainer({ id: 'c2', name: 'redis', status: 'running' }),
    ]);
    mocks.getContainerSummary.mockResolvedValue({
      containers: { total: 2, running: 2, stopped: 0 },
      security: { issues: 0 },
    });

    const { state } = await mountDashboardData();
    expect(state.containers.value).toHaveLength(2);

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-container-removed', {
        detail: { id: 'c1', name: 'nginx' },
      }),
    );
    await nextTick();

    expect(state.containers.value).toHaveLength(1);
    expect(state.containers.value[0]?.id).toBe('c2');
    // containerSummary is recomputed in-place (total drops to 1)
    expect(state.containerSummary.value?.containers.total).toBe(1);
  });

  it('applyDashboardContainerPatch: handles removed event for unknown container without error (idx === -1 branch)', async () => {
    mocks.mapApiContainers.mockReturnValue([makeContainer({ id: 'c1', name: 'nginx' })]);

    const { state } = await mountDashboardData();
    expect(state.containers.value).toHaveLength(1);
    mocks.getAllContainers.mockClear();

    // Container 'c99' does not exist in state — splice should not fire but summary recomputes
    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-container-removed', {
        detail: { id: 'c99', name: 'ghost' },
      }),
    );
    await nextTick();

    // Container list is unchanged; no full refetch; summary is still valid
    expect(state.containers.value).toHaveLength(1);
    expect(state.containers.value[0]?.id).toBe('c1');
    expect(mocks.getAllContainers).not.toHaveBeenCalled();
    expect(state.containerSummary.value?.containers.total).toBe(1);
  });

  it('applyDashboardContainerPatch: pushes new container on dd:sse-container-added when id is absent', async () => {
    mocks.mapApiContainers.mockReturnValue([
      makeContainer({ id: 'c1', name: 'nginx', status: 'running' }),
    ]);

    const { state } = await mountDashboardData();
    expect(state.containers.value).toHaveLength(1);
    mocks.getAllContainers.mockClear();

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-container-added', {
        detail: { id: 'c99', name: 'postgres', status: 'running', watcher: 'local' },
      }),
    );
    await nextTick();

    // Container pushed into state; no full refetch fired
    expect(state.containers.value).toHaveLength(2);
    expect(state.containers.value.some((c) => c.id === 'c99')).toBe(true);
    expect(mocks.getAllContainers).not.toHaveBeenCalled();
  });

  it('applyDashboardContainerPatch: merges fields via Object.assign on dd:sse-container-updated when container exists', async () => {
    mocks.mapApiContainers.mockReturnValue([
      makeContainer({ id: 'c1', name: 'nginx', status: 'running', currentTag: '1.0.0' }),
    ]);

    const { state } = await mountDashboardData();
    const originalRef = state.containers.value[0];
    mocks.getAllContainers.mockClear();

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-container-updated', {
        detail: { id: 'c1', name: 'nginx', status: 'stopped', watcher: 'local' },
      }),
    );
    await nextTick();

    // Still one container; same array slot (Object.assign mutated in place)
    expect(state.containers.value).toHaveLength(1);
    expect(state.containers.value[0]).toBe(originalRef);
    expect(state.containers.value[0]?.status).toBe('stopped');
    expect(mocks.getAllContainers).not.toHaveBeenCalled();
  });

  it('applyDashboardContainerPatch: calls fallback when detail is null or a non-object', async () => {
    vi.useFakeTimers();
    mocks.mapApiContainers.mockReturnValue([makeContainer({ id: 'c1' })]);

    const { state } = await mountDashboardData();
    mocks.getAllContainers.mockClear();

    // null detail on the added listener — must call fallback (schedules a debounced full refresh)
    globalThis.dispatchEvent(new CustomEvent('dd:sse-container-added', { detail: null }));
    vi.advanceTimersByTime(1_000);
    await flushPromises();
    expect(mocks.getAllContainers).toHaveBeenCalledTimes(1);

    mocks.getAllContainers.mockClear();

    // string detail on the updated listener — must also call fallback
    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-container-updated', { detail: 'not-an-object' }),
    );
    vi.advanceTimersByTime(1_000);
    await flushPromises();
    expect(mocks.getAllContainers).toHaveBeenCalledTimes(1);

    mocks.getAllContainers.mockClear();

    // null detail on the removed listener — exercises the containerRemovedListener fallback path
    globalThis.dispatchEvent(new CustomEvent('dd:sse-container-removed', { detail: null }));
    vi.advanceTimersByTime(1_000);
    await flushPromises();
    expect(mocks.getAllContainers).toHaveBeenCalledTimes(1);

    // State containers are unchanged (fallback scheduled refresh, not an in-place patch)
    expect(state.containers.value).toHaveLength(1);
  });

  it('applyDashboardContainerPatch: calls fallback when mapApiContainer throws on a valid-id payload', async () => {
    vi.useFakeTimers();
    mocks.mapApiContainers.mockReturnValue([makeContainer({ id: 'c1' })]);
    // Make mapApiContainer throw to exercise the catch { fallback(); return } path (lines 203-204)
    mocks.mapApiContainer.mockImplementationOnce(() => {
      throw new Error('mapper error');
    });

    const { state } = await mountDashboardData();
    mocks.getAllContainers.mockClear();

    // Detail has a valid id/name so the guard passes, but mapApiContainer throws → fallback
    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-container-added', {
        detail: { id: 'c99', name: 'broken' },
      }),
    );
    vi.advanceTimersByTime(1_000);
    await flushPromises();

    // Fallback triggered a full refresh instead of an in-place add
    expect(mocks.getAllContainers).toHaveBeenCalledTimes(1);
    expect(state.containers.value).toHaveLength(1);
    expect(state.containers.value[0]?.id).toBe('c1');
  });

  it('skips watchers/registries/agents/server on reconnect-driven refresh when within TTL', async () => {
    vi.useFakeTimers();

    // Mount — initial fetch calls all live+static endpoints
    await mountDashboardData();

    // Confirm each static endpoint was called exactly once during initial load
    expect(mocks.getServer).toHaveBeenCalledTimes(1);
    expect(mocks.getAgents).toHaveBeenCalledTimes(1);
    expect(mocks.getAllWatchers).toHaveBeenCalledTimes(1);
    expect(mocks.getAllRegistries).toHaveBeenCalledTimes(1);
    expect(mocks.getAllContainers).toHaveBeenCalledTimes(1);
    expect(mocks.getContainerRecentStatus).toHaveBeenCalledTimes(1);

    // Dispatch reconnect — debouncer waits 1000ms then calls fetchDashboardData({ background: true, skipStaticIfFresh: true })
    // lastStaticFetchAt was just set, so the static endpoints are within TTL and will be skipped
    globalThis.dispatchEvent(new CustomEvent('dd:sse-connected'));
    vi.advanceTimersByTime(1_000);
    await flushPromises();

    // Live endpoints always fetch — now called 2× total
    expect(mocks.getAllContainers).toHaveBeenCalledTimes(2);
    expect(mocks.getContainerRecentStatus).toHaveBeenCalledTimes(2);

    // Static endpoints skipped — still only 1× (TTL fresh)
    expect(mocks.getServer).toHaveBeenCalledTimes(1);
    expect(mocks.getAgents).toHaveBeenCalledTimes(1);
    expect(mocks.getAllWatchers).toHaveBeenCalledTimes(1);
    expect(mocks.getAllRegistries).toHaveBeenCalledTimes(1);
  });

  it('refetches static endpoints after TTL expires on reconnect-driven refresh', async () => {
    vi.useFakeTimers();

    // Mount — initial fetch records lastStaticFetchAt = Date.now()
    await mountDashboardData();

    // Advance wall clock past the 30s TTL so the next skipStaticIfFresh check finds stale data
    vi.setSystemTime(Date.now() + 31_000);

    // Dispatch reconnect — debouncer waits 1000ms, then TTL has expired so static endpoints are included
    globalThis.dispatchEvent(new CustomEvent('dd:sse-connected'));
    vi.advanceTimersByTime(1_000);
    await flushPromises();

    // All live + static endpoints called 2× total
    expect(mocks.getAllContainers).toHaveBeenCalledTimes(2);
    expect(mocks.getContainerRecentStatus).toHaveBeenCalledTimes(2);
    expect(mocks.getServer).toHaveBeenCalledTimes(2);
    expect(mocks.getAgents).toHaveBeenCalledTimes(2);
    expect(mocks.getAllWatchers).toHaveBeenCalledTimes(2);
    expect(mocks.getAllRegistries).toHaveBeenCalledTimes(2);
  });

  it('always refetches all endpoints on foreground fetchDashboardData call regardless of TTL', async () => {
    // Mount — initial fetch (foreground, no skipStaticIfFresh)
    const { state } = await mountDashboardData();

    // Call fetchDashboardData directly with no options → foreground, skipStaticIfFresh is false
    await state.fetchDashboardData();

    // All live + static endpoints called 2× total — TTL guard is never consulted for foreground calls
    expect(mocks.getAllContainers).toHaveBeenCalledTimes(2);
    expect(mocks.getContainerRecentStatus).toHaveBeenCalledTimes(2);
    expect(mocks.getServer).toHaveBeenCalledTimes(2);
    expect(mocks.getAgents).toHaveBeenCalledTimes(2);
    expect(mocks.getAllWatchers).toHaveBeenCalledTimes(2);
    expect(mocks.getAllRegistries).toHaveBeenCalledTimes(2);
  });

  it('opens stats summary stream on mount and disconnects on unmount', async () => {
    const { wrapper } = await mountDashboardData();

    expect(mocks.getStatsSummary).toHaveBeenCalledTimes(1);
    expect(mocks.connectStatsSummaryStream).toHaveBeenCalledTimes(1);

    // The controller disconnect is called on unmount
    const controller = mocks.connectStatsSummaryStream.mock.results[0]?.value;
    expect(controller).toBeDefined();

    wrapper.unmount();
    expect(controller.disconnect).toHaveBeenCalledTimes(1);
  });

  it('updates summary ref when the stream onSummary handler fires', async () => {
    let capturedHandlers: Record<string, unknown> | undefined;
    mocks.connectStatsSummaryStream.mockImplementation((handlers: unknown) => {
      capturedHandlers = handlers as Record<string, unknown>;
      return { pause: vi.fn(), resume: vi.fn(), disconnect: vi.fn(), isPaused: vi.fn() };
    });

    const { state } = await mountDashboardData();

    expect(state.summary.value).toEqual(
      expect.objectContaining({ watchedCount: 0, avgCpuPercent: 0 }),
    );

    const newSummary = {
      timestamp: '2026-04-30T01:00:00.000Z',
      watchedCount: 5,
      avgCpuPercent: 35.5,
      totalMemoryUsageBytes: 1_000_000_000,
      totalMemoryLimitBytes: 4_000_000_000,
      totalMemoryPercent: 25.0,
      topCpu: [],
      topMemory: [],
    };

    const onSummary = capturedHandlers?.onSummary as ((s: unknown) => void) | undefined;
    expect(onSummary).toBeTypeOf('function');
    onSummary!(newSummary);

    await nextTick();
    expect(state.summary.value).toEqual(newSummary);
  });

  it('keeps existing summary unchanged when the stats summary stream errors', async () => {
    const existingSummary = {
      timestamp: '2026-04-30T00:00:00.000Z',
      watchedCount: 2,
      avgCpuPercent: 15.0,
      totalMemoryUsageBytes: 500_000_000,
      totalMemoryLimitBytes: 2_000_000_000,
      totalMemoryPercent: 25.0,
      topCpu: [],
      topMemory: [],
    };
    mocks.getStatsSummary.mockResolvedValue(existingSummary);

    let capturedHandlers: Record<string, unknown> | undefined;
    mocks.connectStatsSummaryStream.mockImplementation((handlers: unknown) => {
      capturedHandlers = handlers as Record<string, unknown>;
      return { pause: vi.fn(), resume: vi.fn(), disconnect: vi.fn(), isPaused: vi.fn() };
    });

    const { state } = await mountDashboardData();

    expect(state.summary.value).toEqual(existingSummary);

    const onError = capturedHandlers?.onError as (() => void) | undefined;
    expect(onError).toBeTypeOf('function');
    onError!();

    await nextTick();
    expect(state.summary.value).toEqual(existingSummary);
  });

  it('populates summary from initial getStatsSummary fetch', async () => {
    const initialSummary = {
      timestamp: '2026-04-30T00:00:00.000Z',
      watchedCount: 2,
      avgCpuPercent: 15.0,
      totalMemoryUsageBytes: 500_000_000,
      totalMemoryLimitBytes: 2_000_000_000,
      totalMemoryPercent: 25.0,
      topCpu: [],
      topMemory: [],
    };
    mocks.getStatsSummary.mockResolvedValue(initialSummary);

    const { state } = await mountDashboardData();

    expect(state.summary.value).toEqual(initialSummary);
  });

  it('tolerates getStatsSummary errors and keeps summary null until stream fires', async () => {
    mocks.getStatsSummary.mockRejectedValue(new Error('summary fetch failed'));
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    let capturedOnSummary: ((s: unknown) => void) | undefined;
    mocks.connectStatsSummaryStream.mockImplementation((handlers: unknown) => {
      const h = handlers as Record<string, unknown>;
      capturedOnSummary = h?.onSummary as ((s: unknown) => void) | undefined;
      return { pause: vi.fn(), resume: vi.fn(), disconnect: vi.fn(), isPaused: vi.fn() };
    });

    const { state } = await mountDashboardData();

    // Initial fetch failed — summary is still null
    expect(state.summary.value).toBeNull();
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('summary fetch failed'));

    // Stream fires later and updates summary
    const streamSummary = {
      timestamp: '2026-04-30T02:00:00.000Z',
      watchedCount: 1,
      avgCpuPercent: 5.0,
      totalMemoryUsageBytes: 100_000_000,
      totalMemoryLimitBytes: 1_000_000_000,
      totalMemoryPercent: 10.0,
      topCpu: [],
      topMemory: [],
    };
    capturedOnSummary?.(streamSummary);
    await nextTick();
    expect(state.summary.value).toEqual(streamSummary);

    debugSpy.mockRestore();
  });

  it('pauses stats summary stream on visibilitychange:hidden and resumes on visible', async () => {
    vi.useFakeTimers();
    let capturedController: {
      pause: ReturnType<typeof vi.fn>;
      resume: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    } | null = null;

    mocks.connectStatsSummaryStream.mockImplementation(() => {
      capturedController = { pause: vi.fn(), resume: vi.fn(), disconnect: vi.fn() };
      return { ...capturedController, isPaused: vi.fn().mockReturnValue(false) };
    });

    mocks.getAllWatchers.mockResolvedValue([
      { configuration: { maintenanceWindow: 'Sun 02:00-03:00 UTC' } },
    ]);

    await mountDashboardData();
    expect(capturedController).not.toBeNull();

    setVisibilityState('hidden');
    expect(capturedController!.pause).toHaveBeenCalledTimes(1);

    setVisibilityState('visible');
    expect(capturedController!.resume).toHaveBeenCalledTimes(1);
  });

  it('exports summary ref (not containerStats) from useDashboardData', async () => {
    const { state } = await mountDashboardData();
    expect('summary' in state).toBe(true);
    expect('containerStats' in state).toBe(false);
  });
});
