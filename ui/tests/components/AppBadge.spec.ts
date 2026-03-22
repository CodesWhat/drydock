import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AppBadge from '@/components/AppBadge.vue';

describe('AppBadge', () => {
  it('renders with default props (tone=neutral, size=sm, uppercase=true)', () => {
    const wrapper = mount(AppBadge, {
      slots: { default: 'Default' },
    });

    const span = wrapper.get('span');

    expect(span.classes()).toContain('badge');
    expect(span.classes()).toContain('text-2xs');
    expect(span.classes()).toContain('font-semibold');
    expect(span.classes()).toContain('uppercase');
    expect(span.attributes('style')).toContain('background-color: var(--dd-neutral-muted)');
    expect(span.attributes('style')).toContain('color: var(--dd-neutral)');
  });

  it('applies correct size classes for xs', () => {
    const wrapper = mount(AppBadge, {
      props: { size: 'xs' },
      slots: { default: 'XS' },
    });

    const span = wrapper.get('span');

    expect(span.classes()).toContain('text-3xs');
    expect(span.classes()).toContain('font-bold');
  });

  it('applies correct size classes for sm', () => {
    const wrapper = mount(AppBadge, {
      props: { size: 'sm' },
      slots: { default: 'SM' },
    });

    const span = wrapper.get('span');

    expect(span.classes()).toContain('text-2xs');
    expect(span.classes()).toContain('font-semibold');
  });

  it('applies correct size classes for md', () => {
    const wrapper = mount(AppBadge, {
      props: { size: 'md' },
      slots: { default: 'MD' },
    });

    const span = wrapper.get('span');

    expect(span.classes()).toContain('text-2xs-plus');
    expect(span.classes()).toContain('font-semibold');
  });

  it('applies uppercase class when uppercase=true', () => {
    const wrapper = mount(AppBadge, {
      props: { uppercase: true },
      slots: { default: 'Upper' },
    });

    expect(wrapper.get('span').classes()).toContain('uppercase');
  });

  it('omits uppercase class when uppercase=false', () => {
    const wrapper = mount(AppBadge, {
      props: { uppercase: false },
      slots: { default: 'Lower' },
    });

    expect(wrapper.get('span').classes()).not.toContain('uppercase');
  });

  it.each([
    ['success', '--dd-success-muted', '--dd-success'],
    ['danger', '--dd-danger-muted', '--dd-danger'],
    ['warning', '--dd-warning-muted', '--dd-warning'],
    ['caution', '--dd-caution-muted', '--dd-caution'],
    ['info', '--dd-info-muted', '--dd-info'],
    ['primary', '--dd-primary-muted', '--dd-primary'],
    ['alt', '--dd-alt-muted', '--dd-alt'],
    ['neutral', '--dd-neutral-muted', '--dd-neutral'],
  ] as const)('applies correct color style for tone=%s', (tone, bgVar, textVar) => {
    const wrapper = mount(AppBadge, {
      props: { tone },
      slots: { default: tone },
    });

    const style = wrapper.get('span').attributes('style');

    expect(style).toContain(`background-color: var(${bgVar})`);
    expect(style).toContain(`color: var(${textVar})`);
  });

  it('uses custom colors when custom prop provided, overriding tone', () => {
    const wrapper = mount(AppBadge, {
      props: {
        tone: 'danger',
        custom: { bg: '#1e3a5f', text: '#7cb3ff' },
      },
      slots: { default: 'Custom' },
    });

    const style = wrapper.get('span').attributes('style');

    expect(style).toContain('background-color: rgb(30, 58, 95)');
    expect(style).toContain('color: rgb(124, 179, 255)');
    expect(style).not.toContain('var(--dd-danger');
  });

  it('renders dot when dot=true with correct color', () => {
    const wrapper = mount(AppBadge, {
      props: { dot: true, tone: 'success' },
      slots: { default: 'Dot' },
    });

    const dot = wrapper.get('span span');

    expect(dot.classes()).toContain('w-1.5');
    expect(dot.classes()).toContain('h-1.5');
    expect(dot.classes()).toContain('rounded-full');
    expect(dot.attributes('style')).toContain('background-color: var(--dd-success)');
  });

  it('does not render dot when dot=false', () => {
    const wrapper = mount(AppBadge, {
      props: { dot: false },
      slots: { default: 'No dot' },
    });

    const innerSpans = wrapper.findAll('span span');

    expect(innerSpans).toHaveLength(0);
  });

  it('dot uses custom.text color when custom prop is provided', () => {
    const wrapper = mount(AppBadge, {
      props: {
        dot: true,
        custom: { bg: '#222', text: '#f0a' },
      },
      slots: { default: 'Custom dot' },
    });

    const dot = wrapper.get('span span');

    expect(dot.attributes('style')).toContain('background-color: rgb(255, 0, 170)');
    expect(dot.attributes('style')).not.toContain('var(--dd-');
  });

  it('renders slot content', () => {
    const wrapper = mount(AppBadge, {
      slots: { default: 'Hello Badge' },
    });

    expect(wrapper.text()).toBe('Hello Badge');
  });

  it('includes base badge class always', () => {
    const wrapper = mount(AppBadge, {
      props: { tone: 'danger', size: 'xs', uppercase: false },
      slots: { default: 'Always badge' },
    });

    expect(wrapper.get('span').classes()).toContain('badge');
  });
});
