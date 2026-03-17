import { flushPromises } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import { getAgents } from '@/services/agent';
import { getAllContainers } from '@/services/container';
import { getServer } from '@/services/server';
import { getAllWatchers } from '@/services/watcher';
import ServersView from '@/views/ServersView.vue';
import { dataViewStubs } from '../helpers/data-view-stubs';
import { mountWithPlugins } from '../helpers/mount';

vi.mock('@/composables/useBreakpoints', () => ({
  useBreakpoints: () => ({
    isMobile: ref(false),
  }),
}));

vi.mock('@/services/server', () => ({
  getServer: vi.fn(),
}));

vi.mock('@/services/agent', () => ({
  getAgents: vi.fn(),
}));

vi.mock('@/services/container', () => ({
  getAllContainers: vi.fn(),
}));

vi.mock('@/services/watcher', () => ({
  getAllWatchers: vi.fn(),
}));

const mockGetServer = getServer as ReturnType<typeof vi.fn>;
const mockGetAgents = getAgents as ReturnType<typeof vi.fn>;
const mockGetAllContainers = getAllContainers as ReturnType<typeof vi.fn>;
const mockGetAllWatchers = getAllWatchers as ReturnType<typeof vi.fn>;

function tableRows(wrapper: any) {
  const table = wrapper.findComponent(dataViewStubs.DataTable as any);
  return (table.props('rows') ?? []) as Array<{
    id?: string;
    name: string;
    host: string;
    status?: 'connected' | 'disconnected';
    containers?: { total: number; running: number; stopped?: number };
  }>;
}

async function mountServersView() {
  const wrapper = mountWithPlugins(ServersView, {
    global: {
      stubs: dataViewStubs,
    },
  });
  await flushPromises();
  return wrapper;
}

