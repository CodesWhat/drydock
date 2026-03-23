import { mount } from '@vue/test-utils';
import FloatingTagBadge from '@/components/containers/FloatingTagBadge.vue';

describe('FloatingTagBadge', () => {
  const globalConfig = {
    directives: {
      tooltip: {
        mounted(el: HTMLElement, binding: { value: string }) {
          el.dataset.tooltip = binding.value;
        },
      },
    },
  };

  it('does not render when tagPrecision is not floating', () => {
    const wrapper = mount(FloatingTagBadge, {
      props: { tagPrecision: 'specific', imageDigestWatch: false },
      global: globalConfig,
    });
    expect(wrapper.find('[data-test="floating-tag-badge"]').exists()).toBe(false);
  });

  it('does not render when digest watch is enabled', () => {
    const wrapper = mount(FloatingTagBadge, {
      props: { tagPrecision: 'floating', imageDigestWatch: true },
      global: globalConfig,
    });
    expect(wrapper.find('[data-test="floating-tag-badge"]').exists()).toBe(false);
  });

  it('renders floating tag badge with tooltip when tag is floating and digest watch is disabled', () => {
    const wrapper = mount(FloatingTagBadge, {
      props: { tagPrecision: 'floating', imageDigestWatch: false },
      global: globalConfig,
    });

    const badge = wrapper.find('[data-test="floating-tag-badge"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toContain('floating tag');
    expect(badge.attributes('data-tooltip')).toBe(
      'This tag may be updated in-place by the registry. Enable dd.watch.digest=true or use a full semver tag for complete update detection.',
    );
  });
});
