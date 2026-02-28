import { flushPromises } from '@vue/test-utils';
import { defineComponent } from 'vue';
import AuditView from '@/views/AuditView.vue';
import { getAuditLog } from '@/services/audit';
import { mountWithPlugins } from '../helpers/mount';

const { mockRoute } = vi.hoisted(() => ({
  mockRoute: { query: {} as Record<string, unknown> },
}));

vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
}));

vi.mock('@/services/audit', () => ({
  getAuditLog: vi.fn(),
}));

vi.mock('@/composables/useBreakpoints', () => ({
  useBreakpoints: () => ({
    isMobile: { value: false },
  }),
}));

const stubs: Record<string, any> = {
  DataViewLayout: defineComponent({
    template: '<div class="data-view-layout"><slot /><slot name="panel" /></div>',
  }),
  DataFilterBar: defineComponent({
    props: ['modelValue', 'showFilters', 'filteredCount', 'totalCount', 'activeFilterCount'],
    emits: ['update:modelValue', 'update:showFilters'],
    template: `
      <div class="data-filter-bar">
        <button class="mode-table" @click="$emit('update:modelValue', 'table')">Table</button>
        <button class="mode-cards" @click="$emit('update:modelValue', 'cards')">Cards</button>
        <button class="mode-list" @click="$emit('update:modelValue', 'list')">List</button>
        <slot name="filters" />
      </div>
    `,
  }),
  DataTable: defineComponent({
    props: ['columns', 'rows', 'rowKey', 'activeRow'],
    emits: ['row-click'],
    template: `
      <div class="data-table" :data-row-count="rows.length" :data-active-row="activeRow || ''">
        <button v-if="rows[0]" class="row-click-first" @click="$emit('row-click', rows[0])">Open 1</button>
        <button v-if="rows[1]" class="row-click-second" @click="$emit('row-click', rows[1])">Open 2</button>
      </div>
    `,
  }),
  DataCardGrid: defineComponent({
    props: ['items', 'itemKey', 'selectedKey'],
    emits: ['item-click'],
    template: `
      <div class="data-card-grid" :data-item-count="items.length">
        <button v-if="items[0]" class="card-click-first" @click="$emit('item-click', items[0])">Card 1</button>
      </div>
    `,
  }),
  DataListAccordion: defineComponent({
    props: ['items', 'itemKey', 'selectedKey'],
    emits: ['item-click'],
    template: `
      <div class="data-list-accordion" :data-item-count="items.length">
        <button v-if="items[0]" class="list-click-first" @click="$emit('item-click', items[0])">List 1</button>
      </div>
    `,
  }),
  DetailPanel: defineComponent({
    props: ['open', 'isMobile', 'showSizeControls', 'showFullPage'],
    emits: ['update:open'],
    template: `
      <div class="detail-panel" :data-open="String(open)">
        <button class="close-detail" @click="$emit('update:open', false)">Close</button>
        <div class="detail-header"><slot name="header" /></div>
        <div class="detail-subtitle"><slot name="subtitle" /></div>
        <div class="detail-content"><slot /></div>
      </div>
    `,
  }),
  EmptyState: defineComponent({
    props: ['icon', 'message', 'showClear'],
    emits: ['clear'],
    template: `
      <div class="empty-state">
        <span>{{ message }}</span>
        <button v-if="showClear" class="clear-empty" @click="$emit('clear')">Clear</button>
      </div>
    `,
  }),
};

const mockGetAuditLog = getAuditLog as ReturnType<typeof vi.fn>;

function makeEntry(overrides: Record<string, any> = {}) {
  return {
    id: 'e1',
    timestamp: '2026-01-10T11:22:33.000Z',
    action: 'update-applied',
    containerName: 'nginx',
    containerImage: 'nginx:1.0',
    fromVersion: '1.0.0',
    toVersion: '1.1.0',
    triggerName: 'nightly',
    status: 'success',
    details: 'upgrade complete',
    ...overrides,
  };
}

