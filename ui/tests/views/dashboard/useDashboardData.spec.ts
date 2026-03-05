import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import type { Container } from '@/types/container';
import { useDashboardData } from '@/views/dashboard/useDashboardData';

const mocks = vi.hoisted(() => ({
  getAgents: vi.fn(),
  getAllContainers: vi.fn(),
  getContainerRecentStatus: vi.fn(),
  getContainerSummary: vi.fn(),
  getAllRegistries: vi.fn(),
  getAllWatchers: vi.fn(),
  getServer: vi.fn(),
  mapApiContainers: vi.fn(),
}));

vi.mock('@/services/agent', () => ({
  getAgents: mocks.getAgents,
}));

vi.mock('@/services/container', () => ({
  getAllContainers: mocks.getAllContainers,
  getContainerRecentStatus: mocks.getContainerRecentStatus,
  getContainerSummary: mocks.getContainerSummary,
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
}));

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'c1',
    name: 'nginx',
    image: 'nginx:latest',
    icon: 'docker',
    currentTag: '1.0.0',
    newTag: null,
    status: 'running',
    registry: 'dockerhub',
    updateKind: null,
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
    mocks.getServer.mockResolvedValue({ configuration: { webhook: { enabled: true } } });
    mocks.getAgents.mockResolvedValue([{ name: 'agent-1', connected: true }]);
    mocks.getAllWatchers.mockResolvedValue([]);
    mocks.getAllRegistries.mockResolvedValue([{ name: 'hub' }]);
    mocks.getContainerSummary.mockResolvedValue({
      containers: { total: 0, running: 0, stopped: 0 },
      security: { issues: 0 },
    });
    mocks.getContainerRecentStatus.mockResolvedValue({ statuses: {} });
    mocks.mapApiContainers.mockReturnValue([makeContainer()]);

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

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);
    const beforeTick = state.maintenanceCountdownNow.value;
    vi.advanceTimersByTime(30_000);
    expect(state.maintenanceCountdownNow.value).toBeGreaterThanOrEqual(beforeTick);

    wrapper.unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('normalizes non-array watcher/registry responses and missing recent-status entries', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    mocks.getAllWatchers.mockResolvedValue({ data: [] });
    mocks.getAllRegistries.mockResolvedValue({ data: [] });
    mocks.getContainerRecentStatus.mockResolvedValue({});

    const { state } = await mountDashboardData();

    expect(state.watchers.value).toEqual([]);
    expect(state.registries.value).toEqual([]);
    expect(state.recentStatusByContainer.value).toEqual({});
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it('normalizes malformed summary payload values during debounced summary refresh', async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    mocks.getAllWatchers.mockResolvedValue([{ id: 'watcher-without-config' }]);

    const { state } = await mountDashboardData();
    mocks.getContainerSummary.mockResolvedValueOnce({
      containers: {
        total: -5,
        running: Number.POSITIVE_INFINITY,
        stopped: 'invalid',
      },
      security: {
        issues: -1,
      },
    });

    globalThis.dispatchEvent(new CustomEvent('dd:sse-container-changed'));
    vi.advanceTimersByTime(1_000);
    await flushPromises();

    expect(mocks.getContainerSummary).toHaveBeenCalledTimes(1);
    expect(state.containerSummary.value).toEqual({
      containers: { total: 0, running: 0, stopped: 0 },
      security: { issues: 0 },
    });
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it('sets error for a failed foreground fetch and clears loading', async () => {
    mocks.getAllContainers.mockRejectedValue(new Error('containers failed'));

    const { state } = await mountDashboardData();

    expect(state.loading.value).toBe(false);
    expect(state.error.value).toBe('containers failed');
  });

  it('debounces realtime refresh and logs background errors when prior data exists', async () => {
    vi.useFakeTimers();
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    mocks.mapApiContainers.mockReturnValue([makeContainer({ id: 'c-rendered' })]);

    const { state, wrapper } = await mountDashboardData();
    expect(state.error.value).toBeNull();
    expect(mocks.getAllContainers).toHaveBeenCalledTimes(1);

    mocks.getAllContainers.mockRejectedValueOnce(new Error('background refresh failed'));

    globalThis.dispatchEvent(new CustomEvent('dd:sse-container-changed'));
    const clearTimeoutCallsBeforeSecondEvent = clearTimeoutSpy.mock.calls.length;
    globalThis.dispatchEvent(new CustomEvent('dd:sse-scan-completed'));
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

  it('logs summary refresh failures when data has already rendered', async () => {
    vi.useFakeTimers();
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    await mountDashboardData();
    mocks.getContainerSummary.mockRejectedValueOnce(new Error('summary refresh failed'));

    globalThis.dispatchEvent(new CustomEvent('dd:sse-container-changed'));
    vi.advanceTimersByTime(1_000);
    await flushPromises();

    expect(mocks.getContainerSummary).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledWith('summary refresh failed');
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

  it('surfaces summary refresh errors when no dashboard data has rendered yet', async () => {
    vi.useFakeTimers();
    mocks.getAllContainers.mockRejectedValue(new Error('initial load failed'));

    const { state } = await mountDashboardData();
    mocks.getContainerSummary.mockRejectedValueOnce(new Error('summary bootstrap failed'));

    globalThis.dispatchEvent(new CustomEvent('dd:sse-container-changed'));
    vi.advanceTimersByTime(1_000);
    await flushPromises();

    expect(mocks.getContainerSummary).toHaveBeenCalledTimes(1);
    expect(state.error.value).toBe('summary bootstrap failed');
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

    globalThis.dispatchEvent(new CustomEvent('dd:sse-container-changed'));
    wrapper.unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
