import { mount } from '@vue/test-utils';
import NoUpdateReasonBadge from '@/components/containers/NoUpdateReasonBadge.vue';

describe('NoUpdateReasonBadge', () => {
  const globalConfig = {
    stubs: { AppIcon: { template: '<span />', props: ['name', 'size'] } },
    directives: {
      tooltip: {
        mounted(el: HTMLElement, binding: { value: string }) {
          el.dataset.tooltip = binding.value;
        },
      },
    },
  };

  it('renders nothing when reason is empty string', () => {
    const wrapper = mount(NoUpdateReasonBadge, {
      props: { reason: '' },
      global: globalConfig,
    });
    expect(wrapper.find('[data-test="no-update-reason-badge"]').exists()).toBe(false);
  });

  it('renders icon-only badge with tooltip and aria-label for icon variant', () => {
    const wrapper = mount(NoUpdateReasonBadge, {
      props: { reason: 'Strict tag-family policy filtered all candidates' },
      global: globalConfig,
    });
    const badge = wrapper.find('[data-test="no-update-reason-badge"]');
    expect(badge.exists()).toBe(true);
    expect(badge.attributes('data-tooltip')).toBe(
      'Strict tag-family policy filtered all candidates',
    );
    expect(badge.attributes('aria-label')).toBe('Strict tag-family policy filtered all candidates');
  });

  it('does not render text content in icon variant', () => {
    const wrapper = mount(NoUpdateReasonBadge, {
      props: { reason: 'Some reason' },
      global: globalConfig,
    });
    const badge = wrapper.find('[data-test="no-update-reason-badge"]');
    expect(badge.find('span').exists()).toBe(true);
    expect(badge.text()).toBe('');
  });

  it('renders text content in inline variant', () => {
    const wrapper = mount(NoUpdateReasonBadge, {
      props: { reason: 'All tags excluded by policy', variant: 'inline' },
      global: globalConfig,
    });
    const badge = wrapper.find('[data-test="no-update-reason-badge"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toContain('All tags excluded by policy');
  });

  it('applies inline pill classes in inline variant', () => {
    const wrapper = mount(NoUpdateReasonBadge, {
      props: { reason: 'No tags', variant: 'inline' },
      global: globalConfig,
    });
    const badge = wrapper.find('[data-test="no-update-reason-badge"]');
    expect(badge.classes()).toContain('gap-1');
    expect(badge.classes()).toContain('px-1.5');
    expect(badge.classes()).toContain('py-0.5');
  });

  it('does not apply inline pill classes in icon variant', () => {
    const wrapper = mount(NoUpdateReasonBadge, {
      props: { reason: 'No tags' },
      global: globalConfig,
    });
    const badge = wrapper.find('[data-test="no-update-reason-badge"]');
    expect(badge.classes()).not.toContain('gap-1');
    expect(badge.classes()).not.toContain('px-1.5');
  });

  it('applies warning-muted background in inline variant', () => {
    const wrapper = mount(NoUpdateReasonBadge, {
      props: { reason: 'No tags', variant: 'inline' },
      global: globalConfig,
    });
    const badge = wrapper.find('[data-test="no-update-reason-badge"]');
    expect(badge.attributes('style')).toContain('var(--dd-warning-muted)');
  });

  it('applies warning color without background in icon variant', () => {
    const wrapper = mount(NoUpdateReasonBadge, {
      props: { reason: 'No tags' },
      global: globalConfig,
    });
    const badge = wrapper.find('[data-test="no-update-reason-badge"]');
    const style = badge.attributes('style') ?? '';
    expect(style).toContain('var(--dd-warning)');
    expect(style).not.toContain('var(--dd-warning-muted)');
  });

  it('defaults to icon variant when variant prop is omitted', () => {
    const wrapper = mount(NoUpdateReasonBadge, {
      props: { reason: 'Pinned tag' },
      global: globalConfig,
    });
    const badge = wrapper.find('[data-test="no-update-reason-badge"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe('');
  });

  it('defaults size to 14 and passes it to AppIcon', () => {
    const iconStubWithSize = {
      template: '<span :data-size="size" />',
      props: ['name', 'size'],
    };
    const wrapper = mount(NoUpdateReasonBadge, {
      props: { reason: 'Pinned' },
      global: {
        stubs: { AppIcon: iconStubWithSize },
        directives: { tooltip: () => {} },
      },
    });
    const icon = wrapper.find('[data-test="no-update-reason-badge"] span');
    expect(icon.attributes('data-size')).toBe('14');
  });

  it('passes custom size to AppIcon', () => {
    const iconStubWithSize = {
      template: '<span :data-size="size" />',
      props: ['name', 'size'],
    };
    const wrapper = mount(NoUpdateReasonBadge, {
      props: { reason: 'Pinned', size: 16 },
      global: {
        stubs: { AppIcon: iconStubWithSize },
        directives: { tooltip: () => {} },
      },
    });
    const icon = wrapper.find('[data-test="no-update-reason-badge"] span');
    expect(icon.attributes('data-size')).toBe('16');
  });
});
