import { mount } from '@vue/test-utils';
import ConfigurationTriggersView from '@/views/ConfigurationTriggersView';

vi.mock('@/services/trigger', () => ({
  getAllTriggers: vi.fn(() =>
    Promise.resolve([
      { id: 'trigger1', type: 'webhook', name: 'My Webhook' },
      { id: 'trigger2', type: 'smtp', name: 'Email Alert' },
    ]),
  ),
  getTriggerProviderIcon: vi.fn((type) => {
    switch (type) {
      case 'webhook':
        return 'fas fa-globe';
      case 'smtp':
        return 'fas fa-envelope';
      default:
        return 'fas fa-bolt';
    }
  }),
  getTriggerProviderColor: vi.fn(() => '#6B7280'),
}));

describe('ConfigurationTriggersView', () => {
  let wrapper;

  beforeEach(async () => {
    wrapper = mount(ConfigurationTriggersView, {
      global: {
        stubs: {
          'trigger-detail': {
            template: '<div class="trigger-detail-stub"><slot /></div>',
            props: ['trigger'],
          },
        },
      },
    });
    await wrapper.setData({
      triggers: [
        { id: 'trigger1', type: 'webhook', name: 'My Webhook' },
        { id: 'trigger2', type: 'smtp', name: 'Email Alert' },
      ],
    });
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it('renders a row for each trigger', () => {
    const rows = wrapper.findAll('.mb-3');
    expect(rows).toHaveLength(2);
  });

  it('displays empty message when no triggers', async () => {
    await wrapper.setData({ triggers: [] });
    expect(wrapper.text()).toContain('No triggers configured');
  });
});

describe('ConfigurationTriggersView Route Hook', () => {
  it('fetches triggers on beforeRouteEnter', async () => {
    const next = vi.fn();
    await ConfigurationTriggersView.beforeRouteEnter.call(ConfigurationTriggersView, {}, {}, next);
    expect(next).toHaveBeenCalledWith(expect.any(Function));

    const vm = { triggers: [] };
    const callback = next.mock.calls[0][0];
    callback(vm);

    expect(vm.triggers).toHaveLength(2);
    expect(vm.triggers[0].id).toBe('trigger1');
  });

  it('emits error notification on failure', async () => {
    const { getAllTriggers } = await import('@/services/trigger');
    (getAllTriggers as any).mockRejectedValueOnce(new Error('Trigger error'));

    const next = vi.fn();
    await ConfigurationTriggersView.beforeRouteEnter.call(ConfigurationTriggersView, {}, {}, next);

    const vm = { $eventBus: { emit: vi.fn() } };
    const callback = next.mock.calls[0][0];
    callback(vm);

    expect(vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      expect.stringContaining('Trigger error'),
      'error',
    );
  });
});
