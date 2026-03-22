import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AppButton from '@/components/AppButton.vue';

describe('AppButton', () => {
  it('renders button defaults with muted/md/semibold classes', () => {
    const wrapper = mount(AppButton, {
      slots: {
        default: 'Run',
      },
    });

    const button = wrapper.get('button');

    expect(button.attributes('type')).toBe('button');
    expect(button.classes()).toContain('dd-rounded');
    expect(button.classes()).toContain('transition-colors');
    expect(button.classes()).toContain('px-3');
    expect(button.classes()).toContain('py-1.5');
    expect(button.classes()).toContain('text-2xs-plus');
    expect(button.classes()).toContain('font-semibold');
    expect(button.classes()).toContain('dd-text-muted');
    expect(button.classes()).toContain('hover:dd-text');
    expect(button.classes()).toContain('hover:dd-bg-elevated');
  });

  it('supports explicit size/variant/weight and forwards attrs', () => {
    const wrapper = mount(AppButton, {
      props: {
        size: 'xs',
        variant: 'secondary',
        weight: 'medium',
      },
      attrs: {
        disabled: true,
        'data-test': 'secondary-action',
      },
      slots: {
        default: 'Refresh',
      },
    });

    const button = wrapper.get('button');

    expect(button.attributes('disabled')).toBeDefined();
    expect(button.attributes('data-test')).toBe('secondary-action');
    expect(button.classes()).toContain('px-2');
    expect(button.classes()).toContain('py-1');
    expect(button.classes()).toContain('text-2xs');
    expect(button.classes()).toContain('font-medium');
    expect(button.classes()).toContain('dd-text-secondary');
    expect(button.classes()).toContain('hover:dd-text');
    expect(button.classes()).toContain('hover:dd-bg-elevated');
  });

  it('uses plain variant and icon-xs size for compact icon controls', () => {
    const wrapper = mount(AppButton, {
      props: {
        size: 'icon-xs',
        variant: 'plain',
      },
      slots: {
        default: 'x',
      },
    });

    const button = wrapper.get('button');

    expect(button.classes()).toContain('inline-flex');
    expect(button.classes()).toContain('items-center');
    expect(button.classes()).toContain('justify-center');
    expect(button.classes()).toContain('w-4');
    expect(button.classes()).toContain('h-4');
    expect(button.classes()).not.toContain('dd-text-muted');
  });

  it('supports text-style muted actions with no padding size', () => {
    const wrapper = mount(AppButton, {
      props: {
        size: 'none',
        variant: 'text-muted',
        weight: 'medium',
      },
      slots: {
        default: 'Clear',
      },
    });

    const button = wrapper.get('button');

    expect(button.classes()).toContain('font-medium');
    expect(button.classes()).toContain('dd-text-muted');
    expect(button.classes()).toContain('hover:dd-text');
    expect(button.classes()).not.toContain('px-3');
    expect(button.classes()).not.toContain('py-1.5');
  });

  it('supports link-secondary variant for dashboard view-all actions', () => {
    const wrapper = mount(AppButton, {
      props: {
        size: 'none',
        variant: 'link-secondary',
        weight: 'medium',
      },
      slots: {
        default: 'View all',
      },
    });

    const button = wrapper.get('button');

    expect(button.classes()).toContain('text-drydock-secondary');
    expect(button.classes()).toContain('hover:underline');
    expect(button.classes()).toContain('font-medium');
  });

  it('supports weight none for passthrough button styling', () => {
    const wrapper = mount(AppButton, {
      props: {
        size: 'none',
        variant: 'plain',
        weight: 'none',
      },
      attrs: {
        class: 'font-bold px-2',
      },
      slots: {
        default: 'Custom',
      },
    });

    const button = wrapper.get('button');

    expect(button.classes()).toContain('px-2');
    expect(button.classes()).toContain('font-bold');
    expect(button.classes()).not.toContain('font-medium');
    expect(button.classes()).not.toContain('font-semibold');
  });
});
