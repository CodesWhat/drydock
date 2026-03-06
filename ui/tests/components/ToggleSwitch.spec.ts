import { mount } from '@vue/test-utils';
import ToggleSwitch from '@/components/ToggleSwitch.vue';

function factory(props: Record<string, any> = {}) {
  return mount(ToggleSwitch, {
    props: {
      modelValue: false,
      ...props,
    },
  });
}

describe('ToggleSwitch', () => {
  it('renders role=switch with aria-checked state', () => {
    const w = factory({ modelValue: true });
    const btn = w.find('button');
    expect(btn.attributes('role')).toBe('switch');
    expect(btn.attributes('aria-checked')).toBe('true');
  });

  it('updates aria-checked when modelValue is false', () => {
    const w = factory({ modelValue: false });
    expect(w.find('button').attributes('aria-checked')).toBe('false');
  });

  it('sets aria-label when provided', () => {
    const w = factory({ ariaLabel: 'Enable auto-refresh' });
    expect(w.find('button').attributes('aria-label')).toBe('Enable auto-refresh');
  });

  it('emits update:modelValue on click', async () => {
    const w = factory({ modelValue: false });
    await w.find('button').trigger('click');
    expect(w.emitted('update:modelValue')?.[0]).toEqual([true]);
  });
});
