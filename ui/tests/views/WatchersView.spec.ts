import { flushPromises } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { resetPreferences } from '@/preferences/store';
import { getAllWatchers, getWatcher } from '@/services/watcher';
import WatchersView from '@/views/WatchersView.vue';
import { dataViewStubs } from '../helpers/data-view-stubs';
import { mountWithPlugins } from '../helpers/mount';

const { mockRoute } = vi.hoisted(() => ({
  mockRoute: { query: {} as Record<string, unknown> },
}));

vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/composables/useBreakpoints', () => ({
  useBreakpoints: () => ({
    isMobile: { value: false },
  }),
}));

vi.mock('@/services/watcher', () => ({
  getAllWatchers: vi.fn(),
  getWatcher: vi.fn(),
}));

const mockGetAllWatchers = getAllWatchers as ReturnType<typeof vi.fn>;
const mockGetWatcher = getWatcher as ReturnType<typeof vi.fn>;

function withStats(total: number) {
  return {
    metadata: {
      containers: { total, running: total, stopped: 0, updatesAvailable: 0 },
      images: total,
    },
  };
}

const richDataTableStub = defineComponent({
  props: ['columns', 'rows', 'rowKey', 'activeRow'],
  emits: ['row-click'],
  template: `
    <div class="data-table" :data-row-count="rows?.length ?? 0" :data-active-row="activeRow || ''">
      <div v-for="row in rows" :key="row[rowKey || 'id']" class="data-table-row">
        <button v-if="row" class="row-click-first" @click="$emit('row-click', row)">Open</button>
        <slot name="cell-name" :row="row" />
        <slot name="cell-status" :row="row" />
        <slot name="cell-containers" :row="row" />
        <slot name="cell-cron" :row="row" />
        <slot name="cell-nextRun" :row="row" />
        <slot name="cell-lastRun" :row="row" />
      </div>
    </div>
  `,
});

