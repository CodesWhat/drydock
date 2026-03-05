import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import type { Container } from '@/types/container';
import { useDashboardData } from '@/views/dashboard/useDashboardData';

const mocks = vi.hoisted(() => ({
  getAgents: vi.fn(),
  getAllContainers: vi.fn(),
  getAllRegistries: vi.fn(),
  getAllWatchers: vi.fn(),
  getAuditLog: vi.fn(),
  getServer: vi.fn(),
  mapApiContainers: vi.fn(),
}));

vi.mock('@/services/agent', () => ({
  getAgents: mocks.getAgents,
}));

vi.mock('@/services/audit', () => ({
  getAuditLog: mocks.getAuditLog,
}));

vi.mock('@/services/container', () => ({
  getAllContainers: mocks.getAllContainers,
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
    mocks.getAuditLog.mockResolvedValue({ entries: [], total: 0 });
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

  it('loads dashboard data, maps audit statuses, and manages maintenance timer', async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');

    mocks.getAllWatchers.mockResolvedValue([
      { configuration: { maintenanceWindow: 'Sun 02:00-03:00 UTC' } },
      { config: { maintenancewindow: 'Mon 01:00-02:00 UTC' } },
      { configuration: { maintenanceWindow: '   ' } },
      null,
    ]);
    mocks.getAuditLog.mockResolvedValue({
      entries: [
        { containerName: 'api', action: 'update-failed' },
        { containerName: 'api', action: 'update-applied' },
        { containerName: 'worker', action: 'update-applied' },
        { containerName: 'cache', action: 'update-available' },
        { containerName: 'ignored', action: 'unknown' },
        { containerName: '', action: 'update-failed' },
        { action: 'update-failed' },
        null,
      ],
      total: 8,
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

  it('normalizes non-array watcher/registry responses and missing audit entries', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    mocks.getAllWatchers.mockResolvedValue({ data: [] });
    mocks.getAllRegistries.mockResolvedValue({ data: [] });
    mocks.getAuditLog.mockResolvedValue({});

    const { state } = await mountDashboardData();

    expect(state.watchers.value).toEqual([]);
    expect(state.registries.value).toEqual([]);
    expect(state.recentStatusByContainer.value).toEqual({});
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
