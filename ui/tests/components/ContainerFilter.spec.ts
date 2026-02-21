import { mount } from '@vue/test-utils';
import ContainerFilter from '@/components/ContainerFilter.vue';
import { refreshAllContainers } from '@/services/container';

const mockProps = {
  registries: ['hub', 'ghcr'],
  registrySelectedInit: '',
  agents: ['node1', 'node2'],
  agentSelectedInit: '',
  watchers: ['local', 'docker'],
  watcherSelectedInit: '',
  updateKinds: ['major', 'minor', 'patch'],
  updateKindSelectedInit: '',
  updateAvailable: false,
  oldestFirst: false,
  groupLabels: ['app', 'env', 'version'],
  groupByLabel: '',
};

// Mock the container service
vi.mock('@/services/container', () => ({
  refreshAllContainers: vi.fn(() => Promise.resolve([])),
}));

describe('ContainerFilter', () => {
  let wrapper;

  beforeEach(() => {
    wrapper = mount(ContainerFilter, {
      props: mockProps,
    });
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it('renders all filter components', () => {
    expect(wrapper.exists()).toBe(true);
  });

  it('emits registry-changed event when registry selection changes', async () => {
    wrapper.vm.registrySelected = 'hub';
    await wrapper.vm.emitRegistryChanged();

    expect(wrapper.emitted('registry-changed')).toBeTruthy();
    expect(wrapper.emitted('registry-changed')[0]).toEqual(['hub']);
  });

  it('emits watcher-changed event when watcher selection changes', async () => {
    wrapper.vm.watcherSelected = 'docker';
    await wrapper.vm.emitWatcherChanged();

    expect(wrapper.emitted('watcher-changed')).toBeTruthy();
    expect(wrapper.emitted('watcher-changed')[0]).toEqual(['docker']);
  });

  it('emits agent-changed event when agent selection changes', async () => {
    wrapper.vm.agentSelected = 'node1';
    await wrapper.vm.emitAgentChanged();

    expect(wrapper.emitted('agent-changed')).toBeTruthy();
    expect(wrapper.emitted('agent-changed')[0]).toEqual(['node1']);
  });

  it('emits update-kind-changed event when update kind selection changes', async () => {
    wrapper.vm.updateKindSelected = 'major';
    await wrapper.vm.emitUpdateKindChanged();

    expect(wrapper.emitted('update-kind-changed')).toBeTruthy();
    expect(wrapper.emitted('update-kind-changed')[0]).toEqual(['major']);
  });

  it('emits group-by-label-changed event when group by label changes', async () => {
    await wrapper.vm.emitGroupByLabelChanged('app');

    expect(wrapper.emitted('group-by-label-changed')).toBeTruthy();
    expect(wrapper.emitted('group-by-label-changed')[0]).toEqual(['app']);
  });

  it('emits update-available-changed event when update available toggle changes', async () => {
    await wrapper.vm.emitUpdateAvailableChanged();

    expect(wrapper.emitted('update-available-changed')).toBeTruthy();
  });

  it('emits oldest-first-changed event when oldest first toggle changes', async () => {
    await wrapper.vm.emitOldestFirstChanged();

    expect(wrapper.emitted('oldest-first-changed')).toBeTruthy();
  });

  it('handles refresh all containers action', async () => {
    vi.mocked(refreshAllContainers).mockResolvedValue([{ id: 'test' }]);

    await wrapper.vm.refreshAllContainers();

    expect(refreshAllContainers).toHaveBeenCalled();
    expect(wrapper.emitted('refresh-all-containers')).toBeTruthy();
  });

  it('handles refresh error gracefully', async () => {
    vi.mocked(refreshAllContainers).mockRejectedValue(new Error('Network error'));

    await wrapper.vm.refreshAllContainers();

    expect(wrapper.vm.isRefreshing).toBe(false);
  });

  it('updates local state when props change', async () => {
    await wrapper.setProps({
      registrySelectedInit: 'ghcr',
      agentSelectedInit: 'node2',
      watcherSelectedInit: 'docker',
      updateAvailable: true,
      oldestFirst: true,
      groupByLabel: 'app',
    });

    await wrapper.vm.$nextTick();

    expect(wrapper.vm.registrySelected).toBe('ghcr');
    expect(wrapper.vm.agentSelected).toBe('node2');
    expect(wrapper.vm.watcherSelected).toBe('docker');
    expect(wrapper.vm.updateAvailableLocal).toBe(true);
    expect(wrapper.vm.oldestFirstLocal).toBe(true);
    expect(wrapper.vm.groupByLabelLocal).toBe('app');
  });

  it('handles null values in emit functions', async () => {
    await wrapper.vm.emitRegistryChanged();
    expect(wrapper.emitted('registry-changed')[0]).toEqual(['']);

    wrapper.vm.watcherSelected = null;
    await wrapper.vm.emitWatcherChanged();
    expect(wrapper.emitted('watcher-changed')?.at(-1)).toEqual(['']);

    wrapper.vm.agentSelected = null;
    await wrapper.vm.emitAgentChanged();
    expect(wrapper.emitted('agent-changed')?.at(-1)).toEqual(['']);

    wrapper.vm.updateKindSelected = null;
    await wrapper.vm.emitUpdateKindChanged();
    expect(wrapper.emitted('update-kind-changed')?.at(-1)).toEqual(['']);

    await wrapper.vm.emitGroupByLabelChanged(null);
    expect(wrapper.emitted('group-by-label-changed')[0]).toEqual(['']);
  });

  it('computes groupLabelItems with Smart group prepended', () => {
    const items = wrapper.vm.groupLabelItems;
    expect(items[0]).toEqual({ title: 'Smart group', value: '__smart__' });
    expect(items.slice(1)).toEqual(['app', 'env', 'version']);
  });

  it('includes all group labels after Smart group option', () => {
    const items = wrapper.vm.groupLabelItems;
    expect(items).toHaveLength(4);
    expect(items[1]).toBe('app');
    expect(items[2]).toBe('env');
    expect(items[3]).toBe('version');
  });

  it('computes active filter count correctly', async () => {
    await wrapper.setProps({
      registrySelectedInit: 'hub',
      agentSelectedInit: 'node1',
      watcherSelectedInit: 'docker',
      updateKindSelectedInit: 'major',
      groupByLabel: 'app',
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.activeFilterCount).toBe(5);
  });

  it('computes activeFilters and clears each filter via callbacks', async () => {
    await wrapper.setProps({
      registrySelectedInit: 'hub',
      agentSelectedInit: 'node1',
      watcherSelectedInit: 'docker',
      updateKindSelectedInit: 'major',
      groupByLabel: 'app',
    });
    await wrapper.vm.$nextTick();

    const filters = wrapper.vm.activeFilters;
    expect(filters.map((f: any) => f.label)).toEqual([
      'Agent',
      'Watcher',
      'Registry',
      'Kind',
      'Group',
    ]);

    filters[0].clear();
    filters[1].clear();
    filters[2].clear();
    filters[3].clear();
    filters[4].clear();

    expect(wrapper.vm.agentSelected).toBe('');
    expect(wrapper.vm.watcherSelected).toBe('');
    expect(wrapper.vm.registrySelected).toBe('');
    expect(wrapper.vm.updateKindSelected).toBe('');
    expect(wrapper.vm.groupByLabelLocal).toBe('');

    expect(wrapper.emitted('agent-changed')?.at(-1)).toEqual(['']);
    expect(wrapper.emitted('watcher-changed')?.at(-1)).toEqual(['']);
    expect(wrapper.emitted('registry-changed')?.at(-1)).toEqual(['']);
    expect(wrapper.emitted('update-kind-changed')?.at(-1)).toEqual(['']);
    expect(wrapper.emitted('group-by-label-changed')?.at(-1)).toEqual(['']);
  });

  it('toggles advanced filters panel from the filters button', async () => {
    expect(wrapper.vm.showFilters).toBe(false);

    const buttons = wrapper.findAll('.v-btn');
    await buttons[0].trigger('click');
    expect(wrapper.vm.showFilters).toBe(true);

    await buttons[0].trigger('click');
    expect(wrapper.vm.showFilters).toBe(false);
  });

  it('updates local selections through select/autocomplete model handlers', async () => {
    const customWrapper = mount(ContainerFilter, {
      props: mockProps,
      global: {
        stubs: {
          'v-select': {
            template:
              '<div class="v-select-stub" @click="$emit(\'update:modelValue\', valueForLabel)"></div>',
            props: ['label'],
            emits: ['update:modelValue'],
            computed: {
              valueForLabel() {
                if (this.label === 'Agent') return 'node1';
                if (this.label === 'Watcher') return 'docker';
                if (this.label === 'Registry') return 'hub';
                return 'major';
              },
            },
          },
          'v-autocomplete': {
            template:
              '<div class="v-autocomplete-stub" @click="$emit(\'update:modelValue\', \'app\')"></div>',
            emits: ['update:modelValue'],
          },
        },
      },
    });

    try {
      customWrapper.vm.showFilters = true;
      await customWrapper.vm.$nextTick();

      const selects = customWrapper.findAll('.v-select-stub');
      expect(selects).toHaveLength(4);

      await selects[0].trigger('click');
      await selects[1].trigger('click');
      await selects[2].trigger('click');
      await selects[3].trigger('click');
      await customWrapper.find('.v-autocomplete-stub').trigger('click');

      expect(customWrapper.emitted('agent-changed')?.at(-1)).toEqual(['node1']);
      expect(customWrapper.emitted('watcher-changed')?.at(-1)).toEqual(['docker']);
      expect(customWrapper.emitted('registry-changed')?.at(-1)).toEqual(['hub']);
      expect(customWrapper.emitted('update-kind-changed')?.at(-1)).toEqual(['major']);
      expect(customWrapper.emitted('group-by-label-changed')?.at(-1)).toEqual(['app']);
    } finally {
      customWrapper.unmount();
    }
  });

  it('toggles updateAvailable and oldestFirst via toolbar button click handlers', async () => {
    const buttons = wrapper.findAll('.v-btn');

    expect(wrapper.vm.updateAvailableLocal).toBe(false);
    await buttons[1].trigger('click');
    expect(wrapper.vm.updateAvailableLocal).toBe(true);
    expect(wrapper.emitted('update-available-changed')).toBeTruthy();

    expect(wrapper.vm.oldestFirstLocal).toBe(false);
    await buttons[2].trigger('click');
    expect(wrapper.vm.oldestFirstLocal).toBe(true);
    expect(wrapper.emitted('oldest-first-changed')).toBeTruthy();
  });

  it('clears chip filters through click:close template handlers', async () => {
    const customWrapper = mount(ContainerFilter, {
      props: {
        ...mockProps,
        registrySelectedInit: 'hub',
        agentSelectedInit: 'node1',
        watcherSelectedInit: 'docker',
      },
      global: {
        stubs: {
          'v-chip': {
            template: '<span class="v-chip" @click="$emit(\'click:close\')"><slot /></span>',
            emits: ['click:close'],
          },
        },
      },
    });

    try {
      await customWrapper.vm.$nextTick();
      customWrapper.vm.agentSelected = 'node1';
      customWrapper.vm.watcherSelected = 'docker';
      customWrapper.vm.registrySelected = 'hub';
      await customWrapper.vm.$nextTick();

      const chips = customWrapper.findAll('.v-chip');
      expect(chips.length).toBeGreaterThan(0);
      for (const chip of chips) {
        await chip.trigger('click');
      }

      expect(customWrapper.emitted('agent-changed')).toBeTruthy();
      expect(customWrapper.emitted('watcher-changed')).toBeTruthy();
      expect(customWrapper.emitted('registry-changed')).toBeTruthy();
    } finally {
      customWrapper.unmount();
    }
  });

  it('handles non-array group labels safely', () => {
    const items = (ContainerFilter as any).computed.groupLabelItems.call({
      groupLabels: null,
    });
    expect(items).toEqual([{ title: 'Smart group', value: '__smart__' }]);
  });

  it('coalesces null registry values to an empty string in emitRegistryChanged', async () => {
    wrapper.vm.registrySelected = null;
    await wrapper.vm.emitRegistryChanged();
    expect(wrapper.emitted('registry-changed')?.at(-1)).toEqual(['']);
  });
});
