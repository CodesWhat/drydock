import { mount } from '@vue/test-utils';
import DataCardGrid from '@/components/DataCardGrid.vue';

const items = [
  { id: '1', name: 'Alpha' },
  { id: '2', name: 'Beta' },
  { id: '3', name: 'Gamma' },
];

function factory(props: Record<string, any> = {}, slots: Record<string, any> = {}) {
  return mount(DataCardGrid, {
    props: { items, itemKey: 'id', ...props },
    slots,
    global: { stubs: { AppIcon: { template: '<span class="app-icon-stub" />' } } },
  });
}

describe('DataCardGrid', () => {
  describe('rendering', () => {
    it('renders a card div for each item', () => {
      const w = factory();
      expect(w.findAll('.container-card')).toHaveLength(3);
    });

    it('renders no cards when items is empty', () => {
      const w = factory({ items: [] });
      expect(w.findAll('.container-card')).toHaveLength(0);
    });
  });

  describe('item key', () => {
    it('supports string item key', () => {
      const w = factory({ itemKey: 'id' });
      expect(w.findAll('.container-card')).toHaveLength(3);
    });

    it('supports function item key', () => {
      const w = factory({ itemKey: (item: any) => `key-${item.id}` });
      expect(w.findAll('.container-card')).toHaveLength(3);
    });
  });

  describe('selection', () => {
    it('applies ring highlight to selected card', () => {
      const w = factory({ selectedKey: '2' });
      const cards = w.findAll('.container-card');
      expect(cards[1].classes()).toContain('ring-2');
      expect(cards[1].classes()).toContain('ring-drydock-secondary');
    });

    it('does not apply ring to unselected cards', () => {
      const w = factory({ selectedKey: '2' });
      const cards = w.findAll('.container-card');
      expect(cards[0].classes()).not.toContain('ring-2');
      expect(cards[2].classes()).not.toContain('ring-2');
    });

    it('applies thicker border to selected card', () => {
      const w = factory({ selectedKey: '1' });
      const style = w.findAll('.container-card')[0].attributes('style');
      expect(style).toContain('1.5px solid');
    });

    it('applies normal border to unselected cards', () => {
      const w = factory({ selectedKey: '1' });
      const style = w.findAll('.container-card')[1].attributes('style');
      expect(style).toContain('1px solid');
    });
  });

  describe('click', () => {
    it('emits item-click with the item when a card is clicked', async () => {
      const w = factory();
      await w.findAll('.container-card')[1].trigger('click');
      expect(w.emitted('item-click')?.[0]).toEqual([items[1]]);
    });
  });

  describe('card slot', () => {
    it('passes item to card slot', () => {
      const w = factory(
        {},
        {
          card: ({ item }: any) => `Card: ${item.name}`,
        },
      );
      const cards = w.findAll('.container-card');
      expect(cards[0].text()).toBe('Card: Alpha');
      expect(cards[1].text()).toBe('Card: Beta');
    });

    it('passes selected boolean to card slot', () => {
      const w = factory(
        { selectedKey: '2' },
        {
          card: ({ item, selected }: any) => `${item.name}:${selected}`,
        },
      );
      const cards = w.findAll('.container-card');
      expect(cards[0].text()).toBe('Alpha:false');
      expect(cards[1].text()).toBe('Beta:true');
    });
  });

  describe('grid layout', () => {
    it('uses default minWidth of 280px', () => {
      const w = factory();
      const grid = w.find('.grid');
      expect(grid.attributes('style')).toContain('280px');
    });

    it('uses custom minWidth when provided', () => {
      const w = factory({ minWidth: '350px' });
      const grid = w.find('.grid');
      expect(grid.attributes('style')).toContain('350px');
    });
  });
});
