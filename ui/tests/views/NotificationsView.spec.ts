import { flushPromises } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { resetPreferences } from '@/preferences/store';
import {
  getAllNotificationRules,
  type NotificationRule,
  updateNotificationRule,
} from '@/services/notification';
import { getAllTriggers } from '@/services/trigger';
import NotificationsView from '@/views/NotificationsView.vue';
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

vi.mock('@/services/notification', () => ({
  getAllNotificationRules: vi.fn(),
  updateNotificationRule: vi.fn(),
}));

vi.mock('@/services/trigger', () => ({
  getAllTriggers: vi.fn(),
}));

const mockGetAllNotificationRules = getAllNotificationRules as ReturnType<typeof vi.fn>;
const mockUpdateNotificationRule = updateNotificationRule as ReturnType<typeof vi.fn>;
const mockGetAllTriggers = getAllTriggers as ReturnType<typeof vi.fn>;

function makeRule(overrides: Partial<NotificationRule> = {}): NotificationRule {
  return {
    id: 'security-alert',
    name: 'Security Alert',
    description: 'Critical vulnerabilities detected',
    enabled: true,
    triggers: ['trigger:slack-alerts'],
    ...overrides,
  };
}

async function mountNotificationsView(stubs: Record<string, any> = {}) {
  const wrapper = mountWithPlugins(NotificationsView, {
    global: {
      stubs: {
        ...dataViewStubs,
        ...stubs,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

describe('NotificationsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPreferences();
    mockRoute.query = {};

    mockGetAllNotificationRules.mockResolvedValue([
      makeRule({
        id: 'security-alert',
        triggers: ['trigger:slack-alerts', 'trigger:docker-policy'],
      }),
    ]);

    mockGetAllTriggers.mockResolvedValue([
      { id: 'trigger:slack-alerts', name: 'Slack Alerts', type: 'slack' },
      { id: 'trigger:docker-policy', name: 'Docker Policy', type: 'docker' },
    ]);

    mockUpdateNotificationRule.mockResolvedValue(
      makeRule({
        id: 'security-alert',
        enabled: true,
        triggers: [],
      }),
    );
  });

  it('loads rules and filters trigger assignments to notification trigger types', async () => {
    const wrapper = await mountNotificationsView();

    expect(mockGetAllNotificationRules).toHaveBeenCalledTimes(1);
    expect(mockGetAllTriggers).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('1');

    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();

    // Docker triggers are excluded from notification assignments in detail view.
    expect(wrapper.text()).toContain('Slack Alerts');
    expect(wrapper.text()).not.toContain('Docker Policy');
  });

  it('saves trigger assignment changes from the detail panel', async () => {
    const wrapper = await mountNotificationsView();

    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();

    const triggerCheckbox = wrapper.find('input[type="checkbox"]');
    expect(triggerCheckbox.exists()).toBe(true);

    await triggerCheckbox.trigger('change');
    await flushPromises();

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Save changes'));

    expect(saveButton).toBeDefined();
    expect(saveButton?.attributes('disabled')).toBeUndefined();

    await saveButton?.trigger('click');
    await flushPromises();

    expect(mockUpdateNotificationRule).toHaveBeenCalledWith('security-alert', {
      triggers: [],
    });
  });

  it('treats empty update-available assignments as all notification triggers in the UI', async () => {
    mockGetAllNotificationRules.mockResolvedValue([
      makeRule({
        id: 'update-available',
        name: 'Update Available',
        description: 'When a container has a new version',
        triggers: [],
      }),
    ]);
    mockGetAllTriggers.mockResolvedValue([
      { id: 'trigger:slack-alerts', name: 'Slack Alerts', type: 'slack' },
      { id: 'trigger:smtp-gmail', name: 'SMTP Gmail', type: 'smtp' },
    ]);

    const wrapper = await mountNotificationsView();

    await wrapper.find('.mode-cards').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('All notification triggers');
    expect(wrapper.text()).not.toContain('No triggers');

    await wrapper.find('.card-click-first').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain(
      'Leave this empty to send this event to all notification triggers.',
    );
    expect(wrapper.text()).toContain('Selecting any trigger turns this rule into an allow-list.');
  });

  it('renders the non-update-available trigger summary and detail help text', async () => {
    mockGetAllNotificationRules.mockResolvedValue([
      makeRule({
        id: 'security-alert',
        name: 'Security Alert',
        description: 'Critical vulnerabilities detected',
        triggers: [],
      }),
    ]);

    const wrapper = await mountNotificationsView();

    await wrapper.find('.mode-cards').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('No triggers');

    await wrapper.find('.card-click-first').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain(
      'Only selected triggers will receive this event. Leave it empty to suppress this event for all triggers.',
    );
    expect(wrapper.text()).not.toContain(
      'Leave this empty to send this event to all notification triggers. Selecting any trigger turns this rule into an allow-list.',
    );
  });

  it('renders shared switch controls in table, cards, list, and detail contexts', async () => {
    const wrapper = await mountNotificationsView({
      DataTable: defineComponent({
        props: ['rows', 'rowKey', 'activeRow', 'selectedKey', 'sortKey', 'sortAsc'],
        emits: ['row-click', 'update:sort-key', 'update:sort-asc'],
        template: `
          <div class="data-table"
               :data-row-count="rows?.length ?? 0"
               :data-selected-key="selectedKey || activeRow || ''">
            <button v-if="rows?.[0]" class="row-click-first" @click="$emit('row-click', rows[0])">Open 1</button>
            <slot name="cell-enabled" v-if="rows?.[0]" :row="rows[0]" />
            <slot name="empty" v-if="!rows || rows.length === 0" />
          </div>
        `,
      }),
      DataListAccordion: defineComponent({
        props: ['items', 'itemKey', 'selectedKey'],
        emits: ['item-click'],
        template: `
          <div class="data-list-accordion" :data-item-count="items?.length ?? 0">
            <button v-if="items?.[0]" class="list-click-first" @click="$emit('item-click', items[0])">List 1</button>
            <slot name="header" v-if="items?.[0]" :item="items[0]" />
          </div>
        `,
      }),
    });

    const tableRuleSwitch = wrapper.find('button[aria-label="Toggle notification rule"]');
    expect(tableRuleSwitch.exists()).toBe(true);
    expect(tableRuleSwitch.classes()).toEqual(expect.arrayContaining(['w-8', 'h-4']));

    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('button[role="switch"]')).toHaveLength(2);

    const detailSwitch = wrapper.find('button[aria-label="Rule status"]');
    expect(detailSwitch.exists()).toBe(true);
    expect(detailSwitch.classes()).toEqual(expect.arrayContaining(['w-10', 'h-5']));

    await wrapper.find('.mode-cards').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('button[role="switch"]')).toHaveLength(2);

    const cardsRuleSwitch = wrapper.find('button[aria-label="Toggle notification rule"]');
    expect(cardsRuleSwitch.classes()).toEqual(expect.arrayContaining(['w-8', 'h-4']));

    await wrapper.find('.mode-list').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('button[role="switch"]')).toHaveLength(2);

    const listRuleSwitch = wrapper.find('button[aria-label="Toggle notification rule"]');
    expect(listRuleSwitch.classes()).toEqual(expect.arrayContaining(['w-8', 'h-4']));
  });

  it('shows an inline error when rules fail to load', async () => {
    mockGetAllNotificationRules.mockRejectedValue(new Error('boom'));

    const wrapper = await mountNotificationsView();

    expect(wrapper.text()).toContain('boom');
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('0');
  });

  it('applies search query from the route', async () => {
    mockRoute.query = { q: 'security' };
    mockGetAllNotificationRules.mockResolvedValue([
      makeRule({ id: 'security-alert', name: 'Security Alert' }),
      makeRule({ id: 'agent-disconnect', name: 'Agent Disconnect' }),
    ]);

    const wrapper = await mountNotificationsView();

    expect((wrapper.find('input[type="text"]').element as HTMLInputElement).value).toBe('security');
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('1');
  });
});
