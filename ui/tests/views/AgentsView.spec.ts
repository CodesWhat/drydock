import { flushPromises } from '@vue/test-utils';
import { defineComponent, nextTick, ref } from 'vue';
import { VIEW_TABLE_COLUMN_KEYS } from '@/preferences/schema';
import { preferences, resetPreferences } from '@/preferences/store';
import { getAgents } from '@/services/agent';
import { getLogEntries } from '@/services/log';
import { getAllTriggers } from '@/services/trigger';
import { getAllWatchers } from '@/services/watcher';
import AgentsView from '@/views/AgentsView.vue';
import { dataViewStubs } from '../helpers/data-view-stubs';
import { mountWithPlugins } from '../helpers/mount';

const { mockRoute } = vi.hoisted(() => ({
  mockRoute: { query: {} as Record<string, unknown> },
}));

// Real refs (not plain `{ value }` objects) — the component's template uses bare
// `isCompact` (no `.value`) in `v-if` bindings, which only auto-unwraps for genuine
// Vue refs. A plain object would be constant-truthy there.
const mockIsMobile = ref(false);
const mockWindowNarrow = ref(false);

vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/composables/useBreakpoints', () => ({
  useBreakpoints: () => ({
    isMobile: mockIsMobile,
    windowNarrow: mockWindowNarrow,
  }),
}));

vi.mock('@/services/agent', () => ({
  getAgents: vi.fn(),
}));

vi.mock('@/services/log', () => ({
  getLogEntries: vi.fn(),
}));

vi.mock('@/services/watcher', () => ({
  getAllWatchers: vi.fn(),
}));

vi.mock('@/services/trigger', () => ({
  getAllTriggers: vi.fn(),
}));

const mockGetAgents = getAgents as ReturnType<typeof vi.fn>;
const mockGetLogEntries = getLogEntries as ReturnType<typeof vi.fn>;
const mockGetAllWatchers = getAllWatchers as ReturnType<typeof vi.fn>;
const mockGetAllTriggers = getAllTriggers as ReturnType<typeof vi.fn>;
const mountedWrappers: Array<{ unmount: () => void }> = [];

function makeAgent(overrides: Record<string, any> = {}) {
  return {
    name: 'edge-1',
    host: '10.0.0.31',
    port: 2376,
    connected: true,
    dockerVersion: '27.0.0',
    os: 'linux',
    arch: 'amd64',
    cpus: 8,
    memoryGb: 16,
    containers: { total: 12, running: 10, stopped: 2 },
    images: 45,
    lastSeen: 'Just now',
    version: '1.4.0',
    uptime: '4d 3h',
    logLevel: 'info',
    pollInterval: '30s',
    ...overrides,
  };
}

// Renders column headers (filtered by hiddenColumnKeys, like the real DataTable) and, per
// row, only the cell slots for columns that survive that same filter — so the compact-mode
// badge folded into `cell-name` is the only place row data resurfaces once the other
// columns are force-hidden.
const richDataTableStub = defineComponent({
  props: ['columns', 'rows', 'rowKey', 'sortKey', 'sortAsc', 'selectedKey', 'hiddenColumnKeys'],
  emits: ['row-click', 'update:sort-key', 'update:sort-asc'],
  template: `
    <div class="data-table" :data-row-count="rows?.length ?? 0" :data-selected-key="selectedKey || ''">
      <div
        v-for="col in (columns || []).filter((c) => !(hiddenColumnKeys || []).includes(c.key))"
        :key="col.key"
        class="dt-header"
        :data-col-key="col.key">
        {{ col.label }}
      </div>
      <button v-if="rows?.[0]" class="row-click-first" @click="$emit('row-click', rows[0])">Open 1</button>
      <button v-if="rows?.[1]" class="row-click-second" @click="$emit('row-click', rows[1])">Open 2</button>
      <div v-for="row in rows" :key="row[rowKey || 'id']" class="data-table-row">
        <template
          v-for="col in (columns || []).filter((c) => !(hiddenColumnKeys || []).includes(c.key))"
          :key="col.key">
          <slot :name="'cell-' + col.key" :row="row" />
        </template>
      </div>
      <slot name="empty" v-if="!rows || rows.length === 0" />
    </div>
  `,
});

