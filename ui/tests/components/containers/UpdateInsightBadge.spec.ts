import { mount } from '@vue/test-utils';
import UpdateInsightBadge from '@/components/containers/UpdateInsightBadge.vue';
import { updateInsightColor, updateKindColor } from '@/utils/display';

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

  it('uses the informational color, and it renders on the badge itself', () => {
    const wrapper = mount(UpdateInsightBadge, {
      props: { insight: { tag: 'v1.46.1', kind: 'minor' } },
      global: globalConfig,
    });
    const badge = wrapper.find('[data-test="update-insight-badge"]');
    const style = badge.attributes('style');
    const insightColor = updateInsightColor();
    expect(style).toContain(insightColor.bg);
    expect(style).toContain(insightColor.text);
  });

  it.each([
    'major',
    'minor',
    'patch',
    'digest',
  ] as const)('is distinct from the actionable updateKindColor(%s) badge color', (kind) => {
    const insightColor = updateInsightColor();
    const kindColor = updateKindColor(kind);
    expect(insightColor.bg).not.toBe(kindColor.bg);
    expect(insightColor.text).not.toBe(kindColor.text);
  });
});
