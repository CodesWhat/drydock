import { flushPromises } from '@vue/test-utils';
import { getAgentRoster, getAgents } from '@/services/agent';
import { getAllContainers } from '@/services/container';
import { getAllWatchers, refreshWatcherInventory } from '@/services/watcher';
import type { ApiAgent, ApiComponent } from '@/types/api';
import FleetHealthView from '@/views/FleetHealthView.vue';
import { mountWithPlugins } from '../helpers/mount';

vi.mock('@/services/container', () => ({ getAllContainers: vi.fn() }));
vi.mock('@/services/agent', () => ({ getAgents: vi.fn(), getAgentRoster: vi.fn() }));
vi.mock('@/services/watcher', () => ({
  getAllWatchers: vi.fn(),
  refreshWatcherInventory: vi.fn(),
}));

const watcher = {
  id: 'docker.one',
  type: 'docker',
  name: 'one',
  configuration: {},
  metadata: { inventoryRefreshSupported: true },
} satisfies ApiComponent;

describe('FleetHealthView', () => {
  beforeEach(() => {
    vi.mocked(getAllContainers).mockResolvedValue([{ id: 'a', name: 'a' }] as never);
    vi.mocked(getAgents).mockResolvedValue([]);
    vi.mocked(getAgentRoster).mockResolvedValue([]);
    vi.mocked(getAllWatchers).mockResolvedValue([watcher]);
  });

  it('renders the fleet health roster with local container counts', async () => {
    const wrapper = mountWithPlugins(FleetHealthView);
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-health-reload"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="fleet-health-row"]').text()).toContain('1 container');
  });

  it('shows local counts as unavailable when the container list fails to load', async () => {
    vi.mocked(getAllContainers).mockRejectedValue(new Error('list unavailable'));
    const wrapper = mountWithPlugins(FleetHealthView);
    await flushPromises();
    expect(wrapper.get('[data-test="fleet-health-row"]').text()).toContain('Unavailable');
  });

  it('refreshes inventory and reloads the container list', async () => {
    vi.mocked(getAgents).mockResolvedValue([
      {
        name: 'edge',
        host: '127.0.0.1',
        connected: true,
        containers: { total: 0, running: 0, stopped: 0 },
      } satisfies ApiAgent,
    ]);
    vi.mocked(getAllWatchers).mockResolvedValue([
      { ...watcher, id: 'edge.docker.one', agent: 'edge' },
    ]);
    vi.mocked(refreshWatcherInventory).mockResolvedValueOnce({
      context: {
        origin: 'inventory',
        operationId: 'op',
        source: { type: 'docker', name: 'one', agent: 'edge' },
      },
      authoritative: true,
      containers: [],
      removedIds: [],
      errors: [],
    });
    const wrapper = mountWithPlugins(FleetHealthView);
    await flushPromises();
    const calls = vi.mocked(getAllContainers).mock.calls.length;
    await wrapper.get('[data-test="fleet-inventory-refresh"]').trigger('click');
    await flushPromises();
    expect(refreshWatcherInventory).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getAllContainers).mock.calls.length).toBe(calls + 1);
  });
});
