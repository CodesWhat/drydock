import { flushPromises } from '@vue/test-utils';
import type { Container } from '@/types/container';
import DashboardView from '@/views/DashboardView.vue';
import { mountWithPlugins } from '../helpers/mount';

const { mockRouterPush } = vi.hoisted(() => ({
  mockRouterPush: vi.fn(),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

vi.mock('@/services/container', () => ({
  getAllContainers: vi.fn(),
}));

vi.mock('@/services/agent', () => ({
  getAgents: vi.fn(),
}));

vi.mock('@/services/server', () => ({
  getServer: vi.fn(),
}));

vi.mock('@/services/trigger', () => ({
  getAllTriggers: vi.fn(),
}));

vi.mock('@/services/watcher', () => ({
  getAllWatchers: vi.fn(),
}));

vi.mock('@/services/registry', () => ({
  getAllRegistries: vi.fn(),
}));

vi.mock('@/services/audit', () => ({
  getAuditLog: vi.fn(),
}));

vi.mock('@/utils/container-mapper', () => ({
  mapApiContainers: vi.fn((x: any) => x),
}));

import { getAgents } from '@/services/agent';
import { getAuditLog } from '@/services/audit';
import { getAllContainers } from '@/services/container';
import { getAllRegistries } from '@/services/registry';
import { getServer } from '@/services/server';
import { getAllTriggers } from '@/services/trigger';
import { getAllWatchers } from '@/services/watcher';

const mockGetAllContainers = getAllContainers as ReturnType<typeof vi.fn>;
const mockGetAgents = getAgents as ReturnType<typeof vi.fn>;
const mockGetServer = getServer as ReturnType<typeof vi.fn>;
const mockGetAllTriggers = getAllTriggers as ReturnType<typeof vi.fn>;
const mockGetAllWatchers = getAllWatchers as ReturnType<typeof vi.fn>;
const mockGetAllRegistries = getAllRegistries as ReturnType<typeof vi.fn>;
const mockGetAuditLog = getAuditLog as ReturnType<typeof vi.fn>;
const DASHBOARD_WIDGET_ORDER_STORAGE_KEY = 'dd-dashboard-widget-order-v2';

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
    bouncer: 'safe',
    server: 'Local',
    details: { ports: [], volumes: [], env: [], labels: [] },
    ...overrides,
  };
}

interface DashboardDataOverrides {
  triggers?: any[];
  watchers?: any[];
  registries?: any[];
  auditEntries?: any[];
}

async function mountDashboard(
  containers: Container[] = [],
  agents: any[] = [],
  server: any = {},
  overrides: DashboardDataOverrides = {},
) {
  mockGetAllContainers.mockResolvedValue(containers);
  mockGetAgents.mockResolvedValue(agents);
  mockGetServer.mockResolvedValue(server);
  mockGetAllTriggers.mockResolvedValue(overrides.triggers ?? []);
  mockGetAllWatchers.mockResolvedValue(overrides.watchers ?? []);
  mockGetAllRegistries.mockResolvedValue(overrides.registries ?? []);
  mockGetAuditLog.mockResolvedValue({
    entries: overrides.auditEntries ?? [],
    total: (overrides.auditEntries ?? []).length,
  });

  const { mapApiContainers } = await import('@/utils/container-mapper');
  (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValue(containers);

  const wrapper = mountWithPlugins(DashboardView);
  await flushPromises();
  return wrapper;
}

describe('DashboardView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouterPush.mockClear();
    localStorage.removeItem(DASHBOARD_WIDGET_ORDER_STORAGE_KEY);
  });

  describe('loading state', () => {
    it('shows loading text before data resolves', () => {
      mockGetAllContainers.mockReturnValue(new Promise(() => {}));
      mockGetAgents.mockReturnValue(new Promise(() => {}));
      mockGetServer.mockReturnValue(new Promise(() => {}));

      const wrapper = mountWithPlugins(DashboardView);
      expect(wrapper.text()).toContain('Loading dashboard...');
    });

    it('hides loading text after data resolves', async () => {
      const wrapper = await mountDashboard();
      expect(wrapper.text()).not.toContain('Loading dashboard...');
    });
  });

  describe('SSE refresh behavior', () => {
    it('refreshes dashboard data on dd:sse-container-changed', async () => {
      await mountDashboard([makeContainer()]);
      const containersCallsBefore = mockGetAllContainers.mock.calls.length;
      const serverCallsBefore = mockGetServer.mock.calls.length;
      const agentsCallsBefore = mockGetAgents.mock.calls.length;

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-changed'));
      await flushPromises();

      expect(mockGetAllContainers.mock.calls.length).toBeGreaterThan(containersCallsBefore);
      expect(mockGetServer.mock.calls.length).toBeGreaterThan(serverCallsBefore);
      expect(mockGetAgents.mock.calls.length).toBeGreaterThan(agentsCallsBefore);
    });
  });

  describe('error state', () => {
    it('shows error message on fetch failure', async () => {
      mockGetAllContainers.mockRejectedValue(new Error('Network error'));
      mockGetAgents.mockResolvedValue([]);
      mockGetServer.mockResolvedValue({});

      const wrapper = mountWithPlugins(DashboardView);
      await flushPromises();

      expect(wrapper.text()).toContain('Failed to load dashboard');
      expect(wrapper.text()).toContain('Network error');
    });
  });

  describe('stat cards', () => {
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

    it('computes unique images count', async () => {
      const containers = [
        makeContainer({ image: 'nginx' }),
        makeContainer({ id: 'c2', name: 'redis', image: 'redis' }),
        makeContainer({ id: 'c3', name: 'nginx-2', image: 'nginx' }),
      ];
      const wrapper = await mountDashboard(containers);
      const statCards = wrapper.findAll('.stat-card');
      const imagesCard = statCards.find((c) => c.text().includes('Images'));
      // 2 unique images: nginx, redis
      expect(imagesCard?.text()).toContain('2');
    });

    it('shows 0 images when no containers exist', async () => {
      const wrapper = await mountDashboard([]);
      const statCards = wrapper.findAll('.stat-card');
      const imagesCard = statCards.find((c) => c.text().includes('Images'));
      expect(imagesCard?.text()).toContain('0');
    });

    it('computes trigger, watcher, and registry counts from dashboard inputs', async () => {
      const wrapper = await mountDashboard([], [], {}, {
        triggers: [{ id: 't1' }, { id: 't2' }],
        watchers: [{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }],
        registries: [{ id: 'r1' }],
      });

      const statCards = wrapper.findAll('.stat-card');
      const triggersCard = statCards.find((c) => c.text().includes('Triggers'));
      const watchersCard = statCards.find((c) => c.text().includes('Watchers'));
      const registriesCard = statCards.find((c) => c.text().includes('Registries'));

      expect(triggersCard?.text()).toContain('2');
      expect(watchersCard?.text()).toContain('3');
      expect(registriesCard?.text()).toContain('1');
    });

    it('shows maintenance countdown status on the watchers card', async () => {
      const wrapper = await mountDashboard([], [], {}, {
        watchers: [
          {
            id: 'watcher-1',
            configuration: {
              maintenancewindow: '0 2 * * *',
              maintenancewindowopen: true,
            },
          },
        ],
      });

      const statCards = wrapper.findAll('.stat-card');
      const watchersCard = statCards.find((c) => c.text().includes('Watchers'));
      expect(watchersCard?.text()).toContain('Open now');
    });
  });

  describe('recent activity', () => {
    it('shows recent activity entries from audit log', async () => {
      const wrapper = await mountDashboard([], [], {}, {
        auditEntries: [
          {
            id: 'a1',
            timestamp: '2026-02-28T10:00:00.000Z',
            action: 'update-applied',
            containerName: 'api',
            status: 'success',
          },
        ],
      });

      expect(wrapper.text()).toContain('Recent Activity');
      expect(wrapper.text()).toContain('api');
      expect(wrapper.text()).toContain('Update Applied');
    });

    it('shows empty state when there is no recent activity', async () => {
      const wrapper = await mountDashboard();
      expect(wrapper.text()).toContain('No activity recorded yet');
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

    it('limits recent updates to 6 entries', async () => {
      const containers = Array.from({ length: 12 }, (_, i) =>
        makeContainer({
          id: `c${i}`,
          name: `container-${i}`,
          newTag: `${i + 1}.0.0`,
        }),
      );
      const wrapper = await mountDashboard(containers);
      const rows = wrapper.findAll('tbody tr');
      expect(rows.length).toBe(6);
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
      const rows = wrapper.find('[data-widget-id="recent-updates"] tbody').findAll('tr');
      const names = rows.map((row) => row.find('td:nth-child(2) .font-medium').text());

      expect(names).toEqual(['beta', 'alpha', 'gamma']);
    });

    it('does not show containers without newTag in the recent updates table', async () => {
      const containers = [
        makeContainer({ name: 'no-update' }),
        makeContainer({ id: 'c2', name: 'has-update', newTag: '2.0.0' }),
      ];
      const wrapper = await mountDashboard(containers);
      const rows = wrapper.findAll('tbody tr');
      expect(rows.length).toBe(1);
      expect(rows[0].text()).toContain('has-update');
    });

    it('shows snoozed and skipped policy updates in recent updates', async () => {
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
      ];

      const wrapper = await mountDashboard(containers);
      const rows = wrapper.find('[data-widget-id="recent-updates"] tbody').findAll('tr');
      expect(rows.length).toBe(2);
      const rowTexts = rows.map((row) => row.text().toLowerCase());
      expect(
        rowTexts.some((text) => text.includes('snoozed-nginx') && text.includes('snoozed')),
      ).toBe(true);
      expect(
        rowTexts.some((text) => text.includes('skipped-redis') && text.includes('skipped')),
      ).toBe(true);
    });

    it('uses the latest audit outcome to render each row status', async () => {
      const containers = [makeContainer({ id: 'c1', name: 'redis', currentTag: '6.0.0', newTag: '7.0.0' })];
      const wrapper = await mountDashboard(containers, [], {}, {
        auditEntries: [
          {
            id: 'a1',
            timestamp: '2026-02-28T10:00:00.000Z',
            action: 'update-failed',
            containerName: 'redis',
            status: 'error',
          },
        ],
      });

      const row = wrapper.find('[data-widget-id="recent-updates"] tbody tr');
      expect(row.text()).toContain('redis');
      expect(row.text()).toContain('failed');
    });

    it('surfaces registry check failures in recent updates', async () => {
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
      const errorRow = wrapper.find('[data-widget-id="recent-updates"] tr[data-update-status="error"]');

      expect(errorRow.exists()).toBe(true);
      expect(errorRow.text()).toContain('registry-fail');
      expect(errorRow.text()).toContain('Registry request failed: unauthorized');
      expect(errorRow.text()).toContain('error');
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
      expect(widget.text()).toContain('No recent updates yet');
    });

    it('shows the same empty state when there are zero containers', async () => {
      const wrapper = await mountDashboard([]);
      const widget = wrapper.find('[data-widget-id="recent-updates"]');
      expect(widget.text()).toContain('No recent updates yet');
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
      ] as Array<Container & {
        securitySummary?: {
          critical: number;
          high: number;
          medium: number;
          low: number;
          unknown: number;
        };
      }>;

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

    it('shows webhook status indicator from server configuration', async () => {
      const wrapper = await mountDashboard([], [], {
        configuration: {
          webhook: {
            enabled: true,
          },
        },
      });

      expect(wrapper.text()).toContain('Webhook API');
      expect(wrapper.text()).toContain('Enabled');
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

  describe('dashboard widget ordering', () => {
    it('hydrates widget order from localStorage', async () => {
      localStorage.setItem(
        DASHBOARD_WIDGET_ORDER_STORAGE_KEY,
        JSON.stringify([
          'stat-containers', 'stat-updates', 'stat-security', 'stat-images',
          'host-status', 'recent-updates', 'security-overview', 'update-breakdown',
        ]),
      );

      const wrapper = await mountDashboard([makeContainer({ newTag: '2.0.0' })]);

      expect(wrapper.find('[data-widget-id="host-status"]').attributes('data-widget-order')).toBe('4');
      expect(wrapper.find('[data-widget-id="recent-updates"]').attributes('data-widget-order')).toBe(
        '5',
      );
      expect(
        wrapper.find('[data-widget-id="security-overview"]').attributes('data-widget-order'),
      ).toBe('6');
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

      expect(wrapper.find('[data-widget-id="update-breakdown"]').attributes('data-widget-order')).toBe(
        '4',
      );
      expect(wrapper.find('[data-widget-id="recent-updates"]').attributes('data-widget-order')).toBe(
        '5',
      );
      expect(JSON.parse(localStorage.getItem(DASHBOARD_WIDGET_ORDER_STORAGE_KEY) || '[]')).toEqual([
        'stat-containers',
        'stat-updates',
        'stat-security',
        'stat-images',
        'update-breakdown',
        'recent-updates',
        'security-overview',
        'host-status',
        'stat-triggers',
        'stat-watchers',
        'stat-registries',
        'recent-activity',
      ]);
    });

    it('reorders stat cards on drop', async () => {
      const wrapper = await mountDashboard([makeContainer({ newTag: '2.0.0' })]);

      const draggedStat = wrapper.find('[data-widget-id="stat-images"]');
      const targetStat = wrapper.find('[data-widget-id="stat-containers"]');
      const dataTransfer = {
        setData: vi.fn(),
        getData: vi.fn(() => 'stat-images'),
        effectAllowed: 'move',
        dropEffect: 'move',
      };

      await draggedStat.trigger('dragstart', { dataTransfer });
      await targetStat.trigger('dragover', { dataTransfer });
      await targetStat.trigger('drop', { dataTransfer });
      await draggedStat.trigger('dragend');

      expect(wrapper.find('[data-widget-id="stat-images"]').attributes('data-widget-order')).toBe('0');
      expect(wrapper.find('[data-widget-id="stat-containers"]').attributes('data-widget-order')).toBe('1');
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
    });

    it('routes update view-all buttons with has-update filter', async () => {
      const wrapper = await mountDashboard([
        makeContainer({ updateKind: 'minor', newTag: '1.2.0' }),
      ]);
      const recentUpdatesViewAll = wrapper.find('[data-widget-id="recent-updates"]').find('button');
      const updateBreakdownViewAll = wrapper.find('[data-widget-id="update-breakdown"]').find('button');

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
      const { getContainerGroups } = await vi.importActual<typeof import('@/services/container')>(
        '@/services/container',
      );
      const groups = [{ name: 'core' }];
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => groups,
      } as any);

      await expect(getContainerGroups()).resolves.toEqual(groups);
      expect(fetch).toHaveBeenCalledWith('/api/containers/groups', { credentials: 'include' });
    });

    it('throws when fetching container groups fails', async () => {
      const { getContainerGroups } = await vi.importActual<typeof import('@/services/container')>(
        '@/services/container',
      );
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Gateway',
      } as any);

      await expect(getContainerGroups()).rejects.toThrow(
        'Failed to get container groups: Bad Gateway',
      );
    });
  });
});
