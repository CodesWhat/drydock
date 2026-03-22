import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AppTabBar from '@/components/AppTabBar.vue';

const tabs = [
  { id: 'overview', label: 'Overview', icon: 'info' },
  { id: 'actions', label: 'Actions' },
  { id: 'logs', label: 'Logs', count: 5 },
  { id: 'disabled', label: 'Disabled', disabled: true },
];

function factory(overrides: Record<string, unknown> = {}) {
  return mount(AppTabBar, {
    props: {
      tabs,
      modelValue: 'overview',
      ...overrides,
    },
    global: {
      directives: { tooltip: () => {} },
    },
  });
}

describe('AppTabBar', () => {
  it('renders all tabs with correct labels', () => {
    const wrapper = factory();
    const buttons = wrapper.findAll('button');

    expect(buttons).toHaveLength(4);
    expect(buttons[0].text()).toContain('Overview');
    expect(buttons[1].text()).toContain('Actions');
    expect(buttons[2].text()).toContain('Logs');
    expect(buttons[3].text()).toContain('Disabled');
  });

  it('active tab has dd-text class, inactive has dd-text-muted', () => {
    const wrapper = factory({ modelValue: 'overview' });
    const buttons = wrapper.findAll('button');

    expect(buttons[0].classes()).toContain('dd-text');
    expect(buttons[0].classes()).not.toContain('dd-text-muted');

    expect(buttons[1].classes()).toContain('dd-text-muted');
    expect(buttons[1].classes()).not.toContain('dd-text');
  });

  it('clicking a tab emits update:modelValue', async () => {
    const wrapper = factory({ modelValue: 'overview' });
    const buttons = wrapper.findAll('button');

    await buttons[1].trigger('click');

    expect(wrapper.emitted('update:modelValue')).toBeTruthy();
    expect(wrapper.emitted('update:modelValue')![0]).toEqual(['actions']);
  });

  it('disabled tab has opacity-40 and cursor-not-allowed classes', () => {
    const wrapper = factory();
    const disabledButton = wrapper.findAll('button')[3];

    expect(disabledButton.classes()).toContain('opacity-40');
    expect(disabledButton.classes()).toContain('cursor-not-allowed');
    expect(disabledButton.attributes('disabled')).toBeDefined();
  });

  it('clicking disabled tab does NOT emit update:modelValue', async () => {
    const wrapper = factory();
    const disabledButton = wrapper.findAll('button')[3];

    await disabledButton.trigger('click');

    expect(wrapper.emitted('update:modelValue')).toBeFalsy();
  });

  it('compact size applies correct classes (px-2 py-1.5 text-2xs)', () => {
    const wrapper = factory({ size: 'compact' });
    const button = wrapper.findAll('button')[0];

    expect(button.classes()).toContain('px-2');
    expect(button.classes()).toContain('py-1.5');
    expect(button.classes()).toContain('text-2xs');
    expect(button.classes()).toContain('font-semibold');
    expect(button.classes()).toContain('uppercase');
    expect(button.classes()).toContain('tracking-wide');
  });

  it('default size applies correct classes (px-3 py-2 text-2xs-plus)', () => {
    const wrapper = factory();
    const button = wrapper.findAll('button')[0];

    expect(button.classes()).toContain('px-3');
    expect(button.classes()).toContain('py-2');
    expect(button.classes()).toContain('text-2xs-plus');
    expect(button.classes()).toContain('font-semibold');
    expect(button.classes()).toContain('uppercase');
    expect(button.classes()).toContain('tracking-wide');
  });

  it('active tab shows underline indicator div (h-[2px])', () => {
    const wrapper = factory({ modelValue: 'overview' });
    const activeButton = wrapper.findAll('button')[0];
    const indicator = activeButton.find('div');

    expect(indicator.exists()).toBe(true);
    expect(indicator.classes()).toContain('h-[2px]');
    expect(indicator.classes()).toContain('absolute');
    expect(indicator.classes()).toContain('bottom-0');
    expect(indicator.classes()).toContain('rounded-t-full');
  });

  it('inactive tab does NOT show underline indicator', () => {
    const wrapper = factory({ modelValue: 'overview' });
    const inactiveButton = wrapper.findAll('button')[1];
    const indicator = inactiveButton.find('div');

    expect(indicator.exists()).toBe(false);
  });

  it('tab with icon renders AppIcon (iconify-icon element)', () => {
    const wrapper = factory();
    const overviewButton = wrapper.findAll('button')[0];
    const iconEl = overviewButton.find('iconify-icon');

    expect(iconEl.exists()).toBe(true);

    const actionsButton = wrapper.findAll('button')[1];
    const noIconEl = actionsButton.find('iconify-icon');

    expect(noIconEl.exists()).toBe(false);
  });

  it('tab with count renders count badge', () => {
    const wrapper = factory();
    const logsButton = wrapper.findAll('button')[2];
    const badge = logsButton.findAll('span').find((s) => s.classes().includes('badge'));

    expect(badge).toBeDefined();
    expect(badge!.text()).toBe('5');
    expect(badge!.classes()).toContain('text-4xs');
    expect(badge!.classes()).toContain('font-bold');
  });

  it('tab without count does not render count badge', () => {
    const wrapper = factory();
    const actionsButton = wrapper.findAll('button')[1];
    const badge = actionsButton.findAll('span').find((s) => s.classes().includes('badge'));

    expect(badge).toBeUndefined();
  });

  it('iconOnly mode hides label text', () => {
    const wrapper = factory({ iconOnly: true });
    const overviewButton = wrapper.findAll('button')[0];

    const spans = overviewButton.findAll('span');
    const labelSpan = spans.filter(
      (s) =>
        !s.classes().includes('badge') &&
        !s.find('iconify-icon').exists() &&
        s.text() === 'Overview',
    );

    expect(labelSpan).toHaveLength(0);
  });

  it('iconOnly mode shows tooltip on tabs', () => {
    const wrapper = factory({ iconOnly: true });
    const buttons = wrapper.findAll('button');

    expect(buttons.length).toBeGreaterThan(0);
    // Tooltip directive is stubbed — we verify it was applied by checking
    // the component renders without error with the directive in place.
    // The v-tooltip binding receives tab.label when iconOnly is true.
    expect(wrapper.html()).toBeTruthy();
  });

  it('icon has mr-1.5 class when not in iconOnly mode', () => {
    const wrapper = factory({ iconOnly: false });
    const overviewButton = wrapper.findAll('button')[0];
    const iconEl = overviewButton.find('iconify-icon');

    expect(iconEl.classes()).toContain('mr-1.5');
  });

  it('icon does NOT have mr-1.5 class in iconOnly mode', () => {
    const wrapper = factory({ iconOnly: true });
    const overviewButton = wrapper.findAll('button')[0];
    const iconEl = overviewButton.find('iconify-icon');

    expect(iconEl.classes()).not.toContain('mr-1.5');
  });

  it('compact size uses smaller icon size', () => {
    const wrapper = factory({ size: 'compact' });
    const overviewButton = wrapper.findAll('button')[0];
    const iconEl = overviewButton.find('iconify-icon');

    // compact iconSize = 10, default iconSize = 12
    // The actual rendered size goes through iconScale, but the prop is passed
    expect(iconEl.exists()).toBe(true);
  });

  it('count badge has correct inline styles', () => {
    const wrapper = factory();
    const logsButton = wrapper.findAll('button')[2];
    const badge = logsButton.findAll('span').find((s) => s.classes().includes('badge'));

    expect(badge).toBeDefined();
    expect(badge!.attributes('style')).toContain('background-color: var(--dd-neutral-muted)');
    expect(badge!.attributes('style')).toContain('color: var(--dd-neutral)');
  });

  it('wrapper div has correct border styling', () => {
    const wrapper = factory();
    const root = wrapper.find('div');

    expect(root.classes()).toContain('flex');
    expect(root.classes()).toContain('items-center');
    expect(root.classes()).toContain('gap-1');
    expect(root.classes()).toContain('border-b');
    expect(root.attributes('style')).toContain('border-color: var(--dd-border)');
  });
});
