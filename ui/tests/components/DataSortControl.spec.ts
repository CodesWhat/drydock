import { defineComponent } from 'vue';
import DataSortControl from '@/components/DataSortControl.vue';
import { mountWithPlugins } from '../helpers/mount';

const columns = [
  { key: 'name', label: 'Name' },
  { key: 'status', label: 'Status' },
];

const AppIconButtonStub = defineComponent({
  inheritAttrs: false,
  props: ['icon', 'disabled', 'tooltip', 'ariaLabel', 'size'],
  emits: ['click'],
  template: `
    <button
      v-bind="$attrs"
      type="button"
      :disabled="disabled"
      :data-icon="icon"
      :data-size="size"
      :data-tooltip="tooltip"
      :aria-label="ariaLabel"
      @click="$emit('click', $event)" />
  `,
});

function factory(props: Record<string, unknown> = {}) {
  return mountWithPlugins(DataSortControl, {
    props: {
      columns,
      ...props,
    },
    global: {
      stubs: {
        AppIconButton: AppIconButtonStub,
      },
    },
  });
}

describe('DataSortControl', () => {
  it('uses 44px targets for both sort controls', () => {
    const wrapper = factory({ sortKey: 'name', sortAsc: true });
    const select = wrapper.get('[data-test="dd-toolbar-sort-select"]');
    const button = wrapper.get('[data-test="dd-toolbar-sort-direction"]');

    expect(select.classes()).toContain('min-h-[44px]');
    expect(button.attributes('data-size')).toBe('sm');
  });

  it('renders the unset disabled state with the ascending icon and inactive press state', () => {
    const wrapper = factory({ sortAsc: true });
    const select = wrapper.get('[data-test="dd-toolbar-sort-select"]');
    const button = wrapper.get('[data-test="dd-toolbar-sort-direction"]');

    expect((select.element as HTMLSelectElement).value).toBe('');
    expect(button.attributes('disabled')).toBeDefined();
    expect(button.attributes('aria-pressed')).toBe('false');
    expect(button.attributes('data-icon')).toBe('sort-asc');
    expect(button.attributes('aria-label')).toBe('Sort direction: ascending');
    expect(button.attributes('data-tooltip')).toBe('Sort direction: ascending');
  });

  it('renders ascending direction as pressed when a sort key is selected', () => {
    const wrapper = factory({ sortKey: 'name', sortAsc: true });
    const button = wrapper.get('[data-test="dd-toolbar-sort-direction"]');

    expect(button.attributes('disabled')).toBeUndefined();
    expect(button.attributes('aria-pressed')).toBe('true');
    expect(button.attributes('data-icon')).toBe('sort-asc');
    expect(button.attributes('aria-label')).toBe('Sort direction: ascending');
  });

  it('renders descending direction icon, label, tooltip, and inactive press state', () => {
    const wrapper = factory({ sortKey: 'name', sortAsc: false });
    const button = wrapper.get('[data-test="dd-toolbar-sort-direction"]');

    expect(button.attributes('aria-pressed')).toBe('false');
    expect(button.attributes('data-icon')).toBe('sort-desc');
    expect(button.attributes('aria-label')).toBe('Sort direction: descending');
    expect(button.attributes('data-tooltip')).toBe('Sort direction: descending');
  });

  it('emits a new sort key and resets direction to ascending when the field changes', async () => {
    const wrapper = factory({ sortKey: 'name', sortAsc: false });

    await wrapper.get('[data-test="dd-toolbar-sort-select"]').setValue('status');

    expect(wrapper.emitted('update:sortKey')?.[0]).toEqual(['status']);
    expect(wrapper.emitted('update:sortAsc')?.[0]).toEqual([true]);
  });

  it('does nothing when the selected field is empty', async () => {
    const wrapper = factory({ sortKey: 'name', sortAsc: true });
    const select = wrapper.get('[data-test="dd-toolbar-sort-select"]');

    (select.element as HTMLSelectElement).value = '';
    await select.trigger('change');

    expect(wrapper.emitted('update:sortKey')).toBeUndefined();
    expect(wrapper.emitted('update:sortAsc')).toBeUndefined();
  });

  it('does nothing when re-selecting the current field', async () => {
    const wrapper = factory({ sortKey: 'name', sortAsc: true });
    const select = wrapper.get('[data-test="dd-toolbar-sort-select"]');

    (select.element as HTMLSelectElement).value = 'name';
    await select.trigger('change');

    expect(wrapper.emitted('update:sortKey')).toBeUndefined();
    expect(wrapper.emitted('update:sortAsc')).toBeUndefined();
  });

  it('does not emit a direction update when no sort key is selected', async () => {
    const wrapper = factory({ sortAsc: true });

    wrapper.findComponent(AppIconButtonStub).vm.$emit('click', new MouseEvent('click'));
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('update:sortAsc')).toBeUndefined();
  });

  it('toggles ascending to descending for the current sort key', async () => {
    const wrapper = factory({ sortKey: 'name', sortAsc: true });

    await wrapper.get('[data-test="dd-toolbar-sort-direction"]').trigger('click');

    expect(wrapper.emitted('update:sortAsc')?.[0]).toEqual([false]);
  });

  it('toggles explicit descending back to ascending for the current sort key', async () => {
    const wrapper = factory({ sortKey: 'name', sortAsc: false });

    await wrapper.get('[data-test="dd-toolbar-sort-direction"]').trigger('click');

    expect(wrapper.emitted('update:sortAsc')?.[0]).toEqual([true]);
  });
});
