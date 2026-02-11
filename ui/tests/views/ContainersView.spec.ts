import { mount } from '@vue/test-utils';
import ContainersView from '@/views/ContainersView.vue';
import { deleteContainer, getAllContainers } from '@/services/container';

// Mock the container service
vi.mock('@/services/container', () => ({
  getAllContainers: vi.fn(),
  deleteContainer: vi.fn()
}));
vi.mock('@/services/agent', () => ({
  getAgents: vi.fn(() => Promise.resolve([])),
}));

const mockContainers = [
  {
    id: '1',
    displayName: 'Container 1',
    agent: 'node1',
    watcher: 'local',
    image: { registry: { name: 'hub' }, created: '2023-01-01T00:00:00Z' },
    updateAvailable: true,
    updateKind: { semverDiff: 'minor' },
    labels: { app: 'web', env: 'prod' }
  },
  {
    id: '2',
    displayName: 'Container 2',
    agent: 'node2',
    watcher: 'docker',
    image: { registry: { name: 'ghcr' }, created: '2023-01-02T00:00:00Z' },
    updateAvailable: false,
    labels: { app: 'api', env: 'dev' }
  }
];

describe('ContainersView', () => {
  let wrapper;

  beforeEach(() => {
    vi.mocked(getAllContainers).mockResolvedValue(mockContainers);

    wrapper = mount(ContainersView, {
      global: {
        stubs: {
          'container-filter': true,
          'container-item': true
        }
      }
    });
    wrapper.vm.onRefreshAllContainers(mockContainers);
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  it('renders container filter and container items', () => {
    expect(wrapper.vm.containers).toHaveLength(2);
    expect(wrapper.vm.containersFiltered).toHaveLength(2);
  });

  it('computes registries correctly', () => {
    expect(wrapper.vm.registries).toEqual(['ghcr', 'hub']);
  });

  it('computes watchers correctly', () => {
    expect(wrapper.vm.watchers).toEqual(['docker', 'local']);
  });

  it('computes agents correctly', () => {
    expect(wrapper.vm.agents).toEqual(['node1', 'node2']);
  });

  it('computes update kinds correctly', () => {
    expect(Array.isArray(wrapper.vm.updateKinds)).toBe(true);
  });

  it('computes all container labels correctly', () => {
    const labels = wrapper.vm.allContainerLabels;
    expect(labels).toContain('app');
    expect(labels).toContain('env');
  });

  it('filters containers by registry', async () => {
    wrapper.vm.registrySelected = 'hub';
    await wrapper.vm.$nextTick();

    const filtered = wrapper.vm.containersFiltered;
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('1');
  });

  it('filters containers by watcher', async () => {
    wrapper.vm.watcherSelected = 'docker';
    await wrapper.vm.$nextTick();

    const filtered = wrapper.vm.containersFiltered;
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('2');
  });

  it('filters containers by agent', async () => {
    wrapper.vm.agentSelected = 'node1';
    await wrapper.vm.$nextTick();

    const filtered = wrapper.vm.containersFiltered;
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('1');
  });

  it('filters containers by update available', async () => {
    wrapper.vm.updateAvailableSelected = true;
    await wrapper.vm.$nextTick();

    const filtered = wrapper.vm.containersFiltered;
    expect(filtered).toHaveLength(1);
    expect(filtered[0].updateAvailable).toBe(true);
  });

  it('sorts containers by oldest first when enabled', async () => {
    wrapper.vm.oldestFirst = true;
    await wrapper.vm.$nextTick();

    const filtered = wrapper.vm.containersFiltered;
    expect(filtered[0].id).toBe('1'); // Created 2023-01-01
    expect(filtered[1].id).toBe('2'); // Created 2023-01-02
  });

  it('groups containers by label', async () => {
    wrapper.vm.groupByLabel = 'app';
    await wrapper.vm.$nextTick();

    const filtered = wrapper.vm.containersFiltered;
    // Should be sorted by label value
    expect(filtered[0].labels.app).toBe('api');
    expect(filtered[1].labels.app).toBe('web');
  });

  it('handles registry filter change', async () => {
    await wrapper.vm.onRegistryChanged('hub');

    expect(wrapper.vm.registrySelected).toBe('hub');
  });

  it('handles watcher filter change', async () => {
    await wrapper.vm.onWatcherChanged('docker');

    expect(wrapper.vm.watcherSelected).toBe('docker');
  });

  it('handles agent filter change', async () => {
    await wrapper.vm.onAgentChanged('node1');

    expect(wrapper.vm.agentSelected).toBe('node1');
  });

  it('handles update available toggle', async () => {
    const initialValue = wrapper.vm.updateAvailableSelected;
    await wrapper.vm.onUpdateAvailableChanged();

    expect(wrapper.vm.updateAvailableSelected).toBe(!initialValue);
  });

  it('handles oldest first toggle', async () => {
    const initialValue = wrapper.vm.oldestFirst;
    await wrapper.vm.onOldestFirstChanged();

    expect(wrapper.vm.oldestFirst).toBe(!initialValue);
  });

  it('handles group by label change', async () => {
    await wrapper.vm.onGroupByLabelChanged('env');

    expect(wrapper.vm.groupByLabel).toBe('env');
  });

  it('removes container from list when deleted', async () => {
    const containerToDelete = mockContainers[0];
    
    wrapper.vm.removeContainerFromList(containerToDelete);

    expect(wrapper.vm.containers).toHaveLength(1);
    expect(wrapper.vm.containers[0].id).toBe('2');
  });

  it('deletes container successfully', async () => {
    vi.mocked(deleteContainer).mockResolvedValue();

    const containerToDelete = mockContainers[0];
    await wrapper.vm.deleteContainer(containerToDelete);

    expect(deleteContainer).toHaveBeenCalledWith('1');
    expect(wrapper.vm.containers).toHaveLength(1);
  });

  it('handles delete container error', async () => {
    vi.mocked(deleteContainer).mockRejectedValue(new Error('Delete failed'));

    const containerToDelete = mockContainers[0];
    await wrapper.vm.deleteContainer(containerToDelete);

    // Container should still be in the list
    expect(wrapper.vm.containers).toHaveLength(2);
  });

  it('shows no containers message when list is empty', async () => {
    wrapper.vm.containers = [];
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.containersFiltered).toHaveLength(0);
  });

  it('computes isGrouped as true when groupByLabel is set', async () => {
    wrapper.vm.groupByLabel = 'app';
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.isGrouped).toBe(true);
  });

  it('computes isGrouped as false when groupByLabel is empty', () => {
    expect(wrapper.vm.isGrouped).toBe(false);
  });

  it('computes groups by label value', async () => {
    wrapper.vm.groupByLabel = 'app';
    await wrapper.vm.$nextTick();

    const groups = wrapper.vm.computedGroups;
    expect(groups).toHaveLength(2);
    expect(groups[0].name).toBe('api');
    expect(groups[0].containers).toHaveLength(1);
    expect(groups[1].name).toBe('web');
    expect(groups[1].containers).toHaveLength(1);
  });

  it('puts ungrouped containers last in computedGroups', async () => {
    const containersWithMissing = [
      ...mockContainers,
      {
        id: '3',
        displayName: 'Container 3',
        agent: '',
        watcher: 'local',
        image: { registry: { name: 'hub' }, created: '2023-01-03T00:00:00Z' },
        updateAvailable: false,
        labels: {}
      }
    ];
    wrapper.vm.containers = containersWithMissing;
    wrapper.vm.groupByLabel = 'app';
    await wrapper.vm.$nextTick();

    const groups = wrapper.vm.computedGroups;
    const lastGroup = groups[groups.length - 1];
    expect(lastGroup.name).toBeNull();
    expect(lastGroup.containers).toHaveLength(1);
  });

  it('computes smart groups using label priority', async () => {
    const smartContainers = [
      {
        id: 's1',
        displayName: 'Smart 1',
        agent: '',
        watcher: 'local',
        image: { registry: { name: 'hub' }, created: '2023-01-01T00:00:00Z' },
        updateAvailable: false,
        labels: { 'dd.group': 'my-stack' }
      },
      {
        id: 's2',
        displayName: 'Smart 2',
        agent: '',
        watcher: 'local',
        image: { registry: { name: 'hub' }, created: '2023-01-02T00:00:00Z' },
        updateAvailable: false,
        labels: { 'wud.group': 'wud-stack' }
      },
      {
        id: 's3',
        displayName: 'Smart 3',
        agent: '',
        watcher: 'local',
        image: { registry: { name: 'hub' }, created: '2023-01-03T00:00:00Z' },
        updateAvailable: false,
        labels: { 'com.docker.compose.project': 'compose-proj' }
      },
      {
        id: 's4',
        displayName: 'Smart 4',
        agent: '',
        watcher: 'local',
        image: { registry: { name: 'hub' }, created: '2023-01-04T00:00:00Z' },
        updateAvailable: false,
        labels: {}
      }
    ];
    wrapper.vm.containers = smartContainers;
    wrapper.vm.groupByLabel = '__smart__';
    await wrapper.vm.$nextTick();

    const groups = wrapper.vm.computedGroups;
    expect(groups).toHaveLength(4);
    // Named groups alphabetically, ungrouped last
    expect(groups[0].name).toBe('compose-proj');
    expect(groups[1].name).toBe('my-stack');
    expect(groups[2].name).toBe('wud-stack');
    expect(groups[3].name).toBeNull();
  });
});
