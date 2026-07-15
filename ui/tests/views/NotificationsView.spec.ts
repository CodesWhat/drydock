import { flushPromises } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';
import { preferences, resetPreferences } from '@/preferences/store';
import {
  getAllNotificationRules,
  type NotificationRule,
  previewNotificationTemplates,
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
  previewNotificationTemplates: vi.fn(),
  updateNotificationRule: vi.fn(),
}));

vi.mock('@/services/trigger', () => ({
  getAllTriggers: vi.fn(),
}));

const mockGetAllNotificationRules = getAllNotificationRules as ReturnType<typeof vi.fn>;
const mockPreviewNotificationTemplates = previewNotificationTemplates as ReturnType<typeof vi.fn>;
const mockUpdateNotificationRule = updateNotificationRule as ReturnType<typeof vi.fn>;
const mockGetAllTriggers = getAllTriggers as ReturnType<typeof vi.fn>;

function makeRule(overrides: Partial<NotificationRule> = {}): NotificationRule {
  return {
    id: 'security-alert',
    name: 'Security Alert',
    description: 'Critical vulnerabilities detected',
    enabled: true,
    triggers: ['trigger:slack-alerts'],
    bellEnabled: true,
    bellThreshold: 'all',
    templates: {},
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

const notificationCardFilterBarStub = defineComponent({
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
      class="data-filter-bar notification-card-filter"
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

const notificationCardDataTableStub = defineComponent({
  props: [
    'columns',
    'rows',
    'rowKey',
    'activeRow',
    'selectedKey',
    'sortKey',
    'sortAsc',
    'preferCards',
  ],
  emits: ['row-click', 'update:cardReflowForced'],
  template: `
    <div
      class="data-table notification-card-table"
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
        class="notification-card"
        :data-card-id="row[rowKey || 'id']">
        <slot name="card" :row="row" />
      </article>
      <slot name="empty" v-if="!rows || rows.length === 0" />
    </div>
  `,
});

const notificationToggleSwitchStub = defineComponent({
  props: ['modelValue', 'size', 'disabled', 'ariaLabel'],
  emits: ['click', 'update:modelValue'],
  template: `
    <button
      class="toggle-switch-stub"
      role="switch"
      :aria-checked="String(modelValue)"
      :aria-label="ariaLabel"
      :disabled="disabled"
      :data-size="size"
      @click="$emit('click', $event); $emit('update:modelValue', !modelValue)">
      {{ modelValue ? 'on' : 'off' }}
    </button>
  `,
});

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
    mockPreviewNotificationTemplates.mockResolvedValue({
      simpleTitle: 'Preview title',
      simpleBody: 'Preview body',
      batchTitle: 'Preview batch',
    });

    mockUpdateNotificationRule.mockResolvedValue(
      makeRule({
        id: 'security-alert',
        enabled: true,
        triggers: [],
      }),
    );
  });

  describe('tableColumns (card-mode annotations)', () => {
    it('flags name as the card title and triggers as the card subtitle priority', async () => {
      const wrapper = await mountNotificationsView();
      const vm = wrapper.vm as any;
      const nameCol = vm.tableColumns.find((c: any) => c.key === 'name');
      const triggersCol = vm.tableColumns.find((c: any) => c.key === 'triggers');
      const enabledCol = vm.tableColumns.find((c: any) => c.key === 'enabled');
      expect(nameCol.cardTitle).toBe(true);
      expect(triggersCol.cardPriority).toBe(1);
      // enabled keeps the default so it renders as a card body row with its ToggleSwitch.
      expect(enabledCol.cardTitle).toBeUndefined();
      expect(enabledCol.cardPriority).toBeUndefined();
    });
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

  it('truncates compact notification surfaces in table mode', async () => {
    const longRuleName = 'Security Alert With A Very Long Name That Should Not Expand Compact Rows';
    const longDescription =
      'This description is intentionally long enough to verify compact notification rows stay one line.';
    const longTriggerName =
      'Slack Alerts With An Exceptionally Long Trigger Name That Must Stay On One Line';

    mockGetAllNotificationRules.mockResolvedValue([
      makeRule({
        id: 'custom-rule',
        name: longRuleName,
        description: longDescription,
        triggers: ['trigger:slack-alerts'],
      }),
    ]);
    mockGetAllTriggers.mockResolvedValue([
      { id: 'trigger:slack-alerts', name: longTriggerName, type: 'slack' },
    ]);

    const wrapper = await mountNotificationsView({
      DataTable: defineComponent({
        props: ['columns', 'rows', 'rowKey', 'activeRow', 'selectedKey', 'sortKey', 'sortAsc'],
        emits: ['row-click', 'update:sort-key', 'update:sort-asc'],
        template: `
          <div class="data-table"
               :data-row-count="rows?.length ?? 0"
               :data-selected-key="selectedKey || activeRow || ''">
            <button v-if="rows?.[0]" class="row-click-first" @click="$emit('row-click', rows[0])">Open 1</button>
            <slot name="cell-name" v-if="rows?.[0]" :row="rows[0]" />
            <slot name="cell-triggers" v-if="rows?.[0]" :row="rows[0]" />
            <slot name="empty" v-if="!rows || rows.length === 0" />
          </div>
        `,
      }),
    });

    const tableName = wrapper.get('.data-table .font-medium.truncate.dd-text');
    expect(tableName.classes()).toContain('truncate');
    expect(tableName.attributes('title')).toBe(longRuleName);

    const tableDescription = wrapper.get('.data-table .text-2xs.mt-0\\.5.dd-text-muted.truncate');
    expect(tableDescription.classes()).toContain('truncate');
    expect(tableDescription.attributes('title')).toBe(longDescription);

    const tableBadge = wrapper.get('.data-table .badge');
    expect(tableBadge.classes()).toContain('shrink-0');
    expect(tableBadge.attributes('title')).toBe(longTriggerName);
    expect(tableBadge.get('span').classes()).toEqual(expect.arrayContaining(['block', 'truncate']));
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

  it('edits bell preferences and previews per-trigger notification templates', async () => {
    const wrapper = await mountNotificationsView({ ToggleSwitch: notificationToggleSwitchStub });
    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();

    await wrapper.get('button[aria-label="Notification bell"]')?.trigger('click');
    expect(wrapper.find('select[aria-label="Bell severity threshold"]').exists()).toBe(false);
    await wrapper
      .get('textarea[aria-label="Simple notification title"]')
      .setValue('Alert ${container.name}');
    await wrapper
      .get('textarea[aria-label="Simple notification body"]')
      .setValue('${container.result.releaseNotes.body}');
    await wrapper.get('button[aria-label="Preview notification template"]').trigger('click');
    await flushPromises();

    expect(mockPreviewNotificationTemplates).toHaveBeenCalledWith(
      'security-alert',
      'trigger:slack-alerts',
      {
        simpleTitle: 'Alert ${container.name}',
        simpleBody: '${container.result.releaseNotes.body}',
      },
    );
    expect(wrapper.text()).toContain('Preview title');

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Save changes'));
    await saveButton?.trigger('click');
    await flushPromises();
    expect(mockUpdateNotificationRule).toHaveBeenCalledWith('security-alert', {
      bellEnabled: false,
      templates: {
        'trigger:slack-alerts': {
          simpleTitle: 'Alert ${container.name}',
          simpleBody: '${container.result.releaseNotes.body}',
        },
      },
    });
  });

  it('clears a rendered template preview when resetting the trigger template', async () => {
    const wrapper = await mountNotificationsView();
    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();

    await wrapper
      .get('textarea[aria-label="Simple notification title"]')
      .setValue('Draft preview title');
    await wrapper.get('button[aria-label="Preview notification template"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Preview title');

    const resetTemplateButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Reset template'));
    expect(resetTemplateButton).toBeDefined();
    await resetTemplateButton?.trigger('click');
    await nextTick();

    expect(wrapper.text()).not.toContain('Preview title');
  });

  it('clears a template preview error when resetting the trigger template', async () => {
    mockPreviewNotificationTemplates.mockRejectedValueOnce(new Error('Preview request failed'));
    const wrapper = await mountNotificationsView();
    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();

    await wrapper
      .get('textarea[aria-label="Simple notification title"]')
      .setValue('Invalid draft title');
    await wrapper.get('button[aria-label="Preview notification template"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Preview request failed');

    const resetTemplateButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Reset template'));
    await resetTemplateButton?.trigger('click');
    await nextTick();

    expect(wrapper.text()).not.toContain('Preview request failed');
  });

  it('hides bell controls for rules without audit-backed bell events', async () => {
    mockGetAllNotificationRules.mockResolvedValue([
      makeRule({
        id: 'agent-reconnect',
        name: 'Agent Reconnected',
        description: 'When an agent reconnects',
        bellEnabled: false,
      }),
    ]);
    const wrapper = await mountNotificationsView({ ToggleSwitch: notificationToggleSwitchStub });

    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();

    expect(wrapper.find('button[aria-label="Notification bell"]').exists()).toBe(false);
    expect(wrapper.find('select[aria-label="Bell severity threshold"]').exists()).toBe(false);
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

    await wrapper.find('.row-click-first').trigger('click');
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

    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain(
      'Only selected triggers will receive this event. Leave it empty to suppress this event for all triggers.',
    );
    expect(wrapper.text()).not.toContain(
      'Leave this empty to send this event to all notification triggers. Selecting any trigger turns this rule into an allow-list.',
    );
  });

  it('renders shared switch controls in table and detail contexts', async () => {
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
    });

    const tableRuleSwitch = wrapper.find('button[aria-label="Toggle notification rule"]');
    expect(tableRuleSwitch.exists()).toBe(true);
    expect(tableRuleSwitch.classes()).toEqual(expect.arrayContaining(['w-8', 'h-4']));

    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('button[role="switch"]')).toHaveLength(3);

    const detailSwitch = wrapper.find('button[aria-label="Rule status"]');
    expect(detailSwitch.exists()).toBe(true);
    expect(detailSwitch.classes()).toEqual(expect.arrayContaining(['w-10', 'h-5']));
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

  it('renders notification cards and wires the footer toggle plus card reflow state', async () => {
    preferences.views.notifications.mode = 'cards';
    mockGetAllNotificationRules.mockResolvedValue([
      makeRule({
        id: 'security-alert',
        enabled: true,
        triggers: ['trigger:slack-alerts', 'trigger:smtp-gmail'],
      }),
      makeRule({
        id: 'agent-disconnect',
        name: 'Agent Disconnect',
        description: 'Remote agent disconnected',
        enabled: false,
        triggers: [],
      }),
    ]);
    mockGetAllTriggers.mockResolvedValue([
      { id: 'trigger:slack-alerts', name: 'Slack Alerts', type: 'slack' },
      { id: 'trigger:smtp-gmail', name: 'SMTP Gmail', type: 'smtp' },
    ]);
    mockUpdateNotificationRule.mockResolvedValueOnce(
      makeRule({
        id: 'security-alert',
        enabled: false,
        triggers: ['trigger:slack-alerts', 'trigger:smtp-gmail'],
      }),
    );

    const wrapper = await mountNotificationsView({
      DataFilterBar: notificationCardFilterBarStub,
      DataTable: notificationCardDataTableStub,
      ToggleSwitch: notificationToggleSwitchStub,
    });

    expect(wrapper.get('.notification-card-table').attributes('data-prefer-cards')).toBe('true');
    expect(wrapper.get('.notification-card-filter').attributes('data-mode')).toBe('cards');
    expect(wrapper.get('.notification-card-filter').attributes('data-hide-view-toggle')).toBe(
      'false',
    );

    const enabledCard = wrapper.get('[data-card-id="security-alert"]');
    expect(enabledCard.text()).toContain('Security Alert');
    expect(enabledCard.text()).toContain('Critical/High vulnerability detected');
    expect(enabledCard.text()).toContain('enabled');
    expect(enabledCard.text()).toContain('Slack Alerts');
    expect(enabledCard.text()).toContain('SMTP Gmail');
    expect(enabledCard.get('.toggle-switch-stub').attributes('aria-checked')).toBe('true');

    const disabledCard = wrapper.get('[data-card-id="agent-disconnect"]');
    expect(disabledCard.text()).toContain('Agent Disconnected');
    expect(disabledCard.text()).toContain('When a remote agent loses connection');
    expect(disabledCard.text()).toContain('disabled');
    expect(disabledCard.text()).toContain('No triggers');
    expect(disabledCard.get('.toggle-switch-stub').attributes('aria-checked')).toBe('false');

    await wrapper.get('.force-card-reflow').trigger('click');
    await nextTick();
    expect(wrapper.get('.notification-card-filter').attributes('data-hide-view-toggle')).toBe(
      'true',
    );

    await wrapper.get('.clear-card-reflow').trigger('click');
    await nextTick();
    expect(wrapper.get('.notification-card-filter').attributes('data-hide-view-toggle')).toBe(
      'false',
    );

    await enabledCard.get('.toggle-switch-stub').trigger('click');
    await flushPromises();

    expect(mockUpdateNotificationRule).toHaveBeenCalledWith('security-alert', {
      enabled: false,
    });
  });
});
