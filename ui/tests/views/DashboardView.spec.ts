import { flushPromises } from '@vue/test-utils';
import type { Container } from '@/types/container';
import DashboardView from '@/views/DashboardView.vue';
import { mountWithPlugins } from '../helpers/mount';

vi.mock('@/services/container', () => ({
  getAllContainers: vi.fn(),
}));

vi.mock('@/services/agent', () => ({
  getAgents: vi.fn(),
}));

vi.mock('@/services/server', () => ({
  getServer: vi.fn(),
}));

vi.mock('@/utils/container-mapper', () => ({
  mapApiContainers: vi.fn((x: any) => x),
}));

import { getAgents } from '@/services/agent';
import { getAllContainers } from '@/services/container';
import { getServer } from '@/services/server';

const mockGetAllContainers = getAllContainers as ReturnType<typeof vi.fn>;
const mockGetAgents = getAgents as ReturnType<typeof vi.fn>;
const mockGetServer = getServer as ReturnType<typeof vi.fn>;

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

async function mountDashboard(containers: Container[] = [], agents: any[] = [], server: any = {}) {
  mockGetAllContainers.mockResolvedValue(containers);
  mockGetAgents.mockResolvedValue(agents);
  mockGetServer.mockResolvedValue(server);

  const { mapApiContainers } = await import('@/utils/container-mapper');
  (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValue(containers);

  const wrapper = mountWithPlugins(DashboardView);
  await flushPromises();
  return wrapper;
}

describe('DashboardView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        makeContainer({ id: 'c2', name: 'redis', bouncer: 'unsafe' }),
        makeContainer({ id: 'c3', name: 'postgres', bouncer: 'safe' }),
      ];
      const wrapper = await mountDashboard(containers);
      const statCards = wrapper.findAll('.stat-card');
      const securityCard = statCards.find((c) => c.text().includes('Security Issues'));
      expect(securityCard?.text()).toContain('2');
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

    it('limits recent updates to 8 entries', async () => {
      const containers = Array.from({ length: 12 }, (_, i) =>
        makeContainer({
          id: `c${i}`,
          name: `container-${i}`,
          newTag: `${i + 1}.0.0`,
        }),
      );
      const wrapper = await mountDashboard(containers);
      const rows = wrapper.findAll('tbody tr');
      expect(rows.length).toBe(8);
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
  });

  describe('security donut chart', () => {
    it('shows total container count in the donut center', async () => {
      const containers = [
        makeContainer({ bouncer: 'safe' }),
        makeContainer({ id: 'c2', name: 'redis', bouncer: 'unsafe' }),
        makeContainer({ id: 'c3', name: 'postgres', bouncer: 'blocked' }),
      ];
      const wrapper = await mountDashboard(containers);
      // The donut center shows total count
      const donutCenter = wrapper.find('.absolute.inset-0');
      expect(donutCenter.text()).toContain('3');
      expect(donutCenter.text()).toContain('images');
    });

    it('shows clean and issue counts in the legend', async () => {
      const containers = [
        makeContainer({ bouncer: 'safe' }),
        makeContainer({ id: 'c2', name: 'redis', bouncer: 'safe' }),
        makeContainer({ id: 'c3', name: 'postgres', bouncer: 'blocked' }),
      ];
      const wrapper = await mountDashboard(containers);
      expect(wrapper.text()).toContain('2 Clean');
      expect(wrapper.text()).toContain('1 Issues');
    });

    it('hides issues legend when no issues exist', async () => {
      const containers = [makeContainer({ bouncer: 'safe' })];
      const wrapper = await mountDashboard(containers);
      expect(wrapper.text()).toContain('1 Clean');
      // The danger donut ring should not render (v-if="securityIssueCount > 0")
      const dangerCircles = wrapper.findAll('circle[stroke="var(--dd-danger)"]');
      expect(dangerCircles.length).toBe(0);
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
  });

  describe('navigation', () => {
    it('renders View all links', async () => {
      const wrapper = await mountDashboard([makeContainer()]);
      const links = wrapper.findAll('button').filter((b) => b.text().includes('View all'));
      expect(links.length).toBeGreaterThanOrEqual(3);
    });
  });
});
