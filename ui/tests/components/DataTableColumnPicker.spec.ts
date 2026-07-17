import type { VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import AppIconButton from '@/components/AppIconButton.vue';
import DataTableColumnPicker from '@/components/DataTableColumnPicker.vue';
import type { PickerColumn } from '@/composables/useViewColumnVisibility';
import { mountWithPlugins } from '../helpers/mount';

const columns: PickerColumn[] = [
  { key: 'name', label: 'Name', required: true },
  { key: 'status', label: 'Status' },
  { key: 'containers', label: 'Containers' },
];

const PANEL_SELECTOR = '[data-test="data-table-column-picker-panel"]';
const RESET_SELECTOR = '[data-test="data-table-column-picker-reset"]';

describe('DataTableColumnPicker', () => {
  let wrapper: VueWrapper | null = null;

  function factory(
    props: Partial<{ columns: PickerColumn[]; hiddenKeys: Set<string> | string[] }> = {},
  ) {
    wrapper = mountWithPlugins(DataTableColumnPicker, {
      props: { columns, hiddenKeys: [], ...props },
      attachTo: document.body,
    });
    return wrapper;
  }

  function panel(): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(PANEL_SELECTOR);
  }

  async function openPicker(w: VueWrapper) {
    await w.find('button').trigger('click');
  }

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.querySelectorAll(PANEL_SELECTOR).forEach((el) => el.remove());
  });

  describe('trigger', () => {
    it('renders a trigger guarded to sm and up (hidden on mobile)', () => {
      const w = factory();
      const root = w.find('[data-test="data-table-column-picker"]');
      expect(root.classes()).toContain('hidden');
      expect(root.classes()).toContain('sm:flex');
      expect(root.classes()).toContain('shrink-0');
    });

    it('renders exactly one trigger button', () => {
      const w = factory();
      expect(w.findAll('button')).toHaveLength(1);
    });

    it('uses the 44px icon-button size for the picker trigger', () => {
      const w = factory();
      expect(w.getComponent(AppIconButton).props('size')).toBe('sm');
    });
  });

  describe('popover open/close', () => {
    it('does not render the popover panel when closed', () => {
      factory();
      expect(panel()).toBeNull();
    });

    it('opens the popover panel on trigger click, teleported to document.body', async () => {
      const w = factory();
      await openPicker(w);
      const p = panel();
      expect(p).not.toBeNull();
      expect(p?.style.position).toBe('fixed');
      expect(w.element.contains(p as HTMLElement)).toBe(false);
    });

    it('closes the popover on a second trigger click', async () => {
      const w = factory();
      await openPicker(w);
      expect(panel()).not.toBeNull();
      await openPicker(w);
      expect(panel()).toBeNull();
    });

    it('closes when clicking outside the popover', async () => {
      const w = factory();
      await openPicker(w);
      expect(panel()).not.toBeNull();
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await nextTick();
      expect(panel()).toBeNull();
    });

    it('does not close when clicking inside the popover panel', async () => {
      const w = factory();
      await openPicker(w);
      panel()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await nextTick();
      expect(panel()).not.toBeNull();
    });

    it('closes on Escape when open', async () => {
      const w = factory();
      await openPicker(w);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await nextTick();
      expect(panel()).toBeNull();
    });

    it('ignores Escape when already closed', async () => {
      factory();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await nextTick();
      expect(panel()).toBeNull();
    });

    it('ignores non-Escape keys while open', async () => {
      const w = factory();
      await openPicker(w);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await nextTick();
      expect(panel()).not.toBeNull();
    });

    it('removes its document listeners on unmount', async () => {
      const w = factory();
      await openPicker(w);
      w.unmount();
      wrapper = null;
      // Listeners removed — dispatching more events must not throw.
      expect(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }).not.toThrow();
    });
  });

  describe('column toggling', () => {
    it('emits toggle with the column key when a non-required row is clicked', async () => {
      const w = factory();
      await openPicker(w);
      const statusRow = Array.from(panel()!.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Status'),
      );
      statusRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await nextTick();
      expect(w.emitted('toggle')?.[0]).toEqual(['status']);
    });

    it('does not emit toggle when a required row is clicked', async () => {
      const w = factory();
      await openPicker(w);
      const nameRow = Array.from(panel()!.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Name'),
      );
      nameRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await nextTick();
      expect(w.emitted('toggle')).toBeUndefined();
    });

    it('renders required rows muted with cursor-not-allowed', async () => {
      const w = factory();
      await openPicker(w);
      const nameRow = Array.from(panel()!.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Name'),
      );
      expect(nameRow?.className).toContain('cursor-not-allowed');
      expect(nameRow?.className).toContain('dd-text-muted');
    });

    it('renders check icon for visible columns and square icon for hidden columns', async () => {
      const w = factory({ hiddenKeys: ['status'] });
      await openPicker(w);
      const icons = Array.from(panel()!.querySelectorAll('.app-icon-stub')) as HTMLElement[];
      expect(icons.map((icon) => icon.dataset.icon)).toEqual(['check', 'square', 'check']);
    });
  });

  describe('reset', () => {
    it('emits reset when the reset button is clicked', async () => {
      const w = factory();
      await openPicker(w);
      const resetBtn = document.body.querySelector<HTMLElement>(RESET_SELECTOR);
      resetBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await nextTick();
      expect(w.emitted('reset')).toHaveLength(1);
    });
  });

  describe('hidden count badge', () => {
    it('hides the badge when nothing is hidden', () => {
      const w = factory({ hiddenKeys: [] });
      expect(w.text()).not.toContain('+');
    });

    it('shows the badge with the hidden count when hiddenKeys is a string array', () => {
      const w = factory({ hiddenKeys: ['status'] });
      expect(w.text()).toContain('+1');
    });

    it('shows the badge with the hidden count when hiddenKeys is a Set', () => {
      const w = factory({ hiddenKeys: new Set(['status', 'containers']) });
      expect(w.text()).toContain('+2');
    });

    it('does not count hidden keys that no longer exist in the current columns', () => {
      const w = factory({ hiddenKeys: ['status', 'stale-key'] });
      expect(w.text()).toContain('+1');
      expect(w.text()).not.toContain('+2');
    });
  });
});
