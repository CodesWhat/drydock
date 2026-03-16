import { mount } from '@vue/test-utils';
import UpdateMaturityBadge from '@/components/containers/UpdateMaturityBadge.vue';

describe('UpdateMaturityBadge', () => {
  const globalConfig = {
    stubs: { AppIcon: { template: '<span />', props: ['name', 'size'] } },
    directives: { tooltip: () => {} },
  };

  it('does not render when maturity is null', () => {
    const wrapper = mount(UpdateMaturityBadge, {
      props: { maturity: null },
      global: globalConfig,
    });
    expect(wrapper.find('[data-test="update-maturity-badge"]').exists()).toBe(false);
  });

  it('renders badge with "NEW" text for fresh', () => {
    const wrapper = mount(UpdateMaturityBadge, {
      props: { maturity: 'fresh' },
      global: globalConfig,
    });
    const badge = wrapper.find('[data-test="update-maturity-badge"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toContain('NEW');
  });

  it('renders badge with "MATURE" text for settled', () => {
    const wrapper = mount(UpdateMaturityBadge, {
      props: { maturity: 'settled' },
      global: globalConfig,
    });
    const badge = wrapper.find('[data-test="update-maturity-badge"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toContain('MATURE');
  });

  it('applies correct maturityColor style for fresh', () => {
    const wrapper = mount(UpdateMaturityBadge, {
      props: { maturity: 'fresh' },
      global: globalConfig,
    });
    const badge = wrapper.find('[data-test="update-maturity-badge"]');
    const style = badge.attributes('style');
    expect(style).toContain('color-mix(in srgb, var(--dd-warning) 35%, var(--dd-bg-card))');
    expect(style).toContain('color: var(--dd-text)');
  });

  it('applies correct maturityColor style for settled', () => {
    const wrapper = mount(UpdateMaturityBadge, {
      props: { maturity: 'settled' },
      global: globalConfig,
    });
    const badge = wrapper.find('[data-test="update-maturity-badge"]');
    const style = badge.attributes('style');
    expect(style).toContain('color-mix(in srgb, var(--dd-info) 35%, var(--dd-bg-card))');
    expect(style).toContain('color: var(--dd-text)');
  });

  it('uses sm size class when size prop is sm', () => {
    const wrapper = mount(UpdateMaturityBadge, {
      props: { maturity: 'fresh', size: 'sm' },
      global: globalConfig,
    });
    const badge = wrapper.find('[data-test="update-maturity-badge"]');
    expect(badge.classes()).toContain('px-1.5');
    expect(badge.classes()).toContain('py-0');
  });
});
