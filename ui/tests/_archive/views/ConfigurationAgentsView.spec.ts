import { mount } from '@vue/test-utils';
import ConfigurationAgentsView from '@/views/ConfigurationAgentsView.vue';

vi.mock('@/services/agent', () => ({
  default: {
    getAgents: vi.fn(() =>
      Promise.resolve([
        { name: 'agent1', host: '192.168.1.1', port: 3000, connected: true },
        { name: 'agent2', host: '192.168.1.2', port: 3001, connected: false },
      ]),
    ),
  },
  getAgents: vi.fn(() =>
    Promise.resolve([
      { name: 'agent1', host: '192.168.1.1', port: 3000, connected: true },
      { name: 'agent2', host: '192.168.1.2', port: 3001, connected: false },
    ]),
  ),
}));

describe('ConfigurationAgentsView', () => {
  let wrapper;

  beforeEach(async () => {
    wrapper = mount(ConfigurationAgentsView);
    await wrapper.setData({
      agents: [
        {
          type: 'agent',
          name: 'agent1',
          agent: 'agent1',
          connected: true,
          icon: 'fas fa-network-wired',
          configuration: { host: '192.168.1.1', port: 3000, status: 'Connected' },
        },
        {
          type: 'agent',
          name: 'agent2',
          agent: 'agent2',
          connected: false,
          icon: 'fas fa-plug-circle-xmark',
          configuration: { host: '192.168.1.2', port: 3001, status: 'Disconnected' },
        },
      ],
      rawAgents: [
        { name: 'agent1', host: '192.168.1.1', port: 3000, connected: true },
        { name: 'agent2', host: '192.168.1.2', port: 3001, connected: false },
      ],
    });
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it('renders a row for each agent', () => {
    const rows = wrapper.findAll('.mb-3');
    expect(rows).toHaveLength(2);
  });

  it('displays empty message when no agents', async () => {
    await wrapper.setData({ agents: [] });
    expect(wrapper.text()).toContain('No agents configured');
  });
});

describe('ConfigurationAgentsView Route Hook', () => {
  it('fetches agents on beforeRouteEnter', async () => {
    const next = vi.fn();
    await ConfigurationAgentsView.beforeRouteEnter.call(ConfigurationAgentsView, {}, {}, next);
    expect(next).toHaveBeenCalledWith(expect.any(Function));

    const vm = { agents: [], rawAgents: [] };
    const callback = next.mock.calls[0][0];
    callback(vm);

    expect(vm.agents).toHaveLength(2);
    expect(vm.agents[0].name).toBe('agent1');
    expect(vm.agents[0].icon).toBe('fas fa-network-wired');
    expect(vm.agents[1].icon).toBe('fas fa-plug-circle-xmark');
    expect(vm.rawAgents).toHaveLength(2);
  });

  it('emits error notification on failure', async () => {
    const { default: agentService } = await import('@/services/agent');
    agentService.getAgents.mockRejectedValueOnce(new Error('Network error'));

    const next = vi.fn();
    await ConfigurationAgentsView.beforeRouteEnter.call(ConfigurationAgentsView, {}, {}, next);

    const vm = { $eventBus: { emit: vi.fn() } };
    const callback = next.mock.calls[0][0];
    callback(vm);

    expect(vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      expect.stringContaining('Network error'),
      'error',
    );
  });
});
