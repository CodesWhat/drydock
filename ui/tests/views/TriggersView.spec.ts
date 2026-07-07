import { flushPromises } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';
import { preferences, resetPreferences } from '@/preferences/store';
import { getAllTriggers, getTrigger, runTrigger } from '@/services/trigger';
import TriggersView from '@/views/TriggersView.vue';
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

vi.mock('@/services/trigger', () => ({
  getAllTriggers: vi.fn(),
  getTrigger: vi.fn(),
  runTrigger: vi.fn(),
}));

const mockGetAllTriggers = getAllTriggers as ReturnType<typeof vi.fn>;
const mockGetTrigger = getTrigger as ReturnType<typeof vi.fn>;
const mockRunTrigger = runTrigger as ReturnType<typeof vi.fn>;

function makeTrigger(overrides: Record<string, any> = {}) {
  return {
    id: 'trigger:slack-alerts',
    name: 'Slack Alerts',
    type: 'slack',
    configuration: { channel: '#alerts' },
    ...overrides,
  };
}

async function mountTriggersView() {
  const wrapper = mountWithPlugins(TriggersView, {
    global: { stubs: dataViewStubs },
  });
  await flushPromises();
  return wrapper;
}

function findButtonByText(wrapper: any, label: string) {
  return wrapper.findAll('button').find((button: any) => button.text().includes(label));
}

