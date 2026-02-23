import { flushPromises } from '@vue/test-utils';
import NotificationsView from '@/views/NotificationsView.vue';
import {
  getAllNotificationRules,
  updateNotificationRule,
  type NotificationRule,
} from '@/services/notification';
import { getAllTriggers } from '@/services/trigger';
import { mountWithPlugins } from '../helpers/mount';
import { dataViewStubs } from '../helpers/data-view-stubs';

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

async function mountNotificationsView() {
  const wrapper = mountWithPlugins(NotificationsView, {
    global: { stubs: dataViewStubs },
  });
  await flushPromises();
  return wrapper;
}

describe('NotificationsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
