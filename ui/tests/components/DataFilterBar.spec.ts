import { mount } from '@vue/test-utils';
import DataFilterBar from '@/components/DataFilterBar.vue';

function factory(props: Record<string, any> = {}, slots: Record<string, any> = {}) {
  return mount(DataFilterBar, {
    props: {
      modelValue: 'table',
      filteredCount: 5,
      totalCount: 10,
      showFilters: false,
      ...props,
    },
    slots,
    global: { stubs: { AppIcon: { template: '<span class="app-icon-stub" />' } } },
  });
}

describe('DataFilterBar', () => {
  describe('count display', () => {
    it('renders filtered/total count', () => {
      const w = factory({ filteredCount: 3, totalCount: 12 });
      expect(w.text()).toContain('3/12');
    });

    it('renders count label when provided', () => {
      const w = factory({ filteredCount: 3, totalCount: 12, countLabel: 'containers' });
      expect(w.text()).toContain('3/12');
      expect(w.text()).toContain('containers');
    });

    it('omits count label when not provided', () => {
      const w = factory({ filteredCount: 3, totalCount: 12 });
      expect(w.text()).toContain('3/12');
      expect(w.text()).not.toContain('containers');
    });
  });

  describe('filter toggle', () => {
    it('renders filter button when hideFilter is not set', () => {
      const w = factory();
      const filterBtn = w.find('button[title="Filters"]');
      expect(filterBtn.exists()).toBe(true);
    });

    it('hides filter button when hideFilter is true', () => {
      const w = factory({ hideFilter: true });
      expect(w.find('button[title="Filters"]').exists()).toBe(false);
    });

    it('emits update:showFilters toggled value on click', async () => {
      const w = factory({ showFilters: false });
      await w.find('button[title="Filters"]').trigger('click');
      expect(w.emitted('update:showFilters')?.[0]).toEqual([true]);
    });

    it('emits false when showFilters is currently true', async () => {
      const w = factory({ showFilters: true });
      await w.find('button[title="Filters"]').trigger('click');
      expect(w.emitted('update:showFilters')?.[0]).toEqual([false]);
    });
  });

  describe('active filter badge', () => {
    it('shows badge with activeFilterCount when > 0', () => {
      const w = factory({ activeFilterCount: 3 });
      const badge = w.find('span.rounded-full');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe('3');
    });

    it('does not show badge when activeFilterCount is 0', () => {
      const w = factory({ activeFilterCount: 0 });
      expect(w.find('span.rounded-full').exists()).toBe(false);
    });

    it('does not show badge when activeFilterCount is undefined', () => {
      const w = factory();
      expect(w.find('span.rounded-full').exists()).toBe(false);
    });
  });

  describe('view mode buttons', () => {
    it('renders default view mode buttons (table, cards, list)', () => {
      const w = factory();
      const buttons = w.findAll('button');
      // filter button + 3 view mode buttons = 4
      const viewBtns = buttons.filter((b) => b.attributes('title')?.endsWith('view'));
      expect(viewBtns).toHaveLength(3);
      expect(viewBtns[0].attributes('title')).toBe('Table view');
      expect(viewBtns[1].attributes('title')).toBe('Cards view');
      expect(viewBtns[2].attributes('title')).toBe('List view');
    });

    it('renders custom view modes when provided', () => {
      const customModes = [
        { id: 'grid', icon: 'grid' },
        { id: 'timeline', icon: 'clock' },
      ];
      const w = factory({ viewModes: customModes });
      const viewBtns = w.findAll('button').filter((b) => b.attributes('title')?.endsWith('view'));
      expect(viewBtns).toHaveLength(2);
      expect(viewBtns[0].attributes('title')).toBe('Grid view');
      expect(viewBtns[1].attributes('title')).toBe('Timeline view');
    });

    it('emits update:modelValue when a view mode is clicked', async () => {
      const w = factory({ modelValue: 'table' });
      const cardBtn = w.findAll('button').find((b) => b.attributes('title') === 'Cards view');
      expect(cardBtn).toBeDefined();
      await cardBtn?.trigger('click');
      expect(w.emitted('update:modelValue')?.[0]).toEqual(['cards']);
    });
  });

  describe('accessibility', () => {
    it('sets aria-expanded on the filter toggle button', () => {
      const w = factory({ showFilters: false });
      const filterBtn = w.find('button[title="Filters"]');
      expect(filterBtn.attributes('aria-expanded')).toBe('false');
    });

    it('sets aria-expanded=true when filters are visible', () => {
      const w = factory({ showFilters: true });
      const filterBtn = w.find('button[title="Filters"]');
      expect(filterBtn.attributes('aria-expanded')).toBe('true');
    });

    it('sets aria-label on each view mode button', () => {
      const w = factory();
      const viewBtns = w.findAll('button').filter((b) => b.attributes('title')?.endsWith('view'));
      expect(viewBtns[0].attributes('aria-label')).toBe('Table view');
      expect(viewBtns[1].attributes('aria-label')).toBe('Cards view');
      expect(viewBtns[2].attributes('aria-label')).toBe('List view');
    });
  });

  describe('filter panel', () => {
    it('shows filter slot content when showFilters is true', () => {
      const w = factory(
        { showFilters: true },
        { filters: '<span class="filter-item">Status</span>' },
      );
      expect(w.find('.filter-item').exists()).toBe(true);
    });

    it('hides filter slot content when showFilters is false', () => {
      const w = factory(
        { showFilters: false },
        { filters: '<span class="filter-item">Status</span>' },
      );
      expect(w.find('.filter-item').exists()).toBe(false);
    });
  });

  describe('slots', () => {
    it('renders extra-buttons slot', () => {
      const w = factory({}, { 'extra-buttons': '<button class="extra-btn">Extra</button>' });
      expect(w.find('.extra-btn').exists()).toBe(true);
    });

    it('renders left slot', () => {
      const w = factory({}, { left: '<span class="left-content">Left</span>' });
      expect(w.find('.left-content').exists()).toBe(true);
    });
  });
});