const agentCardFilterBarStub = defineComponent({
  props: [
    'modelValue',
    'viewModes',
    'showFilters',
    'filteredCount',
    'totalCount',
    'activeFilterCount',
    'hideViewToggle',
  ],
  emits: ['update:modelValue', 'update:showFilters'],
  template: `
    <div
      class="data-filter-bar agent-card-filter"
      :data-mode="modelValue"
      :data-hide-view-toggle="String(hideViewToggle)">
      <button
        v-for="mode in (viewModes || [{ id: 'table' }, { id: 'cards' }])"
        :key="mode.id"
        :class="'mode-' + mode.id"
        :data-active="String(modelValue === mode.id)"
        @click="$emit('update:modelValue', mode.id)">
        {{ mode.id }}
      </button>
      <slot name="sort" />
      <slot name="filters" />
      <slot name="extra-buttons" />
    </div>
  `,
});

const agentCardDataTableStub = defineComponent({
  props: [
    'columns',
    'rows',
    'rowKey',
    'sortKey',
    'sortAsc',
    'selectedKey',
    'hiddenColumnKeys',
    'preferCards',
    'hoistCardSort',
  ],
  emits: ['row-click', 'update:sortKey', 'update:sortAsc', 'update:cardReflowForced'],
  template: `
    <div
      class="data-table agent-card-table"
      :data-row-count="rows?.length ?? 0"
      :data-sort-key="sortKey"
      :data-sort-asc="String(sortAsc)"
      :data-prefer-cards="String(preferCards)"
      :data-hoist-card-sort="String(hoistCardSort)"
      :data-hidden-keys="JSON.stringify(hiddenColumnKeys || [])"
      :data-selected-key="selectedKey || ''">
      <button class="force-card-reflow" @click="$emit('update:cardReflowForced', true)">
        Force cards
      </button>
      <button class="clear-card-reflow" @click="$emit('update:cardReflowForced', false)">
        Clear cards
      </button>
      <article
        v-for="row in rows || []"
        :key="row[rowKey || 'id']"
        class="agent-card"
        :data-card-id="row[rowKey || 'id']">
        <slot name="card" :row="row" />
      </article>
      <slot name="empty" v-if="!rows || rows.length === 0" />
    </div>
  `,
});

const dataSortControlStub = defineComponent({
  props: ['columns', 'sortKey', 'sortAsc'],
  emits: ['update:sortKey', 'update:sortAsc'],
  template: `
    <div
      class="agent-sort-control"
      :data-columns="columns.map((column) => column.key).join(',')"
      :data-sort-key="sortKey"
      :data-sort-asc="String(sortAsc)">
      <button class="sort-by-status" @click="$emit('update:sortKey', 'status')">
        Sort status
      </button>
      <button class="sort-desc" @click="$emit('update:sortAsc', false)">
        Desc
      </button>
    </div>
  `,
});