describe('ServersView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServer.mockResolvedValue({ name: 'drydock', version: '1.0.0' });
    mockGetAgents.mockResolvedValue([]);
    mockGetAllContainers.mockResolvedValue([]);
    mockGetAllWatchers.mockResolvedValue([
      {
        id: 'docker.local',
        type: 'docker',
        name: 'local',
        configuration: {
          socket: '/var/run/docker.sock',
          host: '',
          port: 2375,
          protocol: 'http',
          cron: '0 * * * *',
        },
      },
    ]);
  });

  it('loads Local and remote agent rows on successful fetch', async () => {
    mockGetAgents.mockResolvedValue([
      { name: 'Edge-1', connected: true, host: '10.0.0.21', port: 2376 },
      { name: 'Edge-2', connected: false, host: '10.0.0.22' },
    ]);
    mockGetAllContainers.mockResolvedValue([
      { id: 'c-local-1', watcher: 'local', status: 'running', image: 'nginx:1.27' },
      { id: 'c-edge-1', watcher: 'edge-1', status: 'stopped', image: 'redis:7' },
      { id: 'c-edge-2', watcher: 'edge-2', status: 'running', image: 'postgres:16' },
    ]);

    const wrapper = await mountServersView();

    expect(mockGetServer).toHaveBeenCalledTimes(1);
    expect(mockGetAgents).toHaveBeenCalledTimes(1);
    expect(mockGetAllContainers).toHaveBeenCalledTimes(1);
    expect(mockGetAllWatchers).toHaveBeenCalledTimes(1);

    const rows = tableRows(wrapper);
    expect(rows.map((row) => row.name)).toEqual(['Local', 'Edge-1', 'Edge-2']);
    expect(rows.map((row) => row.host)).toEqual([
      'unix:///var/run/docker.sock',
      '10.0.0.21:2376',
      '10.0.0.22',
    ]);
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('3');
  });

  it('filters server rows when typing in the search input', async () => {
    mockGetAgents.mockResolvedValue([
      { name: 'Edge-1', connected: true, host: '10.0.0.21', port: 2376 },
      { name: 'Edge-2', connected: true, host: '10.0.0.22', port: 2376 },
    ]);

    const wrapper = await mountServersView();

    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('3');

    const input = wrapper.find('input[type="text"]');
    expect(input.exists()).toBe(true);

    await input.setValue('edge-2');
    await nextTick();

    const filteredRows = tableRows(wrapper);
    expect(filteredRows.map((row) => row.name)).toEqual(['Edge-2']);
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('1');
  });

  it('shows an inline fallback error message when API calls fail without a message', async () => {
    mockGetServer.mockRejectedValue({});

    const wrapper = await mountServersView();

    expect(wrapper.text()).toContain('Failed to load server data');
  });

  it('loads servers even when webhook configuration is present on server payload', async () => {
    mockGetServer.mockResolvedValue({
      name: 'drydock',
      version: '1.0.0',
      configuration: {
        webhook: {
          enabled: true,
        },
      },
    });

    const wrapper = await mountServersView();
    expect(mockGetServer).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('1');
  });

  it('displays multiple local watchers configured via env vars', async () => {
    mockGetAllWatchers.mockResolvedValue([
      {
        id: 'docker.local',
        type: 'docker',
        name: 'local',
        configuration: {
          socket: '/var/run/docker.sock',
          host: '',
          port: 2375,
          protocol: 'http',
        },
      },
      {
        id: 'docker.nas',
        type: 'docker',
        name: 'nas',
        configuration: {
          socket: '',
          host: '10.0.0.50',
          port: 2376,
          protocol: 'https',
        },
      },
    ]);
    mockGetAllContainers.mockResolvedValue([
      { id: 'c1', watcher: 'local', status: 'running', image: 'nginx:1.27' },
      { id: 'c2', watcher: 'nas', status: 'running', image: 'redis:7' },
      { id: 'c3', watcher: 'nas', status: 'stopped', image: 'postgres:16' },
    ]);

    const wrapper = await mountServersView();
    const rows = tableRows(wrapper);

    expect(rows.map((row) => row.name)).toEqual(['Local', 'Nas']);
    expect(rows.map((row) => row.host)).toEqual([
      'unix:///var/run/docker.sock',
      'https://10.0.0.50:2376',
    ]);

    const nasRow = rows.find((r) => r.name === 'Nas') as any;
    expect(nasRow.containers).toEqual({ total: 2, running: 1, stopped: 1 });
  });

  it('derives host from host:port when no socket is configured', async () => {
    mockGetAllWatchers.mockResolvedValue([
      {
        id: 'docker.remote',
        type: 'docker',
        name: 'remote',
        configuration: { socket: '', host: '10.0.0.99', port: 2375, protocol: '' },
      },
    ]);
    const wrapper = await mountServersView();
    const rows = tableRows(wrapper);
    expect(rows[0].host).toBe('http://10.0.0.99:2375');
  });

  it('derives host as just hostname when no port is configured', async () => {
    mockGetAllWatchers.mockResolvedValue([
      {
        id: 'docker.remote',
        type: 'docker',
        name: 'remote',
        configuration: { socket: '', host: '10.0.0.99' },
      },
    ]);
    const wrapper = await mountServersView();
    const rows = tableRows(wrapper);
    expect(rows[0].host).toBe('10.0.0.99');
  });

  it('shows unknown host when watcher has no socket or host', async () => {
    mockGetAllWatchers.mockResolvedValue([
      { id: 'docker.empty', type: 'docker', name: 'empty', configuration: {} },
    ]);
    const wrapper = await mountServersView();
    const rows = tableRows(wrapper);
    expect(rows[0].host).toBe('unknown');
    expect(rows[0].name).toBe('Empty');
  });

  it('handles watchers with missing configuration gracefully', async () => {
    mockGetAllWatchers.mockResolvedValue([{ id: 'docker.bare', type: 'docker', name: 'bare' }]);
    const wrapper = await mountServersView();
    const rows = tableRows(wrapper);
    expect(rows[0].host).toBe('unknown');
    expect(rows[0].id).toBe('docker.bare');
  });

  it('handles null watchersData gracefully', async () => {
    mockGetAllWatchers.mockResolvedValue(null);
    const wrapper = await mountServersView();
    expect(wrapper.find('.data-table').exists()).toBe(false);
    expect(wrapper.find('.empty-state').exists()).toBe(true);
  });

  it('opens and closes the detail panel on row click', async () => {
    const wrapper = await mountServersView();

    await wrapper.find('.row-click-first').trigger('click');
    await nextTick();
    expect(wrapper.find('.detail-panel').attributes('data-open')).toBe('true');

    await wrapper.find('.close-detail').trigger('click');
    await nextTick();
    expect(wrapper.find('.detail-panel').attributes('data-open')).toBe('false');
  });

  it('renders status badge colors for connected and disconnected', async () => {
    mockGetAgents.mockResolvedValue([{ name: 'Down-Host', connected: false, host: '10.0.0.99' }]);
    const wrapper = await mountServersView();
    const rows = tableRows(wrapper);
    expect(rows[0].status).toBe('connected');
    expect(rows[1].status).toBe('disconnected');
  });

  it('excludes agent-scoped watchers from local watcher list', async () => {
    mockGetAllWatchers.mockResolvedValue([
      {
        id: 'docker.local',
        type: 'docker',
        name: 'local',
        configuration: { socket: '/var/run/docker.sock', host: '', port: 2375 },
      },
      {
        id: 'docker.edge-agent',
        type: 'docker',
        name: 'edge-agent',
        configuration: { socket: '/var/run/docker.sock', host: '', port: 2375 },
        agent: 'Edge-1',
      },
    ]);
    mockGetAgents.mockResolvedValue([
      { name: 'Edge-1', connected: true, host: '10.0.0.21', port: 2376 },
    ]);

    const wrapper = await mountServersView();
    const rows = tableRows(wrapper);

    expect(rows.map((row) => row.name)).toEqual(['Local', 'Edge-1']);
    expect(rows).toHaveLength(2);
  });
});
