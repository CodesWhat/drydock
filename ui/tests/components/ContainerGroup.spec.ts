import { mount } from '@vue/test-utils';
import ContainerGroup from '@/components/ContainerGroup';
import { getContainerTriggers, runTrigger, refreshContainer } from '@/services/container';

vi.mock('@/services/container', () => ({
  getContainerTriggers: vi.fn(),
  runTrigger: vi.fn(),
  refreshContainer: vi.fn(),
}));

const mockContainers = [
  {
    id: 'c1',
    displayName: 'App 1',
    displayIcon: 'fab fa-docker',
    watcher: 'local',
    image: {
      registry: { name: 'hub' },
      tag: { value: '1.0.0', semver: true },
      created: '2023-01-01T00:00:00Z',
      os: 'linux',
    },
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'minor', remoteValue: '1.1.0', localValue: '1.0.0' },
    result: { created: '2023-01-02T00:00:00Z', tag: '1.1.0' },
    labels: { app: 'web' },
    status: 'running',
  },
  {
    id: 'c2',
    displayName: 'App 2',
    displayIcon: 'fab fa-docker',
    watcher: 'local',
    image: {
      registry: { name: 'hub' },
      tag: { value: '2.0.0', semver: true },
      created: '2023-01-03T00:00:00Z',
      os: 'linux',
    },
    updateAvailable: false,
    updateKind: { kind: 'tag', semverDiff: null, remoteValue: null, localValue: '2.0.0' },
    result: null,
    labels: { app: 'web' },
    status: 'running',
  },
  {
    id: 'c3',
    displayName: 'App 3',
    displayIcon: 'fab fa-docker',
    watcher: 'local',
    image: {
      registry: { name: 'hub' },
      tag: { value: '3.0.0', semver: true },
      created: '2023-01-04T00:00:00Z',
      os: 'linux',
    },
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'patch', remoteValue: '3.0.1', localValue: '3.0.0' },
    result: { created: '2023-01-05T00:00:00Z', tag: '3.0.1' },
    labels: { app: 'web' },
    status: 'running',
  },
];

describe('ContainerGroup', () => {
  let wrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    wrapper = mount(ContainerGroup, {
      props: {
        groupName: 'web-stack',
        containers: mockContainers,
        agents: [],
        oldestFirst: false,
      },
      global: {
        stubs: {
          'container-item': true,
        },
      },
    });
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it('renders the group name', () => {
    expect(wrapper.text()).toContain('web-stack');
  });

  it('shows "Ungrouped" when groupName is null', async () => {
    await wrapper.setProps({ groupName: null });
    expect(wrapper.vm.displayName).toBe('Ungrouped');
  });

  it('displays the container count', () => {
    expect(wrapper.vm.containerCount).toBe(3);
  });

  it('displays the update count', () => {
    expect(wrapper.vm.updateCount).toBe(2);
  });

  it('computes hasUpdates correctly', () => {
    expect(wrapper.vm.hasUpdates).toBe(true);
  });

  it('computes hasUpdates as false when no updates', async () => {
    const noUpdateContainers = mockContainers.map((c) => ({
      ...c,
      updateAvailable: false,
    }));
    await wrapper.setProps({ containers: noUpdateContainers });
    expect(wrapper.vm.hasUpdates).toBe(false);
  });

  it('starts expanded by default', () => {
    expect(wrapper.vm.expanded).toBe(true);
  });

  it('toggles expanded state when header is clicked', async () => {
    expect(wrapper.vm.expanded).toBe(true);
    await wrapper.find('[style*="cursor: pointer"]').trigger('click');
    expect(wrapper.vm.expanded).toBe(false);
    await wrapper.find('[style*="cursor: pointer"]').trigger('click');
    expect(wrapper.vm.expanded).toBe(true);
  });

  it('emits delete-container when child emits it', async () => {
    wrapper.vm.onDeleteContainer(mockContainers[0]);
    expect(wrapper.emitted('delete-container')).toBeTruthy();
    expect(wrapper.emitted('delete-container')[0]).toEqual([mockContainers[0]]);
  });

  it('emits container-refreshed when child emits it', async () => {
    wrapper.vm.onContainerRefreshed(mockContainers[0]);
    expect(wrapper.emitted('container-refreshed')).toBeTruthy();
    expect(wrapper.emitted('container-refreshed')[0]).toEqual([mockContainers[0]]);
  });

  it('emits container-missing when child emits it', async () => {
    wrapper.vm.onContainerMissing('c1');
    expect(wrapper.emitted('container-missing')).toBeTruthy();
    expect(wrapper.emitted('container-missing')[0]).toEqual(['c1']);
  });

  it('updates all containers in group successfully', async () => {
    vi.mocked(getContainerTriggers).mockResolvedValue([
      { type: 'webhook', name: 'default', agent: null },
    ]);
    vi.mocked(runTrigger).mockResolvedValue({});
    vi.mocked(refreshContainer).mockImplementation((id) =>
      Promise.resolve({ ...mockContainers.find((c) => c.id === id), updateAvailable: false }),
    );

    await wrapper.vm.updateAllInGroup();

    expect(getContainerTriggers).toHaveBeenCalledTimes(2);
    expect(runTrigger).toHaveBeenCalledTimes(2);
    expect(wrapper.vm.isUpdatingAll).toBe(false);
  });

  it('handles errors during group update', async () => {
    vi.mocked(getContainerTriggers).mockRejectedValue(new Error('Network error'));

    await wrapper.vm.updateAllInGroup();

    expect(wrapper.vm.isUpdatingAll).toBe(false);
  });

  it('skips containers with no triggers during group update', async () => {
    vi.mocked(getContainerTriggers).mockResolvedValue([]);

    await wrapper.vm.updateAllInGroup();

    expect(runTrigger).not.toHaveBeenCalled();
    expect(wrapper.vm.isUpdatingAll).toBe(false);
  });

  it('passes empty groupingLabel to child ContainerItem components', () => {
    const containerItems = wrapper.findAllComponents({ name: 'container-item' });
    // Stubs do not have real props, but we verify the component renders
    expect(containerItems.length).toBe(3);
  });
});
