import { mount } from '@vue/test-utils';
import ConfigurationItem from '@/components/ConfigurationItem.vue';

describe('ConfigurationItem', () => {
  const baseItem = {
    name: 'my-registry',
    type: 'hub',
    agent: 'node1',
    icon: 'fab fa-docker',
    configuration: {
      url: 'https://registry.hub.docker.com',
      login: 'admin',
      password: '',
    },
  };

  const agents = [
    { name: 'node1', connected: true },
    { name: 'node2', connected: false },
  ];

  let wrapper;

  beforeEach(() => {
    wrapper = mount(ConfigurationItem, {
      props: { item: baseItem, agents },
    });
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it('renders with item name and type', () => {
    expect(wrapper.text()).toContain('hub');
    expect(wrapper.text()).toContain('my-registry');
  });

  describe('displayName', () => {
    it('returns "name (type)" when name and type differ', () => {
      expect(wrapper.vm.displayName).toBe('my-registry (hub)');
    });

    it('returns name only when name equals type', async () => {
      await wrapper.setProps({ item: { ...baseItem, name: 'hub', type: 'hub' } });
      expect(wrapper.vm.displayName).toBe('hub');
    });

    it('returns name when type is falsy', async () => {
      await wrapper.setProps({ item: { ...baseItem, type: '' } });
      expect(wrapper.vm.displayName).toBe('my-registry');
    });

    it('returns "Unknown" when name is falsy', async () => {
      await wrapper.setProps({ item: { name: '', type: '' } });
      expect(wrapper.vm.displayName).toBe('Unknown');
    });
  });

  describe('agentStatusColor', () => {
    it('returns "success" when agent is connected', () => {
      expect(wrapper.vm.agentStatusColor).toBe('success');
    });

    it('returns "error" when agent is disconnected', async () => {
      await wrapper.setProps({
        item: { ...baseItem, agent: 'node2' },
        agents,
      });
      expect(wrapper.vm.agentStatusColor).toBe('error');
    });

    it('returns "info" when agent is not found', async () => {
      await wrapper.setProps({
        item: { ...baseItem, agent: 'unknown-agent' },
        agents,
      });
      expect(wrapper.vm.agentStatusColor).toBe('info');
    });
  });

  describe('configurationItems', () => {
    it('returns sorted key-value pairs from configuration', () => {
      const items = wrapper.vm.configurationItems;
      expect(items).toHaveLength(3);
      expect(items[0].key).toBe('login');
      expect(items[1].key).toBe('password');
      expect(items[2].key).toBe('url');
    });

    it('returns empty array when configuration is missing', async () => {
      await wrapper.setProps({ item: { name: 'test', type: 'test' } });
      expect(wrapper.vm.configurationItems).toEqual([]);
    });
  });

  describe('collapse', () => {
    it('toggles showDetail', () => {
      expect(wrapper.vm.showDetail).toBe(false);
      wrapper.vm.collapse();
      expect(wrapper.vm.showDetail).toBe(true);
      wrapper.vm.collapse();
      expect(wrapper.vm.showDetail).toBe(false);
    });

    it('toggles showDetail from card title click handler', async () => {
      const title = wrapper.find('.v-card-title');
      await title.trigger('click');
      expect(wrapper.vm.showDetail).toBe(true);
    });
  });

  describe('formatValue', () => {
    it('returns "<empty>" for undefined', () => {
      expect(wrapper.vm.formatValue(undefined)).toBe('<empty>');
    });

    it('returns "<empty>" for null', () => {
      expect(wrapper.vm.formatValue(null)).toBe('<empty>');
    });

    it('returns "<empty>" for empty string', () => {
      expect(wrapper.vm.formatValue('')).toBe('<empty>');
    });

    it('returns the value for non-empty values', () => {
      expect(wrapper.vm.formatValue('hello')).toBe('hello');
      expect(wrapper.vm.formatValue(42)).toBe(42);
      expect(wrapper.vm.formatValue(false)).toBe(false);
    });
  });

  it('shows "Default configuration" when no configuration and no agent', async () => {
    await wrapper.setProps({
      item: { name: 'test', type: 'test' },
      agents: [],
    });
    wrapper.vm.showDetail = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Default configuration');
  });

  it('defaults agents prop to empty array', () => {
    const w = mount(ConfigurationItem, {
      props: { item: baseItem },
    });
    expect(w.vm.agents).toEqual([]);
    w.unmount();
  });
});