async function mountWatchersView() {
  const wrapper = mountWithPlugins(WatchersView, {
    global: {
      stubs: {
        ...dataViewStubs,
        DataTable: richDataTableStub,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

describe('WatchersView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPreferences();
    mockRoute.query = {};
    mockGetWatcher.mockResolvedValue({
      id: 'watcher-alpha',
      name: 'Alpha Watcher',
      type: 'docker',
      configuration: { cron: '*/1 * * * *', grace: '30s' },
    });
  });

  it('successful load combines watcher + container counts into rendered rows', async () => {
    mockGetAllWatchers.mockResolvedValue([
      {
        id: 'watcher-alpha',
        name: 'Alpha Watcher',
        type: 'docker',
        configuration: { cron: '*/5 * * * *' },
        ...withStats(2),
      },
      {
        id: 'watcher-beta',
        name: 'Beta Watcher',
        type: 'docker',
        configuration: { cron: '0 * * * *' },
        ...withStats(1),
      },
    ]);

    const wrapper = await mountWatchersView();

    expect(mockGetAllWatchers).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('2');

    const table = wrapper.findComponent(richDataTableStub);
    const rows = table.props('rows') as Array<{ id: string; containers: number }>;

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'watcher-alpha', containers: 2 }),
        expect.objectContaining({ id: 'watcher-beta', containers: 1 }),
      ]),
    );
  });

  it('uses watcher name for container counts and defaults missing watchers to 0', async () => {
    mockGetAllWatchers.mockResolvedValue([
      {
        id: 'docker.esk00',
        name: 'esk00',
        type: 'docker',
        configuration: { cron: '*/5 * * * *' },
        ...withStats(2),
      },
      {
        id: 'docker.esk83',
        name: 'esk83',
        type: 'docker',
        configuration: { cron: '0 * * * *' },
        ...withStats(1),
      },
      {
        id: 'docker.empty',
        name: 'empty',
        type: 'docker',
        configuration: { cron: '0 * * * *' },
      },
    ]);

    const wrapper = await mountWatchersView();
    const table = wrapper.findComponent(richDataTableStub);
    const rows = table.props('rows') as Array<{ name: string; containers: number }>;

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'esk00', containers: 2 }),
        expect.objectContaining({ name: 'esk83', containers: 1 }),
        expect.objectContaining({ name: 'empty', containers: 0 }),
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

    const wrapper = await mountWatchersView();

    expect((wrapper.find('input[type="text"]').element as HTMLInputElement).value).toBe('edge');
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('1');

    const table = wrapper.findComponent(richDataTableStub);
    const rows = table.props('rows') as Array<{ id: string; name: string }>;
    expect(rows).toEqual([expect.objectContaining({ id: 'watcher-edge', name: 'Edge Cluster' })]);
  });

  it('API failure shows “Failed to load watchers”', async () => {
    mockGetAllWatchers.mockRejectedValue(new Error('boom'));

    const wrapper = await mountWatchersView();

    expect(wrapper.text()).toContain('Failed to load watchers');
  });

  it('renders lastRun from metadata.lastRunAt when present', async () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    mockGetAllWatchers.mockResolvedValue([
      {
        id: 'watcher-alpha',
        name: 'Alpha Watcher',
        type: 'docker',
        configuration: { cron: '*/5 * * * *' },
        metadata: { lastRunAt: fiveMinutesAgo },
      },
    ]);

    const wrapper = await mountWatchersView();
    const table = wrapper.findComponent(richDataTableStub);
    const rows = table.props('rows') as Array<{ lastRun: string }>;

    expect(rows[0].lastRun).toBe('5m ago');
  });

  it('renders em dash for lastRun when metadata.lastRunAt is absent', async () => {
    mockGetAllWatchers.mockResolvedValue([
      {
        id: 'watcher-alpha',
        name: 'Alpha Watcher',
        type: 'docker',
        configuration: { cron: '*/5 * * * *' },
      },
    ]);

    const wrapper = await mountWatchersView();
    const table = wrapper.findComponent(richDataTableStub);
    const rows = table.props('rows') as Array<{ lastRun: string }>;

    expect(rows[0].lastRun).toBe('\u2014');
  });

  it('renders nextRun from metadata.nextRunAt when present', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-09T12:00:00.000Z'));

    mockGetAllWatchers.mockResolvedValue([
      {
        id: 'watcher-alpha',
        name: 'Alpha Watcher',
        type: 'docker',
        configuration: { cron: '*/5 * * * *' },
        metadata: { nextRunAt: '2026-04-09T13:30:00.000Z' },
      },
    ]);

    const wrapper = await mountWatchersView();
    const table = wrapper.findComponent(richDataTableStub);
    const rows = table.props('rows') as Array<{ nextRun: string }>;

    expect(rows[0].nextRun).toBe('1h 30m');

    vi.useRealTimers();
  });

  it('renders nextRunAt on the row and the next-run span has a tooltip with the absolute time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-09T12:00:00.000Z'));

    mockGetAllWatchers.mockResolvedValue([
      {
        id: 'watcher-alpha',
        name: 'Alpha Watcher',
        type: 'docker',
        configuration: { cron: '*/5 * * * *' },
        metadata: { nextRunAt: '2026-04-09T13:30:00.000Z' },
      },
    ]);

    const wrapper = await mountWatchersView();
    const table = wrapper.findComponent(richDataTableStub);
    const rows = table.props('rows') as Array<{ nextRun: string; nextRunAt: string | undefined }>;

    expect(rows[0].nextRun).toBe('1h 30m');
    expect(rows[0].nextRunAt).toBe('2026-04-09T13:30:00.000Z');

    const nextRunSpan = wrapper.findAll('span').find((s) => s.text() === '1h 30m');
    expect(nextRunSpan).toBeDefined();
    const title = nextRunSpan?.element.getAttribute('title');
    expect(title).toBeTruthy();
    expect(title).toMatch(/\d{2}:\d{2}:\d{2}/);

    vi.useRealTimers();
  });

  it('next-run span has empty tooltip when nextRunAt is absent', async () => {
    mockGetAllWatchers.mockResolvedValue([
      {
        id: 'watcher-alpha',
        name: 'Alpha Watcher',
        type: 'docker',
        configuration: { cron: '*/5 * * * *' },
      },
    ]);

    const wrapper = await mountWatchersView();
    const table = wrapper.findComponent(richDataTableStub);
    const rows = table.props('rows') as Array<{ nextRun: string; nextRunAt: string | undefined }>;

    expect(rows[0].nextRunAt).toBeUndefined();

    const emDashSpan = wrapper.findAll('span').find((s) => s.text() === '\u2014');
    expect(emDashSpan).toBeDefined();
    expect(emDashSpan?.element.getAttribute('title')).toBeFalsy();
  });

  it('caps long cron strings in the table view', async () => {
    const longCron = '0 0 1,15 */2 1-5 /usr/bin/do-something-very-long-and-important';
    mockGetAllWatchers.mockResolvedValue([
      {
        id: 'watcher-alpha',
        name: 'Alpha Watcher',
        type: 'docker',
        configuration: { cron: longCron },
      },
    ]);

    const wrapper = await mountWatchersView();

    const cron = wrapper.findAll('span').find((candidate) => candidate.text().trim() === longCron);

    expect(cron).toBeDefined();
    expect(cron?.classes()).toContain('max-w-[180px]');
    expect(cron?.classes()).toContain('truncate');
  });

  it('clicking a row fetches watcher details from per-component endpoint', async () => {
    mockGetAllWatchers.mockResolvedValue([
      {
        id: 'watcher-alpha',
        name: 'Alpha Watcher',
        type: 'docker',
        configuration: { cron: '*/5 * * * *' },
      },
    ]);
    mockGetWatcher.mockResolvedValue({
      id: 'watcher-alpha',
      name: 'Alpha Watcher',
      type: 'docker',
      configuration: { cron: '*/1 * * * *', grace: '30s' },
    });

    const wrapper = await mountWatchersView();
    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();

    expect(mockGetWatcher).toHaveBeenCalledWith({
      type: 'docker',
      name: 'Alpha Watcher',
      agent: undefined,
    });
    expect(wrapper.text()).toContain('*/1 * * * *');
    expect(wrapper.text()).toContain('30s');
  });

  it('opens watcher details from cards mode selections', async () => {
    mockGetAllWatchers.mockResolvedValue([
      {
        id: 'watcher-alpha',
        name: 'Alpha Watcher',
        type: 'docker',
        configuration: { cron: '*/5 * * * *' },
      },
    ]);
    mockGetWatcher.mockResolvedValue({
      id: 'watcher-alpha',
      name: 'Alpha Watcher',
      type: 'docker',
      configuration: { cron: '*/1 * * * *', grace: '30s' },
    });

    const wrapper = await mountWatchersView();

    await wrapper.find('.mode-cards').trigger('click');
    await flushPromises();
    await wrapper.find('.card-click-first').trigger('click');
    await flushPromises();

    expect(wrapper.find('.detail-panel').attributes('data-open')).toBe('true');
    expect(mockGetWatcher).toHaveBeenCalledWith({
      type: 'docker',
      name: 'Alpha Watcher',
      agent: undefined,
    });
    expect(wrapper.text()).toContain('*/1 * * * *');
    expect(wrapper.text()).toContain('30s');
  });

  it('reads containers total from metadata (issue #301)', async () => {
    mockGetAllWatchers.mockResolvedValue([
      {
        id: 'watcher-alpha',
        name: 'Alpha Watcher',
        type: 'docker',
        configuration: { cron: '*/5 * * * *' },
        metadata: {
          containers: { total: 5, running: 3, stopped: 2, updatesAvailable: 1 },
          images: 3,
        },
      },
    ]);

    const wrapper = await mountWatchersView();
    const table = wrapper.findComponent(richDataTableStub);
    const rows = table.props('rows') as Array<{ containers: number }>;

    expect(rows[0].containers).toBe(5);
  });
});