async function mountAuditView() {
  const wrapper = mountWithPlugins(AuditView, {
    global: { stubs },
  });
  await flushPromises();
  return wrapper;
}

function findButtonByIcon(wrapper: any, icon: string) {
  return wrapper.findAll('button').find((button: any) =>
    button.find(`.app-icon-stub[data-icon="${icon}"]`).exists(),
  );
}

describe('AuditView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoute.query = {};
    mockGetAuditLog.mockResolvedValue({ entries: [], total: 0, page: 1, limit: 50 });
  });

  describe('routing', () => {
    it('loads using route query values for view, page, action, and search', async () => {
      mockRoute.query = {
        view: 'cards',
        page: '2',
        action: 'update-failed',
        q: 'redis',
      };
      mockGetAuditLog.mockResolvedValue({
        entries: [
          makeEntry({ id: 'e1', action: 'update-failed', containerName: 'redis-main' }),
          makeEntry({ id: 'e2', action: 'update-failed', containerName: 'nginx' }),
        ],
        total: 120,
      });

      const wrapper = await mountAuditView();

      expect(mockGetAuditLog).toHaveBeenCalledWith({
        page: 2,
        limit: 50,
        action: 'update-failed',
      });
      expect(wrapper.find('.data-card-grid').exists()).toBe(true);
      expect(wrapper.find('.data-card-grid').attributes('data-item-count')).toBe('1');
      expect((wrapper.find('input').element as HTMLInputElement).value).toBe('redis');
      expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('update-failed');
    });

    it('falls back to safe defaults for invalid query values', async () => {
      mockRoute.query = {
        view: 'timeline',
        page: 'not-a-number',
        action: 'unknown-action',
      };
      mockGetAuditLog.mockResolvedValue({ entries: [makeEntry()], total: 1 });

      const wrapper = await mountAuditView();

      expect(mockGetAuditLog).toHaveBeenCalledWith({
        page: 1,
        limit: 50,
      });
      expect(wrapper.find('.data-table').exists()).toBe(true);
      expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('');
    });

    it('accepts security-alert as a valid action filter from route query', async () => {
      mockRoute.query = {
        action: 'security-alert',
      };
      mockGetAuditLog.mockResolvedValue({
        entries: [makeEntry({ action: 'security-alert', status: 'error' })],
        total: 1,
      });

      const wrapper = await mountAuditView();

      expect(mockGetAuditLog).toHaveBeenCalledWith({
        page: 1,
        limit: 50,
        action: 'security-alert',
      });
      expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('security-alert');
    });

    it('accepts container-update as a valid action filter from route query', async () => {
      mockRoute.query = {
        action: 'container-update',
      };
      mockGetAuditLog.mockResolvedValue({
        entries: [makeEntry({ action: 'container-update' })],
        total: 1,
      });

      const wrapper = await mountAuditView();

      expect(mockGetAuditLog).toHaveBeenCalledWith({
        page: 1,
        limit: 50,
        action: 'container-update',
      });
      expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('container-update');
    });

    it('loads using route query date range filters', async () => {
      mockRoute.query = {
        from: '2026-01-01',
        to: '2026-01-31',
      };
      mockGetAuditLog.mockResolvedValue({
        entries: [makeEntry()],
        total: 1,
      });

      const wrapper = await mountAuditView();

      expect(mockGetAuditLog).toHaveBeenCalledWith({
        page: 1,
        limit: 50,
        from: '2026-01-01',
        to: '2026-01-31',
      });
      expect((wrapper.find('input[name="from-date"]').element as HTMLInputElement).value).toBe(
        '2026-01-01',
      );
      expect((wrapper.find('input[name="to-date"]').element as HTMLInputElement).value).toBe(
        '2026-01-31',
      );
    });

    it('loads using route query container filter', async () => {
      mockRoute.query = {
        container: 'redis-main',
      };
      mockGetAuditLog.mockResolvedValue({
        entries: [makeEntry({ containerName: 'redis-main' })],
        total: 1,
      });

      const wrapper = await mountAuditView();

      expect(mockGetAuditLog).toHaveBeenCalledWith({
        page: 1,
        limit: 50,
        container: 'redis-main',
      });
      expect(
        (wrapper.find('input[name="container-name"]').element as HTMLInputElement).value,
      ).toBe('redis-main');
    });
  });

  describe('filtering', () => {
    it('filters table rows by search query', async () => {
      mockGetAuditLog.mockResolvedValue({
        entries: [
          makeEntry({ id: 'e1', containerName: 'nginx-prod', action: 'update-applied' }),
          makeEntry({
            id: 'e2',
            containerName: 'redis-cache',
            action: 'update-failed',
            details: 'connection timeout',
            status: 'error',
          }),
        ],
        total: 2,
      });
      const wrapper = await mountAuditView();

      expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('2');

      await wrapper.find('input').setValue('redis');
      await flushPromises();
      expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('1');

      await wrapper.find('input').setValue('timeout');
      await flushPromises();
      expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('1');
    });

    it('refetches data when action filter changes', async () => {
      mockGetAuditLog.mockResolvedValue({
        entries: [makeEntry()],
        total: 1,
      });
      const wrapper = await mountAuditView();

      await wrapper.find('select').setValue('update-failed');
      await flushPromises();

      expect(mockGetAuditLog).toHaveBeenCalledTimes(2);
      expect(mockGetAuditLog).toHaveBeenLastCalledWith({
        page: 1,
        limit: 50,
        action: 'update-failed',
      });
    });

    it('refetches data when date range filters change', async () => {
      mockGetAuditLog.mockResolvedValue({
        entries: [makeEntry()],
        total: 1,
      });
      const wrapper = await mountAuditView();

      const fromInput = wrapper.find('input[name="from-date"]');
      const toInput = wrapper.find('input[name="to-date"]');
      expect(fromInput.exists()).toBe(true);
      expect(toInput.exists()).toBe(true);

      await fromInput.setValue('2026-01-01');
      await flushPromises();
      await toInput.setValue('2026-01-31');
      await flushPromises();

      expect(mockGetAuditLog).toHaveBeenLastCalledWith({
        page: 1,
        limit: 50,
        from: '2026-01-01',
        to: '2026-01-31',
      });
    });

    it('refetches data when container filter changes', async () => {
      mockGetAuditLog.mockResolvedValue({
        entries: [makeEntry()],
        total: 1,
      });
      const wrapper = await mountAuditView();

      const containerInput = wrapper.find('input[name="container-name"]');
      expect(containerInput.exists()).toBe(true);

      await containerInput.setValue('redis');
      await flushPromises();

      expect(mockGetAuditLog).toHaveBeenLastCalledWith({
        page: 1,
        limit: 50,
        container: 'redis',
      });
    });

    it('clears filters and resets pagination to page 1', async () => {
      mockRoute.query = { page: '2', action: 'update-failed', q: 'nginx', container: 'redis' };
      mockGetAuditLog.mockResolvedValue({
        entries: [makeEntry({ action: 'update-failed' })],
        total: 120,
      });
      const wrapper = await mountAuditView();

      const clearButton = wrapper.findAll('button').find((button) => button.text() === 'Clear');
      expect(clearButton).toBeDefined();
      await clearButton?.trigger('click');
      await flushPromises();

      expect((wrapper.find('input').element as HTMLInputElement).value).toBe('');
      expect(
        (wrapper.find('input[name="container-name"]').element as HTMLInputElement).value,
      ).toBe('');
      expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('');
      expect(mockGetAuditLog).toHaveBeenLastCalledWith({
        page: 1,
        limit: 50,
      });
    });
  });

  describe('pagination', () => {
    it('loads next and previous pages with pagination controls', async () => {
      mockGetAuditLog
        .mockResolvedValueOnce({
          entries: [makeEntry({ id: 'e1' })],
          total: 120,
        })
        .mockResolvedValueOnce({
          entries: [makeEntry({ id: 'e2', containerName: 'redis' })],
          total: 120,
        })
        .mockResolvedValueOnce({
          entries: [makeEntry({ id: 'e3', containerName: 'postgres' })],
          total: 120,
        });

      const wrapper = await mountAuditView();

      expect(wrapper.text()).toContain('Page 1 of 3 (120 entries)');

      const nextButton = findButtonByIcon(wrapper, 'chevron-right');
      expect(nextButton).toBeDefined();
      await nextButton?.trigger('click');
      await flushPromises();

      expect(mockGetAuditLog).toHaveBeenLastCalledWith({
        page: 2,
        limit: 50,
      });
      expect(wrapper.text()).toContain('Page 2 of 3 (120 entries)');

      const prevButton = findButtonByIcon(wrapper, 'chevron-left');
      expect(prevButton).toBeDefined();
      await prevButton?.trigger('click');
      await flushPromises();

      expect(mockGetAuditLog).toHaveBeenLastCalledWith({
        page: 1,
        limit: 50,
      });
      expect(wrapper.text()).toContain('Page 1 of 3 (120 entries)');
    });

    it('disables next button on the last page', async () => {
      mockRoute.query = { page: '3' };
      mockGetAuditLog.mockResolvedValue({
        entries: [makeEntry({ id: 'e3' })],
        total: 120,
      });
      const wrapper = await mountAuditView();

      const nextButton = findButtonByIcon(wrapper, 'chevron-right');
      expect(nextButton?.attributes('disabled')).toBeDefined();
    });
  });

  describe('detail panel interactions', () => {
    it('opens detail panel from table row click and clears selection on close', async () => {
      mockGetAuditLog.mockResolvedValue({
        entries: [
          makeEntry({ id: 'e1', containerName: 'nginx' }),
          makeEntry({ id: 'e2', containerName: 'redis', action: 'update-failed', status: 'error' }),
        ],
        total: 2,
      });
      const wrapper = await mountAuditView();

      await wrapper.find('.row-click-second').trigger('click');
      await flushPromises();

      expect(wrapper.find('.detail-panel').attributes('data-open')).toBe('true');
      expect(wrapper.find('.data-table').attributes('data-active-row')).toBe('e2');
      expect(wrapper.text()).toContain('redis');
      expect(wrapper.text()).toContain('Update Failed');

      await wrapper.find('.close-detail').trigger('click');
      await flushPromises();

      expect(wrapper.find('.detail-panel').attributes('data-open')).toBe('false');
      expect(wrapper.find('.data-table').attributes('data-active-row')).toBe('');
      expect(wrapper.text()).not.toContain('redis');
    });

    it('opens detail panel from cards and list interactions', async () => {
      mockGetAuditLog.mockResolvedValue({
        entries: [makeEntry({ id: 'e1', containerName: 'nginx' })],
        total: 1,
      });
      const wrapper = await mountAuditView();

      await wrapper.find('.mode-cards').trigger('click');
      await flushPromises();
      expect(wrapper.find('.data-card-grid').exists()).toBe(true);

      await wrapper.find('.card-click-first').trigger('click');
      await flushPromises();
      expect(wrapper.find('.detail-panel').attributes('data-open')).toBe('true');

      await wrapper.find('.close-detail').trigger('click');
      await flushPromises();
      expect(wrapper.find('.detail-panel').attributes('data-open')).toBe('false');

      await wrapper.find('.mode-list').trigger('click');
      await flushPromises();
      expect(wrapper.find('.data-list-accordion').exists()).toBe(true);

      await wrapper.find('.list-click-first').trigger('click');
      await flushPromises();
      expect(wrapper.find('.detail-panel').attributes('data-open')).toBe('true');
    });
  });
});
