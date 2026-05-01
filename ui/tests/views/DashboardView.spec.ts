import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import DataTable from '@/components/DataTable.vue';
import { useToast } from '@/composables/useToast';
import type { Container } from '@/types/container';
import DashboardView from '@/views/DashboardView.vue';
import {
  clampDashboardScroll,
  computeDashboardDragScrollDelta,
} from '@/views/dashboard/dashboardDragAutoScroll';
import { mountWithPlugins } from '../helpers/mount';

const dashboardViewSource = readFileSync(
  resolve(__dirname, '../../src/views/DashboardView.vue'),
  'utf-8',
);

const {
  mockRouterPush,
  mockBuildDashboardContainerMetrics,
  mockUpdateContainer,
  mockUpdateContainers,
} = vi.hoisted(() => ({
  mockRouterPush: vi.fn(),
  mockBuildDashboardContainerMetrics: vi.fn(),
  mockUpdateContainer: vi.fn(),
  mockUpdateContainers: vi.fn(),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

vi.mock('@/services/container', () => ({
  getAllContainers: vi.fn(),
  getContainerRecentStatus: vi.fn(),
  getContainerSummary: vi.fn(),
}));

vi.mock('@/services/stats', () => ({
  getStatsSummary: vi.fn(),
  connectStatsSummaryStream: vi.fn(() => ({
    pause: vi.fn(),
    resume: vi.fn(),
    disconnect: vi.fn(),
    isPaused: vi.fn().mockReturnValue(false),
  })),
}));

vi.mock('@/services/agent', () => ({
  getAgents: vi.fn(),
}));

vi.mock('@/services/server', () => ({
  getServer: vi.fn(),
}));

vi.mock('@/services/watcher', () => ({
  getAllWatchers: vi.fn(),
}));

vi.mock('@/services/registry', () => ({
  getAllRegistries: vi.fn(),
}));

vi.mock('@/services/container-actions', () => ({
  updateContainer: mockUpdateContainer,
  updateContainers: mockUpdateContainers,
}));

vi.mock('@/utils/container-mapper', () => ({
  mapApiContainers: vi.fn((x: any) => x),
}));

vi.mock('@/utils/dashboard-container-metrics', async () => {
  const actual = await vi.importActual<typeof import('@/utils/dashboard-container-metrics')>(
    '@/utils/dashboard-container-metrics',
  );
  return {
    ...actual,
    buildDashboardContainerMetrics: (
      ...args: Parameters<typeof actual.buildDashboardContainerMetrics>
    ) => {
      mockBuildDashboardContainerMetrics(...args);
      return actual.buildDashboardContainerMetrics(...args);
    },
  };
});

import { getAgents } from '@/services/agent';
import {
  getAllContainers,
  getContainerRecentStatus,
  getContainerSummary,
} from '@/services/container';
import { getAllRegistries } from '@/services/registry';
import { getServer } from '@/services/server';
import { connectStatsSummaryStream, getStatsSummary } from '@/services/stats';
import { getAllWatchers } from '@/services/watcher';

const mockGetAllContainers = getAllContainers as ReturnType<typeof vi.fn>;
const mockGetStatsSummary = getStatsSummary as ReturnType<typeof vi.fn>;
const mockConnectStatsSummaryStream = connectStatsSummaryStream as ReturnType<typeof vi.fn>;
const mockGetContainerRecentStatus = getContainerRecentStatus as ReturnType<typeof vi.fn>;
const mockGetContainerSummary = getContainerSummary as ReturnType<typeof vi.fn>;
const mockGetAgents = getAgents as ReturnType<typeof vi.fn>;
const mockGetServer = getServer as ReturnType<typeof vi.fn>;
const mockGetAllWatchers = getAllWatchers as ReturnType<typeof vi.fn>;
const mockGetAllRegistries = getAllRegistries as ReturnType<typeof vi.fn>;
const PREFERENCES_STORAGE_KEY = 'dd-preferences';
const mountedWrappers: VueWrapper[] = [];
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

function makeContainer(overrides: Partial<Container> = {}): Container {
  const defaultId = overrides.id ?? 'c1';
  const defaultName = overrides.name ?? 'nginx';
  return {
    id: defaultId,
    identityKey: overrides.identityKey ?? `::local::${defaultName}`,
    name: defaultName,
    image: 'nginx',
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

interface DashboardDataOverrides {
  watchers?: any[];
  registries?: any[];
  auditEntries?: any[];
  recentStatuses?: Record<string, string>;
  recentStatusesByIdentity?: Record<string, string>;
  statsSummary?: Partial<import('@/services/stats').ContainerStatsSummarySnapshot>;
}

function mapAuditEntriesToRecentStatuses(auditEntries: any[]): Record<string, string> {
  const statuses: Record<string, string> = {};
  const actionToStatus: Record<string, string> = {
    'update-failed': 'failed',
    'update-applied': 'updated',
    'update-available': 'pending',
  };
  for (const entry of auditEntries) {
    const containerName =
      typeof entry?.containerName === 'string' ? entry.containerName.trim() : '';
    if (!containerName || statuses[containerName]) {
      continue;
    }
    const mappedStatus = actionToStatus[String(entry?.action ?? '')];
    if (mappedStatus) {
      statuses[containerName] = mappedStatus;
    }
  }
  return statuses;
}

async function mountDashboard(
  containers: Container[] = [],
  agents: any[] = [],
  server: any = {},
  overrides: DashboardDataOverrides = {},
) {
  mockGetAllContainers.mockResolvedValue(containers);
  mockGetStatsSummary.mockResolvedValue({
    timestamp: '2026-04-30T00:00:00.000Z',
    watchedCount: 0,
    totalCpuPercent: 0,
    totalMemoryUsageBytes: 0,
    totalMemoryLimitBytes: 0,
    totalMemoryPercent: 0,
    topCpu: [],
    topMemory: [],
    ...(overrides.statsSummary ?? {}),
  });
  mockConnectStatsSummaryStream.mockReturnValue({
    pause: vi.fn(),
    resume: vi.fn(),
    disconnect: vi.fn(),
    isPaused: vi.fn().mockReturnValue(false),
  });
  mockGetContainerSummary.mockResolvedValue({
    containers: {
      total: containers.length,
      running: containers.filter((container) => container.status === 'running').length,
      stopped: containers.filter((container) => container.status !== 'running').length,
    },
    security: { issues: 0 },
  });
  mockGetAgents.mockResolvedValue(agents);
  mockGetServer.mockResolvedValue(server);
  mockGetAllWatchers.mockResolvedValue(overrides.watchers ?? []);
  mockGetAllRegistries.mockResolvedValue(overrides.registries ?? []);
  mockGetContainerRecentStatus.mockResolvedValue({
    statuses:
      overrides.recentStatuses ?? mapAuditEntriesToRecentStatuses(overrides.auditEntries ?? []),
    statusesByIdentity: overrides.recentStatusesByIdentity ?? {},
  });

  const { mapApiContainers } = await import('@/utils/container-mapper');
  (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValue(containers);

  const wrapper = mountWithPlugins(DashboardView, {
    global: { components: { DataTable } },
  });
  mountedWrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

function mountDashboardView() {
  const wrapper = mountWithPlugins(DashboardView, {
    global: { components: { DataTable } },
  });
  mountedWrappers.push(wrapper);
  return wrapper;
}

describe('DashboardView', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockRouterPush.mockClear();
    mockBuildDashboardContainerMetrics.mockClear();
    // Default stats mocks (overridden per-test via mountDashboard overrides.statsSummary)
    mockGetStatsSummary.mockResolvedValue({
      timestamp: '2026-04-30T00:00:00.000Z',
      watchedCount: 0,
      totalCpuPercent: 0,
      totalMemoryUsageBytes: 0,
      totalMemoryLimitBytes: 0,
      totalMemoryPercent: 0,
      topCpu: [],
      topMemory: [],
    });
    mockConnectStatsSummaryStream.mockReturnValue({
      pause: vi.fn(),
      resume: vi.fn(),
      disconnect: vi.fn(),
      isPaused: vi.fn().mockReturnValue(false),
    });
    mockUpdateContainer.mockResolvedValue({});
    mockUpdateContainers.mockImplementation(async (containerIds: string[]) => ({
      message: 'Container update requests processed',
      accepted: containerIds.map((containerId) => ({
        containerId,
        containerName: containerId,
        operationId: `op-${containerId}`,
      })),
      rejected: [],
    }));
    const { toasts, dismissToast } = useToast();
    for (const toast of [...toasts.value]) {
      dismissToast(toast.id);
    }
    localStorage.removeItem(PREFERENCES_STORAGE_KEY);
    const { resetPreferences } = await import('@/preferences/store');
    resetPreferences();
    const { useOperationDisplayHold } = await import('@/composables/useOperationDisplayHold');
    useOperationDisplayHold().clearAllOperationDisplayHolds();
  });

  afterEach(() => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      configurable: true,
      value: originalRequestAnimationFrame,
      writable: true,
    });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      configurable: true,
      value: originalCancelAnimationFrame,
      writable: true,
    });
    vi.useRealTimers();
  });

  describe('layout spacing', () => {
    it('extends scroll container edge-to-edge via negative margins on root', () => {
      mockGetAllContainers.mockReturnValue(new Promise(() => {}));
      mockGetAgents.mockReturnValue(new Promise(() => {}));
      mockGetServer.mockReturnValue(new Promise(() => {}));

      const wrapper = mountDashboardView();
      const root = wrapper.find('.flex.flex-col.flex-1.min-h-0');
      expect(root.exists()).toBe(true);
      expect(root.classes()).toContain('-ml-4');
      expect(root.classes()).toContain('-mr-2');
      expect(root.classes()).toContain('-my-4');
    });

    it('applies internal padding on the scroll container for visual spacing', () => {
      mockGetAllContainers.mockReturnValue(new Promise(() => {}));
      mockGetAgents.mockReturnValue(new Promise(() => {}));
      mockGetServer.mockReturnValue(new Promise(() => {}));

      const wrapper = mountDashboardView();
      const scrollArea = wrapper.find('.overflow-y-auto');
      expect(scrollArea.exists()).toBe(true);
      expect(scrollArea.classes()).toContain('px-2');
      expect(scrollArea.classes()).toContain('py-1');
      expect(scrollArea.classes()).toContain('sm:pr-6');
    });

    it('limits edit-mode dragging to explicit drag handles', async () => {
      await mountDashboard([makeContainer({ newTag: '2.0.0' })]);
      expect(dashboardViewSource).toContain('drag-allow-from=".drag-handle"');
    });

    it('keeps editable widgets vertically pannable while customizing', async () => {
      const wrapper = await mountDashboard([makeContainer({ newTag: '2.0.0' })]);

      const editToggle = document.querySelector('[data-test="dashboard-edit-toggle"]');
      expect(editToggle).not.toBeNull();
      (editToggle as HTMLButtonElement).click();
      await flushPromises();

      const widget = wrapper.find('[data-widget-id="recent-updates"]');
      expect(widget.attributes('style')).toContain('touch-action: pan-y');
    });

    it('applies shared scroll containment utilities to the customize panel viewport', async () => {
      const wrapper = await mountDashboard([makeContainer({ newTag: '2.0.0' })]);

      const editToggle = document.querySelector('[data-test="dashboard-edit-toggle"]');
      expect(editToggle).not.toBeNull();
      (editToggle as HTMLButtonElement).click();
      await flushPromises();

      const scrollViewport = wrapper.find('aside .overflow-y-auto');
      expect(scrollViewport.exists()).toBe(true);
      expect(scrollViewport.classes()).toContain('overscroll-contain');
      expect(scrollViewport.classes()).toContain('dd-scroll-stable');
      expect(scrollViewport.classes()).toContain('dd-touch-scroll');
    });

    it('caches widget breakpoint bounds instead of calling getWidgetBoundsForBreakpoint in each GridItem size prop', () => {
      expect(dashboardViewSource).not.toContain(
        ':min-w="getWidgetBoundsForBreakpoint(item.i as DashboardWidgetId, currentBreakpoint).minW"',
      );
      expect(dashboardViewSource).not.toContain(
        ':min-h="getWidgetBoundsForBreakpoint(item.i as DashboardWidgetId, currentBreakpoint).minH"',
      );
      expect(dashboardViewSource).not.toContain(
        ':max-w="getWidgetBoundsForBreakpoint(item.i as DashboardWidgetId, currentBreakpoint).maxW"',
      );
      expect(dashboardViewSource).not.toContain(
        ':max-h="getWidgetBoundsForBreakpoint(item.i as DashboardWidgetId, currentBreakpoint).maxH"',
      );
    });

    it('computes a positive auto-scroll delta near the dashboard bottom edge', () => {
      const delta = computeDashboardDragScrollDelta(395, { top: 0, bottom: 400 } as DOMRect);

      expect(delta).toBeGreaterThan(0);
      expect(clampDashboardScroll(100 + delta, 0, 800)).toBeGreaterThan(100);
    });

    it('computes a negative auto-scroll delta near the dashboard top edge', () => {
      const delta = computeDashboardDragScrollDelta(5, { top: 0, bottom: 400 } as DOMRect);

      expect(delta).toBeLessThan(0);
      expect(clampDashboardScroll(180 + delta, 0, 800)).toBeLessThan(180);
    });

    it('does not auto-scroll when the pointer stays away from the dashboard edges', () => {
      expect(computeDashboardDragScrollDelta(200, { top: 0, bottom: 400 } as DOMRect)).toBe(0);
    });

    it('does not queue another drag auto-scroll frame after drag cleanup occurs mid-frame', async () => {
      const frameCallbacks: FrameRequestCallback[] = [];
      const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      });
      const cancelAnimationFrameMock = vi.fn();
      Object.defineProperty(globalThis, 'requestAnimationFrame', {
        configurable: true,
        value: requestAnimationFrameMock,
        writable: true,
      });
      Object.defineProperty(globalThis, 'cancelAnimationFrame', {
        configurable: true,
        value: cancelAnimationFrameMock,
        writable: true,
      });

      const wrapper = await mountDashboard([makeContainer({ newTag: '2.0.0' })]);
      const editToggle = document.querySelector('[data-test="dashboard-edit-toggle"]');
      expect(editToggle).not.toBeNull();
      (editToggle as HTMLButtonElement).click();
      await flushPromises();

      const scrollArea = wrapper.find('.overflow-y-auto').element as HTMLElement;
      let pointerEnded = false;
      const getBoundingClientRectSpy = vi
        .spyOn(scrollArea, 'getBoundingClientRect')
        .mockImplementation(() => {
          if (!pointerEnded) {
            pointerEnded = true;
            const pointerUpEvent = new Event('pointerup', { bubbles: true, cancelable: true });
            Object.defineProperties(pointerUpEvent, {
              pointerId: { value: 1 },
              clientY: { value: 395 },
            });
            window.dispatchEvent(pointerUpEvent);
          }
          return { top: 0, bottom: 400 } as DOMRect;
        });

      try {
        const dragHandle = wrapper.find('.drag-handle');
        expect(dragHandle.exists()).toBe(true);
        const frameCountBeforeDrag = frameCallbacks.length;

        const pointerDownEvent = new Event('pointerdown', { bubbles: true, cancelable: true });
        Object.defineProperties(pointerDownEvent, {
          pointerId: { value: 1 },
          clientY: { value: 390 },
        });
        dragHandle.element.dispatchEvent(pointerDownEvent);

        const pointerMoveEvent = new Event('pointermove', { bubbles: true, cancelable: true });
        Object.defineProperties(pointerMoveEvent, {
          pointerId: { value: 1 },
          clientY: { value: 395 },
        });
        window.dispatchEvent(pointerMoveEvent);

        expect(frameCallbacks.length).toBe(frameCountBeforeDrag + 1);
        frameCallbacks[frameCountBeforeDrag](0);
        await flushPromises();

        expect(frameCallbacks.length).toBe(frameCountBeforeDrag + 1);
      } finally {
        getBoundingClientRectSpy.mockRestore();
      }
    });
  });

  describe('loading state', () => {
    it('shows loading text before data resolves', () => {
      mockGetAllContainers.mockReturnValue(new Promise(() => {}));
      mockGetAgents.mockReturnValue(new Promise(() => {}));
      mockGetServer.mockReturnValue(new Promise(() => {}));

      const wrapper = mountDashboardView();
      expect(wrapper.text()).toContain('Loading dashboard...');
    });

    it('hides loading text after data resolves', async () => {
      const wrapper = await mountDashboard();
      expect(wrapper.text()).not.toContain('Loading dashboard...');
    });
  });

  describe('maintenance countdown timer', () => {
    const maintenanceWindowWatcher = {
      id: 'w1',
      configuration: {
        maintenanceWindow: 'Sun 02:00-03:00 UTC',
      },
    };
    let originalVisibilityState: PropertyDescriptor | undefined;

    const setVisibilityState = (state: DocumentVisibilityState) => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => state,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    };

    beforeEach(() => {
      originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState');
      setVisibilityState('visible');
    });

    afterEach(() => {
      if (originalVisibilityState) {
        Object.defineProperty(document, 'visibilityState', originalVisibilityState);
      } else {
        Reflect.deleteProperty(document, 'visibilityState');
      }
    });

    it('does not start timer when no maintenance windows exist', async () => {
      vi.useFakeTimers();
      const setIntervalSpy = vi.spyOn(window, 'setInterval');

      try {
        await mountDashboard([makeContainer()], [], {}, { watchers: [] });
        expect(setIntervalSpy).not.toHaveBeenCalled();
      } finally {
        setIntervalSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('starts timer when at least one maintenance window exists', async () => {
      vi.useFakeTimers();
      const setIntervalSpy = vi.spyOn(window, 'setInterval');

      try {
        await mountDashboard([makeContainer()], [], {}, { watchers: [maintenanceWindowWatcher] });
        expect(setIntervalSpy).toHaveBeenCalledTimes(1);
        expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);
      } finally {
        setIntervalSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('pauses while hidden and resumes when visible again', async () => {
      vi.useFakeTimers();
      const setIntervalSpy = vi.spyOn(window, 'setInterval');
      const clearIntervalSpy = vi.spyOn(window, 'clearInterval');

      try {
        await mountDashboard([makeContainer()], [], {}, { watchers: [maintenanceWindowWatcher] });
        expect(setIntervalSpy).toHaveBeenCalledTimes(1);
        const timerId = setIntervalSpy.mock.results[0]?.value;

        setVisibilityState('hidden');
        expect(clearIntervalSpy).toHaveBeenCalledWith(timerId);

        setVisibilityState('visible');
        expect(setIntervalSpy).toHaveBeenCalledTimes(2);
      } finally {
        clearIntervalSpy.mockRestore();
        setIntervalSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('stops timer when maintenance windows are removed after refresh', async () => {
      vi.useFakeTimers();
      const setIntervalSpy = vi.spyOn(window, 'setInterval');
      const clearIntervalSpy = vi.spyOn(window, 'clearInterval');

      try {
        await mountDashboard([makeContainer()], [], {}, { watchers: [maintenanceWindowWatcher] });
        expect(setIntervalSpy).toHaveBeenCalledTimes(1);
        const timerId = setIntervalSpy.mock.results[0]?.value;

        mockGetAllWatchers.mockResolvedValueOnce([]);
        // dd:sse-resync-required forces a full refetch including static endpoints (no TTL skip),
        // so watchers are re-fetched and the now-empty list stops the maintenance window timer.
        globalThis.dispatchEvent(
          new CustomEvent('dd:sse-resync-required', { detail: { reason: 'boot-mismatch' } }),
        );
        vi.advanceTimersByTime(1_000);
        await flushPromises();

        expect(clearIntervalSpy).toHaveBeenCalledWith(timerId);
      } finally {
        clearIntervalSpy.mockRestore();
        setIntervalSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('clears the timer on unmount', async () => {
      vi.useFakeTimers();
      const setIntervalSpy = vi.spyOn(window, 'setInterval');
      const clearIntervalSpy = vi.spyOn(window, 'clearInterval');

      try {
        const wrapper = await mountDashboard(
          [makeContainer()],
          [],
          {},
          { watchers: [maintenanceWindowWatcher] },
        );
        const timerId = setIntervalSpy.mock.results[0]?.value;

        mountedWrappers.splice(mountedWrappers.indexOf(wrapper), 1);
        wrapper.unmount();

        expect(clearIntervalSpy).toHaveBeenCalledWith(timerId);
      } finally {
        clearIntervalSpy.mockRestore();
        setIntervalSpy.mockRestore();
        vi.useRealTimers();
      }
    });
  });

  describe('SSE refresh behavior', () => {
    it('performs full data refresh on dd:sse-connected and dd:sse-resync-required (#229)', async () => {
      vi.useFakeTimers();
      try {
        await mountDashboard([makeContainer()]);
        const containersCallsBefore = mockGetAllContainers.mock.calls.length;

        // dd:sse-connected schedules a debounced full refresh (replaces old container-changed path)
        globalThis.dispatchEvent(new CustomEvent('dd:sse-connected'));
        vi.advanceTimersByTime(1000);
        await flushPromises();

        expect(mockGetAllContainers.mock.calls.length).toBeGreaterThan(containersCallsBefore);
      } finally {
        vi.useRealTimers();
      }
    });

    it('debounces burst SSE events into a single full refresh', async () => {
      // dd:sse-connected goes through the full-live mode: live endpoints always refetch,
      // but static endpoints (server/agents/watchers/registries) are TTL-guarded and skipped
      // when a successful fetch happened within 30 s. This test confirms the burst is still
      // collapsed into a single scheduled refresh and only live endpoints are called.
      vi.useFakeTimers();
      try {
        await mountDashboard([makeContainer()]);
        const summaryCallsBefore = mockGetContainerSummary.mock.calls.length;
        const containersCallsBefore = mockGetAllContainers.mock.calls.length;
        const serverCallsBefore = mockGetServer.mock.calls.length;
        const agentsCallsBefore = mockGetAgents.mock.calls.length;
        const watchersCallsBefore = mockGetAllWatchers.mock.calls.length;
        const registriesCallsBefore = mockGetAllRegistries.mock.calls.length;
        const recentStatusCallsBefore = mockGetContainerRecentStatus.mock.calls.length;

        globalThis.dispatchEvent(new CustomEvent('dd:sse-container-changed'));
        globalThis.dispatchEvent(new CustomEvent('dd:sse-scan-completed'));
        globalThis.dispatchEvent(new CustomEvent('dd:sse-connected'));
        await flushPromises();

        // Nothing fires before the debounce window expires
        expect(mockGetAllContainers).toHaveBeenCalledTimes(containersCallsBefore);
        expect(mockGetServer).toHaveBeenCalledTimes(serverCallsBefore);
        expect(mockGetAgents).toHaveBeenCalledTimes(agentsCallsBefore);
        expect(mockGetAllWatchers).toHaveBeenCalledTimes(watchersCallsBefore);
        expect(mockGetAllRegistries).toHaveBeenCalledTimes(registriesCallsBefore);
        expect(mockGetContainerRecentStatus).toHaveBeenCalledTimes(recentStatusCallsBefore);
        expect(mockGetContainerSummary).toHaveBeenCalledTimes(summaryCallsBefore);

        vi.advanceTimersByTime(1000);
        await flushPromises();

        // Live endpoints always refetch on dd:sse-connected (full-live mode)
        expect(mockGetAllContainers).toHaveBeenCalledTimes(containersCallsBefore + 1);
        expect(mockGetContainerRecentStatus).toHaveBeenCalledTimes(recentStatusCallsBefore + 1);
        // Static endpoints are TTL-guarded and skipped (fetched during mount within 30 s)
        expect(mockGetServer).toHaveBeenCalledTimes(serverCallsBefore);
        expect(mockGetAgents).toHaveBeenCalledTimes(agentsCallsBefore);
        expect(mockGetAllWatchers).toHaveBeenCalledTimes(watchersCallsBefore);
        expect(mockGetAllRegistries).toHaveBeenCalledTimes(registriesCallsBefore);
        expect(mockGetContainerSummary).toHaveBeenCalledTimes(summaryCallsBefore);
      } finally {
        vi.useRealTimers();
      }
    });

    it('dd:sse-resync-required refetches all endpoints including static ones (no TTL skip)', async () => {
      vi.useFakeTimers();
      try {
        await mountDashboard([makeContainer()]);
        const containersCallsBefore = mockGetAllContainers.mock.calls.length;
        const serverCallsBefore = mockGetServer.mock.calls.length;
        const watchersCallsBefore = mockGetAllWatchers.mock.calls.length;

        globalThis.dispatchEvent(
          new CustomEvent('dd:sse-resync-required', { detail: { reason: 'boot-mismatch' } }),
        );
        vi.advanceTimersByTime(1000);
        await flushPromises();

        expect(mockGetAllContainers).toHaveBeenCalledTimes(containersCallsBefore + 1);
        expect(mockGetServer).toHaveBeenCalledTimes(serverCallsBefore + 1);
        expect(mockGetAllWatchers).toHaveBeenCalledTimes(watchersCallsBefore + 1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not show loading state during SSE refresh after initial load', async () => {
      vi.useFakeTimers();
      try {
        const wrapper = await mountDashboard([makeContainer()]);
        mockGetContainerSummary.mockReturnValueOnce(new Promise(() => {}));

        globalThis.dispatchEvent(new CustomEvent('dd:sse-container-changed'));
        vi.advanceTimersByTime(1000);
        await flushPromises();

        expect(wrapper.text()).not.toContain('Loading dashboard...');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('error state', () => {
    it('shows error message on fetch failure', async () => {
      mockGetAllContainers.mockRejectedValue(new Error('Network error'));
      mockGetAgents.mockResolvedValue([]);
      mockGetServer.mockResolvedValue({});

      const wrapper = mountDashboardView();
      await flushPromises();

      expect(wrapper.text()).toContain('Failed to load dashboard');
      expect(wrapper.text()).toContain('Network error');
    });
  });

  describe('stat cards', () => {
    it('computes stats and security aggregates from one container metrics pass', async () => {
      const containers = [
        makeContainer({ id: 'c1', name: 'nginx-1', image: 'nginx', bouncer: 'blocked' }),
        makeContainer({
          id: 'c2',
          name: 'nginx-2',
          image: 'nginx',
          updateKind: 'minor',
          bouncer: 'unsafe',
        }),
        makeContainer({
          id: 'c3',
          name: 'redis',
          image: 'redis',
          status: 'stopped',
          bouncer: 'safe',
        }),
      ];

      await mountDashboard(containers);

      expect(mockBuildDashboardContainerMetrics).toHaveBeenCalledTimes(1);
    });

    it('computes total containers count', async () => {
      const containers = [makeContainer(), makeContainer({ id: 'c2', name: 'redis' })];
      const wrapper = await mountDashboard(containers);
      // Stat cards include "Containers" label and the count
      expect(wrapper.text()).toContain('Containers');
      expect(wrapper.text()).toContain('2');
    });

    it('shows running and stopped container breakdown', async () => {
      const containers = [
        makeContainer({ status: 'running' }),
        makeContainer({ id: 'c2', name: 'redis', status: 'running' }),
        makeContainer({ id: 'c3', name: 'postgres', status: 'stopped' }),
      ];
      const wrapper = await mountDashboard(containers);
      const statCards = wrapper.findAll('.stat-card');
      const containersCard = statCards.find((c) => c.text().includes('Containers'));

      expect(containersCard?.text()).toContain('2 running');
      expect(containersCard?.text()).toContain('1 stopped');
    });

    it('computes updates available count', async () => {
      const containers = [
        makeContainer({ updateKind: 'major', newTag: '2.0.0' }),
        makeContainer({ id: 'c2', name: 'redis' }),
      ];
      const wrapper = await mountDashboard(containers);
      expect(wrapper.text()).toContain('Updates Available');
      // One container with updateKind
      const statCards = wrapper.findAll('.stat-card');
      const updatesCard = statCards.find((c) => c.text().includes('Updates Available'));
      expect(updatesCard?.text()).toContain('1');
    });

    it('hides pinned containers across dashboard widgets when hidePinned is enabled, including ones with updates (#305)', async () => {
      // Hide Pinned is a pure declutter: pinned containers are hidden from
      // dashboard widgets regardless of update status. Users who want to see
      // a pinned row with a pending update uncheck the filter.
      const { flushPreferences, preferences } = await import('@/preferences/store');
      preferences.containers.filters.hidePinned = true;
      flushPreferences();

      const wrapper = await mountDashboard([
        makeContainer({
          id: 'floating',
          name: 'floating',
          updateKind: 'major',
          newTag: '2.0.0',
          tagPrecision: 'floating',
          tagPinned: false,
        }),
        makeContainer({
          id: 'pinned',
          name: 'pinned',
          updateKind: 'minor',
          newTag: '1.2.4',
          currentTag: '16-alpine',
          tagPrecision: 'floating',
          tagPinned: true,
        }),
      ]);

      const statCards = wrapper.findAll('.stat-card');
      const updatesCard = statCards.find((c) => c.text().includes('Updates Available'));
      expect(updatesCard?.text()).toContain('1');

      const recentUpdatesWidget = wrapper.find('[data-widget-id="recent-updates"]');
      expect(recentUpdatesWidget.text()).toContain('floating');
      expect(recentUpdatesWidget.text()).not.toContain('pinned');

      const updateBreakdownWidget = wrapper.find('[data-widget-id="update-breakdown"]');
      expect(updateBreakdownWidget.text()).toContain('Major');
    });

    it('computes security issues count from blocked and unsafe', async () => {
      const containers = [
        makeContainer({ bouncer: 'blocked' }),
        makeContainer({ id: 'c2', name: 'redis', image: 'redis', bouncer: 'unsafe' }),
        makeContainer({ id: 'c3', name: 'postgres', image: 'postgres', bouncer: 'safe' }),
      ];
      const wrapper = await mountDashboard(containers);
      const statCards = wrapper.findAll('.stat-card');
      const securityCard = statCards.find((c) => c.text().includes('Security Issues'));
      expect(securityCard?.text()).toContain('2');
    });

    it('counts security issues by image, not by container', async () => {
      const containers = [
        makeContainer({ id: 'c1', name: 'api-1', image: 'nginx', bouncer: 'blocked' }),
        makeContainer({ id: 'c2', name: 'api-2', image: 'nginx', bouncer: 'unsafe' }),
      ];
      const wrapper = await mountDashboard(containers);
      const statCards = wrapper.findAll('.stat-card');
      const securityCard = statCards.find((c) => c.text().includes('Security Issues'));
      expect(securityCard?.text()).toContain('1');
    });

    it('computes registry count from dashboard inputs', async () => {
      const wrapper = await mountDashboard(
        [],
        [],
        {},
        {
          registries: [{ id: 'r1' }],
        },
      );

      const statCards = wrapper.findAll('.stat-card');
      const registriesCard = statCards.find((c) => c.text().includes('Registries'));

      expect(registriesCard?.text()).toContain('1');
    });
  });

  describe('recent updates list', () => {
    it('shows containers with newTag in the container log table', async () => {
      const containers = [
        makeContainer({ newTag: '2.0.0' }),
        makeContainer({ id: 'c2', name: 'redis', newTag: '7.0.0', currentTag: '6.0.0' }),
      ];
      const wrapper = await mountDashboard(containers);
      expect(wrapper.text()).toContain('nginx');
      expect(wrapper.text()).toContain('redis');
      expect(wrapper.text()).toContain('2.0.0');
      expect(wrapper.text()).toContain('7.0.0');
    });

    it('shows all pending updates without a hard cap', async () => {
      const containers = Array.from({ length: 12 }, (_, i) =>
        makeContainer({
          id: `c${i}`,
          name: `container-${i}`,
          newTag: `${i + 1}.0.0`,
        }),
      );
      const wrapper = await mountDashboard(containers);
      const widget = wrapper.find('[data-widget-id="recent-updates"]');
      const rows = widget.findAll('tbody tr').filter((r) => !r.attributes('aria-hidden'));
      expect(rows.length).toBe(12);
    });

    it('renders the recent updates table with a fixed layout to keep columns stable while scrolling', async () => {
      const containers = Array.from({ length: 12 }, (_, i) =>
        makeContainer({
          id: `c${i}`,
          name: `container-${i}`,
          newTag: `${i + 1}.0.0`,
        }),
      );
      const wrapper = await mountDashboard(containers);
      const tableStyle = wrapper
        .find('[data-widget-id="recent-updates"]')
        .find('table')
        .attributes('style');

      expect(tableStyle).toContain('table-layout: fixed');
    });

    it('orders recent updates by newest detected update first', async () => {
      const containers = [
        {
          ...makeContainer({ id: 'c1', name: 'alpha', newTag: '2.0.0' }),
          updateDetectedAt: '2026-02-27T10:00:00.000Z',
        } as Container,
        {
          ...makeContainer({ id: 'c2', name: 'beta', newTag: '2.0.0' }),
          updateDetectedAt: '2026-02-28T10:00:00.000Z',
        } as Container,
        {
          ...makeContainer({ id: 'c3', name: 'gamma', newTag: '2.0.0' }),
          updateDetectedAt: '2026-02-26T10:00:00.000Z',
        } as Container,
      ];

      const wrapper = await mountDashboard(containers);
      const widget = wrapper.find('[data-widget-id="recent-updates"]');
      const rows = widget.findAll('tbody tr').filter((r) => !r.attributes('aria-hidden'));
      const names = rows.map((row) => row.find('.font-medium').text());

      expect(names).toEqual(['beta', 'alpha', 'gamma']);
    });

    it('does not show containers without newTag in the recent updates table', async () => {
      const containers = [
        makeContainer({ name: 'no-update' }),
        makeContainer({ id: 'c2', name: 'has-update', newTag: '2.0.0' }),
      ];
      const wrapper = await mountDashboard(containers);
      const widget = wrapper.find('[data-widget-id="recent-updates"]');
      const rows = widget.findAll('tbody tr').filter((r) => !r.attributes('aria-hidden'));
      expect(rows.length).toBe(1);
      expect(rows[0].text()).toContain('has-update');
    });

    it('shows snoozed, skipped, and maturity-blocked policy updates in recent updates', async () => {
      const containers = [
        {
          ...makeContainer({
            id: 'c1',
            name: 'snoozed-nginx',
            currentTag: '1.0.0',
            newTag: null,
          }),
          updatePolicyState: 'snoozed',
          suppressedUpdateTag: '1.1.0',
        } as Container,
        {
          ...makeContainer({
            id: 'c2',
            name: 'skipped-redis',
            currentTag: '6.0.0',
            newTag: null,
          }),
          updatePolicyState: 'skipped',
          suppressedUpdateTag: '7.0.0',
        } as Container,
        {
          ...makeContainer({
            id: 'c3',
            name: 'maturity-blocked-postgres',
            currentTag: '15.0.0',
            newTag: null,
          }),
          updatePolicyState: 'maturity-blocked',
          suppressedUpdateTag: '16.0.0',
        } as Container,
      ];

      const wrapper = await mountDashboard(containers);
      const widget = wrapper.find('[data-widget-id="recent-updates"]');
      const rows = widget.findAll('tbody tr').filter((r) => !r.attributes('aria-hidden'));
      expect(rows.length).toBe(3);
      const rowTexts = rows.map((row) => row.text().toLowerCase());
      expect(
        rowTexts.some((text) => text.includes('snoozed-nginx') && text.includes('snoozed')),
      ).toBe(true);
      expect(
        rowTexts.some((text) => text.includes('skipped-redis') && text.includes('skipped')),
      ).toBe(true);
      expect(
        rowTexts.some(
          (text) => text.includes('maturity-blocked-postgres') && text.includes('maturity-blocked'),
        ),
      ).toBe(true);
    });

    it('uses the latest audit outcome to render each row status', async () => {
      const containers = [
        makeContainer({ id: 'c1', name: 'redis', currentTag: '6.0.0', newTag: '7.0.0' }),
      ];
      const wrapper = await mountDashboard(
        containers,
        [],
        {},
        {
          auditEntries: [
            {
              id: 'a1',
              timestamp: '2026-02-28T10:00:00.000Z',
              action: 'update-failed',
              containerName: 'redis',
              status: 'error',
            },
          ],
        },
      );

      const widget = wrapper.find('[data-widget-id="recent-updates"]');
      const rows = widget.findAll('tbody tr').filter((r) => !r.attributes('aria-hidden'));
      expect(rows.length).toBe(1);
      expect(rows[0].text()).toContain('redis');
    });

    it('does not include registry check failures in recent updates', async () => {
      const containers = [
        makeContainer({
          id: 'c1',
          name: 'registry-fail',
          newTag: null,
          updateKind: null,
          registryError: 'Registry request failed: unauthorized',
        }),
        makeContainer({
          id: 'c2',
          name: 'has-update',
          newTag: '2.0.0',
          updateKind: 'major',
        }),
      ];
      const wrapper = await mountDashboard(containers);
      const widget = wrapper.find('[data-widget-id="recent-updates"]');
      const rows = widget.findAll('tbody tr').filter((r) => !r.attributes('aria-hidden'));
      const errorRow = rows.find((r) => r.text().includes('registry-fail'));
      const pendingRow = rows.find((r) => r.text().includes('has-update'));

      expect(errorRow).toBeUndefined();
      expect(pendingRow).toBeDefined();
    });

    it('renders release notes links when available in recent updates rows', async () => {
      const containers = [
        makeContainer({
          id: 'c1',
          name: 'api',
          newTag: '2.0.0',
          releaseLink: 'https://example.com/releases/api-2.0.0',
        }),
      ];

      const wrapper = await mountDashboard(containers);
      const releaseLink = wrapper
        .find('[data-widget-id="recent-updates"]')
        .find('a[href="https://example.com/releases/api-2.0.0"]');

      expect(releaseLink.exists()).toBe(true);
      expect(releaseLink.text()).toContain('Release notes');
    });

    it('shows an empty state when no recent updates are available', async () => {
      const wrapper = await mountDashboard([makeContainer()]);
      const widget = wrapper.find('[data-widget-id="recent-updates"]');
      expect(widget.text()).toContain('No updates available');
    });

    it('shows the same empty state when there are zero containers', async () => {
      const wrapper = await mountDashboard([]);
      const widget = wrapper.find('[data-widget-id="recent-updates"]');
      expect(widget.text()).toContain('No updates available');
    });
  });

  describe('security donut chart', () => {
    it('shows total image count in the donut center', async () => {
      const containers = [
        makeContainer({ bouncer: 'safe', image: 'nginx' }),
        makeContainer({ id: 'c2', name: 'redis', image: 'redis', bouncer: 'unsafe' }),
        makeContainer({ id: 'c3', name: 'postgres', image: 'postgres', bouncer: 'blocked' }),
      ];
      const wrapper = await mountDashboard(containers);
      // The donut center shows total count
      const donutCenter = wrapper.find('.absolute.inset-0');
      expect(donutCenter.text()).toContain('3');
      expect(donutCenter.text()).toContain('images');
    });

    it('shows clean and issue counts in the legend', async () => {
      const containers = [
        makeContainer({ bouncer: 'safe', image: 'nginx' }),
        makeContainer({ id: 'c2', name: 'redis', image: 'redis', bouncer: 'safe' }),
        makeContainer({ id: 'c3', name: 'postgres', image: 'postgres', bouncer: 'blocked' }),
      ];
      const wrapper = await mountDashboard(containers);
      expect(wrapper.text()).toContain('2 Clean');
      expect(wrapper.text()).toContain('1 Issues');
    });

    it('shows a severity breakdown when scan summaries are available', async () => {
      const containers = [
        {
          ...makeContainer({ id: 'c1', name: 'api', bouncer: 'blocked' }),
          securityScanState: 'scanned',
          securitySummary: { critical: 1, high: 2, medium: 0, low: 1, unknown: 0 },
        },
        {
          ...makeContainer({ id: 'c2', name: 'web', bouncer: 'safe' }),
          securityScanState: 'scanned',
          securitySummary: { critical: 0, high: 0, medium: 3, low: 0, unknown: 0 },
        },
      ] as Array<
        Container & {
          securitySummary?: {
            critical: number;
            high: number;
            medium: number;
            low: number;
            unknown: number;
          };
        }
      >;

      const wrapper = await mountDashboard(containers as Container[]);
      const severityBreakdown = wrapper.find('[data-test="security-severity-breakdown"]');

      expect(severityBreakdown.exists()).toBe(true);
      expect(severityBreakdown.text()).toContain('1 Critical');
      expect(severityBreakdown.text()).toContain('2 High');
      expect(severityBreakdown.text()).toContain('3 Medium');
      expect(severityBreakdown.text()).toContain('1 Low');
    });

    it('hides issues legend when no issues exist', async () => {
      const containers = [makeContainer({ bouncer: 'safe' })];
      const wrapper = await mountDashboard(containers);
      expect(wrapper.text()).toContain('1 Clean');
      // The danger donut ring should not render (v-if="securityIssueCount > 0")
      const dangerCircles = wrapper.findAll('circle[stroke="var(--dd-danger)"]');
      expect(dangerCircles.length).toBe(0);
    });

    it('shows not scanned containers separately from clean in the legend', async () => {
      const containers = [
        { ...makeContainer({ bouncer: 'safe', image: 'nginx' }), securityScanState: 'scanned' },
        {
          ...makeContainer({ id: 'c2', name: 'redis', image: 'redis', bouncer: 'safe' }),
          securityScanState: 'not-scanned',
        },
        {
          ...makeContainer({ id: 'c3', name: 'postgres', image: 'postgres', bouncer: 'blocked' }),
          securityScanState: 'scanned',
        },
      ] as Container[];
      const wrapper = await mountDashboard(containers);
      expect(wrapper.text()).toContain('1 Clean');
      expect(wrapper.text()).toContain('1 Issues');
      expect(wrapper.text()).toContain('1 Not Scanned');
    });

    it('shows the zero-image security state when no images are available', async () => {
      const wrapper = await mountDashboard([]);
      const securityWidget = wrapper.find('[data-widget-id="security-overview"]');

      expect(securityWidget.text()).toContain('0');
      expect(securityWidget.text()).toContain('images');
      expect(securityWidget.text()).toContain('No vulnerabilities reported');
    });
  });

  describe('server list', () => {
    it('always includes Local server', async () => {
      const wrapper = await mountDashboard([makeContainer()]);
      expect(wrapper.text()).toContain('Local');
    });

    it('includes agents as remote hosts', async () => {
      const containers = [
        makeContainer({ server: 'Local' }),
        makeContainer({ id: 'c2', name: 'redis', server: 'agent-1' }),
      ];
      const agents = [{ name: 'agent-1', connected: true }];
      const wrapper = await mountDashboard(containers, agents);
      expect(wrapper.text()).toContain('agent-1');
    });

    it('shows disconnected status for offline agents', async () => {
      const agents = [{ name: 'offline-agent', connected: false }];
      const wrapper = await mountDashboard([], agents);
      expect(wrapper.text()).toContain('offline-agent');
      expect(wrapper.text()).toContain('disconnected');
    });

    it('shows container counts per server', async () => {
      const containers = [
        makeContainer({ server: 'Local' }),
        makeContainer({ id: 'c2', name: 'redis', server: 'Local' }),
      ];
      const wrapper = await mountDashboard(containers);
      // "2/2 containers" for Local (both running)
      expect(wrapper.text()).toContain('2/2 containers');
    });

    it('shows agent host and port in host status rows', async () => {
      const wrapper = await mountDashboard(
        [makeContainer({ id: 'c2', name: 'worker', server: 'edge-1' })],
        [{ name: 'edge-1', connected: true, host: '10.0.0.11', port: 2376 }],
      );

      const hostWidget = wrapper.find('[data-widget-id="host-status"]');
      expect(hostWidget.text()).toContain('10.0.0.11:2376');
    });
  });

  describe('vulnerabilities list', () => {
    it('shows blocked containers as CRITICAL severity', async () => {
      const containers = [makeContainer({ bouncer: 'blocked', name: 'bad-container' })];
      const wrapper = await mountDashboard(containers);
      expect(wrapper.text()).toContain('CRITICAL');
      expect(wrapper.text()).toContain('bad-container');
    });

    it('shows unsafe containers as HIGH severity', async () => {
      const containers = [makeContainer({ bouncer: 'unsafe', name: 'risky-one' })];
      const wrapper = await mountDashboard(containers);
      expect(wrapper.text()).toContain('HIGH');
      expect(wrapper.text()).toContain('risky-one');
    });

    it('limits vulnerabilities to 5 entries', async () => {
      const containers = Array.from({ length: 8 }, (_, i) =>
        makeContainer({
          id: `c${i}`,
          name: `vuln-${i}`,
          bouncer: 'blocked',
        }),
      );
      const wrapper = await mountDashboard(containers);
      // Top Vulnerabilities section lists at most 5
      const vulnItems = wrapper.findAll('.space-y-2\\.5 > div');
      expect(vulnItems.length).toBe(5);
    });

    it('applies shared scroll containment utilities to the top vulnerabilities list', async () => {
      const containers = Array.from({ length: 8 }, (_, i) =>
        makeContainer({
          id: `c${i}`,
          name: `vuln-${i}`,
          bouncer: 'blocked',
        }),
      );
      const wrapper = await mountDashboard(containers);
      const scrollViewport = wrapper.find('[data-widget-id="security-overview"] .overflow-y-auto');

      expect(scrollViewport.exists()).toBe(true);
      expect(scrollViewport.classes()).toContain('overscroll-contain');
      expect(scrollViewport.classes()).toContain('dd-scroll-stable');
      expect(scrollViewport.classes()).toContain('dd-touch-scroll');
    });

    it('shows an empty state when there are no security issues', async () => {
      const wrapper = await mountDashboard([makeContainer({ bouncer: 'safe' })]);
      const securityWidget = wrapper.find('[data-widget-id="security-overview"]');
      expect(securityWidget.text()).toContain('No vulnerabilities reported');
    });
  });

  describe('update breakdown', () => {
    it('counts major updates', async () => {
      const containers = [
        makeContainer({ updateKind: 'major', newTag: '2.0.0' }),
        makeContainer({ id: 'c2', name: 'redis', updateKind: 'major', newTag: '3.0.0' }),
      ];
      const wrapper = await mountDashboard(containers);
      // The breakdown grid has a "Major" label
      expect(wrapper.text()).toContain('Major');
    });

    it('counts all four update kinds', async () => {
      const containers = [
        makeContainer({ updateKind: 'major', newTag: '2.0.0' }),
        makeContainer({ id: 'c2', name: 'redis', updateKind: 'minor', newTag: '1.1.0' }),
        makeContainer({ id: 'c3', name: 'pg', updateKind: 'patch', newTag: '1.0.1' }),
        makeContainer({ id: 'c4', name: 'mongo', updateKind: 'digest', newTag: 'sha256:abc' }),
      ];
      const wrapper = await mountDashboard(containers);
      expect(wrapper.text()).toContain('Major');
      expect(wrapper.text()).toContain('Minor');
      expect(wrapper.text()).toContain('Patch');
      expect(wrapper.text()).toContain('Digest');
    });

    it('does not re-filter update kinds on unrelated renders', async () => {
      const containers = [
        makeContainer({ updateKind: 'major', newTag: '2.0.0' }),
        makeContainer({ id: 'c2', name: 'redis', updateKind: 'minor', newTag: '1.1.0' }),
        makeContainer({ id: 'c3', name: 'pg', updateKind: 'patch', newTag: '1.0.1' }),
        makeContainer({ id: 'c4', name: 'mongo', updateKind: 'digest', newTag: 'sha256:abc' }),
      ];
      const containerFilterSpy = vi.spyOn(containers, 'filter');
      try {
        const wrapper = await mountDashboard(containers);
        const initialFilterCalls = containerFilterSpy.mock.calls.length;

        await wrapper.find('[data-widget-id="stat-containers"]').trigger('dragstart');
        await flushPromises();

        expect(containerFilterSpy.mock.calls.length).toBe(initialFilterCalls);
      } finally {
        containerFilterSpy.mockRestore();
      }
    });

    it('shows an empty state when no updates are pending', async () => {
      const wrapper = await mountDashboard([makeContainer()]);
      const updateWidget = wrapper.find('[data-widget-id="update-breakdown"]');
      expect(updateWidget.text()).toContain('No updates to categorize');
    });

    it('renders update buckets when updates exist but kinds are unknown', async () => {
      const wrapper = await mountDashboard([
        makeContainer({
          id: 'c1',
          name: 'uncategorized',
          newTag: 'latest',
          updateKind: 'non-semver' as any,
        }),
      ]);
      const updateWidget = wrapper.find('[data-widget-id="update-breakdown"]');

      expect(updateWidget.text()).not.toContain('No updates to categorize');
      expect(updateWidget.text()).toContain('Major');
      expect(updateWidget.text()).toContain('Minor');
      expect(updateWidget.text()).toContain('Patch');
      expect(updateWidget.text()).toContain('Digest');
    });
  });

  describe('resource usage widget', () => {
    it('renders top cpu and memory containers from stats summary SSE stream', async () => {
      const wrapper = await mountDashboard(
        [makeContainer()],
        [],
        {},
        {
          statsSummary: {
            timestamp: '2026-03-14T10:00:00.000Z',
            watchedCount: 2,
            totalCpuPercent: 55.0,
            totalMemoryUsageBytes: 800,
            totalMemoryLimitBytes: 1_600,
            totalMemoryPercent: 50.0,
            topCpu: [
              {
                id: 'c2',
                name: 'db',
                cpuPercent: 80,
                memoryUsageBytes: 500,
                memoryLimitBytes: 1_000,
                memoryPercent: 50,
              },
              {
                id: 'c1',
                name: 'web',
                cpuPercent: 30,
                memoryUsageBytes: 300,
                memoryLimitBytes: 600,
                memoryPercent: 50,
              },
            ],
            topMemory: [
              {
                id: 'c2',
                name: 'db',
                cpuPercent: 80,
                memoryUsageBytes: 500,
                memoryLimitBytes: 1_000,
                memoryPercent: 50,
              },
              {
                id: 'c1',
                name: 'web',
                cpuPercent: 30,
                memoryUsageBytes: 300,
                memoryLimitBytes: 600,
                memoryPercent: 50,
              },
            ],
          },
        },
      );

      const resourceWidget = wrapper.find('[data-widget-id="resource-usage"]');
      expect(resourceWidget.text()).toContain('Resource Usage');
      expect(resourceWidget.text()).toContain('Top CPU');
      expect(resourceWidget.text()).toContain('Top Memory');
      expect(resourceWidget.text()).toContain('db');
      expect(resourceWidget.text()).toContain('web');
      expect(resourceWidget.text()).toContain('55.0%');
      expect(resourceWidget.text()).toContain('800 B / 1.6 KB');
    });

    it('renders widget with EMPTY_SUMMARY when summary is null on first render', async () => {
      // getStatsSummary rejects — summary remains null — widget gets EMPTY_SUMMARY
      mockGetStatsSummary.mockRejectedValue(new Error('not ready'));
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

      const wrapper = await mountDashboard([makeContainer()]);

      const resourceWidget = wrapper.find('[data-widget-id="resource-usage"]');
      expect(resourceWidget.exists()).toBe(true);
      // With empty summary: 0% cpu, no memory limit, no containers in top lists
      expect(resourceWidget.text()).toContain('0.0%');
      expect(resourceWidget.text()).toContain('No live CPU data');
      expect(resourceWidget.text()).toContain('No live memory data');

      debugSpy.mockRestore();
    });
  });

  describe('dashboard widget ordering', () => {
    it('hydrates widget order from preferences', async () => {
      const { preferences } = await import('@/preferences/store');
      preferences.dashboard.widgetOrder = [
        'stat-containers',
        'stat-updates',
        'stat-security',
        'stat-registries',
        'host-status',
        'recent-updates',
        'security-overview',
        'resource-usage',
        'update-breakdown',
      ];

      const wrapper = await mountDashboard([makeContainer({ newTag: '2.0.0' })]);

      expect(wrapper.find('[data-widget-id="host-status"]').attributes('data-widget-order')).toBe(
        '4',
      );
      expect(
        wrapper.find('[data-widget-id="recent-updates"]').attributes('data-widget-order'),
      ).toBe('5');
      expect(
        wrapper.find('[data-widget-id="security-overview"]').attributes('data-widget-order'),
      ).toBe('6');
      expect(
        wrapper.find('[data-widget-id="resource-usage"]').attributes('data-widget-order'),
      ).toBe('7');
    });

    it('reorders widgets on drop and persists the new order', async () => {
      const wrapper = await mountDashboard([makeContainer({ newTag: '2.0.0' })]);

      const draggedWidget = wrapper.find('[data-widget-id="update-breakdown"]');
      const targetWidget = wrapper.find('[data-widget-id="recent-updates"]');
      const dataTransfer = {
        setData: vi.fn(),
        getData: vi.fn(() => 'update-breakdown'),
        effectAllowed: 'move',
        dropEffect: 'move',
      };

      await draggedWidget.trigger('dragstart', { dataTransfer });
      await targetWidget.trigger('dragover', { dataTransfer });
      await targetWidget.trigger('drop', { dataTransfer });
      await draggedWidget.trigger('dragend');

      expect(
        wrapper.find('[data-widget-id="update-breakdown"]').attributes('data-widget-order'),
      ).toBe('8');
      expect(
        wrapper.find('[data-widget-id="recent-updates"]').attributes('data-widget-order'),
      ).toBe('4');
      const { flushPreferences } = await import('@/preferences/store');
      flushPreferences();
      const prefs = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) || '{}');
      expect(prefs.dashboard.widgetOrder).toEqual([
        'stat-containers',
        'stat-updates',
        'stat-security',
        'stat-registries',
        'recent-updates',
        'security-overview',
        'resource-usage',
        'host-status',
        'update-breakdown',
      ]);
    });

    it('reorders stat cards on drop', async () => {
      const wrapper = await mountDashboard([makeContainer({ newTag: '2.0.0' })]);

      const draggedStat = wrapper.find('[data-widget-id="stat-registries"]');
      const targetStat = wrapper.find('[data-widget-id="stat-containers"]');
      const dataTransfer = {
        setData: vi.fn(),
        getData: vi.fn(() => 'stat-registries'),
        effectAllowed: 'move',
        dropEffect: 'move',
      };

      await draggedStat.trigger('dragstart', { dataTransfer });
      await targetStat.trigger('dragover', { dataTransfer });
      await targetStat.trigger('drop', { dataTransfer });
      await draggedStat.trigger('dragend');

      expect(
        wrapper.find('[data-widget-id="stat-registries"]').attributes('data-widget-order'),
      ).toBe('3');
      expect(
        wrapper.find('[data-widget-id="stat-containers"]').attributes('data-widget-order'),
      ).toBe('0');
    });
  });

  describe('navigation', () => {
    it('renders View all links', async () => {
      const wrapper = await mountDashboard([makeContainer()]);
      const links = wrapper.findAll('button').filter((b) => b.text().includes('View all'));
      expect(links.length).toBeGreaterThanOrEqual(3);
    });

    it('routes stat cards to the expected pages', async () => {
      const wrapper = await mountDashboard([
        makeContainer({ updateKind: 'major', newTag: '2.0.0' }),
      ]);
      const statCards = wrapper.findAll('.stat-card');

      const containersCard = statCards.find((c) => c.text().includes('Containers'));
      await containersCard?.trigger('click');
      expect(mockRouterPush).toHaveBeenCalledWith('/containers');

      const updatesCard = statCards.find((c) => c.text().includes('Updates Available'));
      await updatesCard?.trigger('click');
      expect(mockRouterPush).toHaveBeenCalledWith({
        path: '/containers',
        query: { filterKind: 'any' },
      });

      const securityCard = statCards.find((c) => c.text().includes('Security Issues'));
      await securityCard?.trigger('click');
      expect(mockRouterPush).toHaveBeenCalledWith('/security');

      const registriesCard = statCards.find((c) => c.text().includes('Registries'));
      await registriesCard?.trigger('click');
      expect(mockRouterPush).toHaveBeenCalledWith('/registries');
    });

    it('routes update view-all buttons with has-update filter', async () => {
      const wrapper = await mountDashboard([
        makeContainer({ updateKind: 'minor', newTag: '1.2.0' }),
      ]);
      const recentUpdatesViewAll = wrapper
        .find('[data-widget-id="recent-updates"]')
        .findAll('button')
        .filter((b) => b.text().includes('View all'))[0];
      const updateBreakdownViewAll = wrapper
        .find('[data-widget-id="update-breakdown"]')
        .find('button');

      await recentUpdatesViewAll.trigger('click');
      expect(mockRouterPush).toHaveBeenCalledWith({
        path: '/containers',
        query: { filterKind: 'any' },
      });

      await updateBreakdownViewAll.trigger('click');
      expect(mockRouterPush).toHaveBeenLastCalledWith({
        path: '/containers',
        query: { filterKind: 'any' },
      });
    });
  });

  describe('container service coverage guard', () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    it('fetches container groups', async () => {
      const { getContainerGroups } =
        await vi.importActual<typeof import('@/services/container')>('@/services/container');
      const groups = [{ name: 'core' }];
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => groups,
      } as any);

      await expect(getContainerGroups()).resolves.toEqual(groups);
      expect(fetch).toHaveBeenCalledWith('/api/v1/containers/groups', { credentials: 'include' });
    });

    it('throws when fetching container groups fails', async () => {
      const { getContainerGroups } =
        await vi.importActual<typeof import('@/services/container')>('@/services/container');
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Gateway',
      } as any);

      await expect(getContainerGroups()).rejects.toThrow(
        'Failed to get container groups: Bad Gateway',
      );
    });
  });

  describe('dashboard update actions', () => {
    const pendingContainer = makeContainer({
      id: 'c-pending',
      name: 'nginx',
      newTag: '1.1.0',
      updateKind: 'minor',
    });

    const upToDateContainer = makeContainer({
      id: 'c-uptodate',
      name: 'redis',
      newTag: null,
      updateKind: null,
    });

    it('shows Update button for containers with pending updates', async () => {
      const wrapper = await mountDashboard(
        [pendingContainer],
        [],
        {},
        {
          recentStatuses: { nginx: 'pending' },
        },
      );
      const updateButtons = wrapper.findAll('[data-test="dashboard-update-btn"]');
      expect(updateButtons.length).toBeGreaterThan(0);
    });

    it('does not show Update button for containers without updates', async () => {
      const wrapper = await mountDashboard([upToDateContainer]);
      const updateButtons = wrapper.findAll('[data-test="dashboard-update-btn"]');
      expect(updateButtons.length).toBe(0);
    });

    it('shows Update All button when pending updates exist', async () => {
      const wrapper = await mountDashboard(
        [pendingContainer],
        [],
        {},
        {
          recentStatuses: { nginx: 'pending' },
        },
      );
      const updateAllBtn = wrapper.find('[data-test="dashboard-update-all-btn"]');
      expect(updateAllBtn.exists()).toBe(true);
    });

    it('does not show Update All button when no pending updates', async () => {
      const wrapper = await mountDashboard([upToDateContainer]);
      const updateAllBtn = wrapper.find('[data-test="dashboard-update-all-btn"]');
      expect(updateAllBtn.exists()).toBe(false);
    });

    it('refreshes dashboard data after bulk update when one container update fails', async () => {
      const containers = [
        makeContainer({
          id: 'c-success-1',
          name: 'nginx',
          newTag: '1.1.0',
          updateKind: 'minor',
        }),
        makeContainer({
          id: 'c-fail',
          name: 'redis',
          image: 'redis',
          newTag: '7.1.0',
          updateKind: 'minor',
        }),
        makeContainer({
          id: 'c-success-2',
          name: 'postgres',
          image: 'postgres',
          newTag: '16.1.0',
          updateKind: 'minor',
        }),
      ];
      mockUpdateContainers.mockResolvedValue({
        message: 'Container update requests processed',
        accepted: [
          { containerId: 'c-success-1', containerName: 'nginx', operationId: 'op-1' },
          { containerId: 'c-success-2', containerName: 'postgres', operationId: 'op-2' },
        ],
        rejected: [
          {
            containerId: 'c-fail',
            containerName: 'redis',
            statusCode: 500,
            message: 'update exploded',
          },
        ],
      });

      const wrapper = await mountDashboard(
        containers,
        [],
        {},
        {
          recentStatuses: {
            nginx: 'pending',
            redis: 'pending',
            postgres: 'pending',
          },
        },
      );
      const initialFetchCount = mockGetAllContainers.mock.calls.length;
      const updateAllBtn = wrapper.find('[data-test="dashboard-update-all-btn"]');
      const { useConfirmDialog } = await import('@/composables/useConfirmDialog');
      const confirm = useConfirmDialog();

      await updateAllBtn.trigger('click');
      await confirm.accept();
      await flushPromises();

      expect(mockUpdateContainers).toHaveBeenCalledWith(['c-success-1', 'c-success-2', 'c-fail']);
      expect(mockUpdateContainer).not.toHaveBeenCalled();
      expect(mockGetAllContainers.mock.calls.length).toBe(initialFetchCount + 1);
    });

    it('sends dashboard update-all through the bulk update endpoint', async () => {
      const containers = [
        makeContainer({
          id: 'c-success-1',
          name: 'nginx',
          newTag: '1.1.0',
          updateKind: 'minor',
        }),
        makeContainer({
          id: 'c-fail',
          name: 'redis',
          image: 'redis',
          newTag: '7.1.0',
          updateKind: 'minor',
        }),
        makeContainer({
          id: 'c-success-2',
          name: 'postgres',
          image: 'postgres',
          newTag: '16.1.0',
          updateKind: 'minor',
        }),
      ];
      mockUpdateContainers.mockResolvedValue({
        message: 'Container update requests processed',
        accepted: [
          { containerId: 'c-success-1', containerName: 'nginx', operationId: 'op-1' },
          { containerId: 'c-success-2', containerName: 'postgres', operationId: 'op-2' },
        ],
        rejected: [
          {
            containerId: 'c-fail',
            containerName: 'redis',
            statusCode: 409,
            message: 'Container update already queued',
          },
        ],
      });

      const wrapper = await mountDashboard(
        containers,
        [],
        {},
        {
          recentStatuses: {
            nginx: 'pending',
            redis: 'pending',
            postgres: 'pending',
          },
        },
      );
      const updateAllBtn = wrapper.find('[data-test="dashboard-update-all-btn"]');
      const { useConfirmDialog } = await import('@/composables/useConfirmDialog');
      const confirm = useConfirmDialog();

      await updateAllBtn.trigger('click');
      await confirm.accept();
      await flushPromises();

      expect(mockUpdateContainers).toHaveBeenCalledWith(['c-success-1', 'c-success-2', 'c-fail']);
      expect(mockUpdateContainer).not.toHaveBeenCalled();
    });

    it('shows phase-only queue labels immediately after dashboard update all starts', async () => {
      const containers = [
        makeContainer({
          id: 'c-success-1',
          name: 'nginx',
          newTag: '1.1.0',
          updateKind: 'minor',
        }),
        makeContainer({
          id: 'c-success-2',
          name: 'postgres',
          image: 'postgres',
          newTag: '16.1.0',
          updateKind: 'minor',
        }),
      ];
      let resolveBatch: (() => void) | undefined;
      mockUpdateContainers.mockImplementation(
        (containerIds: string[]) =>
          new Promise((resolve) => {
            resolveBatch = () =>
              resolve({
                message: 'Container update requests processed',
                accepted: containerIds.map((containerId) => ({
                  containerId,
                  containerName: containerId,
                  operationId: `op-${containerId}`,
                })),
                rejected: [],
              });
          }),
      );

      const wrapper = await mountDashboard(
        containers,
        [],
        {},
        {
          recentStatuses: {
            nginx: 'pending',
            postgres: 'pending',
          },
        },
      );
      const { mapApiContainers } = await import('@/utils/container-mapper');
      mockGetAllContainers.mockResolvedValueOnce([]);
      mockGetContainerRecentStatus.mockResolvedValueOnce({ statuses: {} });
      (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValueOnce([]);

      const updateAllBtn = wrapper.find('[data-test="dashboard-update-all-btn"]');
      const { useConfirmDialog } = await import('@/composables/useConfirmDialog');
      const confirm = useConfirmDialog();

      await updateAllBtn.trigger('click');
      void confirm.accept();
      await nextTick();

      const widgetText = wrapper.find('[data-widget-id="recent-updates"]').text();
      expect(widgetText).toContain('Updating');
      expect(widgetText).toContain('Queued');
      expect(widgetText).not.toContain('1 of 2');
      expect(widgetText).not.toContain('2 of 2');

      resolveBatch?.();
      await flushPromises();
    });

    it('keeps same-name containers on different servers distinct during dashboard update all sequencing', async () => {
      const containers = [
        makeContainer({
          id: 'c-local',
          identityKey: 'edge-a::watcher-a::nginx',
          name: 'nginx',
          server: 'Local',
          newTag: '1.1.0',
          updateKind: 'minor',
        }),
        makeContainer({
          id: 'c-edge',
          identityKey: 'edge-b::watcher-b::nginx',
          name: 'nginx',
          server: 'edge-1',
          newTag: '1.1.0',
          updateKind: 'minor',
        }),
      ];
      mockUpdateContainer.mockResolvedValue({});

      const wrapper = await mountDashboard(
        containers,
        [],
        {},
        {
          recentStatuses: {
            nginx: 'pending',
          },
        },
      );
      const { mapApiContainers } = await import('@/utils/container-mapper');
      mockGetAllContainers.mockResolvedValueOnce([]);
      mockGetContainerRecentStatus.mockResolvedValueOnce({ statuses: {} });
      (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValueOnce([]);

      const updateAllBtn = wrapper.find('[data-test="dashboard-update-all-btn"]');
      const { useConfirmDialog } = await import('@/composables/useConfirmDialog');
      const confirm = useConfirmDialog();

      await updateAllBtn.trigger('click');
      await confirm.accept();
      await flushPromises();

      expect(mockUpdateContainers).toHaveBeenCalledWith(['c-local', 'c-edge']);
      expect(mockUpdateContainer).not.toHaveBeenCalled();

      const widgetText = wrapper.find('[data-widget-id="recent-updates"]').text();
      expect(widgetText).toContain('Updating');
      expect(widgetText).toContain('Queued');
      expect(widgetText).not.toContain('1 of 2');
      expect(widgetText).not.toContain('2 of 2');
    });

    it('advances the dashboard queue label when the next bulk update becomes active', async () => {
      vi.useFakeTimers();
      try {
        const firstPendingContainer = makeContainer({
          id: 'c-success-1',
          name: 'nginx',
          newTag: '1.1.0',
          updateKind: 'minor',
        });
        const secondPendingContainer = makeContainer({
          id: 'c-success-2',
          name: 'postgres',
          image: 'postgres',
          newTag: '16.1.0',
          updateKind: 'minor',
        });
        const secondUpdatingContainer = makeContainer({
          id: 'c-success-2',
          name: 'postgres',
          image: 'postgres',
          newTag: null,
          updateKind: null,
          status: 'stopped',
          updateOperation: {
            id: 'op-2',
            status: 'in-progress',
            phase: 'old-stopped',
            updatedAt: '2026-04-01T12:00:02.000Z',
            fromVersion: '15.0.0',
            toVersion: '16.1.0',
          },
        });
        const firstUpdatedContainer = makeContainer({
          id: 'c-success-1',
          name: 'nginx',
          newTag: null,
          updateKind: null,
        });
        mockUpdateContainer.mockResolvedValue({});

        const wrapper = await mountDashboard(
          [firstPendingContainer, secondPendingContainer],
          [],
          {},
          {
            recentStatuses: {
              nginx: 'pending',
              postgres: 'pending',
            },
          },
        );
        const { mapApiContainers } = await import('@/utils/container-mapper');

        mockGetAllContainers.mockResolvedValueOnce([]);
        mockGetContainerRecentStatus.mockResolvedValueOnce({ statuses: {} });
        (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValueOnce([]);

        mockGetAllContainers.mockResolvedValueOnce([
          firstUpdatedContainer,
          secondUpdatingContainer,
        ]);
        mockGetContainerRecentStatus.mockResolvedValueOnce({ statuses: {} });
        (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValueOnce([
          firstUpdatedContainer,
          secondUpdatingContainer,
        ]);

        const updateAllBtn = wrapper.find('[data-test="dashboard-update-all-btn"]');
        const { useConfirmDialog } = await import('@/composables/useConfirmDialog');
        const confirm = useConfirmDialog();

        await updateAllBtn.trigger('click');
        await confirm.accept();
        await flushPromises();

        vi.advanceTimersByTime(2_000);
        await flushPromises();

        const widgetText = wrapper.find('[data-widget-id="recent-updates"]').text();
        expect(widgetText).toContain('Updating');
        expect(widgetText).not.toContain('Queued');
        expect(widgetText).not.toContain('2 of 2');
      } finally {
        vi.useRealTimers();
      }
    });

    it('shows an inline error when a single dashboard update fails', async () => {
      mockUpdateContainer.mockRejectedValueOnce(new Error('update exploded'));
      const wrapper = await mountDashboard(
        [pendingContainer],
        [],
        {},
        {
          recentStatuses: { nginx: 'pending' },
        },
      );
      const { useConfirmDialog } = await import('@/composables/useConfirmDialog');
      const confirm = useConfirmDialog();

      await wrapper.find('[data-test="dashboard-update-btn"]').trigger('click');
      await confirm.accept();
      await flushPromises();

      const updateError = wrapper.find('[data-test="dashboard-update-error"]');
      expect(updateError.exists()).toBe(true);
      expect(updateError.text()).toContain('update exploded');
    });

    it('shows the shared update-started toast when a single dashboard update starts successfully', async () => {
      mockUpdateContainer.mockResolvedValueOnce({});
      const wrapper = await mountDashboard(
        [pendingContainer],
        [],
        {},
        {
          recentStatuses: { nginx: 'pending' },
        },
      );
      const { useConfirmDialog } = await import('@/composables/useConfirmDialog');
      const confirm = useConfirmDialog();
      const { toasts } = useToast();

      await wrapper.find('[data-test="dashboard-update-btn"]').trigger('click');
      await confirm.accept();
      await flushPromises();

      expect(
        toasts.value.some(
          (toast) => toast.tone === 'success' && toast.title === 'Update started: nginx',
        ),
      ).toBe(true);
    });

    it('refreshes immediately and removes a stale dashboard row when update reports no update available', async () => {
      mockUpdateContainer.mockRejectedValueOnce(
        new Error('No update available for this container'),
      );

      const wrapper = await mountDashboard(
        [pendingContainer],
        [],
        {},
        {
          recentStatuses: { nginx: 'pending' },
        },
      );
      const initialFetchCount = mockGetAllContainers.mock.calls.length;
      mockGetAllContainers.mockResolvedValueOnce([upToDateContainer]);
      mockGetContainerRecentStatus.mockResolvedValueOnce({ statuses: {} });
      const { mapApiContainers } = await import('@/utils/container-mapper');
      (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValueOnce([upToDateContainer]);

      const { useConfirmDialog } = await import('@/composables/useConfirmDialog');
      const confirm = useConfirmDialog();

      expect(wrapper.findAll('[data-test="dashboard-update-btn"]')).toHaveLength(1);

      await wrapper.find('[data-test="dashboard-update-btn"]').trigger('click');
      await confirm.accept();
      await flushPromises();

      expect(mockGetAllContainers.mock.calls.length).toBe(initialFetchCount + 1);
      expect(wrapper.findAll('[data-test="dashboard-update-btn"]')).toHaveLength(0);
      expect(wrapper.find('[data-test="dashboard-update-error"]').exists()).toBe(false);
      expect(wrapper.find('[data-widget-id="recent-updates"]').text()).toContain(
        'No updates available',
      );
    });

    it('shows an info toast when a dashboard update is already up to date', async () => {
      mockUpdateContainer.mockRejectedValueOnce(
        new Error('No update available for this container'),
      );

      const wrapper = await mountDashboard(
        [pendingContainer],
        [],
        {},
        {
          recentStatuses: { nginx: 'pending' },
        },
      );
      mockGetAllContainers.mockResolvedValueOnce([upToDateContainer]);
      mockGetContainerRecentStatus.mockResolvedValueOnce({ statuses: {} });
      const { mapApiContainers } = await import('@/utils/container-mapper');
      (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValueOnce([upToDateContainer]);

      const { useConfirmDialog } = await import('@/composables/useConfirmDialog');
      const confirm = useConfirmDialog();
      const { toasts } = useToast();

      await wrapper.find('[data-test="dashboard-update-btn"]').trigger('click');
      await confirm.accept();
      await flushPromises();

      expect(
        toasts.value.some(
          (toast) => toast.tone === 'info' && toast.title === 'Already up to date: nginx',
        ),
      ).toBe(true);
    });

    it('keeps a live dashboard row in Updating while the backend reports an in-progress operation', async () => {
      const updatingContainer = makeContainer({
        id: 'c-pending',
        name: 'nginx',
        newTag: null,
        updateKind: null,
        status: 'stopped',
        updateOperation: {
          id: 'op-1',
          status: 'in-progress',
          phase: 'old-stopped',
          updatedAt: '2026-04-01T12:00:00.000Z',
          fromVersion: '1.0.0',
          toVersion: '1.1.0',
        },
      });

      const wrapper = await mountDashboard([updatingContainer]);

      const widget = wrapper.find('[data-widget-id="recent-updates"]');
      expect(widget.text()).toContain('Updating');
      expect(widget.find('[data-test="dashboard-update-btn"]').exists()).toBe(false);
    });

    it('renders persisted backend queue labels after a dashboard reload', async () => {
      const queuedFirstContainer = makeContainer({
        id: 'c-first',
        name: 'nginx',
        newTag: null,
        updateKind: null,
        status: 'stopped',
        updateOperation: {
          id: 'op-1',
          status: 'queued',
          phase: 'queued',
          updatedAt: '2026-04-01T12:00:00.000Z',
          fromVersion: '1.0.0',
          toVersion: '1.1.0',
          batchId: 'batch-1',
          queuePosition: 1,
          queueTotal: 2,
        },
      });
      const queuedSecondContainer = makeContainer({
        id: 'c-second',
        name: 'postgres',
        image: 'postgres',
        newTag: null,
        updateKind: null,
        status: 'stopped',
        updateOperation: {
          id: 'op-2',
          status: 'queued',
          phase: 'queued',
          updatedAt: '2026-04-01T12:00:00.000Z',
          fromVersion: '15.0.0',
          toVersion: '16.1.0',
          batchId: 'batch-1',
          queuePosition: 2,
          queueTotal: 2,
        },
      });

      const wrapper = await mountDashboard([queuedFirstContainer, queuedSecondContainer]);

      const widgetText = wrapper.find('[data-widget-id="recent-updates"]').text();
      expect(widgetText).toContain('Queued');
      expect(widgetText).not.toContain('Updating 1 of 2');
      expect(widgetText).not.toContain('Queued 2 of 2');
    });

    it('keeps a dashboard row visible as updating until the container reappears', async () => {
      vi.useFakeTimers();
      try {
        const updatedContainer = makeContainer({
          id: 'c-pending-recreated',
          identityKey: pendingContainer.identityKey,
          name: pendingContainer.name,
          newTag: null,
          updateKind: null,
        });
        mockUpdateContainer.mockResolvedValueOnce({});

        const wrapper = await mountDashboard(
          [pendingContainer],
          [],
          {},
          {
            recentStatuses: { nginx: 'pending' },
          },
        );
        const { mapApiContainers } = await import('@/utils/container-mapper');

        mockGetAllContainers.mockResolvedValueOnce([]);
        mockGetContainerRecentStatus.mockResolvedValueOnce({ statuses: {} });
        (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValueOnce([]);

        const { useConfirmDialog } = await import('@/composables/useConfirmDialog');
        const confirm = useConfirmDialog();

        await wrapper.find('[data-test="dashboard-update-btn"]').trigger('click');
        await confirm.accept();
        await flushPromises();

        expect(wrapper.find('[data-widget-id="recent-updates"]').text()).toContain('Updating');

        mockGetAllContainers.mockResolvedValueOnce([updatedContainer]);
        mockGetContainerRecentStatus.mockResolvedValueOnce({ statuses: {} });
        (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValueOnce([updatedContainer]);

        vi.advanceTimersByTime(2_000);
        await flushPromises();

        expect(wrapper.find('[data-widget-id="recent-updates"]').text()).not.toContain('Updating');
        expect(wrapper.find('[data-widget-id="recent-updates"]').text()).toContain(
          'No updates available',
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('backs off dashboard pending-update polling when only ghost updating rows remain', async () => {
      vi.useFakeTimers();
      try {
        mockUpdateContainer.mockResolvedValueOnce({});

        const wrapper = await mountDashboard(
          [pendingContainer],
          [],
          {},
          {
            recentStatuses: { nginx: 'pending' },
          },
        );
        const { mapApiContainers } = await import('@/utils/container-mapper');

        mockGetAllContainers.mockResolvedValueOnce([]);
        mockGetContainerRecentStatus.mockResolvedValueOnce({ statuses: {} });
        (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValueOnce([]);

        mockGetAllContainers.mockResolvedValueOnce([]);
        mockGetContainerRecentStatus.mockResolvedValueOnce({ statuses: {} });
        (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValueOnce([]);

        const { useConfirmDialog } = await import('@/composables/useConfirmDialog');
        const confirm = useConfirmDialog();

        await wrapper.find('[data-test="dashboard-update-btn"]').trigger('click');
        await confirm.accept();
        await flushPromises();

        const fetchCountAfterImmediateRefresh = mockGetAllContainers.mock.calls.length;

        vi.advanceTimersByTime(2_000);
        await flushPromises();
        expect(mockGetAllContainers.mock.calls.length).toBe(fetchCountAfterImmediateRefresh + 1);

        vi.advanceTimersByTime(2_000);
        await flushPromises();
        expect(mockGetAllContainers.mock.calls.length).toBe(fetchCountAfterImmediateRefresh + 1);

        vi.advanceTimersByTime(2_000);
        await flushPromises();
        expect(mockGetAllContainers.mock.calls.length).toBe(fetchCountAfterImmediateRefresh + 2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('shows an inline error when update failure only contains the stale-update text as a substring', async () => {
      mockUpdateContainer.mockRejectedValueOnce(
        new Error('Proxy error: No update available for this container'),
      );

      const wrapper = await mountDashboard(
        [pendingContainer],
        [],
        {},
        {
          recentStatuses: { nginx: 'pending' },
        },
      );
      const initialFetchCount = mockGetAllContainers.mock.calls.length;
      const { useConfirmDialog } = await import('@/composables/useConfirmDialog');
      const confirm = useConfirmDialog();

      await wrapper.find('[data-test="dashboard-update-btn"]').trigger('click');
      await confirm.accept();
      await flushPromises();

      expect(mockGetAllContainers.mock.calls.length).toBe(initialFetchCount);
      const updateError = wrapper.find('[data-test="dashboard-update-error"]');
      expect(updateError.exists()).toBe(true);
      expect(updateError.text()).toContain('Proxy error: No update available for this container');
    });

    it('clears dashboard update error after a successful retry', async () => {
      mockUpdateContainer
        .mockRejectedValueOnce(new Error('temporary failure'))
        .mockResolvedValueOnce({});

      const wrapper = await mountDashboard(
        [pendingContainer],
        [],
        {},
        {
          recentStatuses: { nginx: 'pending' },
        },
      );
      const { useConfirmDialog } = await import('@/composables/useConfirmDialog');
      const confirm = useConfirmDialog();

      await wrapper.find('[data-test="dashboard-update-btn"]').trigger('click');
      await confirm.accept();
      await flushPromises();
      expect(wrapper.find('[data-test="dashboard-update-error"]').exists()).toBe(true);

      await wrapper.find('[data-test="dashboard-update-btn"]').trigger('click');
      await confirm.accept();
      await flushPromises();
      expect(wrapper.find('[data-test="dashboard-update-error"]').exists()).toBe(false);
    });

    it('shows the shared batch update-started toast from dashboard update all', async () => {
      const containers = [
        makeContainer({
          id: 'c-success-1',
          name: 'nginx',
          newTag: '1.1.0',
          updateKind: 'minor',
        }),
        makeContainer({
          id: 'c-success-2',
          name: 'postgres',
          image: 'postgres',
          newTag: '16.1.0',
          updateKind: 'minor',
        }),
      ];
      mockUpdateContainer.mockResolvedValue({});

      const wrapper = await mountDashboard(
        containers,
        [],
        {},
        {
          recentStatuses: {
            nginx: 'pending',
            postgres: 'pending',
          },
        },
      );
      const updateAllBtn = wrapper.find('[data-test="dashboard-update-all-btn"]');
      const { useConfirmDialog } = await import('@/composables/useConfirmDialog');
      const confirm = useConfirmDialog();
      const { toasts } = useToast();

      await updateAllBtn.trigger('click');
      await confirm.accept();
      await flushPromises();

      expect(
        toasts.value.some(
          (toast) => toast.tone === 'success' && toast.title === 'Queued updates for 2 containers',
        ),
      ).toBe(true);
    });

    it('shows the Updating badge immediately on click before the API call resolves (Fix A optimistic state)', async () => {
      // Defect 1: the badge was only rendered after capturePendingDashboardRows ran
      // post-fetch, meaning a full round-trip elapsed before the row showed any
      // in-progress indicator. dashboardUpdatingById should be set synchronously
      // on the accept handler before the API call, so nextTick is enough.
      let resolveUpdate: (() => void) | undefined;
      mockUpdateContainer.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveUpdate = resolve;
          }),
      );

      const wrapper = await mountDashboard(
        [pendingContainer],
        [],
        {},
        { recentStatuses: { nginx: 'pending' } },
      );

      const { useConfirmDialog } = await import('@/composables/useConfirmDialog');
      const confirm = useConfirmDialog();

      await wrapper.find('[data-test="dashboard-update-btn"]').trigger('click');
      // Accept synchronously — do NOT await so the API promise stays pending
      void confirm.accept();
      await nextTick();

      // The Updating badge should appear before the API resolves
      const widgetText = wrapper.find('[data-widget-id="recent-updates"]').text();
      expect(widgetText).toContain('Updating');

      // Cleanup: resolve the pending promise
      resolveUpdate?.();
      await flushPromises();
    });

    it('clears optimistic updating state when the API returns stale/up-to-date', async () => {
      // Optimistic state should be removed when the operation resolves as stale
      // so the row returns to its normal pending state rather than staying stuck
      // showing an "Updating" badge.
      mockUpdateContainer.mockRejectedValueOnce(
        new Error('No update available for this container'),
      );

      const wrapper = await mountDashboard(
        [pendingContainer],
        [],
        {},
        { recentStatuses: { nginx: 'pending' } },
      );
      mockGetAllContainers.mockResolvedValueOnce([pendingContainer]);
      mockGetContainerRecentStatus.mockResolvedValueOnce({ statuses: { nginx: 'pending' } });
      const { mapApiContainers } = await import('@/utils/container-mapper');
      (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValueOnce([pendingContainer]);

      const { useConfirmDialog } = await import('@/composables/useConfirmDialog');
      const confirm = useConfirmDialog();

      await wrapper.find('[data-test="dashboard-update-btn"]').trigger('click');
      await confirm.accept();
      await flushPromises();

      // After stale response, the row should no longer show Updating
      const widgetText = wrapper.find('[data-widget-id="recent-updates"]').text();
      expect(widgetText).not.toContain('Updating');
    });

    it('prunes ghost updating row immediately when a terminal SSE operation phase fires (Fix B)', async () => {
      // Defect 2: ghost rows persisted until the Docker watcher rescanned and the
      // new container id appeared in the live list. The terminal SSE phase should
      // prune the ghost immediately without waiting for watcher rediscovery.
      vi.useFakeTimers();
      try {
        mockUpdateContainer.mockResolvedValueOnce({});

        const wrapper = await mountDashboard(
          [pendingContainer],
          [],
          {},
          { recentStatuses: { nginx: 'pending' } },
        );
        const { mapApiContainers } = await import('@/utils/container-mapper');

        // After update accepted: containers list is empty (container being recreated)
        mockGetAllContainers.mockResolvedValueOnce([]);
        mockGetContainerRecentStatus.mockResolvedValueOnce({ statuses: {} });
        (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValueOnce([]);

        const { useConfirmDialog } = await import('@/composables/useConfirmDialog');
        const confirm = useConfirmDialog();

        await wrapper.find('[data-test="dashboard-update-btn"]').trigger('click');
        await confirm.accept();
        await flushPromises();

        // Ghost row should be visible at this point
        expect(wrapper.find('[data-widget-id="recent-updates"]').text()).toContain('Updating');

        // Fire a terminal SSE event for this container — succeeded phase
        globalThis.dispatchEvent(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              containerId: pendingContainer.id,
              containerName: pendingContainer.name,
              status: 'succeeded',
              phase: 'succeeded',
            },
          }),
        );
        await nextTick();

        // Ghost should be pruned immediately without waiting for watcher rediscovery
        expect(wrapper.find('[data-widget-id="recent-updates"]').text()).not.toContain('Updating');
        expect(wrapper.find('[data-widget-id="recent-updates"]').text()).toContain(
          'No updates available',
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not prune ghost rows for non-terminal SSE operation phases', async () => {
      // In-progress phases like old-stopped should not trigger ghost pruning —
      // only terminal statuses (succeeded, failed, rolled-back) should.
      vi.useFakeTimers();
      try {
        mockUpdateContainer.mockResolvedValueOnce({});

        const wrapper = await mountDashboard(
          [pendingContainer],
          [],
          {},
          { recentStatuses: { nginx: 'pending' } },
        );
        const { mapApiContainers } = await import('@/utils/container-mapper');

        mockGetAllContainers.mockResolvedValueOnce([]);
        mockGetContainerRecentStatus.mockResolvedValueOnce({ statuses: {} });
        (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValueOnce([]);

        const { useConfirmDialog } = await import('@/composables/useConfirmDialog');
        const confirm = useConfirmDialog();

        await wrapper.find('[data-test="dashboard-update-btn"]').trigger('click');
        await confirm.accept();
        await flushPromises();

        expect(wrapper.find('[data-widget-id="recent-updates"]').text()).toContain('Updating');

        // Fire a non-terminal in-progress phase
        globalThis.dispatchEvent(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              containerId: pendingContainer.id,
              containerName: pendingContainer.name,
              status: 'in-progress',
              phase: 'old-stopped',
            },
          }),
        );
        await nextTick();

        // Ghost should still be visible
        expect(wrapper.find('[data-widget-id="recent-updates"]').text()).toContain('Updating');
      } finally {
        vi.useRealTimers();
      }
    });

    it('prunes ghost by newContainerId when terminal SSE carries a recreated container id', async () => {
      // When a container is updated, Docker recreates it with a new id. The SSE
      // payload's newContainerId should match the ghost row's key so the ghost
      // is pruned even if containerId no longer matches.
      vi.useFakeTimers();
      try {
        mockUpdateContainer.mockResolvedValueOnce({});

        const wrapper = await mountDashboard(
          [pendingContainer],
          [],
          {},
          { recentStatuses: { nginx: 'pending' } },
        );
        const { mapApiContainers } = await import('@/utils/container-mapper');

        mockGetAllContainers.mockResolvedValueOnce([]);
        mockGetContainerRecentStatus.mockResolvedValueOnce({ statuses: {} });
        (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValueOnce([]);

        const { useConfirmDialog } = await import('@/composables/useConfirmDialog');
        const confirm = useConfirmDialog();

        await wrapper.find('[data-test="dashboard-update-btn"]').trigger('click');
        await confirm.accept();
        await flushPromises();

        expect(wrapper.find('[data-widget-id="recent-updates"]').text()).toContain('Updating');

        // Terminal SSE with newContainerId (the recreated container's id)
        globalThis.dispatchEvent(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              containerId: 'old-id',
              newContainerId: pendingContainer.identityKey,
              containerName: pendingContainer.name,
              status: 'succeeded',
              phase: 'succeeded',
            },
          }),
        );
        await nextTick();

        expect(wrapper.find('[data-widget-id="recent-updates"]').text()).not.toContain('Updating');
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not fire success toast when terminal SSE succeeded and operation was tracked', async () => {
      vi.useFakeTimers();
      try {
        const wrapper = await mountDashboard(
          [pendingContainer],
          [],
          {},
          { recentStatuses: { nginx: 'pending' } },
        );

        // Establish the hold via in-progress SSE — the hold map is the
        // "tracked" marker now (previously it was dashboardPendingUpdateRows).
        globalThis.dispatchEvent(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-nginx',
              containerId: pendingContainer.id,
              containerName: pendingContainer.name,
              status: 'in-progress',
              phase: 'pulling',
            },
          }),
        );
        await nextTick();

        const { toasts } = useToast();
        const beforeCount = toasts.value.length;

        globalThis.dispatchEvent(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-nginx',
              containerId: pendingContainer.id,
              containerName: pendingContainer.name,
              status: 'succeeded',
              phase: 'succeeded',
            },
          }),
        );
        await nextTick();
        vi.advanceTimersByTime(1500);
        await flushPromises();

        expect(toasts.value.length).toBe(beforeCount);
        void wrapper;
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not fire error toast when terminal SSE failed and operation was tracked', async () => {
      vi.useFakeTimers();
      try {
        const wrapper = await mountDashboard(
          [pendingContainer],
          [],
          {},
          { recentStatuses: { nginx: 'pending' } },
        );

        globalThis.dispatchEvent(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-nginx',
              containerId: pendingContainer.id,
              containerName: pendingContainer.name,
              status: 'in-progress',
              phase: 'pulling',
            },
          }),
        );
        await nextTick();

        const { toasts } = useToast();
        const beforeCount = toasts.value.length;

        globalThis.dispatchEvent(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-nginx',
              containerId: pendingContainer.id,
              containerName: pendingContainer.name,
              status: 'failed',
              phase: 'failed',
            },
          }),
        );
        await nextTick();
        vi.advanceTimersByTime(1500);
        await flushPromises();

        expect(toasts.value.length).toBe(beforeCount);
        void wrapper;
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not fire error toast when terminal SSE rolled-back and operation was tracked', async () => {
      vi.useFakeTimers();
      try {
        const wrapper = await mountDashboard(
          [pendingContainer],
          [],
          {},
          { recentStatuses: { nginx: 'pending' } },
        );

        globalThis.dispatchEvent(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-nginx',
              containerId: pendingContainer.id,
              containerName: pendingContainer.name,
              status: 'in-progress',
              phase: 'pulling',
            },
          }),
        );
        await nextTick();

        const { toasts } = useToast();
        const beforeCount = toasts.value.length;

        globalThis.dispatchEvent(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-nginx',
              containerId: pendingContainer.id,
              containerName: pendingContainer.name,
              status: 'rolled-back',
              phase: 'rolled-back',
            },
          }),
        );
        await nextTick();
        vi.advanceTimersByTime(1500);
        await flushPromises();

        expect(toasts.value.length).toBe(beforeCount);
        void wrapper;
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not fire toast when terminal SSE succeeded but operation was not tracked', async () => {
      const wrapper = await mountDashboard([pendingContainer], [], {}, {});
      // No update action triggered — dashboardPendingUpdateRows is empty

      const { toasts } = useToast();
      const beforeCount = toasts.value.length;

      globalThis.dispatchEvent(
        new CustomEvent('dd:sse-update-operation-changed', {
          detail: {
            containerId: 'unrelated-container-id',
            containerName: 'unrelated-container',
            status: 'succeeded',
            phase: 'succeeded',
          },
        }),
      );
      await nextTick();

      expect(toasts.value.length).toBe(beforeCount);
      void wrapper;
    });

    it('still calls pruneGhostsForOperation even when no toast fires for untracked operation', async () => {
      vi.useFakeTimers();
      try {
        mockUpdateContainer.mockResolvedValueOnce({});

        const wrapper = await mountDashboard(
          [pendingContainer],
          [],
          {},
          { recentStatuses: { nginx: 'pending' } },
        );
        const { mapApiContainers } = await import('@/utils/container-mapper');
        mockGetAllContainers.mockResolvedValueOnce([]);
        mockGetContainerRecentStatus.mockResolvedValueOnce({ statuses: {} });
        (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValueOnce([]);

        const { useConfirmDialog } = await import('@/composables/useConfirmDialog');
        const confirm = useConfirmDialog();
        await wrapper.find('[data-test="dashboard-update-btn"]').trigger('click');
        await confirm.accept();
        await flushPromises();

        // Ghost row visible
        expect(wrapper.find('[data-widget-id="recent-updates"]').text()).toContain('Updating');

        const { toasts } = useToast();
        const beforeCount = toasts.value.length;

        // Fire terminal SSE for a completely different container — toast should NOT fire,
        // but the ghost pruning for our container should still remain (unrelated id won't match)
        globalThis.dispatchEvent(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              containerId: 'completely-unrelated-id',
              containerName: 'completely-unrelated-name',
              status: 'succeeded',
              phase: 'succeeded',
            },
          }),
        );
        await nextTick();

        // No toast for untracked operation
        expect(toasts.value.length).toBe(beforeCount);
        // Ghost for our container should still be visible (unrelated event shouldn't prune it)
        expect(wrapper.find('[data-widget-id="recent-updates"]').text()).toContain('Updating');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('fail-safe completion toast via dd:sse-update-applied / dd:sse-update-failed', () => {
    it('fires toast.success on dd:sse-update-applied when no hold was tracked', async () => {
      vi.useFakeTimers();
      try {
        const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
        const c = makeContainer({ id: 'c1', name: 'nginx' });
        const wrapper = await mountDashboard([c], []);
        const updateAppliedListener = addEventListenerSpy.mock.calls.findLast(
          ([eventName]) => eventName === 'dd:sse-update-applied',
        )?.[1] as EventListener | undefined;

        const { toasts } = useToast();
        const countBefore = toasts.value.length;

        globalThis.dispatchEvent(
          new CustomEvent('dd:sse-update-applied', {
            detail: {
              operationId: 'op-dash-failsafe-1',
              containerId: 'c1',
              containerName: 'nginx',
              batchId: null,
              timestamp: '2026-04-28T12:00:00.000Z',
            },
          }),
        );

        vi.advanceTimersByTime(1500);
        await flushPromises();

        expect(toasts.value.length).toBe(countBefore + 1);
        expect(toasts.value.at(-1)).toMatchObject({ tone: 'success', title: 'Updated: nginx' });

        wrapper.unmount();
        addEventListenerSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    it('fires toast.error on dd:sse-update-failed when no hold was tracked', async () => {
      vi.useFakeTimers();
      try {
        const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
        const c = makeContainer({ id: 'c1', name: 'nginx' });
        const wrapper = await mountDashboard([c], []);
        const updateFailedListener = addEventListenerSpy.mock.calls.findLast(
          ([eventName]) => eventName === 'dd:sse-update-failed',
        )?.[1] as EventListener | undefined;

        const { toasts } = useToast();
        const countBefore = toasts.value.length;

        globalThis.dispatchEvent(
          new CustomEvent('dd:sse-update-failed', {
            detail: {
              operationId: 'op-dash-failfail-1',
              containerId: 'c1',
              containerName: 'nginx',
              phase: 'pulling',
              batchId: null,
              timestamp: '2026-04-28T12:00:00.000Z',
            },
          }),
        );

        vi.advanceTimersByTime(1500);
        await flushPromises();

        expect(toasts.value.length).toBe(countBefore + 1);
        expect(toasts.value.at(-1)).toMatchObject({
          tone: 'error',
          title: 'Update failed: nginx',
        });

        wrapper.unmount();
        addEventListenerSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    it('fires completion toast from dd:sse-update-applied even when operation terminal event arrived first', async () => {
      vi.useFakeTimers();
      try {
        const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
        const c = makeContainer({ id: 'c1', name: 'nginx' });
        const wrapper = await mountDashboard([c], []);
        const operationListener = addEventListenerSpy.mock.calls.findLast(
          ([eventName]) => eventName === 'dd:sse-update-operation-changed',
        )?.[1] as EventListener | undefined;
        const updateAppliedListener = addEventListenerSpy.mock.calls.findLast(
          ([eventName]) => eventName === 'dd:sse-update-applied',
        )?.[1] as EventListener | undefined;
        const { toasts } = useToast();
        const countBefore = toasts.value.length;

        // Register a hold, then receive the terminal phase event first. This path
        // now only releases the hold; the toast is owned by dd:sse-update-applied.
        globalThis.dispatchEvent(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-dash-dedup-1',
              containerId: 'c1',
              containerName: 'nginx',
              status: 'in-progress',
              phase: 'pulling',
            },
          }),
        );
        globalThis.dispatchEvent(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-dash-dedup-1',
              containerId: 'c1',
              containerName: 'nginx',
              status: 'succeeded',
              phase: 'succeeded',
            },
          }),
        );

        vi.advanceTimersByTime(1500);
        await flushPromises();

        expect(toasts.value.length).toBe(countBefore);

        // The canonical completion event is still responsible for user feedback.
        globalThis.dispatchEvent(
          new CustomEvent('dd:sse-update-applied', {
            detail: {
              operationId: 'op-dash-dedup-1',
              containerId: 'c1',
              containerName: 'nginx',
              batchId: null,
              timestamp: '2026-04-28T12:00:00.000Z',
            },
          }),
        );

        vi.advanceTimersByTime(1500);
        await flushPromises();

        expect(toasts.value.length).toBe(countBefore + 1);
        expect(toasts.value.at(-1)).toMatchObject({ tone: 'success', title: 'Updated: nginx' });

        wrapper.unmount();
        addEventListenerSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    it('clears pending fail-safe completion toast timers on unmount', async () => {
      vi.useFakeTimers();
      try {
        const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
        const c = makeContainer({ id: 'c1', name: 'nginx' });
        const wrapper = await mountDashboard([c], []);

        const { toasts } = useToast();
        const countBefore = toasts.value.length;

        globalThis.dispatchEvent(
          new CustomEvent('dd:sse-update-applied', {
            detail: {
              operationId: 'op-dash-unmount-cleanup-1',
              containerId: 'c1',
              containerName: 'nginx',
              batchId: null,
              timestamp: '2026-04-28T12:00:00.000Z',
            },
          }),
        );

        wrapper.unmount();
        vi.advanceTimersByTime(1500);
        await flushPromises();

        expect(toasts.value.length).toBe(countBefore);

        addEventListenerSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    it('suppresses per-container toast when dd:sse-update-applied has a non-null batchId', async () => {
      vi.useFakeTimers();
      try {
        const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
        const c = makeContainer({ id: 'c1', name: 'nginx' });
        const wrapper = await mountDashboard([c], []);

        const { toasts } = useToast();
        const countBefore = toasts.value.length;

        globalThis.dispatchEvent(
          new CustomEvent('dd:sse-update-applied', {
            detail: {
              operationId: 'op-dash-batch-member-1',
              containerId: 'c1',
              containerName: 'nginx',
              batchId: 'batch-xyz',
              timestamp: '2026-04-28T12:00:00.000Z',
            },
          }),
        );

        vi.advanceTimersByTime(1500);
        await flushPromises();

        // Track D handles the batch summary; per-container toast suppressed
        expect(toasts.value.length).toBe(countBefore);

        wrapper.unmount();
        addEventListenerSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    it('fires toast.warning on dd:sse-update-failed when rollbackReason is present and not cancelled', async () => {
      vi.useFakeTimers();
      try {
        const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
        const c = makeContainer({ id: 'c1', name: 'nginx' });
        const wrapper = await mountDashboard([c], []);

        const { toasts } = useToast();
        const countBefore = toasts.value.length;

        globalThis.dispatchEvent(
          new CustomEvent('dd:sse-update-failed', {
            detail: {
              operationId: 'op-dash-rb-1',
              containerId: 'c1',
              containerName: 'nginx',
              rollbackReason: '',
              phase: 'rolled-back',
              batchId: null,
              timestamp: '2026-05-01T12:00:00.000Z',
            },
          }),
        );

        vi.advanceTimersByTime(1500);
        await flushPromises();

        expect(toasts.value.length).toBe(countBefore + 1);
        expect(toasts.value.at(-1)).toMatchObject({
          tone: 'warning',
          title: 'Rolled back: nginx',
        });

        wrapper.unmount();
        addEventListenerSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    it('fires toast.warning with reason on dd:sse-update-failed when rollbackReason has a specific value', async () => {
      vi.useFakeTimers();
      try {
        const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
        const c = makeContainer({ id: 'c1', name: 'nginx' });
        const wrapper = await mountDashboard([c], []);

        const { toasts } = useToast();
        const countBefore = toasts.value.length;

        globalThis.dispatchEvent(
          new CustomEvent('dd:sse-update-failed', {
            detail: {
              operationId: 'op-dash-rb-reason-1',
              containerId: 'c1',
              containerName: 'nginx',
              rollbackReason: 'health-check-failed',
              phase: 'rolled-back',
              batchId: null,
              timestamp: '2026-05-01T12:00:00.000Z',
            },
          }),
        );

        vi.advanceTimersByTime(1500);
        await flushPromises();

        expect(toasts.value.length).toBe(countBefore + 1);
        expect(toasts.value.at(-1)).toMatchObject({
          tone: 'warning',
          title: 'Rolled back: nginx — health check failed',
        });

        wrapper.unmount();
        addEventListenerSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    it('fires toast.error with reason on dd:sse-update-failed when error is short and meaningful', async () => {
      vi.useFakeTimers();
      try {
        const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
        const c = makeContainer({ id: 'c1', name: 'nginx' });
        const wrapper = await mountDashboard([c], []);

        const { toasts } = useToast();
        const countBefore = toasts.value.length;

        globalThis.dispatchEvent(
          new CustomEvent('dd:sse-update-failed', {
            detail: {
              operationId: 'op-dash-fail-reason-1',
              containerId: 'c1',
              containerName: 'nginx',
              error: 'docker pull failed',
              phase: 'pulling',
              batchId: null,
              timestamp: '2026-05-01T12:00:00.000Z',
            },
          }),
        );

        vi.advanceTimersByTime(1500);
        await flushPromises();

        expect(toasts.value.length).toBe(countBefore + 1);
        expect(toasts.value.at(-1)).toMatchObject({
          tone: 'error',
          title: 'Update failed: nginx — docker pull failed',
        });

        wrapper.unmount();
        addEventListenerSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    it('fires toast.success (Cancelled) on dd:sse-update-failed when rollbackReason is cancelled', async () => {
      vi.useFakeTimers();
      try {
        const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
        const c = makeContainer({ id: 'c1', name: 'nginx' });
        const wrapper = await mountDashboard([c], []);

        const { toasts } = useToast();
        const countBefore = toasts.value.length;

        globalThis.dispatchEvent(
          new CustomEvent('dd:sse-update-failed', {
            detail: {
              operationId: 'op-dash-cancel-1',
              containerId: 'c1',
              containerName: 'nginx',
              error: 'Cancelled by operator',
              rollbackReason: 'cancelled',
              phase: 'rolled-back',
              batchId: null,
              timestamp: '2026-05-01T12:00:00.000Z',
            },
          }),
        );

        vi.advanceTimersByTime(1500);
        await flushPromises();

        expect(toasts.value.length).toBe(countBefore + 1);
        expect(toasts.value.at(-1)).toMatchObject({
          tone: 'success',
          title: 'Cancelled: nginx',
        });

        wrapper.unmount();
        addEventListenerSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    it('suppresses per-container toast when dd:sse-update-failed has a non-null batchId', async () => {
      vi.useFakeTimers();
      try {
        const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
        const c = makeContainer({ id: 'c1', name: 'nginx' });
        const wrapper = await mountDashboard([c], []);

        const { toasts } = useToast();
        const countBefore = toasts.value.length;

        globalThis.dispatchEvent(
          new CustomEvent('dd:sse-update-failed', {
            detail: {
              operationId: 'op-dash-batch-fail-1',
              containerId: 'c1',
              containerName: 'nginx',
              error: 'Update failed',
              phase: 'failed',
              batchId: 'batch-xyz',
              timestamp: '2026-05-01T12:00:00.000Z',
            },
          }),
        );

        vi.advanceTimersByTime(1500);
        await flushPromises();

        // Track D handles the batch summary; per-container toast suppressed
        expect(toasts.value.length).toBe(countBefore);

        wrapper.unmount();
        addEventListenerSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
