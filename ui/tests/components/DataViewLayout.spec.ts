import { mount } from '@vue/test-utils';
import DataViewLayout from '@/components/DataViewLayout.vue';

describe('DataViewLayout', () => {
  it('renders default slot content', () => {
    const wrapper = mount(DataViewLayout, {
      slots: { default: '<p>Main content</p>' },
    });
    expect(wrapper.text()).toContain('Main content');
  });

  it('renders panel slot content', () => {
    const wrapper = mount(DataViewLayout, {
      slots: {
        default: '<p>Main</p>',
        panel: '<aside>Panel content</aside>',
      },
    });
    expect(wrapper.text()).toContain('Panel content');
  });

  it('renders without panel slot', () => {
    const wrapper = mount(DataViewLayout, {
      slots: { default: '<p>Only main</p>' },
    });
    expect(wrapper.text()).toContain('Only main');
    expect(wrapper.find('aside').exists()).toBe(false);
  });

  it('has a flex-col root container', () => {
    const wrapper = mount(DataViewLayout, {
      slots: { default: '<p>Content</p>' },
    });
    const root = wrapper.find('div');
    expect(root.classes()).toContain('flex');
    expect(root.classes()).toContain('flex-col');
  });

  it('sets full viewport height minus header on root', () => {
    const wrapper = mount(DataViewLayout, {
      slots: { default: '<p>Content</p>' },
    });
    const root = wrapper.find('div');
    expect(root.attributes('style')).toContain('calc(100vh - 48px)');
  });

  it('has a flex row inside for main + panel layout', () => {
    const wrapper = mount(DataViewLayout, {
      slots: { default: '<p>Content</p>' },
    });
    const row = wrapper.find('.flex.gap-4');
    expect(row.exists()).toBe(true);
  });

  it('has a scroll container on the main content area', () => {
    const wrapper = mount(DataViewLayout, {
      slots: { default: '<p>Scrollable</p>' },
    });
    const scrollArea = wrapper.find('.overflow-y-auto');
    expect(scrollArea.exists()).toBe(true);
    expect(scrollArea.text()).toContain('Scrollable');
  });

  it('renders multiple default slot children', () => {
    const wrapper = mount(DataViewLayout, {
      slots: { default: '<p>First</p><p>Second</p>' },
    });
    expect(wrapper.text()).toContain('First');
    expect(wrapper.text()).toContain('Second');
  });
});
