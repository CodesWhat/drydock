import { defineComponent, nextTick } from 'vue';

const mockGetAllContainers = vi.fn();

vi.mock('@/services/container', () => ({
  getAllContainers: (...args: any[]) => mockGetAllContainers(...args),
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
  DataViewLayout: defineComponent({ template: '<div class="dvl"><slot /></div>' }),
  DataFilterBar: defineComponent({
    props: ['modelValue', 'showFilters', 'filteredCount', 'totalCount', 'activeFilterCount'],
    emits: ['update:modelValue', 'update:showFilters'],
    template: '<div class="dfb"><slot name="filters" /><slot name="extra-buttons" /></div>',
  }),
  DataTable: defineComponent({
    props: ['columns', 'rows', 'rowKey', 'sortKey', 'sortAsc'],
    emits: ['update:sortKey', 'update:sortAsc'],
    template: '<div class="dt" :data-rows="rows.length"><slot name="empty" /></div>',
  }),
  DataCardGrid: defineComponent({
    props: ['items', 'itemKey', 'minWidth'],
    template: '<div class="dcg" :data-items="items.length" />',
  }),
  DataListAccordion: defineComponent({
    props: ['items', 'itemKey'],
    template: '<div class="dla" :data-items="items.length" />',
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
    it('fetches containers on mount and extracts vulnerabilities', async () => {
      mockGetAllContainers.mockResolvedValue([makeContainer()]);
      const w = factory();
      await vi.waitFor(() => {
        expect(mockGetAllContainers).toHaveBeenCalledOnce();
      });
      await nextTick();
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
      expect(vm.filteredSecurityVulns[0].severity).toBe('CRITICAL');
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
      expect(vm.filteredSecurityVulns[0].package).toBe('curl');
    });
  });

  describe('filtering', () => {
    const twoVulnContainer = makeContainer({
      security: {
        scan: {
          vulnerabilities: [
            { id: 'CVE-1', severity: 'CRITICAL', packageName: 'openssl', fixedVersion: '3.0.1' },
            { id: 'CVE-2', severity: 'LOW', packageName: 'zlib', fixedVersion: null },
          ],
        },
      },
    });

    it('filters by severity', async () => {
      mockGetAllContainers.mockResolvedValue([twoVulnContainer]);
      const w = factory();
      await vi.waitFor(() => expect(mockGetAllContainers).toHaveBeenCalled());
      await nextTick();

      // Both visible initially
      expect(w.find('.dt').attributes('data-rows')).toBe('2');

      // Filter to CRITICAL only via internal ref
      const vm = w.vm as any;
      vm.secFilterSeverity = 'CRITICAL';
      await nextTick();
      expect(w.find('.dt').attributes('data-rows')).toBe('1');
    });

    it('filters by fix available', async () => {
      mockGetAllContainers.mockResolvedValue([twoVulnContainer]);
      const w = factory();
      await vi.waitFor(() => expect(mockGetAllContainers).toHaveBeenCalled());
      await nextTick();

      const vm = w.vm as any;
      vm.secFilterFix = 'yes';
      await nextTick();
      expect(w.find('.dt').attributes('data-rows')).toBe('1');

      vm.secFilterFix = 'no';
      await nextTick();
      expect(w.find('.dt').attributes('data-rows')).toBe('1');
    });
  });

  describe('sorting', () => {
    it('sorts by custom severity order (CRITICAL < HIGH < MEDIUM < LOW)', async () => {
      mockGetAllContainers.mockResolvedValue([
        makeContainer({
          security: {
            scan: {
              vulnerabilities: [
                { id: 'CVE-LOW', severity: 'LOW', packageName: 'a' },
                { id: 'CVE-CRIT', severity: 'CRITICAL', packageName: 'b' },
                { id: 'CVE-MED', severity: 'MEDIUM', packageName: 'c' },
              ],
            },
          },
        }),
      ]);
      const w = factory();
      await vi.waitFor(() => expect(mockGetAllContainers).toHaveBeenCalled());
      await nextTick();

      const vm = w.vm as any;
      expect(vm.filteredSecurityVulns.map((r: any) => r.severity)).toEqual([
        'CRITICAL',
        'MEDIUM',
        'LOW',
      ]);
    });

    it('reverses sort when sortAsc is false', async () => {
      mockGetAllContainers.mockResolvedValue([
        makeContainer({
          security: {
            scan: {
              vulnerabilities: [
                { id: 'CVE-LOW', severity: 'LOW', packageName: 'a' },
                { id: 'CVE-CRIT', severity: 'CRITICAL', packageName: 'b' },
              ],
            },
          },
        }),
      ]);
      const w = factory();
      await vi.waitFor(() => expect(mockGetAllContainers).toHaveBeenCalled());
      await nextTick();

      const vm = w.vm as any;
      vm.securitySortAsc = false;
      await nextTick();

      expect(vm.filteredSecurityVulns[0].severity).toBe('LOW');
    });
  });

  describe('column visibility', () => {
    it('starts with all columns visible', async () => {
      mockGetAllContainers.mockResolvedValue([]);
      const w = factory();
      await vi.waitFor(() => expect(mockGetAllContainers).toHaveBeenCalled());
      await nextTick();

      const vm = w.vm as any;
      expect(vm.secVisibleColumns.size).toBe(6);
    });

    it('can toggle non-required columns', async () => {
      mockGetAllContainers.mockResolvedValue([]);
      const w = factory();
      await vi.waitFor(() => expect(mockGetAllContainers).toHaveBeenCalled());
      await nextTick();

      const vm = w.vm as any;
      vm.toggleSecColumn('package');
      expect(vm.secVisibleColumns.has('package')).toBe(false);

      vm.toggleSecColumn('package');
      expect(vm.secVisibleColumns.has('package')).toBe(true);
    });

    it('cannot toggle required columns', async () => {
      mockGetAllContainers.mockResolvedValue([]);
      const w = factory();
      await vi.waitFor(() => expect(mockGetAllContainers).toHaveBeenCalled());
      await nextTick();

      const vm = w.vm as any;
      vm.toggleSecColumn('severity');
      expect(vm.secVisibleColumns.has('severity')).toBe(true);
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
