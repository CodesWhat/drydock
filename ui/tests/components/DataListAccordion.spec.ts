import { mount } from '@vue/test-utils';
import DataListAccordion from '@/components/DataListAccordion.vue';

const items = [
  { id: '1', name: 'Alpha' },
  { id: '2', name: 'Beta' },
  { id: '3', name: 'Gamma' },
];

function factory(props: Record<string, any> = {}, slots: Record<string, any> = {}) {
  return mount(DataListAccordion, {
    props: { items, itemKey: 'id', ...props },
    slots,
    global: {
      stubs: { AppIcon: { template: '<span class="app-icon-stub" />', props: ['name', 'size'] } },
    },
  });
}

describe('DataListAccordion', () => {
  describe('rendering', () => {
    it('renders a row for each item', () => {
      const w = factory();
      expect(w.findAll('.space-y-2 > div')).toHaveLength(3);
    });
  });

  describe('item key', () => {
    it('supports string item key', () => {
      const w = factory({ itemKey: 'id' });
      expect(w.findAll('.space-y-2 > div')).toHaveLength(3);
    });

    it('supports function item key', () => {
      const w = factory({ itemKey: (item: any) => `key-${item.id}` });
      expect(w.findAll('.space-y-2 > div')).toHaveLength(3);
    });
  });

  describe('click-through mode (default)', () => {
    it('emits item-click with the item on row click', async () => {
      const w = factory();
      const rows = w.findAll('.space-y-2 > div');
      await rows[1].trigger('click');
      expect(w.emitted('item-click')?.[0]).toEqual([items[1]]);
    });

    it('emits item-click for each clicked row independently', async () => {
      const w = factory();
      const rows = w.findAll('.space-y-2 > div');
      await rows[0].trigger('click');
      await rows[2].trigger('click');
      expect(w.emitted('item-click')).toHaveLength(2);
      expect(w.emitted('item-click')?.[0]).toEqual([items[0]]);
      expect(w.emitted('item-click')?.[1]).toEqual([items[2]]);
    });

    it('does not show chevron icons', () => {
      const w = factory();
      expect(w.findAll('.app-icon-stub')).toHaveLength(0);
    });

    it('does not show details slot content', () => {
      const w = factory(
        {},
        { details: ({ item }: any) => `Details: ${item.name}` },
      );
      expect(w.text()).not.toContain('Details:');
    });
  });

  describe('expandable mode', () => {
    it('starts collapsed (no details visible)', () => {
      const w = factory(
        { expandable: true },
        { details: ({ item }: any) => `Details: ${item.name}` },
      );
      expect(w.text()).not.toContain('Details:');
    });

    it('expands on click to show details', async () => {
      const w = factory(
        { expandable: true },
        {
          header: ({ item }: any) => `Header: ${item.name}`,
          details: ({ item }: any) => `Details: ${item.name}`,
        },
      );
      const rows = w.findAll('.space-y-2 > div');
      await rows[0].trigger('click');
      expect(w.text()).toContain('Details: Alpha');
    });

    it('collapses on second click', async () => {
      const w = factory(
        { expandable: true },
        {
          header: ({ item }: any) => `Header: ${item.name}`,
          details: ({ item }: any) => `Details: ${item.name}`,
        },
      );
      const rows = w.findAll('.space-y-2 > div');
      await rows[0].trigger('click');
      expect(w.text()).toContain('Details: Alpha');
      await rows[0].trigger('click');
      expect(w.text()).not.toContain('Details: Alpha');
    });

    it('does not emit item-click', async () => {
      const w = factory({ expandable: true });
      const rows = w.findAll('.space-y-2 > div');
      await rows[0].trigger('click');
      expect(w.emitted('item-click')).toBeUndefined();
    });

    it('shows chevron icons', () => {
      const w = factory({ expandable: true });
      expect(w.findAll('.app-icon-stub').length).toBeGreaterThanOrEqual(3);
    });

    it('allows multiple items to expand independently', async () => {
      const w = factory(
        { expandable: true },
        { details: ({ item }: any) => `Details: ${item.name}` },
      );
      const rows = w.findAll('.space-y-2 > div');
      await rows[0].trigger('click');
      await rows[2].trigger('click');
      expect(w.text()).toContain('Details: Alpha');
      expect(w.text()).toContain('Details: Gamma');
      expect(w.text()).not.toContain('Details: Beta');
    });

    it('passes expanded state to header slot', async () => {
      const w = factory(
        { expandable: true },
        { header: ({ item, expanded }: any) => `${item.name}:${expanded}` },
      );
      const firstItem = w.findAll('.space-y-2 > div')[0];
      expect(firstItem.text()).toContain('Alpha:false');
      await firstItem.trigger('click');
      expect(w.findAll('.space-y-2 > div')[0].text()).toContain('Alpha:true');
    });
  });

  describe('accessibility', () => {
    it('marks expandable rows as buttons and updates aria-expanded', async () => {
      const w = factory({ expandable: true });
      const firstItem = w.findAll('.space-y-2 > div')[0];
      expect(firstItem.attributes('role')).toBe('button');
      expect(firstItem.attributes('aria-expanded')).toBe('false');
      expect(firstItem.attributes('tabindex')).toBe('0');

      await firstItem.trigger('click');
      expect(w.findAll('.space-y-2 > div')[0].attributes('aria-expanded')).toBe('true');
    });

    it('adds an aria-label for click-through rows', () => {
      const w = factory({ expandable: false });
      const firstItem = w.findAll('.space-y-2 > div')[0];
      expect(firstItem.attributes('aria-label')).toContain('Alpha');
    });
  });

  describe('selection', () => {
    it('applies thicker border to selected item', () => {
      const w = factory({ selectedKey: '2' });
      const itemDivs = w.findAll('.space-y-2 > div');
      const style = itemDivs[1].attributes('style');
      expect(style).toContain('1.5px solid');
    });

    it('applies normal border to unselected items', () => {
      const w = factory({ selectedKey: '2' });
      const itemDivs = w.findAll('.space-y-2 > div');
      const style = itemDivs[0].attributes('style');
      expect(style).toContain('1px solid');
    });
  });

  describe('header slot', () => {
    it('passes item to header slot', () => {
      const w = factory(
        {},
        { header: ({ item }: any) => `${item.name}` },
      );
      const firstItem = w.findAll('.space-y-2 > div')[0];
      expect(firstItem.text()).toContain('Alpha');
    });
  });
});
