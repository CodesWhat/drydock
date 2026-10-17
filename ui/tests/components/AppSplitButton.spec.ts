import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import AppSplitButton from '@/components/AppSplitButton.vue';

describe('AppSplitButton', () => {
  it.each([
    ['muted', 'dd-border-strong', 'dd-bg-button', 'dd-bg-elevated'],
    ['warning', 'dd-border-warning', 'dd-bg-warning-muted', 'brightness-125'],
    ['success', 'dd-border-success', 'dd-bg-success-muted', 'brightness-125'],
  ] as const)(
    'preserves %s sizing, palette, slot and open-menu styling',
    async (variant, border, background, openClass) => {
      const wrapper = mount(AppSplitButton, {
        props: { variant, menuLabel: 'More actions', primaryClass: 'flex-1' },
        slots: { default: '<span>Update</span>' },
        attrs: { class: 'min-w-[110px]' },
      });
      const [primary, menu] = wrapper.findAll('button');
      expect(wrapper.classes()).toEqual(
        expect.arrayContaining([
          'inline-flex',
          'dd-rounded',
          'overflow-hidden',
          'border',
          border,
          'min-w-[110px]',
        ]),
      );
      expect(primary.classes()).toEqual(
        expect.arrayContaining([
          'px-3',
          'py-1.5',
          'dd-text-button',
          'font-bold',
          'flex-1',
          background,
        ]),
      );
      expect(primary.text()).toBe('Update');
      expect(menu.classes()).toEqual(
        expect.arrayContaining(['w-8', 'h-8', 'border-l', border, background]),
      );
      expect(menu.attributes('aria-label')).toBe('More actions');
      expect(menu.classes()).not.toContain(openClass);
      for (const button of [primary, menu]) expect(button.attributes('type')).toBe('button');
      await wrapper.setProps({ menuOpen: true });
      expect(menu.classes()).toContain(openClass);
      await wrapper.setProps({ menuDisabled: true });
      expect(menu.classes()).not.toContain(openClass);
      expect(menu.classes()).toContain('cursor-not-allowed');
      wrapper.unmount();
    },
  );

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    'keeps primary disabled=%s independent from menu disabled=%s',
    async (primaryDisabled, menuDisabled) => {
      const primaryClick = vi.fn();
      const menuClick = vi.fn();
      const wrapper = mount(AppSplitButton, {
        props: {
          menuLabel: 'More',
          primaryDisabled,
          menuDisabled,
          onPrimary: primaryClick,
          onMenu: menuClick,
        },
      });
      const [primary, menu] = wrapper.findAll('button');
      expect(primary.element.disabled).toBe(primaryDisabled);
      expect(menu.element.disabled).toBe(menuDisabled);
      primary.element.click();
      menu.element.click();
      expect(primaryClick).toHaveBeenCalledTimes(primaryDisabled ? 0 : 1);
      expect(menuClick).toHaveBeenCalledTimes(menuDisabled ? 0 : 1);
      wrapper.unmount();
    },
  );

  it('isolates each native click and activation keys without cancelling defaults or arrow navigation', () => {
    const rowClick = vi.fn();
    const rowKeydown = vi.fn();
    const primaryClick = vi.fn();
    let nativeMenuEvent: MouseEvent | undefined;
    let menuAnchor: EventTarget | null | undefined;
    const menuClick = vi.fn((event: MouseEvent) => {
      nativeMenuEvent = event;
      menuAnchor = event.currentTarget;
    });
    const wrapper = mount(
      defineComponent({
        components: { AppSplitButton },
        setup: () => ({ rowClick, rowKeydown, primaryClick, menuClick }),
        template:
          '<div @click="rowClick" @keydown="rowKeydown"><AppSplitButton menu-label="More" @primary="primaryClick" @menu="menuClick">Update</AppSplitButton></div>',
      }),
    );
    const [primary, menu] = wrapper.findAll('button');
    for (const button of [primary, menu]) {
      for (const key of ['Enter', ' ']) {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        button.element.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
      }
    }
    expect(rowKeydown).not.toHaveBeenCalled();
    expect(primaryClick).not.toHaveBeenCalled();
    expect(menuClick).not.toHaveBeenCalled();
    menu.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(rowKeydown).toHaveBeenCalledOnce();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    menu.element.dispatchEvent(click);
    expect(nativeMenuEvent).toBe(click);
    expect(menuAnchor).toBe(menu.element);
    expect(click.defaultPrevented).toBe(false);
    expect(primaryClick).not.toHaveBeenCalled();
    primary.element.click();
    expect(primaryClick).toHaveBeenCalledOnce();
    expect(menuClick).toHaveBeenCalledOnce();
    expect(rowClick).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
