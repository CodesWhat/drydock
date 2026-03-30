import { mount } from '@vue/test-utils';
import SuggestedTagBadge from '@/components/containers/SuggestedTagBadge.vue';

describe('SuggestedTagBadge', () => {
  const globalConfig = {
    stubs: { AppIcon: { template: '<span />', props: ['name', 'size'] } },
    directives: { tooltip: () => {} },
  };

  it('does not render when tag is undefined', () => {
    const wrapper = mount(SuggestedTagBadge, {
      props: { tag: undefined, currentTag: 'latest' },
      global: globalConfig,
    });
    expect(wrapper.find('[data-test="suggested-tag-badge"]').exists()).toBe(false);
  });

  it('does not render when currentTag is not latest or empty', () => {
    const wrapper = mount(SuggestedTagBadge, {
      props: { tag: 'v1.3.0', currentTag: '1.2.3' },
      global: globalConfig,
    });
    expect(wrapper.find('[data-test="suggested-tag-badge"]').exists()).toBe(false);
  });

  it('renders badge with "Suggested: v1.3.0" when tag is v1.3.0 and currentTag is latest', () => {
    const wrapper = mount(SuggestedTagBadge, {
      props: { tag: 'v1.3.0', currentTag: 'latest' },
      global: globalConfig,
    });
    const badge = wrapper.find('[data-test="suggested-tag-badge"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toContain('Suggested: v1.3.0');
  });

  it('renders when currentTag is Latest (case insensitive)', () => {
    const wrapper = mount(SuggestedTagBadge, {
      props: { tag: 'v2.0.0', currentTag: 'Latest' },
      global: globalConfig,
    });
    expect(wrapper.find('[data-test="suggested-tag-badge"]').exists()).toBe(true);
  });

  it('renders when currentTag is empty string', () => {
    const wrapper = mount(SuggestedTagBadge, {
      props: { tag: 'v1.0.0', currentTag: '' },
      global: globalConfig,
    });
    expect(wrapper.find('[data-test="suggested-tag-badge"]').exists()).toBe(true);
  });

  it('does not render when currentTag is 1.2.3 even with tag set', () => {
    const wrapper = mount(SuggestedTagBadge, {
      props: { tag: 'v1.3.0', currentTag: '1.2.3' },
      global: globalConfig,
    });
    expect(wrapper.find('[data-test="suggested-tag-badge"]').exists()).toBe(false);
  });
});
