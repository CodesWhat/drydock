import { flushPromises, type VueWrapper } from '@vue/test-utils';
import DataTable from '@/components/DataTable.vue';
import type { Container } from '@/types/container';
import DashboardView from '@/views/DashboardView.vue';
import { mountWithPlugins } from '../helpers/mount';

const { mockRouterPush, mockBuildDashboardContainerMetrics, mockUpdateContainer } = vi.hoisted(
  () => ({
    mockRouterPush: vi.fn(),
    mockBuildDashboardContainerMetrics: vi.fn(),
    mockUpdateContainer: vi.fn(),
  }),
);

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

vi.mock('@/services/container', () => ({
  getAllContainers: vi.fn(),
  getContainerRecentStatus: vi.fn(),
  getContainerSummary: vi.fn(),
}));

vi.mock('@/services/stats', () => ({
  getAllContainerStats: vi.fn(),
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
import { getAllContainerStats } from '@/services/stats';
import { getAllWatchers } from '@/services/watcher';

const mockGetAllContainers = getAllContainers as ReturnType<typeof vi.fn>;
const mockGetAllContainerStats = getAllContainerStats as ReturnType<typeof vi.fn>;
const mockGetContainerRecentStatus = getContainerRecentStatus as ReturnType<typeof vi.fn>;
const mockGetContainerSummary = getContainerSummary as ReturnType<typeof vi.fn>;
const mockGetAgents = getAgents as ReturnType<typeof vi.fn>;
const mockGetServer = getServer as ReturnType<typeof vi.fn>;
const mockGetAllWatchers = getAllWatchers as ReturnType<typeof vi.fn>;
const mockGetAllRegistries = getAllRegistries as ReturnType<typeof vi.fn>;
const PREFERENCES_STORAGE_KEY = 'dd-preferences';
const mountedWrappers: VueWrapper[] = [];

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'c1',
    name: 'nginx',
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
  containerStats?: any[];
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
  mockGetAllContainerStats.mockResolvedValue(overrides.containerStats ?? []);
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
    localStorage.removeItem(PREFERENCES_STORAGE_KEY);
    const { resetPreferences } = await import('@/preferences/store');
    resetPreferences();
  });

  afterEach(() => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
    vi.useRealTimers();
  });

  describe('layout spacing', () => {
    it('applies pr-[15px] on the scrollable container for scrollbar centering', () => {
      mockGetAllContainers.mockReturnValue(new Promise(() => {}));
      mockGetAgents.mockReturnValue(new Promise(() => {}));
      mockGetServer.mockReturnValue(new Promise(() => {}));

      const wrapper = mountDashboardView();
      const scrollArea = wrapper.find('.overflow-y-auto');
      expect(scrollArea.exists()).toBe(true);
      expect(scrollArea.classes()).toContain('sm:pr-[15px]');
    });

    it('does not use legacy scrollbar compensation padding', () => {
      mockGetAllContainers.mockReturnValue(new Promise(() => {}));
      mockGetAgents.mockReturnValue(new Promise(() => {}));
      mockGetServer.mockReturnValue(new Promise(() => {}));

      const wrapper = mountDashboardView();
      const scrollArea = wrapper.find('.overflow-y-auto');
      expect(scrollArea.classes()).not.toContain('sm:pr-2');
      expect(scrollArea.classes()).not.toContain('sm:pr-4');
      expect(scrollArea.classes()).not.toContain('sm:pr-5');
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
        globalThis.dispatchEvent(new CustomEvent('dd:sse-scan-completed'));
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
    it('performs full data refresh on dd:sse-container-changed (#229)', async () => {
      vi.useFakeTimers();
      try {
        await mountDashboard([makeContainer()]);
        const containersCallsBefore = mockGetAllContainers.mock.calls.length;

        globalThis.dispatchEvent(new CustomEvent('dd:sse-container-changed'));
        vi.advanceTimersByTime(1000);
        await flushPromises();

        expect(mockGetAllContainers.mock.calls.length).toBeGreaterThan(containersCallsBefore);
      } finally {
        vi.useRealTimers();
      }
    });

    it('debounces burst SSE events into a single full refresh', async () => {
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

        expect(mockGetAllContainers).toHaveBeenCalledTimes(containersCallsBefore);
        expect(mockGetServer).toHaveBeenCalledTimes(serverCallsBefore);
        expect(mockGetAgents).toHaveBeenCalledTimes(agentsCallsBefore);
        expect(mockGetAllWatchers).toHaveBeenCalledTimes(watchersCallsBefore);
        expect(mockGetAllRegistries).toHaveBeenCalledTimes(registriesCallsBefore);
        expect(mockGetContainerRecentStatus).toHaveBeenCalledTimes(recentStatusCallsBefore);
        expect(mockGetContainerSummary).toHaveBeenCalledTimes(summaryCallsBefore);

        vi.advanceTimersByTime(1000);
        await flushPromises();

        expect(mockGetContainerSummary).toHaveBeenCalledTimes(summaryCallsBefore);
        expect(mockGetAllContainers).toHaveBeenCalledTimes(containersCallsBefore + 1);
        expect(mockGetServer).toHaveBeenCalledTimes(serverCallsBefore + 1);
        expect(mockGetAgents).toHaveBeenCalledTimes(agentsCallsBefore + 1);
        expect(mockGetAllWatchers).toHaveBeenCalledTimes(watchersCallsBefore + 1);
        expect(mockGetAllRegistries).toHaveBeenCalledTimes(registriesCallsBefore + 1);
        expect(mockGetContainerRecentStatus).toHaveBeenCalledTimes(recentStatusCallsBefore + 1);
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
    it('renders top cpu and memory containers from live stats summary', async () => {
      const wrapper = await mountDashboard(
        [makeContainer()],
        [],
        {},
        {
          containerStats: [
            {
              id: 'c1',
              name: 'web',
              status: 'running',
              watcher: 'local',
              agent: undefined,
              stats: {
                containerId: 'c1',
                cpuPercent: 30,
                memoryUsageBytes: 300,
                memoryLimitBytes: 600,
                memoryPercent: 50,
                networkRxBytes: 1,
                networkTxBytes: 2,
                blockReadBytes: 3,
                blockWriteBytes: 4,
                timestamp: '2026-03-14T10:00:00.000Z',
              },
            },
            {
              id: 'c2',
              name: 'db',
              status: 'running',
              watcher: 'local',
              agent: undefined,
              stats: {
                containerId: 'c2',
                cpuPercent: 80,
                memoryUsageBytes: 500,
                memoryLimitBytes: 1_000,
                memoryPercent: 50,
                networkRxBytes: 1,
                networkTxBytes: 2,
                blockReadBytes: 3,
                blockWriteBytes: 4,
                timestamp: '2026-03-14T10:00:00.000Z',
              },
            },
          ],
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
      ).toBe('4');
      expect(
        wrapper.find('[data-widget-id="recent-updates"]').attributes('data-widget-order'),
      ).toBe('5');
      const { flushPreferences } = await import('@/preferences/store');
      flushPreferences();
      const prefs = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) || '{}');
      expect(prefs.dashboard.widgetOrder).toEqual([
        'stat-containers',
        'stat-updates',
        'stat-security',
        'stat-registries',
        'update-breakdown',
        'recent-updates',
        'security-overview',
        'resource-usage',
        'host-status',
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
      ).toBe('0');
      expect(
        wrapper.find('[data-widget-id="stat-containers"]').attributes('data-widget-order'),
      ).toBe('1');
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
      mockUpdateContainer.mockImplementation(async (id: string) => {
        if (id === 'c-fail') {
          throw new Error('update exploded');
        }
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

      expect(mockUpdateContainer).toHaveBeenCalledTimes(3);
      expect(mockUpdateContainer).toHaveBeenCalledWith('c-success-1');
      expect(mockUpdateContainer).toHaveBeenCalledWith('c-fail');
      expect(mockUpdateContainer).toHaveBeenCalledWith('c-success-2');
      expect(mockGetAllContainers.mock.calls.length).toBe(initialFetchCount + 1);
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
  });
});
