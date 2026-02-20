import { mount } from '@vue/test-utils';
import { deleteContainer, getAllContainers } from '@/services/container';
import ContainersView from '@/views/ContainersView.vue';

// Mock the container service
vi.mock('@/services/container', () => ({
  getAllContainers: vi.fn(),
  deleteContainer: vi.fn(),
}));
const { mockGetAgents } = vi.hoisted(() => ({
  mockGetAgents: vi.fn(() => Promise.resolve([])),
}));
vi.mock('@/services/agent', () => ({
  default: { getAgents: mockGetAgents },
  getAgents: mockGetAgents,
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
    labels: { app: 'web', env: 'prod' },
  },
  {
    id: '2',
    displayName: 'Container 2',
    agent: 'node2',
    watcher: 'docker',
    image: { registry: { name: 'ghcr' }, created: '2023-01-02T00:00:00Z' },
    updateAvailable: false,
    labels: { app: 'api', env: 'dev' },
  },
];

describe('ContainersView', () => {
  let wrapper;

  beforeEach(() => {
    vi.mocked(getAllContainers).mockResolvedValue(mockContainers);

    wrapper = mount(ContainersView, {
      global: {
        stubs: {
          'container-filter': true,
          'container-item': true,
        },
      },
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

  it('handles containers without labels when computing allContainerLabels', async () => {
    wrapper.vm.containers = [
      { ...mockContainers[0], labels: null },
      { ...mockContainers[1], labels: { team: 'platform' } },
    ];
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.allContainerLabels).toEqual(['team']);
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
        labels: {},
      },
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
        labels: { 'dd.group': 'my-stack' },
      },
      {
        id: 's2',
        displayName: 'Smart 2',
        agent: '',
        watcher: 'local',
        image: { registry: { name: 'hub' }, created: '2023-01-02T00:00:00Z' },
        updateAvailable: false,
        labels: { 'wud.group': 'wud-stack' },
      },
      {
        id: 's3',
        displayName: 'Smart 3',
        agent: '',
        watcher: 'local',
        image: { registry: { name: 'hub' }, created: '2023-01-03T00:00:00Z' },
        updateAvailable: false,
        labels: { 'com.docker.compose.project': 'compose-proj' },
      },
      {
        id: 's4',
        displayName: 'Smart 4',
        agent: '',
        watcher: 'local',
        image: { registry: { name: 'hub' }, created: '2023-01-04T00:00:00Z' },
        updateAvailable: false,
        labels: {},
      },
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

  it('removes container from list by id', () => {
    wrapper.vm.removeContainerFromListById('1');

    expect(wrapper.vm.containers).toHaveLength(1);
    expect(wrapper.vm.containers[0].id).toBe('2');
  });

  it('refreshes a single container in place', () => {
    const updated = {
      ...mockContainers[0],
      displayName: 'Updated Container 1',
    };
    wrapper.vm.onContainerRefreshed(updated);

    expect(wrapper.vm.containers[0].displayName).toBe('Updated Container 1');
    expect(wrapper.vm.containers).toHaveLength(2);
  });

  it('handles update kind filter change', async () => {
    await wrapper.vm.onUpdateKindChanged('minor');

    expect(wrapper.vm.updateKindSelected).toBe('minor');
  });

  it('filters containers by update kind', async () => {
    const containersWithKinds = [
      {
        id: '1',
        displayName: 'A',
        agent: '',
        watcher: 'local',
        image: { registry: { name: 'hub' }, created: '2023-01-01T00:00:00Z' },
        updateAvailable: true,
        updateKind: { kind: 'tag', semverDiff: 'minor' },
        labels: {},
      },
      {
        id: '2',
        displayName: 'B',
        agent: '',
        watcher: 'local',
        image: { registry: { name: 'hub' }, created: '2023-01-02T00:00:00Z' },
        updateAvailable: true,
        updateKind: { kind: 'tag', semverDiff: 'major' },
        labels: {},
      },
    ];
    wrapper.vm.containers = containersWithKinds;
    wrapper.vm.updateKindSelected = 'minor';
    await wrapper.vm.$nextTick();

    const filtered = wrapper.vm.containersFiltered;
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('1');
  });

  it('computes updateKinds from containers with tag kind', () => {
    const containersWithKinds = [
      {
        id: '1',
        displayName: 'A',
        agent: '',
        watcher: 'local',
        image: { registry: { name: 'hub' }, created: '2023-01-01T00:00:00Z' },
        updateAvailable: true,
        updateKind: { kind: 'tag', semverDiff: 'minor' },
        labels: {},
      },
      {
        id: '2',
        displayName: 'B',
        agent: '',
        watcher: 'local',
        image: { registry: { name: 'hub' }, created: '2023-01-02T00:00:00Z' },
        updateAvailable: true,
        updateKind: { kind: 'tag', semverDiff: 'major' },
        labels: {},
      },
      {
        id: '3',
        displayName: 'C',
        agent: '',
        watcher: 'local',
        image: { registry: { name: 'hub' }, created: '2023-01-03T00:00:00Z' },
        updateAvailable: false,
        updateKind: { kind: 'tag', semverDiff: 'patch' },
        labels: {},
      },
    ];
    wrapper.vm.containers = containersWithKinds;

    expect(wrapper.vm.updateKinds).toEqual(['major', 'minor']);
  });

  it('sorts grouped containers by label then oldest first', async () => {
    const containers = [
      {
        id: '1',
        displayName: 'Z',
        agent: '',
        watcher: 'local',
        image: { registry: { name: 'hub' }, created: '2023-01-02T00:00:00Z' },
        updateAvailable: false,
        labels: { app: 'web' },
      },
      {
        id: '2',
        displayName: 'A',
        agent: '',
        watcher: 'local',
        image: { registry: { name: 'hub' }, created: '2023-01-01T00:00:00Z' },
        updateAvailable: false,
        labels: { app: 'web' },
      },
    ];
    wrapper.vm.containers = containers;
    wrapper.vm.groupByLabel = 'app';
    wrapper.vm.oldestFirst = true;
    await wrapper.vm.$nextTick();

    const filtered = wrapper.vm.containersFiltered;
    expect(filtered[0].id).toBe('2'); // Older date first
    expect(filtered[1].id).toBe('1');
  });

  it('builds query params from all filter state', async () => {
    wrapper.vm.registrySelected = 'hub';
    wrapper.vm.agentSelected = 'node1';
    wrapper.vm.watcherSelected = 'local';
    wrapper.vm.updateKindSelected = 'minor';
    wrapper.vm.updateAvailableSelected = true;
    wrapper.vm.oldestFirst = true;
    wrapper.vm.groupByLabel = 'app';

    wrapper.vm.updateQueryParams();

    expect(wrapper.vm.$router.push).toHaveBeenCalledWith({
      query: {
        registry: 'hub',
        agent: 'node1',
        watcher: 'local',
        'update-kind': 'minor',
        'update-available': 'true',
        'oldest-first': 'true',
        'group-by-label': 'app',
      },
    });
  });

  it('handles grouped delete-container event emitted from template', async () => {
    const groupedWrapper = mount(ContainersView, {
      global: {
        stubs: {
          'container-filter': true,
          'container-item': true,
          'container-group': {
            template:
              '<div class="container-group-stub" @click="$emit(\'delete-container\', containers[0])"></div>',
            props: ['containers'],
            emits: ['delete-container'],
          },
        },
      },
    });

    try {
      groupedWrapper.vm.onRefreshAllContainers(mockContainers);
      groupedWrapper.vm.groupByLabel = 'app';
      await groupedWrapper.vm.$nextTick();

      const deleteSpy = vi.spyOn(groupedWrapper.vm, 'deleteContainer');
      await groupedWrapper.find('.container-group-stub').trigger('click');

      expect(deleteSpy).toHaveBeenCalled();
    } finally {
      groupedWrapper.unmount();
    }
  });

  it('handles ungrouped delete-container event emitted from template', async () => {
    const listWrapper = mount(ContainersView, {
      global: {
        stubs: {
          'container-filter': true,
          'container-group': true,
          'container-item': {
            template:
              '<div class="container-item-stub" @click="$emit(\'delete-container\')"></div>',
            emits: ['delete-container'],
          },
        },
      },
    });

    try {
      listWrapper.vm.onRefreshAllContainers(mockContainers);
      listWrapper.vm.groupByLabel = '';
      await listWrapper.vm.$nextTick();

      const deleteSpy = vi.spyOn(listWrapper.vm, 'deleteContainer');
      await listWrapper.find('.container-item-stub').trigger('click');

      expect(deleteSpy).toHaveBeenCalled();
    } finally {
      listWrapper.unmount();
    }
  });

  describe('beforeRouteEnter', () => {
    it('loads containers and agents on route enter', async () => {
      const agents = [{ name: 'agent1' }];
      vi.mocked(getAllContainers).mockResolvedValue(mockContainers);
      mockGetAgents.mockResolvedValue(agents);

      const guard =
        ContainersView.__component?.beforeRouteEnter ?? (ContainersView as any).beforeRouteEnter;

      let nextCallback: ((vm: any) => void) | undefined;
      const to = {
        query: {
          registry: 'hub',
          agent: 'node1',
          watcher: 'local',
          'update-kind': 'minor',
          'update-available': 'true',
          'oldest-first': 'true',
          'group-by-label': 'app',
        },
      };
      await guard.call(undefined, to as any, {} as any, (cb: any) => {
        nextCallback = cb;
      });

      const vm: any = {
        containers: [],
        agentsList: [],
        registrySelected: '',
        agentSelected: '',
        watcherSelected: '',
        updateKindSelected: '',
        updateAvailableSelected: false,
        oldestFirst: false,
        groupByLabel: '',
      };
      nextCallback?.(vm);

      expect(vm.containers).toEqual(mockContainers);
      expect(vm.agentsList).toEqual(agents);
      expect(vm.registrySelected).toBe('hub');
      expect(vm.agentSelected).toBe('node1');
      expect(vm.watcherSelected).toBe('local');
      expect(vm.updateKindSelected).toBe('minor');
      expect(vm.updateAvailableSelected).toBe(true);
      expect(vm.oldestFirst).toBe(true);
      expect(vm.groupByLabel).toBe('app');
    });

    it('emits error notification when beforeRouteEnter fails', async () => {
      vi.mocked(getAllContainers).mockRejectedValue(new Error('Network fail'));

      const guard =
        ContainersView.__component?.beforeRouteEnter ?? (ContainersView as any).beforeRouteEnter;

      let nextCallback: ((vm: any) => void) | undefined;
      await guard.call(undefined, { query: {} } as any, {} as any, (cb: any) => {
        nextCallback = cb;
      });

      const emitMock = vi.fn();
      const vm: any = { $eventBus: { emit: emitMock } };
      nextCallback?.(vm);

      expect(emitMock).toHaveBeenCalledWith(
        'notify',
        expect.stringContaining('Network fail'),
        'error',
      );
    });

    it('keeps default filter values when query params are absent', async () => {
      vi.mocked(getAllContainers).mockResolvedValue(mockContainers);
      mockGetAgents.mockResolvedValue([]);

      const guard =
        ContainersView.__component?.beforeRouteEnter ?? (ContainersView as any).beforeRouteEnter;

      let nextCallback: ((vm: any) => void) | undefined;
      await guard.call(undefined, { query: {} } as any, {} as any, (cb: any) => {
        nextCallback = cb;
      });

      const vm: any = {
        containers: [],
        agentsList: [],
        registrySelected: '',
        agentSelected: '',
        watcherSelected: '',
        updateKindSelected: '',
        updateAvailableSelected: false,
        oldestFirst: false,
        groupByLabel: '',
      };
      nextCallback?.(vm);

      expect(vm.registrySelected).toBe('');
      expect(vm.agentSelected).toBe('');
      expect(vm.watcherSelected).toBe('');
      expect(vm.updateKindSelected).toBe('');
      expect(vm.updateAvailableSelected).toBe(false);
      expect(vm.oldestFirst).toBe(false);
      expect(vm.groupByLabel).toBe('');
    });
  });

  it('sorts containers with groupByLabel where one has label and one does not', async () => {
    const containers = [
      {
        id: '1',
        displayName: 'A',
        agent: '',
        watcher: 'local',
        image: { registry: { name: 'hub' }, created: '2023-01-01T00:00:00Z' },
        updateAvailable: false,
        labels: {},
      },
      {
        id: '2',
        displayName: 'B',
        agent: '',
        watcher: 'local',
        image: { registry: { name: 'hub' }, created: '2023-01-02T00:00:00Z' },
        updateAvailable: false,
        labels: { app: 'web' },
      },
    ];
    wrapper.vm.containers = containers;
    wrapper.vm.groupByLabel = 'app';
    await wrapper.vm.$nextTick();

    const filtered = wrapper.vm.containersFiltered;
    // Container with label should come first
    expect(filtered[0].id).toBe('2');
    expect(filtered[1].id).toBe('1');
  });

  it('sorts groups with null keys last when null group is inserted first', async () => {
    wrapper.vm.containers = [
      {
        id: 'z0',
        displayName: 'No label first',
        agent: '',
        watcher: 'local',
        image: { registry: { name: 'hub' }, created: '2023-01-01T00:00:00Z' },
        updateAvailable: false,
        labels: {},
      },
      {
        id: 'z1',
        displayName: 'Named group',
        agent: '',
        watcher: 'local',
        image: { registry: { name: 'hub' }, created: '2023-01-02T00:00:00Z' },
        updateAvailable: false,
        labels: { app: 'alpha' },
      },
    ];
    wrapper.vm.groupByLabel = 'app';
    await wrapper.vm.$nextTick();

    const groups = wrapper.vm.computedGroups;
    expect(groups[0].name).toBe('alpha');
    expect(groups[1].name).toBeNull();
  });

  it('handles non-string sortable values in helper comparisons', async () => {
    wrapper.vm.containers = [
      {
        id: 'n1',
        displayName: 'A',
        agent: 7,
        watcher: true,
        image: { registry: { name: null }, created: '2023-01-01T00:00:00Z' },
        updateAvailable: false,
        labels: {},
      },
      {
        id: 'n2',
        displayName: 'B',
        agent: false,
        watcher: {},
        image: { registry: { name: 'hub' }, created: '2023-01-02T00:00:00Z' },
        updateAvailable: false,
        labels: {},
      },
    ];
    await wrapper.vm.$nextTick();

    expect(Array.isArray(wrapper.vm.watchers)).toBe(true);
    expect(Array.isArray(wrapper.vm.agents)).toBe(true);
    expect(Array.isArray(wrapper.vm.registries)).toBe(true);
  });

  it('covers null-group comparator edge paths in computedGroups sort', async () => {
    wrapper.vm.containers = [
      {
        id: 'a1',
        displayName: 'Alpha',
        agent: '',
        watcher: 'local',
        image: { registry: { name: 'hub' }, created: '2023-01-01T00:00:00Z' },
        updateAvailable: false,
        labels: { app: 'alpha' },
      },
      {
        id: 'a2',
        displayName: 'No Label',
        agent: '',
        watcher: 'local',
        image: { registry: { name: 'hub' }, created: '2023-01-02T00:00:00Z' },
        updateAvailable: false,
        labels: {},
      },
    ];
    wrapper.vm.groupByLabel = 'app';
    await wrapper.vm.$nextTick();

    const originalSort = Array.prototype.sort;
    const sortSpy = vi.spyOn(Array.prototype, 'sort').mockImplementation(function mockedSort(
      this: any[],
      compareFn?: any,
    ) {
      if (typeof compareFn === 'function') {
        compareFn([null, []], [null, []]);
        compareFn(['alpha', []], [null, []]);
      }
      return originalSort.call(this, compareFn);
    });

    try {
      const computeGroups = wrapper.vm.$options.computed?.computedGroups as
        | ((this: any) => any[])
        | undefined;
      const groups = computeGroups?.call(wrapper.vm) ?? wrapper.vm.computedGroups;
      expect(groups.at(-1)?.name).toBeNull();
    } finally {
      sortSpy.mockRestore();
    }
  });
});