const triggerCardFilterBarStub = defineComponent({
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
      class="data-filter-bar trigger-card-filter"
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
      <slot name="filters" />
    </div>
  `,
});

const triggerCardDataTableStub = defineComponent({
  props: [
    'columns',
    'rows',
    'rowKey',
    'activeRow',
    'selectedKey',
    'sortKey',
    'sortAsc',
    'preferCards',
    'showActions',
  ],
  emits: ['row-click', 'update:cardReflowForced'],
  template: `
    <div
      class="data-table trigger-card-table"
      :data-row-count="rows?.length ?? 0"
      :data-prefer-cards="String(preferCards)"
      :data-selected-key="selectedKey || activeRow || ''">
      <button class="force-card-reflow" @click="$emit('update:cardReflowForced', true)">
        Force cards
      </button>
      <button class="clear-card-reflow" @click="$emit('update:cardReflowForced', false)">
        Clear cards
      </button>
      <article
        v-for="row in rows || []"
        :key="row[rowKey || 'id']"
        class="trigger-card"
        :data-card-id="row[rowKey || 'id']">
        <slot name="card" :row="row" />
      </article>
      <slot name="empty" v-if="!rows || rows.length === 0" />
    </div>
  `,
});

const appIconButtonStub = defineComponent({
  props: ['icon', 'size', 'variant', 'ariaLabel', 'disabled'],
  emits: ['click'],
  template:
    '<button class="app-icon-button-stub" :data-icon="icon" :data-size="size" :aria-label="ariaLabel" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>',
});

async function mountTriggersCardView() {
  const wrapper = mountWithPlugins(TriggersView, {
    global: {
      stubs: {
        ...dataViewStubs,
        DataFilterBar: triggerCardFilterBarStub,
        DataTable: triggerCardDataTableStub,
        AppIconButton: appIconButtonStub,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

describe('TriggersView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPreferences();
    mockRoute.query = {};

    mockGetAllTriggers.mockResolvedValue([
      makeTrigger(),
      makeTrigger({
        id: 'trigger:smtp-reports',
        name: 'SMTP Reports',
        type: 'smtp',
        configuration: { from: 'drydock@example.com' },
      }),
    ]);

    mockRunTrigger.mockResolvedValue({ ok: true });
    mockGetTrigger.mockResolvedValue(makeTrigger());
  });

  it('successful load renders trigger rows', async () => {
    const wrapper = await mountTriggersView();

    expect(mockGetAllTriggers).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('2');
  });

  it('route query q filters rows', async () => {
    mockRoute.query = { q: 'slack' };

    const wrapper = await mountTriggersView();

    expect((wrapper.find('input[type="text"]').element as HTMLInputElement).value).toBe('slack');
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('1');
  });

  it('clicking "Test Trigger" in detail panel calls runTrigger with expected payload', async () => {
    const wrapper = await mountTriggersView();

    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();

    const testButton = findButtonByText(wrapper, 'Test Trigger');
    expect(testButton).toBeDefined();

    await testButton?.trigger('click');
    await flushPromises();

    expect(mockRunTrigger).toHaveBeenCalledTimes(1);
    expect(mockRunTrigger).toHaveBeenCalledWith({
      triggerType: 'slack',
      triggerName: 'Slack Alerts',
      container: {
        id: 'test',
        name: 'Test Container',
        image: { name: 'test/image', tag: { value: 'latest' } },
        result: { tag: 'latest' },
        updateKind: { kind: 'unknown', semverDiff: 'unknown' },
      },
    });
  });

  it('API load failure shows "Failed to load triggers"', async () => {
    mockGetAllTriggers.mockRejectedValue(new Error('boom'));

    const wrapper = await mountTriggersView();

    expect(wrapper.text()).toContain('Failed to load triggers');
  });

  it('shows parsed trigger failure reason in the detail panel', async () => {
    mockRunTrigger.mockRejectedValueOnce(
      new Error(
        'Error when running trigger http.local (Unable to authenticate HTTP trigger http.local: bearer token is missing)',
      ),
    );

    const wrapper = await mountTriggersView();
    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();

    const testButton = findButtonByText(wrapper, 'Test Trigger');
    expect(testButton).toBeDefined();

    await testButton?.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain(
      'Unable to authenticate HTTP trigger http.local: bearer token is missing',
    );
  });

  it('shows fallback trigger failure message when error has no text', async () => {
    mockRunTrigger.mockRejectedValueOnce({});

    const wrapper = await mountTriggersView();
    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();

    const testButton = findButtonByText(wrapper, 'Test Trigger');
    expect(testButton).toBeDefined();

    await testButton?.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Trigger test failed');
  });

  it('clicking a row fetches trigger details from per-component endpoint', async () => {
    mockGetAllTriggers.mockResolvedValue([
      makeTrigger({
        id: 'trigger:slack-alerts',
        name: 'Slack Alerts',
        type: 'slack',
        configuration: { channel: '#alerts' },
      }),
    ]);
    mockGetTrigger.mockResolvedValue(
      makeTrigger({
        id: 'trigger:slack-alerts',
        name: 'Slack Alerts',
        type: 'slack',
        configuration: { channel: '#detail-alerts', retries: '3' },
      }),
    );

    const wrapper = await mountTriggersView();
    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();

    expect(mockGetTrigger).toHaveBeenCalledWith({
      type: 'slack',
      name: 'Slack Alerts',
      agent: undefined,
    });
    expect(wrapper.text()).toContain('#detail-alerts');
    expect(wrapper.text()).toContain('3');
  });

  it('status badges render translated text not raw data values', async () => {
    const wrapper = await mountTriggersView();

    // table view: DataTable stub exposes #cell-status slot in data-cell="status"
    expect(wrapper.find('[data-cell="status"]').text()).toContain('Active');
    expect(wrapper.find('[data-cell="status"]').text()).not.toContain('active');

    // detail panel subtitle slot — contains the status AppBadge for selectedTrigger
    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();
    expect(wrapper.find('.detail-subtitle').text()).toBe('Active');
  });

  it('test button in DataTable actions column fires runTrigger', async () => {
    mockGetAllTriggers.mockResolvedValue([makeTrigger()]);

    const wrapper = mountWithPlugins(TriggersView, {
      global: {
        stubs: {
          ...dataViewStubs,
          DataTable: defineComponent({
            props: [
              'columns',
              'rows',
              'rowKey',
              'activeRow',
              'selectedKey',
              'sortKey',
              'sortAsc',
              'showActions',
            ],
            emits: ['row-click', 'update:sort-key', 'update:sort-asc'],
            template: `
              <div class="data-table"
                   :data-row-count="rows?.length ?? 0"
                   :data-selected-key="selectedKey || activeRow || ''"
                   :data-show-actions="showActions">
                <button v-if="rows?.[0]" class="row-click-first" @click="$emit('row-click', rows[0])">Open 1</button>
                <div v-if="rows?.[0]" class="actions-cell"><slot name="actions" :row="rows[0]" /></div>
                <slot name="empty" v-if="!rows || rows.length === 0" />
              </div>
            `,
          }),
          AppIconButton: defineComponent({
            props: ['icon', 'size', 'variant', 'ariaLabel', 'disabled'],
            emits: ['click'],
            template:
              '<button class="app-icon-button-stub" :data-icon="icon" :aria-label="ariaLabel" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>',
          }),
        },
      },
    });
    await flushPromises();

    const actionsCell = wrapper.find('.actions-cell');
    expect(actionsCell.exists()).toBe(true);

    const testButton = actionsCell.find('.app-icon-button-stub');
    expect(testButton.exists()).toBe(true);
    expect(testButton.attributes('data-icon')).toBe('play');

    await testButton.trigger('click');
    await flushPromises();

    expect(mockRunTrigger).toHaveBeenCalledTimes(1);
    expect(mockRunTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: 'slack',
        triggerName: 'Slack Alerts',
      }),
    );
  });

  it('renders trigger cards and wires the card-mode reflow controls', async () => {
    preferences.views.triggers.mode = 'cards';
    mockGetAllTriggers.mockResolvedValue([
      makeTrigger({
        id: 'trigger:slack-alerts',
        name: 'Slack Alerts',
        type: 'slack',
        agent: 'edge-1',
      }),
      makeTrigger({
        id: 'trigger:http-alerts',
        name: 'HTTP Alerts',
        type: 'http',
      }),
    ]);

    const wrapper = await mountTriggersCardView();

    expect(wrapper.get('.trigger-card-table').attributes('data-prefer-cards')).toBe('true');
    expect(wrapper.get('.trigger-card-filter').attributes('data-mode')).toBe('cards');
    expect(wrapper.get('.trigger-card-filter').attributes('data-hide-view-toggle')).toBe('false');

    const slackCard = wrapper.get('[data-card-id="trigger:slack-alerts"]');
    expect(slackCard.text()).toContain('Slack Alerts');
    expect(slackCard.text()).toContain('edge-1');
    expect(slackCard.text()).toContain('Active');
    expect(slackCard.text()).toContain('Slack');
    expect(slackCard.get('.app-icon-button-stub').attributes('data-icon')).toBe('play');
    expect(slackCard.get('.app-icon-button-stub').attributes('data-size')).toBe('sm');

    await wrapper.get('.force-card-reflow').trigger('click');
    await nextTick();
    expect(wrapper.get('.trigger-card-filter').attributes('data-hide-view-toggle')).toBe('true');

    await wrapper.get('.clear-card-reflow').trigger('click');
    await nextTick();
    expect(wrapper.get('.trigger-card-filter').attributes('data-hide-view-toggle')).toBe('false');

    (wrapper.vm as any).triggersData = [
      {
        id: 'trigger:http-alerts',
        name: 'HTTP Alerts',
        type: 'http',
        status: 'inactive',
        config: {},
      },
    ];
    await nextTick();

    const inactiveCard = wrapper.get('[data-card-id="trigger:http-alerts"]');
    expect(inactiveCard.text()).toContain('HTTP Alerts');
    expect(inactiveCard.text()).toContain('Inactive');
    expect(inactiveCard.text()).toContain('HTTP');

    await inactiveCard.get('.app-icon-button-stub').trigger('click');
    await flushPromises();

    expect(mockRunTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: 'http',
        triggerName: 'HTTP Alerts',
      }),
    );
  });
});
