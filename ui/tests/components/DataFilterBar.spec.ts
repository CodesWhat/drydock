import { mount } from '@vue/test-utils';
import DataFilterBar from '@/components/DataFilterBar.vue';
import { tooltip as tooltipDirective } from '@/directives/tooltip';

function factory(props: Record<string, any> = {}, slots: Record<string, any> = {}) {
  return mount(DataFilterBar, {
    props: {
      filteredCount: 5,
      totalCount: 10,
      showFilters: false,
      ...props,
    },
    slots,
    global: {
      stubs: {
        AppIcon: { template: '<span class="app-icon-stub" />' },
        AppIconButton: {
          props: ['icon', 'variant', 'tooltip', 'ariaLabel', 'size'],
          template:
            '<button class="app-icon-button-stub" :data-icon="icon" :data-variant="variant" :data-size="size" :aria-label="ariaLabel"><slot /></button>',
        },
      },
      directives: { tooltip: {} },
    },
  });
}

function factoryWithTooltip(props: Record<string, any> = {}, slots: Record<string, any> = {}) {
  return mount(DataFilterBar, {
    props: {
      filteredCount: 5,
      totalCount: 10,
      showFilters: false,
      ...props,
    },
    slots,
    global: {
      stubs: {
        AppIcon: { template: '<span class="app-icon-stub" />' },
        AppIconButton: {
          props: ['icon', 'variant', 'tooltip', 'ariaLabel', 'size'],
          template:
            '<button class="app-icon-button-stub" v-tooltip="tooltip" :data-icon="icon" :data-variant="variant" :aria-label="ariaLabel || tooltip"><slot /></button>',
        },
      },
      directives: { tooltip: tooltipDirective },
    },
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
    it('renders the filter toggle as an AppIconButton', () => {
      const w = factory();
      const filterBtn = w.find('.app-icon-button-stub[aria-label="Toggle filters"]');
      expect(filterBtn.exists()).toBe(true);
      expect(filterBtn.attributes('data-icon')).toBe('filter');
      expect(filterBtn.attributes('data-variant')).toBe('plain');
    });

    it('uses the 44px icon-button size for the filter toggle', () => {
      const w = factory();
      expect(w.get('button[aria-label="Toggle filters"]').attributes('data-size')).toBe('sm');
    });

    it('renders filter button when hideFilter is not set', () => {
      const w = factory();
      const filterBtn = w.find('button[aria-label="Toggle filters"]');
      expect(filterBtn.exists()).toBe(true);
    });

    it('hides filter button when hideFilter is true', () => {
      const w = factory({ hideFilter: true });
      expect(w.find('button[aria-label="Toggle filters"]').exists()).toBe(false);
    });

    it('emits update:showFilters toggled value on click', async () => {
      const w = factory({ showFilters: false });
      await w.find('button[aria-label="Toggle filters"]').trigger('click');
      expect(w.emitted('update:showFilters')?.[0]).toEqual([true]);
    });

    it('emits false when showFilters is currently true', async () => {
      const w = factory({ showFilters: true });
      await w.find('button[aria-label="Toggle filters"]').trigger('click');
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
    function viewModeButtons(wrapper: ReturnType<typeof factory>) {
      return wrapper
        .findAll('button')
        .filter((button) => button.attributes('aria-label')?.endsWith('view'));
    }

    it('renders no view mode switcher when modelValue is undefined', () => {
      const w = factory();
      expect(viewModeButtons(w)).toHaveLength(0);
      expect(w.find('[role="group"][aria-label="View mode"]').exists()).toBe(false);
    });

    it('hides the view mode switcher when hideViewToggle is true even with modelValue bound', () => {
      const w = factory({ modelValue: 'table', hideViewToggle: true });

      expect(viewModeButtons(w)).toHaveLength(0);
      expect(w.find('[role="group"][aria-label="View mode"]').exists()).toBe(false);
    });

    it('renders default table/cards view mode buttons when modelValue is provided', () => {
      const w = factory({ modelValue: 'table' });
      const buttons = viewModeButtons(w);

      expect(buttons).toHaveLength(2);
      expect(buttons[0].attributes('aria-label')).toBe('Table view');
      expect(buttons[0].attributes('aria-pressed')).toBe('true');
      expect(buttons[0].attributes('data-icon')).toBe('table');
      expect(buttons[1].attributes('aria-label')).toBe('Cards view');
      expect(buttons[1].attributes('aria-pressed')).toBe('false');
      expect(buttons[1].attributes('data-icon')).toBe('grid');
    });

    it('uses the 44px icon-button size for each view mode', () => {
      const w = factory({ modelValue: 'table' });

      expect(viewModeButtons(w).map((button) => button.attributes('data-size'))).toEqual([
        'sm',
        'sm',
      ]);
    });

    it('renders custom view modes when provided', () => {
      const customModes = [
        { id: 'table', icon: 'table' },
        { id: 'cards', icon: 'grid' },
      ];
      const w = factory({ modelValue: 'cards', viewModes: customModes });
      const buttons = viewModeButtons(w);

      expect(buttons).toHaveLength(2);
      expect(buttons[0].attributes('aria-label')).toBe('Table view');
      expect(buttons[1].attributes('aria-label')).toBe('Cards view');
      expect(buttons[1].attributes('aria-pressed')).toBe('true');
    });

    it('emits update:modelValue when a view mode is clicked', async () => {
      const w = factory({ modelValue: 'table' });
      const cardBtn = viewModeButtons(w).find(
        (button) => button.attributes('aria-label') === 'Cards view',
      );
      expect(cardBtn).toBeDefined();

      await cardBtn?.trigger('click');

      expect(w.emitted('update:modelValue')?.[0]).toEqual(['cards']);
    });
  });

  describe('accessibility', () => {
    it('sets aria-expanded on the filter toggle button', () => {
      const w = factory({ showFilters: false });
      const filterBtn = w.find('button[aria-label="Toggle filters"]');
      expect(filterBtn.attributes('aria-expanded')).toBe('false');
    });

    it('sets aria-expanded=true when filters are visible', () => {
      const w = factory({ showFilters: true });
      const filterBtn = w.find('button[aria-label="Toggle filters"]');
      expect(filterBtn.attributes('aria-expanded')).toBe('true');
    });

    it('sets aria-label on each view mode button', () => {
      const w = factory({ modelValue: 'table' });
      const viewBtns = w
        .findAll('button')
        .filter((button) => button.attributes('aria-label')?.endsWith('view'));

      expect(viewBtns.map((button) => button.attributes('aria-label'))).toEqual([
        'Table view',
        'Cards view',
      ]);
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

    it('renders center slot', () => {
      const w = factory({}, { center: '<button class="center-content">Scan Now</button>' });
      expect(w.find('.center-content').exists()).toBe(true);
    });

    it('renders the sort slot in the right-side toolbar controls', () => {
      const w = factory({}, { sort: '<span data-test="sort-slot">Sort control</span>' });

      expect(w.find('[data-test="sort-slot"]').exists()).toBe(true);
      expect(w.text()).toContain('Sort control');
    });
  });

  describe('themed tooltips', () => {
    function getTooltipPopup(): HTMLElement | null {
      return document.body.querySelector('.dd-tooltip-popup');
    }

    afterEach(() => {
      document.body.querySelectorAll('.dd-tooltip-popup').forEach((el) => el.remove());
    });

    it('shows Filters tooltip when the filter control has an active badge', async () => {
      const w = factoryWithTooltip({ activeFilterCount: 2 });
      const filterButton = w.find('button[aria-label="Toggle filters"]');
      const filterControl = filterButton.element.parentElement as HTMLElement | null;
      expect(filterControl).not.toBeNull();
      filterControl?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      const tip = getTooltipPopup();
      expect(tip).not.toBeNull();
      expect(tip!.textContent).toBe('Filters');
      filterControl?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
      expect(getTooltipPopup()).toBeNull();
      w.unmount();
    });

    it('shows tooltip for view mode icon buttons', async () => {
      const w = factoryWithTooltip({ modelValue: 'table' });
      const cardsButton = w
        .findAll('button')
        .find((button) => button.attributes('aria-label') === 'Cards view');
      expect(cardsButton).toBeDefined();

      await cardsButton?.trigger('mouseenter');
      const tip = getTooltipPopup();
      expect(tip).not.toBeNull();
      expect(tip!.textContent).toBe('Cards view');

      await cardsButton?.trigger('mouseleave');
      expect(getTooltipPopup()).toBeNull();
      w.unmount();
    });
  });
});