async function mountAgentsView() {
  const wrapper = mountWithPlugins(AgentsView, {
    global: {
      stubs: {
        ...dataViewStubs,
        DataTable: richDataTableStub,
      },
    },
  });
  mountedWrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

async function mountAgentsCardView() {
  const wrapper = mountWithPlugins(AgentsView, {
    global: {
      stubs: {
        ...dataViewStubs,
        DataFilterBar: agentCardFilterBarStub,
        DataTable: agentCardDataTableStub,
        DataSortControl: dataSortControlStub,
      },
    },
  });
  mountedWrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

describe('AgentsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPreferences();
    mockRoute.query = {};
    mockIsMobile.value = false;
    mockWindowNarrow.value = false;
    mockGetAgents.mockResolvedValue([makeAgent()]);
    mockGetLogEntries.mockResolvedValue([]);
    mockGetAllWatchers.mockResolvedValue([]);
    mockGetAllTriggers.mockResolvedValue([]);
  });

  afterEach(() => {
    while (mountedWrappers.length > 0) {
      mountedWrappers.pop()?.unmount();
    }
  });

  describe('agentAllColumns (card-mode annotations)', () => {
    it('flags status with cardPriority and demotes docker + os out of the card body', async () => {
      const wrapper = await mountAgentsView();
      const vm = wrapper.vm as any;
      const statusCol = vm.agentAllColumns.find((c: any) => c.key === 'status');
      const dockerCol = vm.agentAllColumns.find((c: any) => c.key === 'docker');
      const osCol = vm.agentAllColumns.find((c: any) => c.key === 'os');
      expect(statusCol.cardPriority).toBe(5);
      expect(dockerCol.cardPriority).toBe(-1);
      expect(osCol.cardPriority).toBe(-1);
    });
  });

  describe('column picker', () => {
    it('agentAllColumns keys match VIEW_TABLE_COLUMN_KEYS.agents (schema/view sync guard)', async () => {
      const wrapper = await mountAgentsView();
      const vm = wrapper.vm as any;
      const keys = new Set(vm.agentAllColumns.map((c: any) => c.key));
      expect(keys).toEqual(new Set(VIEW_TABLE_COLUMN_KEYS.agents));
    });

    it('marks the name column as required', async () => {
      const wrapper = await mountAgentsView();
      const vm = wrapper.vm as any;
      const nameCol = vm.agentAllColumns.find((c: any) => c.key === 'name');
      expect(nameCol.required).toBe(true);
    });

    it('renders the column picker in the filter bar when not compact', async () => {
      const wrapper = await mountAgentsView();
      expect(wrapper.find('[data-test="data-table-column-picker"]').exists()).toBe(true);
    });

    it('passes only the picker-hidden set to DataTable when not compact', async () => {
      const wrapper = await mountAgentsView();

      expect(wrapper.find('[data-col-key="status"]').exists()).toBe(true);
      await wrapper.find('[data-test="column-picker-toggle-status"]').trigger('click');
      await nextTick();

      expect(wrapper.find('[data-col-key="status"]').exists()).toBe(false);
    });

    it('toggling a column via the picker persists the key to preferences.views.agents.hiddenColumns', async () => {
      const wrapper = await mountAgentsView();

      await wrapper.find('[data-test="column-picker-toggle-status"]').trigger('click');
      await nextTick();

      expect(preferences.views.agents.hiddenColumns).toContain('status');
    });

    it('hides the picker and unions the picker-hidden set with every non-required column when compact', async () => {
      mockWindowNarrow.value = true;
      const wrapper = await mountAgentsView();

      expect(wrapper.find('[data-test="data-table-column-picker"]').exists()).toBe(false);
      expect(wrapper.find('[data-col-key="name"]').exists()).toBe(true);
      expect(
        ['status', 'containers', 'docker', 'os', 'version', 'lastSeen'].every(
          (key) => !wrapper.find(`[data-col-key="${key}"]`).exists(),
        ),
      ).toBe(true);
    });
  });

  it('renders the compact badge row inside the name cell when compact', async () => {
    mockWindowNarrow.value = true;
    const wrapper = await mountAgentsView();

    const badgeRow = wrapper.find('.flex.items-center.gap-1\\.5.mt-1\\.5');
    expect(badgeRow.exists()).toBe(true);
    expect(badgeRow.text()).toContain('10/12');
    expect(badgeRow.text()).toContain('Just now');
  });

  it('does not render the compact badge row inside the name cell when not compact', async () => {
    const wrapper = await mountAgentsView();
    expect(wrapper.find('.flex.items-center.gap-1\\.5.mt-1\\.5').exists()).toBe(false);
    expect(wrapper.find('[data-col-key="containers"]').exists()).toBe(true);
  });

  it('successful load renders agent rows', async () => {
    mockGetAgents.mockResolvedValue([
      makeAgent({ name: 'edge-1' }),
      makeAgent({ name: 'edge-2', connected: false }),
    ]);

    const wrapper = await mountAgentsView();

    expect(mockGetAgents).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('2');
  });

  it('logs are not eagerly fetched on mount (issue #301 lazy fetch)', async () => {
    mockGetAgents.mockResolvedValue([
      makeAgent({ name: 'edge-1', connected: true }),
      makeAgent({ name: 'edge-2', connected: false }),
      makeAgent({ name: 'edge-3', connected: true }),
    ]);

    await mountAgentsView();

    expect(mockGetLogEntries).not.toHaveBeenCalled();
  });

  it('logs are fetched lazily when the Logs tab is selected in the detail panel', async () => {
    mockGetAgents.mockResolvedValue([makeAgent({ name: 'edge-1', connected: true })]);

    const wrapper = await mountAgentsView();
    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();

    const logsTab = wrapper.findAll('button').find((button) => button.text().includes('Logs'));
    expect(logsTab).toBeDefined();
    await logsTab?.trigger('click');
    await flushPromises();

    expect(mockGetLogEntries).toHaveBeenCalledTimes(1);
    expect(mockGetLogEntries).toHaveBeenCalledWith({ agent: 'edge-1', tail: 100 });
  });

  it('route query q filters rows', async () => {
    mockRoute.query = { q: 'edge-2' };
    mockGetAgents.mockResolvedValue([makeAgent({ name: 'edge-1' }), makeAgent({ name: 'edge-2' })]);

    const wrapper = await mountAgentsView();

    expect((wrapper.find('input[type="text"]').element as HTMLInputElement).value).toBe('edge-2');
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('1');
  });

  it('API failure shows inline error', async () => {
    mockGetAgents.mockRejectedValue(new Error('boom'));

    const wrapper = await mountAgentsView();

    expect(wrapper.text()).toContain('boom');
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('0');
  });

  it('refreshes agents when agent status SSE event is received', async () => {
    await mountAgentsView();
    expect(mockGetAgents).toHaveBeenCalledTimes(1);

    globalThis.dispatchEvent(new CustomEvent('dd:sse-agent-status-changed'));
    await flushPromises();

    expect(mockGetAgents).toHaveBeenCalledTimes(2);
  });

  it('refreshes agents when the SSE connection is re-established', async () => {
    await mountAgentsView();
    expect(mockGetAgents).toHaveBeenCalledTimes(1);

    globalThis.dispatchEvent(new CustomEvent('dd:sse-connected'));
    await flushPromises();

    expect(mockGetAgents).toHaveBeenCalledTimes(2);
  });

  it('shows agent-specific watchers and triggers in detail panel', async () => {
    mockGetAgents.mockResolvedValue([makeAgent({ name: 'edge-1' })]);
    mockGetAllWatchers.mockResolvedValue([
      { id: 'edge-1.docker.remote', type: 'docker', name: 'remote', agent: 'edge-1' },
      { id: 'docker.local', type: 'docker', name: 'local' },
    ]);
    mockGetAllTriggers.mockResolvedValue([
      { id: 'edge-1.slack.ops', type: 'slack', name: 'ops', agent: 'edge-1' },
      { id: 'smtp.email', type: 'smtp', name: 'email' },
    ]);

    const wrapper = await mountAgentsView();
    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Watchers');
    expect(wrapper.text()).toContain('docker.remote');
    expect(wrapper.text()).toContain('Triggers');
    expect(wrapper.text()).toContain('slack.ops');
    expect(wrapper.text()).not.toContain('docker.local');
    expect(wrapper.text()).not.toContain('smtp.email');
  });

  it('applies agent log filters and refreshes logs from the detail panel', async () => {
    mockGetAgents.mockResolvedValue([makeAgent({ name: 'edge-1', connected: true })]);
    mockGetLogEntries.mockResolvedValue([
      {
        timestamp: '2026-02-28T10:00:00.000Z',
        displayTimestamp: '[10:00:00.000]',
        level: 'info',
        component: 'agent',
        msg: 'connected',
      },
    ]);

    const wrapper = await mountAgentsView();
    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();

    const logsTab = wrapper.findAll('button').find((button) => button.text().includes('Logs'));
    expect(logsTab).toBeDefined();
    await logsTab?.trigger('click');
    await flushPromises();

    const levelSelect = wrapper.find('[data-testid="agent-log-level-filter"]');
    const tailSelect = wrapper.find('[data-testid="agent-log-tail-filter"]');
    const componentInput = wrapper.find('[data-testid="agent-log-component-filter"]');
    const applyButton = wrapper.find('[data-testid="agent-log-apply"]');
    const refreshButton = wrapper.find('[data-testid="agent-log-refresh"]');

    expect(levelSelect.exists()).toBe(true);
    expect(tailSelect.exists()).toBe(true);
    expect(componentInput.exists()).toBe(true);
    expect(applyButton.exists()).toBe(true);
    expect(refreshButton.exists()).toBe(true);

    await levelSelect.setValue('warn');
    await tailSelect.setValue('500');
    await componentInput.setValue('api');
    await applyButton.trigger('click');
    await flushPromises();

    expect(mockGetLogEntries).toHaveBeenLastCalledWith({
      agent: 'edge-1',
      level: 'warn',
      component: 'api',
      tail: 500,
    });

    expect(wrapper.text()).toContain('[10:00:00.000]');

    await refreshButton.trigger('click');
    await flushPromises();

    expect(mockGetLogEntries).toHaveBeenLastCalledWith({
      agent: 'edge-1',
      level: 'warn',
      component: 'api',
      tail: 500,
    });
  });

  it('DataTable empty slot renders when no agents are present', async () => {
    mockGetAgents.mockResolvedValue([]);

    const wrapper = await mountAgentsView();

    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('0');
    expect(wrapper.find('.empty-state').exists()).toBe(true);
  });

  it('hides unknown runtime fields when API only returns base agent connectivity fields', async () => {
    mockGetAgents.mockResolvedValue([
      {
        name: 'edge-1',
        host: '10.0.0.31',
        port: 2376,
        connected: true,
      },
    ]);

    const wrapper = await mountAgentsView();
    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();

    // Scoped to the detail panel body — the table's own "Docker" column header text
    // (now rendered by the richer DataTable stub) would otherwise collide.
    const detailContent = wrapper.find('.detail-content').text();
    expect(detailContent).not.toContain('CPUs');
    expect(detailContent).not.toContain('Memory');
    expect(detailContent).not.toContain('Architecture');
    expect(detailContent).not.toContain('Docker');
  });

  it('renders agent cards and wires card-mode sort controls', async () => {
    preferences.views.agents.mode = 'cards';
    mockGetAgents.mockResolvedValue([
      makeAgent({ name: 'edge-1' }),
      makeAgent({
        name: 'edge-2',
        host: 'unix:///var/run/docker.sock',
        port: undefined,
        connected: false,
        dockerVersion: undefined,
        os: undefined,
        version: undefined,
        containers: { total: 3, running: 0, stopped: 3 },
        lastSeen: '5 minutes ago',
      }),
    ]);

    const wrapper = await mountAgentsCardView();

    const table = wrapper.get('.agent-card-table');
    expect(table.attributes('data-prefer-cards')).toBe('true');
    expect(table.attributes('data-hoist-card-sort')).toBe('true');
    expect(table.attributes('data-sort-key')).toBe('name');
    expect(wrapper.get('.agent-card-filter').attributes('data-mode')).toBe('cards');
    expect(wrapper.get('.agent-card-filter').attributes('data-hide-view-toggle')).toBe('false');

    const sort = wrapper.get('.agent-sort-control');
    expect(sort.attributes('data-columns')).toBe(
      'name,status,containers,docker,os,version,lastSeen',
    );
    expect(sort.attributes('data-sort-key')).toBe('name');
    expect(sort.attributes('data-sort-asc')).toBe('true');

    const connectedCard = wrapper.get('[data-card-id="edge-1"]');
    expect(connectedCard.text()).toContain('edge-1');
    expect(connectedCard.text()).toContain('10.0.0.31:2376');
    expect(connectedCard.text()).toContain('Connected');
    expect(connectedCard.text()).toContain('10/12');
    expect(connectedCard.text()).toContain('v1.4.0');
    expect(connectedCard.text()).toContain('27.0.0');
    expect(connectedCard.text()).toContain('linux');
    expect(connectedCard.text()).toContain('Just now');

    const disconnectedCard = wrapper.get('[data-card-id="edge-2"]');
    expect(disconnectedCard.text()).toContain('edge-2');
    expect(disconnectedCard.text()).toContain('unix:///var/run/docker.sock');
    expect(disconnectedCard.text()).toContain('Disconnected');
    expect(disconnectedCard.text()).toContain('0/3');
    expect(disconnectedCard.text()).toContain('5 minutes ago');

    await sort.get('.sort-by-status').trigger('click');
    await nextTick();
    expect(preferences.views.agents.sortKey).toBe('status');
    expect(wrapper.get('.agent-card-table').attributes('data-sort-key')).toBe('status');

    await wrapper.get('.agent-sort-control .sort-desc').trigger('click');
    await nextTick();
    expect(preferences.views.agents.sortAsc).toBe(false);
    expect(wrapper.get('.agent-card-table').attributes('data-sort-asc')).toBe('false');
  });

  it('hoists agent sorting when card reflow is forced in table mode', async () => {
    mockGetAgents.mockResolvedValue([makeAgent({ name: 'edge-1' })]);

    const wrapper = await mountAgentsCardView();

    expect(wrapper.find('.agent-sort-control').exists()).toBe(false);
    expect(wrapper.get('.agent-card-table').attributes('data-prefer-cards')).toBe('false');
    expect(wrapper.get('.agent-card-table').attributes('data-hoist-card-sort')).toBe('false');
    expect(wrapper.get('.agent-card-filter').attributes('data-hide-view-toggle')).toBe('false');

    await wrapper.get('.force-card-reflow').trigger('click');
    await nextTick();

    expect(wrapper.find('.agent-sort-control').exists()).toBe(true);
    expect(wrapper.get('.agent-card-table').attributes('data-prefer-cards')).toBe('false');
    expect(wrapper.get('.agent-card-table').attributes('data-hoist-card-sort')).toBe('true');
    expect(wrapper.get('.agent-card-filter').attributes('data-hide-view-toggle')).toBe('true');

    await wrapper.get('.clear-card-reflow').trigger('click');
    await nextTick();

    expect(wrapper.find('.agent-sort-control').exists()).toBe(false);
    expect(wrapper.get('.agent-card-table').attributes('data-hoist-card-sort')).toBe('false');
    expect(wrapper.get('.agent-card-filter').attributes('data-hide-view-toggle')).toBe('false');
  });
});
