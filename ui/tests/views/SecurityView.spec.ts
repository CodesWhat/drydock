import { defineComponent, nextTick } from 'vue';

const mockGetAllContainers = vi.fn();
const mockScanContainer = vi.fn();

vi.mock('@/services/container', () => ({
  getAllContainers: (...args: any[]) => mockGetAllContainers(...args),
  scanContainer: (...args: any[]) => mockScanContainer(...args),
}));

vi.mock('@/composables/useBreakpoints', () => ({
  useBreakpoints: () => ({ isMobile: { value: false }, windowNarrow: { value: false } }),
}));

import { mount } from '@vue/test-utils';
import SecurityView from '@/views/SecurityView.vue';

function makeContainer(overrides: Record<string, any> = {}) {
  return {
    name: 'nginx',
    displayName: 'nginx-web',
    security: {
      scan: {
        vulnerabilities: [
          {
            id: 'CVE-2024-0001',
            severity: 'HIGH',
            packageName: 'libssl',
            installedVersion: '1.1.1',
            fixedVersion: '1.1.2',
            publishedDate: '2024-01-15',
          },
        ],
      },
    },
    ...overrides,
  };
}

const stubs: Record<string, any> = {
  DataViewLayout: defineComponent({
    template: '<div class="dvl"><slot /><slot name="panel" /></div>',
  }),
  DataFilterBar: defineComponent({
    props: ['modelValue', 'showFilters', 'filteredCount', 'totalCount', 'activeFilterCount', 'countLabel'],
    emits: ['update:modelValue', 'update:showFilters'],
    template: '<div class="dfb"><slot name="filters" /><slot name="left" /></div>',
  }),
  DataTable: defineComponent({
    props: ['columns', 'rows', 'rowKey', 'sortKey', 'sortAsc', 'selectedKey'],
    emits: ['update:sortKey', 'update:sortAsc', 'row-click'],
    template: '<div class="dt" :data-rows="rows.length"><slot name="empty" /></div>',
  }),
  DataCardGrid: defineComponent({
    props: ['items', 'itemKey', 'minWidth', 'selectedKey'],
    emits: ['item-click'],
    template: '<div class="dcg" :data-items="items.length" />',
  }),
  DataListAccordion: defineComponent({
    props: ['items', 'itemKey', 'selectedKey'],
    emits: ['item-click'],
    template: '<div class="dla" :data-items="items.length" />',
  }),
  DetailPanel: defineComponent({
    props: ['open', 'isMobile', 'showSizeControls', 'showFullPage'],
    emits: ['update:open'],
    template: '<div class="detail-panel" />',
  }),
  EmptyState: defineComponent({
    props: ['icon', 'message', 'showClear'],
    emits: ['clear'],
    template: '<div class="empty" />',
  }),
  AppIcon: defineComponent({
    props: ['name', 'size'],
    template: '<span class="app-icon-stub" />',
  }),
};

function factory() {
  return mount(SecurityView, { global: { stubs }, shallow: false });
}

