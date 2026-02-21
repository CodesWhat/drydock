import { mount } from '@vue/test-utils';
import EmptyState from '@/components/EmptyState.vue';

describe('EmptyState', () => {
  const stubs = { AppIcon: { template: '<span />', props: ['name', 'size'] } };

  it('renders the message text', () => {
    const wrapper = mount(EmptyState, {
      props: { message: 'No results found' },
      global: { stubs },
    });
    expect(wrapper.text()).toContain('No results found');
  });

  it('renders AppIcon with the default icon name', () => {
    const wrapper = mount(EmptyState, {
      props: { message: 'Empty' },
      global: { stubs },
    });
    const icon = wrapper.findComponent(stubs.AppIcon);
    expect(icon.props('name')).toBe('filter');
  });

  it('renders AppIcon with a custom icon name', () => {
    const wrapper = mount(EmptyState, {
      props: { message: 'Empty', icon: 'search' },
      global: { stubs },
    });
    const icon = wrapper.findComponent(stubs.AppIcon);
    expect(icon.props('name')).toBe('search');
  });

  it('passes size 24 to AppIcon', () => {
    const wrapper = mount(EmptyState, {
      props: { message: 'Empty' },
      global: { stubs },
    });
    const icon = wrapper.findComponent(stubs.AppIcon);
    expect(icon.props('size')).toBe(24);
  });

  it('hides the clear button when showClear is false', () => {
    const wrapper = mount(EmptyState, {
      props: { message: 'Empty', showClear: false },
      global: { stubs },
    });
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('hides the clear button by default', () => {
    const wrapper = mount(EmptyState, {
      props: { message: 'Empty' },
      global: { stubs },
    });
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('shows the clear button when showClear is true', () => {
    const wrapper = mount(EmptyState, {
      props: { message: 'Empty', showClear: true },
      global: { stubs },
    });
    const btn = wrapper.find('button');
    expect(btn.exists()).toBe(true);
    expect(btn.text()).toBe('Clear all filters');
  });

  it('emits clear when the clear button is clicked', async () => {
    const wrapper = mount(EmptyState, {
      props: { message: 'Empty', showClear: true },
      global: { stubs },
    });
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('clear')).toHaveLength(1);
  });

  it('has the expected background and border styling', () => {
    const wrapper = mount(EmptyState, {
      props: { message: 'Styled' },
      global: { stubs },
    });
    const root = wrapper.find('div');
    expect(root.attributes('style')).toContain('background-color');
    expect(root.attributes('style')).toContain('border');
  });
});
