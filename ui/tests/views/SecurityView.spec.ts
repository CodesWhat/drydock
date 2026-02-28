import { defineComponent, nextTick } from 'vue';

const mockGetAllContainers = vi.fn();
const mockScanContainer = vi.fn();
const mockGetContainerSbom = vi.fn();
const mockGetSecurityRuntime = vi.fn();

vi.mock('@/services/container', () => ({
  getAllContainers: (...args: any[]) => mockGetAllContainers(...args),
  scanContainer: (...args: any[]) => mockScanContainer(...args),
  getContainerSbom: (...args: any[]) => mockGetContainerSbom(...args),
}));

vi.mock('@/services/server', () => ({
  getSecurityRuntime: (...args: any[]) => mockGetSecurityRuntime(...args),
}));

vi.mock('@/composables/useBreakpoints', () => ({
  useBreakpoints: () => ({ isMobile: { value: false }, windowNarrow: { value: false } }),
}));

import { mount } from '@vue/test-utils';
import { clearIconCache, updateSettings } from '@/services/settings';
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
    props: [
      'modelValue',
      'showFilters',
      'filteredCount',
      'totalCount',
      'activeFilterCount',
      'countLabel',
    ],
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
    template:
      '<div class="detail-panel"><slot name="header" /><slot name="subtitle" /><slot /></div>',
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
  RouterLink: defineComponent({
    props: ['to'],
    template: '<a><slot /></a>',
  }),
};

function factory() {
  return mount(SecurityView, { global: { stubs }, shallow: false });
}

function readyRuntimeStatus() {
  return {
    checkedAt: '2026-02-23T00:00:00.000Z',
    ready: true,
    scanner: {
      enabled: true,
      command: 'trivy',
      commandAvailable: true,
      status: 'ready',
      message: 'Trivy client is ready',
      scanner: 'trivy',
      server: '',
    },
    signature: {
      enabled: false,
      command: '',
      commandAvailable: null,
      status: 'disabled',
      message: 'Signature verification is disabled',
    },
    sbom: {
      enabled: false,
      formats: [],
    },
    requirements: [],
  };
}

describe('SecurityView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSecurityRuntime.mockResolvedValue(readyRuntimeStatus());
  });

  describe('data loading', () => {
    it('loads security runtime status on mount', async () => {
      mockGetAllContainers.mockResolvedValue([makeContainer()]);
      const w = factory();
      await vi.waitFor(() => {
        expect(mockGetSecurityRuntime).toHaveBeenCalledOnce();
      });
      await nextTick();
      expect(w.text()).toContain('Vulnerability scanner is ready');
    });

    it('shows runtime checkedAt and latest scannedAt timestamps', async () => {
      mockGetAllContainers.mockResolvedValue([
        makeContainer({
          name: 'nginx',
          displayName: 'nginx',
          security: {
            scan: {
              scannedAt: '2026-02-24T10:00:00.000Z',
              vulnerabilities: [
                { id: 'CVE-1', severity: 'HIGH', packageName: 'openssl', fixedVersion: '3.0.1' },
              ],
            },
          },
        }),
        makeContainer({
          name: 'redis',
          displayName: 'redis',
          security: {
            scan: {
              scannedAt: '2026-02-25T11:30:00.000Z',
              vulnerabilities: [
                { id: 'CVE-2', severity: 'LOW', packageName: 'zlib', fixedVersion: null },
              ],
            },
          },
        }),
      ]);
      const w = factory();
      await vi.waitFor(() => expect(mockGetSecurityRuntime).toHaveBeenCalledOnce());
      await vi.waitFor(() => expect(mockGetAllContainers).toHaveBeenCalledOnce());
      await nextTick();

      expect(w.text()).toContain('Runtime checked');
      expect(w.text()).toContain('2026-02-23');
      expect(w.text()).toContain('Latest scan');
      expect(w.text()).toContain('2026-02-25');
    });

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

    it('renders vulnerability title, target, and reference URL in detail view', async () => {
      mockGetAllContainers.mockResolvedValue([
        makeContainer({
          id: 'container-1',
          displayName: 'nginx',
          security: {
            scan: {
              vulnerabilities: [
                {
                  id: 'CVE-2026-9999',
                  severity: 'CRITICAL',
                  packageName: 'openssl',
                  installedVersion: '3.0.0',
                  fixedVersion: '3.0.10',
                  title: 'OpenSSL buffer overflow',
                  target: 'usr/lib/libcrypto.so',
                  primaryUrl: 'https://avd.aquasec.com/nvd/cve-2026-9999',
                },
              ],
            },
          },
        }),
      ]);

      const w = factory();
      await vi.waitFor(() => expect(mockGetAllContainers).toHaveBeenCalledOnce());
      await nextTick();

      const vm = w.vm as any;
      vm.openDetail(vm.filteredSummaries[0]);
      await nextTick();

      expect(w.text()).toContain('OpenSSL buffer overflow');
      expect(w.text()).toContain('usr/lib/libcrypto.so');
      expect(w.find('a[href="https://avd.aquasec.com/nvd/cve-2026-9999"]').exists()).toBe(true);
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

    it('loads sbom and shows view/download controls for the selected image', async () => {
      mockGetAllContainers.mockResolvedValue([
        makeContainer({ id: 'container-1', displayName: 'nginx' }),
      ]);
      mockGetContainerSbom.mockResolvedValue({
        format: 'spdx-json',
        generatedAt: '2026-02-28T09:00:00.000Z',
        document: { spdxVersion: 'SPDX-2.3' },
      });

      const w = factory();
      await vi.waitFor(() => expect(mockGetAllContainers).toHaveBeenCalledOnce());
      await nextTick();

      const vm = w.vm as any;
      vm.openDetail(vm.filteredSummaries[0]);

      await vi.waitFor(() => {
        expect(mockGetContainerSbom).toHaveBeenCalledWith('container-1', 'spdx-json');
      });

      expect(w.text()).toContain('View SBOM');
      expect(w.text()).toContain('Download SBOM');
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
              vulnerabilities: [{ id: 'CVE-1', severity: 'LOW', packageName: 'a' }],
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
              vulnerabilities: [{ id: 'CVE-1', severity: 'LOW', packageName: 'a' }],
            },
          },
        }),
        makeContainer({
          name: 'redis',
          displayName: 'redis',
          security: {
            scan: {
              vulnerabilities: [{ id: 'CVE-2', severity: 'CRITICAL', packageName: 'b' }],
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

  describe('settings service coverage guard', () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    it('falls back to HTTP status when updateSettings error body has no error field', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: vi.fn().mockResolvedValue({}),
      } as any);

      await expect(updateSettings({ internetlessMode: true })).rejects.toThrow('HTTP 502');
    });

    it('falls back to HTTP status when clearIconCache error body has no error field', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: vi.fn().mockResolvedValue({}),
      } as any);

      await expect(clearIconCache()).rejects.toThrow('HTTP 503');
    });

    it('falls back to Unknown error when clearIconCache error body is not JSON', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValue(new Error('not json')),
      } as any);

      await expect(clearIconCache()).rejects.toThrow('Unknown error');
    });
  });
});
