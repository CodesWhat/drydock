import { flushPromises } from '@vue/test-utils';
import { getAllContainers } from '@/services/container';
import { getAllWatchers } from '@/services/watcher';
import WatchersView from '@/views/WatchersView.vue';
import { dataViewStubs } from '../helpers/data-view-stubs';
import { mountWithPlugins } from '../helpers/mount';

const { mockRoute } = vi.hoisted(() => ({
  mockRoute: { query: {} as Record<string, unknown> },
}));

vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
}));

vi.mock('@/composables/useBreakpoints', () => ({
  useBreakpoints: () => ({
    isMobile: { value: false },
  }),
}));

vi.mock('@/services/watcher', () => ({
  getAllWatchers: vi.fn(),
}));

vi.mock('@/services/container', () => ({
  getAllContainers: vi.fn(),
}));

const mockGetAllWatchers = getAllWatchers as ReturnType<typeof vi.fn>;
const mockGetAllContainers = getAllContainers as ReturnType<typeof vi.fn>;

async function mountWatchersView() {
  const wrapper = mountWithPlugins(WatchersView, {
    global: { stubs: dataViewStubs },
  });
  await flushPromises();
  return wrapper;
}

describe('WatchersView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoute.query = {};
  });

  it('successful load combines watcher + container counts into rendered rows', async () => {
    mockGetAllWatchers.mockResolvedValue([
      {
        id: 'watcher-alpha',
        name: 'Alpha Watcher',
        type: 'docker',
        configuration: { cron: '*/5 * * * *' },
      },
      {
        id: 'watcher-beta',
        name: 'Beta Watcher',
        type: 'docker',
        configuration: { cron: '0 * * * *' },
      },
    ]);

    mockGetAllContainers.mockResolvedValue([
      { id: 'c-1', watcher: 'watcher-alpha' },
      { id: 'c-2', watcher: 'watcher-alpha' },
      { id: 'c-3', watcher: 'watcher-beta' },
    ]);

    const wrapper = await mountWatchersView();

    expect(mockGetAllWatchers).toHaveBeenCalledTimes(1);
    expect(mockGetAllContainers).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('2');

    const table = wrapper.findComponent(dataViewStubs.DataTable);
    const rows = table.props('rows') as Array<{ id: string; containers: number }>;

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'watcher-alpha', containers: 2 }),
        expect.objectContaining({ id: 'watcher-beta', containers: 1 }),
      ]),
    );
  });

  it('route query q filters rows', async () => {
    mockRoute.query = { q: 'edge' };

    mockGetAllWatchers.mockResolvedValue([
      {
        id: 'watcher-edge',
        name: 'Edge Cluster',
        type: 'docker',
        configuration: { cron: '*/15 * * * *' },
      },
      {
        id: 'watcher-local',
        name: 'Local Host',
        type: 'docker',
        configuration: { cron: '0 * * * *' },
      },
    ]);
    mockGetAllContainers.mockResolvedValue([{ id: 'c-1', watcher: 'watcher-edge' }]);

    const wrapper = await mountWatchersView();

    expect((wrapper.find('input[type="text"]').element as HTMLInputElement).value).toBe('edge');
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('1');

    const table = wrapper.findComponent(dataViewStubs.DataTable);
    const rows = table.props('rows') as Array<{ id: string; name: string }>;
    expect(rows).toEqual([expect.objectContaining({ id: 'watcher-edge', name: 'Edge Cluster' })]);
  });

  it('API failure shows “Failed to load watchers”', async () => {
    mockGetAllWatchers.mockRejectedValue(new Error('boom'));
    mockGetAllContainers.mockResolvedValue([]);

    const wrapper = await mountWatchersView();

    expect(wrapper.text()).toContain('Failed to load watchers');
  });
});
