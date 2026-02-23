import { flushPromises } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import { getAgents } from '@/services/agent';
import { getAllContainers } from '@/services/container';
import { getServer } from '@/services/server';
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

const mockGetServer = getServer as ReturnType<typeof vi.fn>;
const mockGetAgents = getAgents as ReturnType<typeof vi.fn>;
const mockGetAllContainers = getAllContainers as ReturnType<typeof vi.fn>;

function tableRows(wrapper: any) {
  const table = wrapper.findComponent(dataViewStubs.DataTable as any);
  return (table.props('rows') ?? []) as Array<{ name: string; host: string }>;
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
});