describe('SecurityView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('data loading', () => {
    it('fetches containers on mount and groups vulnerabilities by image', async () => {
      mockGetAllContainers.mockResolvedValue([makeContainer()]);
      const w = factory();
      await vi.waitFor(() => {
        expect(mockGetAllContainers).toHaveBeenCalledOnce();
      });
      await nextTick();
      // One image with vulnerabilities = one row in the table
      const dt = w.find('.dt');
      expect(dt.attributes('data-rows')).toBe('1');
    });

    it('skips containers without security scan data', async () => {
      mockGetAllContainers.mockResolvedValue([
        makeContainer(),
        makeContainer({ name: 'redis', displayName: 'redis', security: null }),
      ]);
      const w = factory();
      await vi.waitFor(() => expect(mockGetAllContainers).toHaveBeenCalled());
      await nextTick();
      // Only one image has vulns
      expect(w.find('.dt').attributes('data-rows')).toBe('1');
    });

    it('normalizes severity to uppercase', async () => {
      mockGetAllContainers.mockResolvedValue([
        makeContainer({
          security: {
            scan: {
              vulnerabilities: [{ id: 'CVE-1', severity: 'critical', packageName: 'pkg' }],
            },
          },
        }),
      ]);
      const w = factory();
      await vi.waitFor(() => expect(mockGetAllContainers).toHaveBeenCalled());
      await nextTick();
      const vm = w.vm as any;
      // Image summaries should have the critical count
      expect(vm.filteredSummaries[0].critical).toBe(1);
    });

    it('uses fallback package name from package field', async () => {
      mockGetAllContainers.mockResolvedValue([
        makeContainer({
          security: {
            scan: {
              vulnerabilities: [{ id: 'CVE-1', severity: 'LOW', package: 'curl' }],
            },
          },
        }),
      ]);
      const w = factory();
      await vi.waitFor(() => expect(mockGetAllContainers).toHaveBeenCalled());
      await nextTick();
      const vm = w.vm as any;
      // The vulnerability within the image summary should have the package name
      expect(vm.filteredSummaries[0].vulns[0].package).toBe('curl');
    });

    it('groups multiple containers into separate image summaries', async () => {
      mockGetAllContainers.mockResolvedValue([
        makeContainer({ name: 'nginx', displayName: 'nginx' }),
        makeContainer({
          name: 'redis',
          displayName: 'redis',
          security: {
            scan: {
              vulnerabilities: [{ id: 'CVE-2', severity: 'CRITICAL', packageName: 'libc' }],
            },
          },
        }),
      ]);
      const w = factory();
      await vi.waitFor(() => expect(mockGetAllContainers).toHaveBeenCalled());
      await nextTick();
      expect(w.find('.dt').attributes('data-rows')).toBe('2');
    });
  });

  describe('filtering', () => {
    const twoImageContainers = [
      makeContainer({
        name: 'nginx',
        displayName: 'nginx',
        security: {
          scan: {
            vulnerabilities: [
              { id: 'CVE-1', severity: 'CRITICAL', packageName: 'openssl', fixedVersion: '3.0.1' },
            ],
          },
        },
      }),
      makeContainer({
        name: 'redis',
        displayName: 'redis',
        security: {
          scan: {
            vulnerabilities: [
              { id: 'CVE-2', severity: 'LOW', packageName: 'zlib', fixedVersion: null },
            ],
          },
        },
      }),
    ];

    it('filters by severity', async () => {
      mockGetAllContainers.mockResolvedValue(twoImageContainers);
      const w = factory();
      await vi.waitFor(() => expect(mockGetAllContainers).toHaveBeenCalled());
      await nextTick();

      // Both images visible initially
      expect(w.find('.dt').attributes('data-rows')).toBe('2');

      // Filter to CRITICAL only — only nginx image has CRITICAL vulns
      const vm = w.vm as any;
      vm.secFilterSeverity = 'CRITICAL';
      await nextTick();
      expect(w.find('.dt').attributes('data-rows')).toBe('1');
    });

    it('filters by fix available', async () => {
      mockGetAllContainers.mockResolvedValue(twoImageContainers);
      const w = factory();
      await vi.waitFor(() => expect(mockGetAllContainers).toHaveBeenCalled());
      await nextTick();

      const vm = w.vm as any;
      vm.secFilterFix = 'yes';
      await nextTick();
      // Only nginx has fixable vulns
      expect(w.find('.dt').attributes('data-rows')).toBe('1');

      vm.secFilterFix = 'no';
      await nextTick();
      // Only redis has unfixable vulns
      expect(w.find('.dt').attributes('data-rows')).toBe('1');
    });
  });

  describe('sorting', () => {
    it('sorts image summaries by sort field', async () => {
      mockGetAllContainers.mockResolvedValue([
        makeContainer({
          name: 'nginx',
          displayName: 'nginx',
          security: {
            scan: {
              vulnerabilities: [
                { id: 'CVE-1', severity: 'LOW', packageName: 'a' },
              ],
            },
          },
        }),
        makeContainer({
          name: 'redis',
          displayName: 'redis',
          security: {
            scan: {
              vulnerabilities: [
                { id: 'CVE-2', severity: 'CRITICAL', packageName: 'b' },
                { id: 'CVE-3', severity: 'CRITICAL', packageName: 'c' },
              ],
            },
          },
        }),
      ]);
      const w = factory();
      await vi.waitFor(() => expect(mockGetAllContainers).toHaveBeenCalled());
      await nextTick();

      const vm = w.vm as any;
      // Default sort is by critical count descending
      expect(vm.filteredSummaries[0].image).toBe('redis');
      expect(vm.filteredSummaries[1].image).toBe('nginx');
    });

    it('reverses sort when sortAsc is toggled', async () => {
      mockGetAllContainers.mockResolvedValue([
        makeContainer({
          name: 'nginx',
          displayName: 'nginx',
          security: {
            scan: {
              vulnerabilities: [
                { id: 'CVE-1', severity: 'LOW', packageName: 'a' },
              ],
            },
          },
        }),
        makeContainer({
          name: 'redis',
          displayName: 'redis',
          security: {
            scan: {
              vulnerabilities: [
                { id: 'CVE-2', severity: 'CRITICAL', packageName: 'b' },
              ],
            },
          },
        }),
      ]);
      const w = factory();
      await vi.waitFor(() => expect(mockGetAllContainers).toHaveBeenCalled());
      await nextTick();

      const vm = w.vm as any;
      vm.securitySortAsc = true;
      await nextTick();

      // Ascending: nginx (0 critical) first, redis (1 critical) second
      expect(vm.filteredSummaries[0].image).toBe('nginx');
    });
  });

  describe('image summary counts', () => {
    it('counts severity levels per image', async () => {
      mockGetAllContainers.mockResolvedValue([
        makeContainer({
          security: {
            scan: {
              vulnerabilities: [
                { id: 'CVE-1', severity: 'CRITICAL', packageName: 'a' },
                { id: 'CVE-2', severity: 'HIGH', packageName: 'b' },
                { id: 'CVE-3', severity: 'MEDIUM', packageName: 'c' },
                { id: 'CVE-4', severity: 'LOW', packageName: 'd' },
              ],
            },
          },
        }),
      ]);
      const w = factory();
      await vi.waitFor(() => expect(mockGetAllContainers).toHaveBeenCalled());
      await nextTick();

      const vm = w.vm as any;
      const summary = vm.filteredSummaries[0];
      expect(summary.critical).toBe(1);
      expect(summary.high).toBe(1);
      expect(summary.medium).toBe(1);
      expect(summary.low).toBe(1);
      expect(summary.total).toBe(4);
    });

    it('counts fixable vulnerabilities', async () => {
      mockGetAllContainers.mockResolvedValue([
        makeContainer({
          security: {
            scan: {
              vulnerabilities: [
                { id: 'CVE-1', severity: 'HIGH', packageName: 'a', fixedVersion: '2.0' },
                { id: 'CVE-2', severity: 'LOW', packageName: 'b', fixedVersion: null },
              ],
            },
          },
        }),
      ]);
      const w = factory();
      await vi.waitFor(() => expect(mockGetAllContainers).toHaveBeenCalled());
      await nextTick();

      const vm = w.vm as any;
      expect(vm.filteredSummaries[0].fixable).toBe(1);
    });
  });

  describe('empty state', () => {
    it('shows DataTable empty slot when no vulns match filters', async () => {
      mockGetAllContainers.mockResolvedValue([]);
      const w = factory();
      await vi.waitFor(() => expect(mockGetAllContainers).toHaveBeenCalled());
      await nextTick();

      expect(w.find('.dt').attributes('data-rows')).toBe('0');
    });
  });
});
