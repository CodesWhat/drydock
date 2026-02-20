import { mount } from '@vue/test-utils';
import TriggerDetail from '@/components/TriggerDetail.vue';

const mockGetAllContainers = vi.fn();
const mockRunTrigger = vi.fn();
vi.mock('@/services/container', () => ({
  getAllContainers: (...args: any[]) => mockGetAllContainers(...args),
}));
vi.mock('@/services/trigger', () => ({
  runTrigger: (...args: any[]) => mockRunTrigger(...args),
}));

const mockTrigger = {
  type: 'smtp',
  name: 'email-alert',
  icon: 'fas fa-envelope',
  configuration: {
    threshold: 'all',
    host: 'smtp.example.com',
    port: '587',
  },
};

const mockContainers = [
  { id: 'c1', name: 'app-1', displayName: 'App 1', watcher: 'local', agent: false },
  { id: 'c2', name: 'app-2', displayName: 'App 2', watcher: 'local', agent: false },
  { id: 'c3', name: 'remote-app', displayName: 'Remote', watcher: 'remote', agent: true },
];

describe('TriggerDetail', () => {
  let wrapper: any;

  beforeEach(() => {
    mockGetAllContainers.mockReset();
    mockRunTrigger.mockReset();
    wrapper = mount(TriggerDetail, {
      props: { trigger: mockTrigger },
      global: {
        stubs: {
          'v-navigation-drawer': {
            template: '<div class="v-navigation-drawer"><slot /></div>',
            props: ['modelValue'],
            emits: ['update:modelValue'],
          },
          'v-select': {
            template:
              '<div class="v-select">' +
              '<slot name="item" :props="{}" :item="{ raw: items?.[0] || {} }" />' +
              '<slot name="selection" :item="{ raw: items?.[0] || {} }" />' +
              '<button class="v-select-update" @click="$emit(\'update:modelValue\', items?.[0]?.id || \'\')">select</button>' +
              '<slot />' +
              '</div>',
            props: ['items', 'modelValue'],
            emits: ['update:modelValue'],
          },
        },
      },
    });
    wrapper.vm.$eventBus.emit.mockClear();
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it('renders trigger type and name chips', () => {
    expect(wrapper.text()).toContain('smtp');
    expect(wrapper.text()).toContain('email-alert');
  });

  it('starts with detail collapsed', () => {
    expect(wrapper.vm.showDetail).toBe(false);
  });

  it('toggles detail on collapse()', async () => {
    wrapper.vm.collapse();
    expect(wrapper.vm.showDetail).toBe(true);
    wrapper.vm.collapse();
    expect(wrapper.vm.showDetail).toBe(false);
  });

  it('toggles detail on title click', async () => {
    await wrapper.find('[style*="cursor: pointer"]').trigger('click');
    expect(wrapper.vm.showDetail).toBe(true);
  });

  it('computes configurationItems sorted by key', () => {
    const items = wrapper.vm.configurationItems;
    expect(items.length).toBe(3);
    expect(items[0].key).toBe('host');
    expect(items[1].key).toBe('port');
    expect(items[2].key).toBe('threshold');
  });

  it('returns empty configurationItems when configuration is empty', async () => {
    await wrapper.setProps({
      trigger: { ...mockTrigger, configuration: {} },
    });
    expect(wrapper.vm.configurationItems).toEqual([]);
  });

  it('returns empty configurationItems when configuration is missing', async () => {
    await wrapper.setProps({
      trigger: { ...mockTrigger, configuration: undefined },
    });
    expect(wrapper.vm.configurationItems).toEqual([]);
  });

  it('formatValue returns value for non-empty values', () => {
    expect(wrapper.vm.formatValue('hello')).toBe('hello');
    expect(wrapper.vm.formatValue(42)).toBe(42);
    expect(wrapper.vm.formatValue(false)).toBe(false);
  });

  it('formatValue returns <empty> for undefined/null/empty string', () => {
    expect(wrapper.vm.formatValue(undefined)).toBe('<empty>');
    expect(wrapper.vm.formatValue(null)).toBe('<empty>');
    expect(wrapper.vm.formatValue('')).toBe('<empty>');
  });

  describe('openTestForm', () => {
    it('sets showTestForm to true', async () => {
      mockGetAllContainers.mockResolvedValue(mockContainers);
      await wrapper.vm.openTestForm();
      expect(wrapper.vm.showTestForm).toBe(true);
    });

    it('fetches and filters containers (excludes agents)', async () => {
      mockGetAllContainers.mockResolvedValue(mockContainers);
      await wrapper.vm.openTestForm();
      expect(wrapper.vm.testContainers.length).toBe(2);
      expect(wrapper.vm.testContainers.every((c: any) => !c.agent)).toBe(true);
    });

    it('auto-selects when only one container', async () => {
      mockGetAllContainers.mockResolvedValue([mockContainers[0]]);
      await wrapper.vm.openTestForm();
      expect(wrapper.vm.selectedContainerId).toBe('c1');
    });

    it('does not re-fetch when containers already loaded', async () => {
      mockGetAllContainers.mockResolvedValue(mockContainers);
      await wrapper.vm.openTestForm();
      await wrapper.vm.openTestForm();
      expect(mockGetAllContainers).toHaveBeenCalledTimes(1);
    });

    it('handles fetch error gracefully', async () => {
      mockGetAllContainers.mockRejectedValue(new Error('network fail'));
      await wrapper.vm.openTestForm();
      expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
        'notify',
        'Failed to load containers for trigger test (network fail)',
        'error',
      );
    });

    it('handles non-array response', async () => {
      mockGetAllContainers.mockResolvedValue(null);
      await wrapper.vm.openTestForm();
      expect(wrapper.vm.testContainers).toEqual([]);
    });

    it('renders custom v-select item and selection slots', async () => {
      mockGetAllContainers.mockResolvedValue(mockContainers);
      await wrapper.vm.openTestForm();
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('App 1');
      expect(wrapper.text()).toContain('app-1 • local');
    });

    it('falls back to container name when displayName is empty in item/selection slots', async () => {
      mockGetAllContainers.mockResolvedValue([
        { id: 'x1', name: 'fallback-name', displayName: '', watcher: 'local', agent: false },
      ]);
      await wrapper.vm.openTestForm();
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('fallback-name');
    });
  });

  describe('runTrigger', () => {
    beforeEach(async () => {
      mockGetAllContainers.mockResolvedValue(mockContainers);
      await wrapper.vm.openTestForm();
    });

    it('errors when no container selected', async () => {
      wrapper.vm.selectedContainerId = '';
      await wrapper.vm.runTrigger();
      expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
        'notify',
        expect.stringContaining('Select a container'),
        'error',
      );
    });

    it('errors when selected container not found', async () => {
      wrapper.vm.selectedContainerId = 'nonexistent';
      await wrapper.vm.runTrigger();
      expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
        'notify',
        expect.stringContaining('no longer available'),
        'error',
      );
    });

    it('calls runTrigger service with correct args', async () => {
      wrapper.vm.selectedContainerId = 'c1';
      mockRunTrigger.mockResolvedValue(undefined);
      await wrapper.vm.runTrigger();
      expect(mockRunTrigger).toHaveBeenCalledWith({
        triggerType: 'smtp',
        triggerName: 'email-alert',
        container: mockContainers[0],
      });
    });

    it('emits success notify', async () => {
      wrapper.vm.selectedContainerId = 'c1';
      mockRunTrigger.mockResolvedValue(undefined);
      await wrapper.vm.runTrigger();
      expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
        'notify',
        'Trigger executed with success',
      );
    });

    it('emits error notify on failure', async () => {
      wrapper.vm.selectedContainerId = 'c1';
      mockRunTrigger.mockRejectedValue(new Error('send failed'));
      await wrapper.vm.runTrigger();
      expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
        'notify',
        'Trigger executed with error (send failed)',
        'error',
      );
    });

    it('sets isTriggering during execution', async () => {
      wrapper.vm.selectedContainerId = 'c1';
      let resolvePromise: (() => void) | undefined;
      mockRunTrigger.mockReturnValue(
        new Promise<void>((r) => {
          resolvePromise = r;
        }),
      );
      const promise = wrapper.vm.runTrigger();
      expect(wrapper.vm.isTriggering).toBe(true);
      resolvePromise?.();
      await promise;
      expect(wrapper.vm.isTriggering).toBe(false);
    });

    it('updates selectedContainerId through select model event handler', async () => {
      await wrapper.find('.v-select-update').trigger('click');
      expect(wrapper.vm.selectedContainerId).toBe('c1');
    });
  });

  it('updates showTestForm through navigation drawer model event handler', async () => {
    wrapper.vm.showTestForm = true;
    await wrapper.vm.$nextTick();

    const drawer = wrapper.findComponent('.v-navigation-drawer');
    drawer.vm.$emit('update:modelValue', false);
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.showTestForm).toBe(false);
  });
});
