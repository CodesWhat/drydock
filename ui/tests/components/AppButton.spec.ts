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
    expect(button.classes()).toContain('dd-text-button');
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
    expect(button.classes()).toContain('dd-text-button-sm');
    expect(button.classes()).toContain('font-medium');
    expect(button.classes()).toContain('dd-text-secondary');
    expect(button.classes()).toContain('disabled:cursor-not-allowed');
    expect(button.classes()).toContain('disabled:opacity-60');
    expect(button.classes()).not.toContain('hover:dd-text');
    expect(button.classes()).not.toContain('hover:dd-bg-elevated');
  });

  it('omits hover affordance classes when disabled', () => {
    const wrapper = mount(AppButton, {
      props: {
        variant: 'outlined',
      },
      attrs: {
        disabled: true,
      },
      slots: {
        default: 'Rollback Latest',
      },
    });

    const button = wrapper.get('button');

    expect(button.attributes('disabled')).toBeDefined();
    expect(button.classes()).toContain('dd-bg-button');
    expect(button.classes()).toContain('dd-text');
    expect(button.classes()).not.toContain('hover:opacity-85');
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
    expect(button.classes()).toContain('w-9');
    expect(button.classes()).toContain('h-9');
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

  it('supports semantic action variants without inline token styles', () => {
    const cases = [
      ['danger', 'dd-bg-danger-muted', 'dd-text-danger', 'dd-border-danger'],
      ['success', 'dd-bg-success-muted', 'dd-text-success', 'dd-border-success'],
      ['warning', 'dd-bg-warning-muted', 'dd-text-warning', 'dd-border-warning'],
    ] as const;

    for (const [variant, bgClass, textClass, borderClass] of cases) {
      const wrapper = mount(AppButton, {
        props: {
          variant,
        },
        slots: {
          default: variant,
        },
      });

      const button = wrapper.get('button');

      expect(button.classes()).toContain(bgClass);
      expect(button.classes()).toContain(textClass);
      expect(button.classes()).toContain('border');
      expect(button.classes()).toContain(borderClass);
      expect(button.attributes('style')).toBeUndefined();
    }
  });

  it('supports semantic subtle variants without inline token styles', () => {
    const cases = [
      ['muted-subtle', 'dd-bg-button', 'dd-text-muted'],
      ['danger-subtle', 'dd-bg-danger-muted', 'dd-text-danger'],
      ['success-subtle', 'dd-bg-success-muted', 'dd-text-success'],
      ['warning-subtle', 'dd-bg-warning-muted', 'dd-text-warning'],
      ['info-subtle', 'dd-bg-info-muted', 'dd-text-info'],
    ] as const;

    for (const [variant, bgClass, textClass] of cases) {
      const wrapper = mount(AppButton, {
        props: {
          variant,
        },
        slots: {
          default: variant,
        },
      });

      const button = wrapper.get('button');

      expect(button.classes()).toContain(bgClass);
      expect(button.classes()).toContain(textClass);
      expect(button.classes()).not.toContain('border');
      expect(button.classes()).toContain('hover:opacity-90');
      expect(button.attributes('style')).toBeUndefined();
    }
  });

  it('supports semantic text variants without inline token styles', () => {
    const cases = [
      ['text-danger', 'dd-text-danger'],
      ['text-success', 'dd-text-success'],
      ['text-warning', 'dd-text-warning'],
      ['text-info', 'dd-text-info'],
    ] as const;

    for (const [variant, textClass] of cases) {
      const wrapper = mount(AppButton, {
        props: {
          size: 'none',
          variant,
        },
        slots: {
          default: variant,
        },
      });

      const button = wrapper.get('button');

      expect(button.classes()).toContain(textClass);
      expect(button.classes()).toContain('hover:opacity-85');
      expect(button.attributes('style')).toBeUndefined();
    }
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

  it('uses tooltip text as the accessible label and title for icon-only controls', () => {
    const wrapper = mount(AppButton, {
      props: {
        size: 'none',
        variant: 'plain',
        weight: 'none',
        tooltip: 'Close panel',
      } as any,
      slots: {
        default: 'x',
      },
    });

    const button = wrapper.get('button');

    expect(button.attributes('aria-label')).toBe('Close panel');
    expect(button.attributes('title')).toBe('Close panel');
  });
});
