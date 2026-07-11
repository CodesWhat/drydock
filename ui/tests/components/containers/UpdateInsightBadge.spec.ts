import { mount } from '@vue/test-utils';
import UpdateInsightBadge from '@/components/containers/UpdateInsightBadge.vue';

describe('UpdateInsightBadge (#498)', () => {
  const globalConfig = {
    stubs: { AppIcon: { template: '<span />', props: ['name', 'size'] } },
    directives: { tooltip: () => {} },
  };

  it('does not render when insight is undefined', () => {
    const wrapper = mount(UpdateInsightBadge, {
      props: { insight: undefined },
      global: globalConfig,
    });
    expect(wrapper.find('[data-test="update-insight-badge"]').exists()).toBe(false);
  });

  it('renders the "Newer available" label when insight is set', () => {
    const wrapper = mount(UpdateInsightBadge, {
      props: { insight: { tag: 'v1.46.1', kind: 'minor' } },
      global: globalConfig,
    });
    const badge = wrapper.find('[data-test="update-insight-badge"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe('Newer available');
    // Full tag is carried in the tooltip so the cell never needs to grow.
    expect(badge.text()).not.toContain('v1.46.1');
  });

  it('renders for kind=major', () => {
    const wrapper = mount(UpdateInsightBadge, {
      props: { insight: { tag: '2.0.0', kind: 'major' } },
      global: globalConfig,
    });
    expect(wrapper.find('[data-test="update-insight-badge"]').exists()).toBe(true);
  });

  it('renders for kind=patch', () => {
    const wrapper = mount(UpdateInsightBadge, {
      props: { insight: { tag: '1.2.5-alpine', kind: 'patch' } },
      global: globalConfig,
    });
    expect(wrapper.find('[data-test="update-insight-badge"]').exists()).toBe(true);
  });

  it('uses the neutral/informational color, distinct from actionable update-kind colors', () => {
    const wrapper = mount(UpdateInsightBadge, {
      props: { insight: { tag: 'v1.46.1', kind: 'minor' } },
      global: globalConfig,
    });
    const badge = wrapper.find('[data-test="update-insight-badge"]');
    const style = badge.attributes('style');
    expect(style).toContain('var(--dd-neutral-muted)');
    expect(style).toContain('var(--dd-neutral)');
  });
});
