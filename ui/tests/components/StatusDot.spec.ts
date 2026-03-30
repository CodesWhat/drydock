import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import StatusDot from '@/components/StatusDot.vue';

describe('StatusDot', () => {
  it('renders with default props (size=md, muted fallback color)', () => {
    const wrapper = mount(StatusDot);
    const span = wrapper.get('span');

    expect(span.classes()).toContain('rounded-full');
    expect(span.classes()).toContain('shrink-0');
    expect(span.classes()).toContain('inline-block');
    expect(span.classes()).toContain('w-2');
    expect(span.classes()).toContain('h-2');
    expect(span.attributes('style')).toContain('background-color: var(--dd-text-muted)');
  });

  it('applies correct size class for sm', () => {
    const wrapper = mount(StatusDot, { props: { size: 'sm' } });
    const span = wrapper.get('span');

    expect(span.classes()).toContain('w-1.5');
    expect(span.classes()).toContain('h-1.5');
  });

  it('applies correct size class for md', () => {
    const wrapper = mount(StatusDot, { props: { size: 'md' } });
    const span = wrapper.get('span');

    expect(span.classes()).toContain('w-2');
    expect(span.classes()).toContain('h-2');
  });

  it('applies correct size class for lg', () => {
    const wrapper = mount(StatusDot, { props: { size: 'lg' } });
    const span = wrapper.get('span');

    expect(span.classes()).toContain('w-2.5');
    expect(span.classes()).toContain('h-2.5');
  });

  it('uses success color for connected status', () => {
    const wrapper = mount(StatusDot, { props: { status: 'connected' } });

    expect(wrapper.get('span').attributes('style')).toContain(
      'background-color: var(--dd-success)',
    );
  });

  it('uses success color for running status', () => {
    const wrapper = mount(StatusDot, { props: { status: 'running' } });

    expect(wrapper.get('span').attributes('style')).toContain(
      'background-color: var(--dd-success)',
    );
  });

  it('uses danger color for disconnected status', () => {
    const wrapper = mount(StatusDot, { props: { status: 'disconnected' } });

    expect(wrapper.get('span').attributes('style')).toContain('background-color: var(--dd-danger)');
  });

  it('uses danger color for stopped status', () => {
    const wrapper = mount(StatusDot, { props: { status: 'stopped' } });

    expect(wrapper.get('span').attributes('style')).toContain('background-color: var(--dd-danger)');
  });

  it('uses warning color for warning status', () => {
    const wrapper = mount(StatusDot, { props: { status: 'warning' } });

    expect(wrapper.get('span').attributes('style')).toContain(
      'background-color: var(--dd-warning)',
    );
  });

  it('uses muted color for idle status', () => {
    const wrapper = mount(StatusDot, { props: { status: 'idle' } });

    expect(wrapper.get('span').attributes('style')).toContain(
      'background-color: var(--dd-text-muted)',
    );
  });

  it('custom color overrides status color', () => {
    const wrapper = mount(StatusDot, {
      props: { status: 'connected', color: '#ff0000' },
    });

    expect(wrapper.get('span').attributes('style')).toContain('background-color: rgb(255, 0, 0)');
  });

  it('adds animate-pulse class when pulse is true', () => {
    const wrapper = mount(StatusDot, { props: { pulse: true } });

    expect(wrapper.get('span').classes()).toContain('animate-pulse');
  });

  it('does not add animate-pulse class by default', () => {
    const wrapper = mount(StatusDot);

    expect(wrapper.get('span').classes()).not.toContain('animate-pulse');
  });

  it('has role="presentation"', () => {
    const wrapper = mount(StatusDot);

    expect(wrapper.get('span').attributes('role')).toBe('presentation');
  });
});
