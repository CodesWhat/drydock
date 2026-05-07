import { mount } from '@vue/test-utils';
import AppStatusIndicator from '@/components/AppStatusIndicator.vue';

describe('AppStatusIndicator', () => {
  it('renders a semantic dot and label from token classes', () => {
    const wrapper = mount(AppStatusIndicator, {
      props: {
        tone: 'success',
        label: 'running',
      },
    });

    const indicator = wrapper.get('[data-test="status-indicator"]');
    const marker = wrapper.get('[data-test="status-indicator-marker"]');

    expect(indicator.classes()).toContain('dd-text-success');
    expect(marker.classes()).toContain('dd-bg-success');
    expect(wrapper.text()).toBe('running');
    expect(indicator.attributes('style')).toBeUndefined();
    expect(marker.attributes('style')).toBeUndefined();
  });

  it('can render icon and text without a pill background', () => {
    const wrapper = mount(AppStatusIndicator, {
      props: {
        marker: 'icon',
        icon: 'warning',
        tone: 'danger',
        label: 'critical',
      },
    });

    const indicator = wrapper.get('[data-test="status-indicator"]');

    expect(indicator.classes()).toContain('dd-text-danger');
    expect(wrapper.find('[data-test="status-indicator-marker"]').exists()).toBe(false);
    expect(wrapper.findComponent({ name: 'AppIcon' }).props('name')).toBe('warning');
    expect(wrapper.text()).toBe('critical');
  });

  it('can render a toned count with no marker', () => {
    const wrapper = mount(AppStatusIndicator, {
      props: {
        marker: 'none',
        tone: 'warning',
        label: 4,
      },
    });

    expect(wrapper.get('[data-test="status-indicator"]').classes()).toContain('dd-text-warning');
    expect(wrapper.find('[data-test="status-indicator-marker"]').exists()).toBe(false);
    expect(wrapper.findComponent({ name: 'AppIcon' }).exists()).toBe(false);
    expect(wrapper.text()).toBe('4');
  });
});
