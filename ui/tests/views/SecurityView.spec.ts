import { flushPromises } from '@vue/test-utils';
import { computed, defineComponent, nextTick, ref } from 'vue';

const mockGetSecurityVulnerabilityOverview = vi.fn();
const mockScanContainer = vi.fn();
const mockGetContainerSbom = vi.fn();
const mockGetSecurityRuntime = vi.fn();
const mockGetAllContainers = vi.fn();
const mockRouterPush = vi.fn().mockResolvedValue(undefined);
// Real refs (not plain `{ value }` objects) — the component's template uses bare
// `isCompact`/`isMobile` (no `.value`) in several `v-if`/prop bindings, which only
// auto-unwraps for genuine Vue refs. A plain object would be constant-truthy there.
const mockIsMobile = ref(false);
const mockWindowNarrow = ref(false);
const mockUpdateMode = ref<'notify' | 'manual' | 'auto'>('manual');
const { mockComputeSecurityDelta, mockToSafeExternalUrl } = vi.hoisted(() => ({
  mockComputeSecurityDelta: vi.fn(),
  mockToSafeExternalUrl: vi.fn(),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

vi.mock('@/services/container', () => ({
  getSecurityVulnerabilityOverview: (...args: any[]) =>
    mockGetSecurityVulnerabilityOverview(...args),
  scanContainer: (...args: any[]) => mockScanContainer(...args),
  getContainerSbom: (...args: any[]) => mockGetContainerSbom(...args),
  getAllContainers: (...args: any[]) => mockGetAllContainers(...args),
}));

vi.mock('@/services/server', () => ({
  getSecurityRuntime: (...args: any[]) => mockGetSecurityRuntime(...args),
}));

vi.mock('@/composables/useBreakpoints', () => ({
  useBreakpoints: () => ({ isMobile: mockIsMobile, windowNarrow: mockWindowNarrow }),
}));

vi.mock('@/composables/useUpdateMode', () => ({
  useUpdateMode: () => ({ updateMode: mockUpdateMode }),
}));

vi.mock('@/utils/container-mapper', async () => {
  const actual = await vi.importActual<typeof import('@/utils/container-mapper')>(
    '@/utils/container-mapper',
  );
  mockComputeSecurityDelta.mockImplementation(actual.computeSecurityDelta);
  return {
    ...actual,
    computeSecurityDelta: mockComputeSecurityDelta,
    mapApiContainers: (containers: any[]) => containers,
  };
});

vi.mock('@/views/security/securityViewUtils', async () => {
  const actual = await vi.importActual<typeof import('@/views/security/securityViewUtils')>(
    '@/views/security/securityViewUtils',
  );
  return {
    ...actual,
    toSafeExternalUrl: (...args: Parameters<typeof actual.toSafeExternalUrl>) => {
      mockToSafeExternalUrl(...args);
      return actual.toSafeExternalUrl(...args);
    },
  };
});

import { mount } from '@vue/test-utils';
import { VIEW_TABLE_COLUMN_KEYS } from '@/preferences/schema';
import { preferences, resetPreferences } from '@/preferences/store';
import { clearIconCache, updateSettings } from '@/services/settings';
import SecurityView from '@/views/SecurityView.vue';

let containerIdCounter = 0;
function makeContainer(overrides: Record<string, any> = {}) {
  containerIdCounter += 1;
  return {
    id: overrides.id ?? `container-${containerIdCounter}`,
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
    template:
      '<div class="dfb"><slot name="extra-buttons" /><slot name="filters" /><slot name="left" /><slot name="center" /></div>',
  }),
  DataTableColumnPicker: defineComponent({
    props: ['columns', 'hiddenKeys'],
    emits: ['toggle', 'reset'],
    template: `
      <div data-test="data-table-column-picker">
        <button
          v-for="column in columns"
          :key="column.key"
          type="button"
          :data-test="'column-picker-toggle-' + column.key"
          @click="$emit('toggle', column.key)">
          {{ column.label }}
        </button>
        <button type="button" data-test="data-table-column-picker-reset" @click="$emit('reset')">
          Reset
        </button>
      </div>
    `,
  }),
  AppIconButton: defineComponent({
    inheritAttrs: false,
    props: ['icon', 'size', 'variant', 'tooltip', 'ariaLabel', 'disabled', 'loading'],
    template:
      '<button class="app-icon-button-stub" v-bind="$attrs" :data-icon="icon" :data-size="size" :data-variant="variant" :data-loading="String(loading)" :aria-label="ariaLabel" :disabled="disabled"><slot /></button>',
  }),
  DataTable: defineComponent({
    props: ['columns', 'rows', 'rowKey', 'sortKey', 'sortAsc', 'selectedKey', 'hiddenColumnKeys'],
    emits: ['update:sortKey', 'update:sortAsc', 'row-click'],
    template: `
      <div class="dt" :data-rows="rows.length" :data-hidden-keys="JSON.stringify(hiddenColumnKeys || [])">
        <div
          v-for="col in (columns || []).filter((c) => !(hiddenColumnKeys || []).includes(c.key))"
          :key="col.key"
          class="dt-header"
          :data-col-key="col.key">
          {{ col.label }}
        </div>
        <slot name="empty" />
      </div>
    `,
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
  SecurityEmptyState: defineComponent({
    props: [
      'hasVulnerabilityData',
      'scannerSetupNeeded',
      'scannerMessage',
      'activeFilterCount',
      'scanDisabledReason',
      'scanning',
      'runtimeLoading',
      'scannerReady',
      'scanProgress',
      'boxed',
    ],
    emits: ['clear-filters', 'scan-now'],
    template: '<div class="security-empty-state-stub" />',
  }),
  AppIcon: defineComponent({
    props: ['name', 'size'],
    template: '<span class="app-icon-stub" />',
  }),
  AppButton: defineComponent({
    inheritAttrs: false,
    props: ['size', 'variant', 'disabled'],
    emits: ['click'],
    template:
      '<button class="app-button-stub" v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  }),
  AppBadge: defineComponent({
    props: ['tone', 'size', 'custom'],
    template: '<span class="app-badge-stub"><slot /></span>',
  }),
  RouterLink: defineComponent({
    props: ['to'],
    template: '<a><slot /></a>',
  }),
};

const securityCardFilterBarStub = defineComponent({
  props: [
    'modelValue',
    'showFilters',
    'filteredCount',
    'totalCount',
    'activeFilterCount',
    'countLabel',
    'hideViewToggle',
  ],
  emits: ['update:modelValue', 'update:showFilters'],
  template: `
    <div
      class="dfb security-card-filter"
      :data-mode="modelValue"
      :data-hide-view-toggle="String(hideViewToggle)">
      <button class="mode-table" @click="$emit('update:modelValue', 'table')">table</button>
      <button class="mode-cards" @click="$emit('update:modelValue', 'cards')">cards</button>
      <slot name="sort" />
      <slot name="extra-buttons" />
      <slot name="filters" />
      <slot name="left" />
      <slot name="center" />
    </div>
  `,
});

const securityDataSortControlStub = defineComponent({
  props: ['columns', 'sortKey', 'sortAsc'],
  emits: ['update:sortKey', 'update:sortAsc'],
  template: `
    <div
      class="security-sort-control"
      :data-columns="columns.map((column) => column.key).join(',')"
      :data-sort-key="sortKey"
      :data-sort-asc="String(sortAsc)">
      <button class="sort-by-high" @click="$emit('update:sortKey', 'high')">Sort high</button>
      <button class="sort-asc" @click="$emit('update:sortAsc', true)">Asc</button>
    </div>
  `,
});

function makeSecurityCardDataTableStub(extraRows: any[] = []) {
  return defineComponent({
    props: [
      'columns',
      'rows',
      'rowKey',
      'sortKey',
      'sortAsc',
      'selectedKey',
      'hiddenColumnKeys',
      'preferCards',
      'hoistCardSort',
    ],
    emits: ['update:sortKey', 'update:sortAsc', 'row-click', 'update:cardReflowForced'],
    setup(props) {
      const renderedRows = computed(() => [...((props.rows as any[]) || []), ...extraRows]);
      return { renderedRows };
    },
    template: `
      <div
        class="dt security-card-table"
        :data-rows="rows?.length ?? 0"
        :data-sort-key="sortKey"
        :data-sort-asc="String(sortAsc)"
        :data-prefer-cards="String(preferCards)"
        :data-hoist-card-sort="String(hoistCardSort)"
        :data-hidden-keys="JSON.stringify(hiddenColumnKeys || [])">
        <button class="force-card-reflow" @click="$emit('update:cardReflowForced', true)">
          Force cards
        </button>
        <button class="clear-card-reflow" @click="$emit('update:cardReflowForced', false)">
          Clear cards
        </button>
        <article
          v-for="row in renderedRows"
          :key="row[rowKey || 'image']"
          class="security-card"
          :data-card-id="row[rowKey || 'image']"
          @click="$emit('row-click', row)">
          <slot name="card" :row="row" />
        </article>
        <slot name="empty" v-if="!rows || rows.length === 0" />
      </div>
    `,
  });
}

const releaseNotesLinkStub = defineComponent({
  inheritAttrs: false,
  props: ['releaseNotes', 'currentReleaseNotes', 'releaseLink', 'iconOnly', 'iconSize'],
  template: '<a class="release-notes-link-stub" v-bind="$attrs">Release notes</a>',
});

const projectLinkStub = defineComponent({
  inheritAttrs: false,
  props: ['sourceRepo', 'iconOnly', 'iconSize'],
  template: '<a class="project-link-stub" v-bind="$attrs">{{ sourceRepo }}</a>',
});

const containerLinkActionsStub = defineComponent({
  inheritAttrs: false,
  props: [
    'sourceRepo',
    'releaseNotes',
    'currentReleaseNotes',
    'releaseLink',
    'containerId',
    'fromTag',
    'toTag',
    'registry',
    'registryName',
    'registryUrl',
    'iconSize',
  ],
  template: `
    <div
      data-test="container-link-actions-stub"
      :data-source-repo="sourceRepo"
      :data-container-id="containerId"
      :data-from-tag="fromTag"
      :data-to-tag="toTag"
      :data-registry="registry"
      :data-registry-name="registryName"
      :data-registry-url="registryUrl"
      :data-icon-size="iconSize"
      v-bind="$attrs">
      <button type="button" data-link-action="source" @click.stop>Source</button>
      <button type="button" data-link-action="release" @click.stop>Release notes</button>
      <button type="button" data-link-action="registry" @click.stop>Registry</button>
    </div>
  `,
});

const securityLinkTableStub = defineComponent({
  props: ['rows', 'rowKey'],
  emits: ['row-click'],
  template: `
    <div data-test="security-link-table-stub">
      <div
        v-for="row in rows"
        :key="row[rowKey || 'image']"
        class="security-link-table-row"
        @click="$emit('row-click', row)">
        <slot name="cell-image" :row="row" />
      </div>
    </div>
  `,
});

const securityCardAppButtonStub = defineComponent({
  inheritAttrs: false,
  props: ['size', 'variant', 'disabled'],
  emits: ['click'],
  template:
    '<button class="app-button-stub" v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>',
});

const containerUpdateDialogStub = defineComponent({
  props: ['containerId'],
  template: '<div v-if="containerId" data-test="container-update-dialog-stub" />',
});

function securityCardStubs(extraRows: any[] = []) {
  return {
    DataFilterBar: securityCardFilterBarStub,
    DataSortControl: securityDataSortControlStub,
    DataTable: makeSecurityCardDataTableStub(extraRows),
    ReleaseNotesLink: releaseNotesLinkStub,
    ProjectLink: projectLinkStub,
    ContainerLinkActions: containerLinkActionsStub,
    AppButton: securityCardAppButtonStub,
    ContainerUpdateDialog: containerUpdateDialogStub,
  };
}

function factory(extraStubs: Record<string, any> = {}) {
  return mount(SecurityView, { global: { stubs: { ...stubs, ...extraStubs } }, shallow: false });
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

function normalizeSeverityCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  return Math.floor(value);
}

function chooseLatestTimestamp(current: string | null, candidate: unknown): string | null {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return current;
  }
  if (current === null) {
    return candidate;
  }
  return candidate > current ? candidate : current;
}

function mockContainers(containers: any[]) {
  const images = new Map<string, any>();
  let scannedContainers = 0;
  let latestScannedAt: string | null = null;

  for (const container of containers) {
    const scan = container.security?.scan;
    if (!scan) continue;
    scannedContainers += 1;
    latestScannedAt = chooseLatestTimestamp(latestScannedAt, scan.scannedAt);

    const imageName = container.displayName || container.name || 'unknown';
    const entry = images.get(imageName) || {
      image: imageName,
      containerIds: [],
      vulnerabilities: [],
    };

    if (
      typeof container.id === 'string' &&
      container.id.length > 0 &&
      !entry.containerIds.includes(container.id)
    ) {
      entry.containerIds.push(container.id);
    }

    const updateSummary = container.security?.updateScan?.summary;
    if (updateSummary) {
      entry.updateSummary = {
        unknown: normalizeSeverityCount(updateSummary.unknown),
        low: normalizeSeverityCount(updateSummary.low),
        medium: normalizeSeverityCount(updateSummary.medium),
        high: normalizeSeverityCount(updateSummary.high),
        critical: normalizeSeverityCount(updateSummary.critical),
      };
    }

    const vulnList = Array.isArray(scan.vulnerabilities) ? scan.vulnerabilities : [];
    for (const vulnerability of vulnList) {
      entry.vulnerabilities.push({
        id: vulnerability.id ?? 'unknown',
        severity: vulnerability.severity ?? 'UNKNOWN',
        package: vulnerability.packageName ?? vulnerability.package ?? 'unknown',
        version: vulnerability.installedVersion ?? vulnerability.version ?? '',
        fixedIn: vulnerability.fixedVersion ?? vulnerability.fixedIn ?? null,
        title: vulnerability.title ?? vulnerability.Title ?? '',
        target: vulnerability.target ?? vulnerability.Target ?? '',
        primaryUrl: vulnerability.primaryUrl ?? vulnerability.PrimaryURL ?? '',
        publishedDate: vulnerability.publishedDate ?? '',
      });
    }

    images.set(imageName, entry);
  }

  mockGetSecurityVulnerabilityOverview.mockResolvedValue({
    totalContainers: containers.length,
    scannedContainers,
    latestScannedAt,
    images: [...images.values()],
  });
}

describe('SecurityView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPreferences();
    containerIdCounter = 0;
    mockIsMobile.value = false;
    mockWindowNarrow.value = false;
    mockUpdateMode.value = 'manual';
    mockGetSecurityRuntime.mockResolvedValue(readyRuntimeStatus());
    mockGetAllContainers.mockResolvedValue([]);
    mockRouterPush.mockResolvedValue(undefined);
  });

  describe('tableColumns (card-mode annotations)', () => {
    it('flags critical with cardPriority in the wide (non-compact) column set', async () => {
      mockWindowNarrow.value = false;
      const w = factory();
      await flushPromises();
      const vm = w.vm as any;
      const criticalCol = vm.tableColumns.find((c: any) => c.key === 'critical');
      expect(criticalCol?.cardPriority).toBe(5);
    });

    it('always returns the full 7-column set, even when compact (severity columns are hidden via hiddenColumnKeys, not dropped from tableColumns)', async () => {
      mockWindowNarrow.value = true;
      const w = factory();
      await flushPromises();
      const vm = w.vm as any;
      const criticalCol = vm.tableColumns.find((c: any) => c.key === 'critical');
      expect(criticalCol).toBeDefined();
      expect(criticalCol?.cardPriority).toBe(5);
      expect(vm.tableColumns).toHaveLength(7);
    });
  });

  describe('column picker', () => {
    it('tableColumns keys match VIEW_TABLE_COLUMN_KEYS.security (schema/view sync guard)', async () => {
      const w = factory();
      await flushPromises();
      const vm = w.vm as any;
      const keys = new Set(vm.tableColumns.map((c: any) => c.key));
      expect(keys).toEqual(new Set(VIEW_TABLE_COLUMN_KEYS.security));
    });

    it('marks the image column as required', async () => {
      const w = factory();
      await flushPromises();
      const vm = w.vm as any;
      const imageCol = vm.tableColumns.find((c: any) => c.key === 'image');
      expect(imageCol.required).toBe(true);
    });

    it('renders the picker and passes only the picker-hidden set to DataTable when not compact', async () => {
      mockWindowNarrow.value = false;
      mockContainers([makeContainer()]);
      const w = factory();
      await flushPromises();

      expect(w.find('[data-test="data-table-column-picker"]').exists()).toBe(true);
      await w.find('[data-test="column-picker-toggle-fixable"]').trigger('click');
      await nextTick();

      const hiddenKeys = JSON.parse(w.find('.dt').attributes('data-hidden-keys') ?? '[]');
      expect(hiddenKeys).toEqual(['fixable']);
    });

    it('hides the picker and unions the picker-hidden set with the compact-forced-hidden columns when compact', async () => {
      mockWindowNarrow.value = true;
      mockContainers([makeContainer()]);
      const w = factory();
      await flushPromises();

      expect(w.find('[data-test="data-table-column-picker"]').exists()).toBe(false);
      const hiddenKeys = JSON.parse(w.find('.dt').attributes('data-hidden-keys') ?? '[]');
      expect([...hiddenKeys].sort()).toEqual(
        ['critical', 'fixable', 'high', 'low', 'medium'].sort(),
      );
    });

    it('toggling a column via the picker removes its header from the table', async () => {
      mockWindowNarrow.value = false;
      mockContainers([makeContainer()]);
      const w = factory();
      await flushPromises();

      expect(w.find('[data-col-key="critical"]').exists()).toBe(true);
      await w.find('[data-test="column-picker-toggle-critical"]').trigger('click');
      await nextTick();

      expect(w.find('[data-col-key="critical"]').exists()).toBe(false);
    });

    it('toggling a column via the picker persists the key to preferences.views.security.hiddenColumns', async () => {
      mockWindowNarrow.value = false;
      mockContainers([makeContainer()]);
      const w = factory();
      await flushPromises();

      await w.find('[data-test="column-picker-toggle-critical"]').trigger('click');
      await nextTick();

      expect(preferences.views.security.hiddenColumns).toContain('critical');
    });
  });

  describe('data loading', () => {
    it('loads security runtime status on mount', async () => {
      mockContainers([makeContainer()]);
      const w = factory();
      await vi.waitFor(() => {
        expect(mockGetSecurityRuntime).toHaveBeenCalledOnce();
      });
      await nextTick();
      const vm = w.vm as any;
      expect(vm.runtimeStatus?.scanner?.message).toBe('Trivy client is ready');
      expect(vm.scanDisabledReason).toBe('Scan all containers for vulnerabilities');
    });

    it('shows runtime checkedAt and latest scannedAt timestamps', async () => {
      mockContainers([
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
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalledOnce());
      await flushPromises();

      const vm = w.vm as any;
      expect(vm.runtimeStatus?.checkedAt).toBe('2026-02-23T00:00:00.000Z');
      expect(vm.latestSecurityScanAt).toBe('2026-02-25T11:30:00.000Z');
    });

    it('fetches containers on mount and groups vulnerabilities by image', async () => {
      mockContainers([makeContainer()]);
      const w = factory();
      await vi.waitFor(() => {
        expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalledOnce();
      });
      await flushPromises();
      // One image with vulnerabilities = one row in the table
      const dt = w.find('.dt');
      expect(dt.attributes('data-rows')).toBe('1');
    });

    it('refetches vulnerability data when the SSE connection is re-established', async () => {
      vi.useFakeTimers();
      try {
        mockContainers([makeContainer()]);
        const w = factory();
        await vi.waitFor(() => {
          expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalledOnce();
        });
        await flushPromises();
        const callsBeforeReconnect = mockGetSecurityVulnerabilityOverview.mock.calls.length;

        globalThis.dispatchEvent(new CustomEvent('dd:sse-connected'));
        await flushPromises();
        expect(mockGetSecurityVulnerabilityOverview.mock.calls.length).toBe(callsBeforeReconnect);

        vi.advanceTimersByTime(800);
        await flushPromises();
        expect(mockGetSecurityVulnerabilityOverview.mock.calls.length).toBeGreaterThan(
          callsBeforeReconnect,
        );
        w.unmount();
      } finally {
        vi.useRealTimers();
      }
    });

    it('refetches containers AND vulnerabilities when the SSE connection is re-established', async () => {
      vi.useFakeTimers();
      try {
        mockContainers([makeContainer()]);
        const w = factory();
        await vi.waitFor(() => {
          expect(mockGetAllContainers).toHaveBeenCalledOnce();
        });
        await flushPromises();
        const containerCallsBeforeReconnect = mockGetAllContainers.mock.calls.length;

        globalThis.dispatchEvent(new CustomEvent('dd:sse-connected'));
        vi.advanceTimersByTime(800);
        await flushPromises();

        expect(mockGetAllContainers.mock.calls.length).toBeGreaterThan(
          containerCallsBeforeReconnect,
        );
        w.unmount();
      } finally {
        vi.useRealTimers();
      }
    });

    it('refetches containers AND vulnerabilities when resync-required SSE event fires', async () => {
      vi.useFakeTimers();
      try {
        mockContainers([makeContainer()]);
        const w = factory();
        await vi.waitFor(() => {
          expect(mockGetAllContainers).toHaveBeenCalledOnce();
        });
        await flushPromises();
        const containerCallsBeforeResync = mockGetAllContainers.mock.calls.length;
        const vulnCallsBeforeResync = mockGetSecurityVulnerabilityOverview.mock.calls.length;

        globalThis.dispatchEvent(new CustomEvent('dd:sse-resync-required'));
        vi.advanceTimersByTime(800);
        await flushPromises();

        expect(mockGetAllContainers.mock.calls.length).toBeGreaterThan(containerCallsBeforeResync);
        expect(mockGetSecurityVulnerabilityOverview.mock.calls.length).toBeGreaterThan(
          vulnCallsBeforeResync,
        );
        w.unmount();
      } finally {
        vi.useRealTimers();
      }
    });

    it('refetches container update state when a container change SSE event arrives', async () => {
      vi.useFakeTimers();
      try {
        mockContainers([makeContainer()]);
        const w = factory();
        await vi.waitFor(() => {
          expect(mockGetAllContainers).toHaveBeenCalledOnce();
        });
        await flushPromises();
        const callsBeforeEvent = mockGetAllContainers.mock.calls.length;

        globalThis.dispatchEvent(new CustomEvent('dd:sse-container-changed'));
        await flushPromises();
        expect(mockGetAllContainers.mock.calls.length).toBe(callsBeforeEvent);

        vi.advanceTimersByTime(400);
        await flushPromises();
        expect(mockGetAllContainers.mock.calls.length).toBeGreaterThan(callsBeforeEvent);
        w.unmount();
      } finally {
        vi.useRealTimers();
      }
    });

    it('skips containers without security scan data', async () => {
      mockContainers([
        makeContainer(),
        makeContainer({ name: 'redis', displayName: 'redis', security: null }),
      ]);
      const w = factory();
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalled());
      await flushPromises();
      // Only one image has vulns
      expect(w.find('.dt').attributes('data-rows')).toBe('1');
    });

    it('normalizes severity to uppercase', async () => {
      mockContainers([
        makeContainer({
          security: {
            scan: {
              vulnerabilities: [{ id: 'CVE-1', severity: 'critical', packageName: 'pkg' }],
            },
          },
        }),
      ]);
      const w = factory();
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalled());
      await flushPromises();
      const vm = w.vm as any;
      // Image summaries should have the critical count
      expect(vm.filteredSummaries[0].critical).toBe(1);
    });

    it('keeps vulnerability lists out of image summaries and uses grouped detail data', async () => {
      mockContainers([
        makeContainer({
          name: 'nginx',
          displayName: 'nginx',
          security: {
            scan: {
              vulnerabilities: [
                { id: 'CVE-1', severity: 'HIGH', packageName: 'openssl' },
                { id: 'CVE-2', severity: 'LOW', packageName: 'zlib' },
              ],
            },
          },
        }),
      ]);

      const w = factory();
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalledOnce());
      await flushPromises();

      const vm = w.vm as any;
      const summary = vm.filteredSummaries[0];
      expect(summary.vulns).toBeUndefined();

      vm.openDetail(summary);
      await nextTick();

      const grouped = vm.vulnerabilitiesByImage[summary.image];
      expect(vm.selectedImageVulns).toBe(grouped);
    });

    it('uses fallback package name from package field', async () => {
      mockContainers([
        makeContainer({
          security: {
            scan: {
              vulnerabilities: [{ id: 'CVE-1', severity: 'LOW', package: 'curl' }],
            },
          },
        }),
      ]);
      const w = factory();
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalled());
      await flushPromises();
      const vm = w.vm as any;
      const image = vm.filteredSummaries[0].image;
      expect(vm.vulnerabilitiesByImage[image][0].package).toBe('curl');
    });

    it('renders vulnerability title, target, and reference URL in detail view', async () => {
      mockContainers([
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
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalledOnce());
      await flushPromises();

      const vm = w.vm as any;
      vm.openDetail(vm.filteredSummaries[0]);
      await nextTick();

      expect(w.text()).toContain('OpenSSL buffer overflow');
      expect(w.text()).toContain('usr/lib/libcrypto.so');
      expect(w.find('a[href="https://avd.aquasec.com/nvd/cve-2026-9999"]').exists()).toBe(true);

      const vulnerabilityRow = w.find('.divide-y > div');
      const detailLines = vulnerabilityRow.findAll('.flex');
      expect(detailLines[0].classes()).toContain('items-start');
      expect(detailLines[0].classes()).not.toContain('items-center');
      expect(detailLines[1].classes()).toContain('items-start');
      expect(detailLines[1].classes()).not.toContain('items-center');
    });

    it('computes safe vulnerability URLs once per vulnerability instead of per binding', async () => {
      mockContainers([
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
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalledOnce());
      await flushPromises();

      const vm = w.vm as any;
      vm.openDetail(vm.filteredSummaries[0]);
      await flushPromises();

      expect(mockToSafeExternalUrl).toHaveBeenCalledTimes(1);
      expect(mockToSafeExternalUrl).toHaveBeenCalledWith(
        'https://avd.aquasec.com/nvd/cve-2026-9999',
      );
    });

    it('does not render vulnerability links for disallowed URL protocols', async () => {
      mockContainers([
        makeContainer({
          id: 'container-1',
          displayName: 'nginx',
          security: {
            scan: {
              vulnerabilities: [
                {
                  id: 'CVE-2026-9998',
                  severity: 'HIGH',
                  packageName: 'openssl',
                  installedVersion: '3.0.0',
                  fixedVersion: '3.0.10',
                  title: 'Unsafe reference URL',
                  primaryUrl: 'javascript:alert(1)',
                },
              ],
            },
          },
        }),
      ]);

      const w = factory();
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalledOnce());
      await flushPromises();

      const vm = w.vm as any;
      vm.openDetail(vm.filteredSummaries[0]);
      await nextTick();

      expect(w.text()).toContain('Unsafe reference URL');
      expect(w.find('a[href="javascript:alert(1)"]').exists()).toBe(false);
      expect(w.find('a').exists()).toBe(false);
    });

    it('groups multiple containers into separate image summaries', async () => {
      mockContainers([
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
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalled());
      await flushPromises();
      expect(w.find('.dt').attributes('data-rows')).toBe('2');
    });

    it('uses shared computeSecurityDelta helper when update scan summary exists', async () => {
      mockContainers([
        makeContainer({
          displayName: 'nginx-web',
          security: {
            scan: {
              vulnerabilities: [
                { id: 'CVE-1', severity: 'CRITICAL', packageName: 'openssl' },
                { id: 'CVE-2', severity: 'HIGH', packageName: 'curl' },
                { id: 'CVE-3', severity: 'LOW', packageName: 'zlib' },
              ],
            },
            updateScan: {
              summary: {
                critical: 0,
                high: 1,
                medium: 0,
                low: 1,
                unknown: 2,
              },
            },
          },
        }),
      ]);

      const w = factory();
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalledOnce());
      await flushPromises();

      const vm = w.vm as any;
      expect(vm.filteredSummaries[0].delta).toEqual({
        fixed: 1,
        new: 2,
        unchanged: 2,
        fixedCritical: 1,
        fixedHigh: 0,
        newCritical: 0,
        newHigh: 0,
      });
      expect(mockComputeSecurityDelta).toHaveBeenCalledWith(
        { critical: 1, high: 1, medium: 0, low: 1, unknown: 0 },
        { critical: 0, high: 1, medium: 0, low: 1, unknown: 2 },
      );
    });

    it('loads sbom and shows view/download controls for the selected image', async () => {
      mockContainers([makeContainer({ id: 'container-1', displayName: 'nginx' })]);
      mockGetContainerSbom.mockResolvedValue({
        format: 'spdx-json',
        generatedAt: '2026-02-28T09:00:00.000Z',
        document: { spdxVersion: 'SPDX-2.3' },
      });

      const w = factory();
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalledOnce());
      await flushPromises();

      const vm = w.vm as any;
      vm.openDetail(vm.filteredSummaries[0]);

      await vi.waitFor(() => {
        expect(mockGetContainerSbom).toHaveBeenCalledWith('container-1', 'spdx-json');
      });

      expect(w.text()).toContain('Download Report');
      expect(w.text()).toContain('Download');
    });
  });

  describe('scan action sizing', () => {
    it('renders the compact scan action as a toolbar AppIconButton', async () => {
      mockWindowNarrow.value = true;
      mockContainers([makeContainer()]);

      const wrapper = factory();
      await vi.waitFor(() => {
        expect(mockGetSecurityRuntime).toHaveBeenCalledOnce();
      });
      await nextTick();

      const scanButton = wrapper.find('.app-icon-button-stub[aria-label="Scan all containers"]');
      expect(scanButton.exists()).toBe(true);
      expect(scanButton.attributes('data-icon')).toBe('restart');
      expect(scanButton.attributes('data-size')).toBe('toolbar');
    });
  });

  describe('scan coverage display', () => {
    it('shows 0/N scanned when no containers have been scanned', async () => {
      mockContainers([makeContainer({ security: null }), makeContainer({ security: null })]);
      const w = factory();
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalled());
      await flushPromises();

      const vm = w.vm as any;
      expect(vm.displayFilteredCount).toBe(0);
      expect(vm.displayTotalCount).toBe(2);
      expect(vm.displayCountLabel).toBe('scanned');
    });

    it('shows scannedCount/totalCount scanned with no active filters', async () => {
      mockContainers([
        makeContainer({ name: 'nginx', displayName: 'nginx' }),
        makeContainer({ name: 'redis', displayName: 'redis', security: null }),
        makeContainer({
          name: 'postgres',
          displayName: 'postgres',
          security: {
            scan: {
              vulnerabilities: [
                { id: 'CVE-2', severity: 'LOW', packageName: 'zlib', fixedVersion: null },
              ],
            },
          },
        }),
      ]);
      const w = factory();
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalled());
      await flushPromises();

      const vm = w.vm as any;
      expect(vm.displayFilteredCount).toBe(2);
      expect(vm.displayTotalCount).toBe(3);
      expect(vm.displayCountLabel).toBe('scanned');
    });

    it('switches to filtered/total images when filters are active', async () => {
      mockContainers([
        makeContainer({
          name: 'nginx',
          displayName: 'nginx',
          security: {
            scan: {
              vulnerabilities: [
                {
                  id: 'CVE-1',
                  severity: 'CRITICAL',
                  packageName: 'openssl',
                  fixedVersion: '3.0.1',
                },
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
        makeContainer({ name: 'alpine', displayName: 'alpine', security: null }),
      ]);
      const w = factory();
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalled());
      await flushPromises();

      const vm = w.vm as any;
      vm.secFilterSeverity = 'CRITICAL';
      await nextTick();

      expect(vm.displayFilteredCount).toBe(1);
      expect(vm.displayTotalCount).toBe(2);
      expect(vm.displayCountLabel).toBe('images');
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
      mockContainers(twoImageContainers);
      const w = factory();
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalled());
      await flushPromises();

      // Both images visible initially
      expect(w.find('.dt').attributes('data-rows')).toBe('2');

      // Filter to CRITICAL only — only nginx image has CRITICAL vulns
      const vm = w.vm as any;
      vm.secFilterSeverity = 'CRITICAL';
      await nextTick();
      expect(w.find('.dt').attributes('data-rows')).toBe('1');
    });

    it('filters by fix available', async () => {
      mockContainers(twoImageContainers);
      const w = factory();
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalled());
      await flushPromises();

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
      mockContainers([
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
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalled());
      await flushPromises();

      const vm = w.vm as any;
      // Default sort is by critical count descending
      expect(vm.filteredSummaries[0].image).toBe('redis');
      expect(vm.filteredSummaries[1].image).toBe('nginx');
    });

    it('reverses sort when sortAsc is toggled', async () => {
      mockContainers([
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
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalled());
      await flushPromises();

      const vm = w.vm as any;
      vm.securitySortAsc = true;
      await nextTick();

      // Ascending: nginx (0 critical) first, redis (1 critical) second
      expect(vm.filteredSummaries[0].image).toBe('nginx');
    });

    it('falls back to critical sort when sort key is invalid', async () => {
      mockContainers([
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
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalled());
      await flushPromises();

      const vm = w.vm as any;
      vm.securitySortField = 'not-a-real-column';
      await nextTick();

      expect(vm.filteredSummaries[0].image).toBe('redis');
      expect(vm.filteredSummaries[1].image).toBe('nginx');
    });
  });

  describe('image summary counts', () => {
    it('counts severity levels per image', async () => {
      mockContainers([
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
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalled());
      await flushPromises();

      const vm = w.vm as any;
      const summary = vm.filteredSummaries[0];
      expect(summary.critical).toBe(1);
      expect(summary.high).toBe(1);
      expect(summary.medium).toBe(1);
      expect(summary.low).toBe(1);
      expect(summary.total).toBe(4);
    });

    it('counts fixable vulnerabilities', async () => {
      mockContainers([
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
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalled());
      await flushPromises();

      const vm = w.vm as any;
      expect(vm.filteredSummaries[0].fixable).toBe(1);
    });
  });

  describe('empty state', () => {
    it('shows DataTable empty slot when no vulns match filters', async () => {
      mockContainers([]);
      const w = factory();
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalled());
      await flushPromises();

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

  describe('View update affordance', () => {
    it('sets hasUpdate on image summaries when containers with newTag are provided', async () => {
      mockContainers([
        makeContainer({
          id: 'c1',
          name: 'nginx',
          displayName: 'nginx',
          security: {
            scan: {
              vulnerabilities: [{ id: 'CVE-1', severity: 'HIGH', packageName: 'openssl' }],
            },
          },
        }),
      ]);
      mockGetAllContainers.mockResolvedValue([
        {
          id: 'c1',
          name: 'nginx',
          displayName: 'nginx',
          image: { name: 'nginx', tag: { value: '1.25' } },
          currentTag: '1.25',
          newTag: '1.26',
          status: 'running',
          registry: 'dockerhub',
          updateKind: 'patch',
          updateMaturity: null,
          bouncer: 'safe',
          server: 'Local',
        },
      ]);

      const w = factory();
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalledOnce());
      await flushPromises();

      const vm = w.vm as any;
      const summary = vm.filteredSummaries[0];
      expect(summary.hasUpdate).toBe(true);
      expect(summary.containersWithUpdate).toEqual(['c1']);
    });

    it('does not set hasUpdate when no containers have pending updates', async () => {
      mockContainers([
        makeContainer({
          id: 'c1',
          name: 'nginx',
          displayName: 'nginx',
          security: {
            scan: {
              vulnerabilities: [{ id: 'CVE-1', severity: 'HIGH', packageName: 'openssl' }],
            },
          },
        }),
      ]);
      mockGetAllContainers.mockResolvedValue([
        {
          id: 'c1',
          name: 'nginx',
          displayName: 'nginx',
          image: { name: 'nginx', tag: { value: '1.25' } },
          currentTag: '1.25',
          newTag: null,
          status: 'running',
          registry: 'dockerhub',
          updateKind: null,
          updateMaturity: null,
          bouncer: 'safe',
          server: 'Local',
        },
      ]);

      const w = factory();
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalledOnce());
      await flushPromises();

      const vm = w.vm as any;
      const summary = vm.filteredSummaries[0];
      expect(summary.hasUpdate).toBeUndefined();
    });

    it('navigateToContainerUpdate pushes to containers route with containerIds query', async () => {
      mockContainers([
        makeContainer({
          id: 'c1',
          name: 'nginx',
          displayName: 'nginx',
          security: {
            scan: {
              vulnerabilities: [{ id: 'CVE-1', severity: 'HIGH', packageName: 'openssl' }],
            },
          },
        }),
      ]);
      mockGetAllContainers.mockResolvedValue([
        {
          id: 'c1',
          name: 'nginx',
          displayName: 'nginx',
          image: { name: 'nginx', tag: { value: '1.25' } },
          newTag: '1.26',
          status: 'running',
          registry: 'dockerhub',
          updateKind: 'patch',
          updateMaturity: null,
          bouncer: 'safe',
          server: 'Local',
        },
      ]);

      const w = factory();
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalledOnce());
      await flushPromises();

      const vm = w.vm as any;
      const summary = vm.filteredSummaries[0];
      vm.navigateToContainerUpdate(summary);
      await nextTick();

      expect(mockRouterPush).toHaveBeenCalledWith({
        path: '/containers',
        query: { containerIds: 'c1' },
      });
    });

    it('does nothing when navigateToContainerUpdate called with no containersWithUpdate', async () => {
      mockContainers([makeContainer()]);
      mockGetAllContainers.mockResolvedValue([]);

      const w = factory();
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalledOnce());
      await flushPromises();

      const vm = w.vm as any;
      vm.navigateToContainerUpdate({ image: 'nginx', hasUpdate: false, containersWithUpdate: [] });
      await nextTick();

      expect(mockRouterPush).not.toHaveBeenCalled();
    });

    it('does not open the update dialog when every security update candidate is hard-blocked', async () => {
      mockContainers([
        makeContainer({
          id: 'c1',
          name: 'nginx',
          displayName: 'nginx',
          security: {
            scan: {
              vulnerabilities: [{ id: 'CVE-1', severity: 'HIGH', packageName: 'openssl' }],
            },
          },
        }),
      ]);
      mockGetAllContainers.mockResolvedValue([
        {
          id: 'c1',
          name: 'nginx',
          displayName: 'nginx',
          image: { name: 'nginx', tag: { value: '1.25' } },
          currentTag: '1.25',
          newTag: '1.26',
          status: 'running',
          registry: 'dockerhub',
          updateKind: 'patch',
          updateMaturity: null,
          bouncer: 'safe',
          server: 'Local',
          updateEligibility: {
            eligible: false,
            evaluatedAt: '2026-04-01T00:00:00.000Z',
            blockers: [
              {
                reason: 'agent-mismatch',
                severity: 'hard',
                message: 'Container belongs to another agent.',
                actionable: false,
              },
            ],
          },
        },
      ]);

      const w = factory();
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalledOnce());
      await flushPromises();

      const vm = w.vm as any;
      const summary = vm.filteredSummaries[0];
      expect(vm.isSummaryUpdateBlocked(summary)).toBe(true);

      vm.openUpdateAction(summary);
      await nextTick();

      expect(vm.updateDialogContainerId).toBeNull();
    });

    it('hides and guards managed security updates in notify mode', async () => {
      mockUpdateMode.value = 'notify';
      mockContainers([
        makeContainer({
          id: 'c1',
          name: 'nginx',
          displayName: 'nginx',
          security: {
            scan: {
              vulnerabilities: [{ id: 'CVE-1', severity: 'HIGH', packageName: 'openssl' }],
            },
          },
        }),
      ]);
      mockGetAllContainers.mockResolvedValue([
        {
          id: 'c1',
          name: 'nginx',
          displayName: 'nginx',
          image: { name: 'nginx', tag: { value: '1.25' } },
          currentTag: '1.25',
          newTag: '1.26',
          status: 'running',
          registry: 'dockerhub',
          updateKind: 'patch',
          updateMaturity: null,
          bouncer: 'safe',
          server: 'Local',
        },
      ]);

      const w = factory(securityCardStubs());
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalledOnce());
      await flushPromises();

      const vm = w.vm as any;
      const summary = vm.filteredSummaries[0];
      expect(w.find('[data-test="security-card-update-btn"]').exists()).toBe(false);

      vm.openUpdateAction(summary);
      const choice = vm.resolveContainerChoices(summary)[0];
      vm.openUpdateFromChooser(choice);
      await nextTick();

      expect(vm.updateDialogContainerId).toBeNull();
    });

    it('marks hard-blocked security chooser entries and only opens unblocked entries', async () => {
      mockContainers([
        makeContainer({
          id: 'c1',
          name: 'app-1',
          displayName: 'app',
          security: { scan: { vulnerabilities: [{ id: 'CVE-1', severity: 'HIGH' }] } },
        }),
        makeContainer({
          id: 'c2',
          name: 'app-2',
          displayName: 'app',
          security: { scan: { vulnerabilities: [{ id: 'CVE-2', severity: 'HIGH' }] } },
        }),
      ]);
      mockGetAllContainers.mockResolvedValue([
        {
          id: 'c1',
          name: 'app-1',
          displayName: 'app',
          image: { name: 'app', tag: { value: '1.0' } },
          currentTag: '1.0',
          newTag: '2.0',
          status: 'running',
          registry: 'dockerhub',
          updateKind: 'major',
          updateMaturity: null,
          bouncer: 'safe',
          server: 'Local',
          updateEligibility: {
            eligible: false,
            evaluatedAt: '2026-04-01T00:00:00.000Z',
            blockers: [
              {
                reason: 'last-update-rolled-back',
                severity: 'hard',
                message: 'Last update attempt rolled back.',
                actionable: true,
              },
            ],
          },
        },
        {
          id: 'c2',
          name: 'app-2',
          displayName: 'app',
          image: { name: 'app', tag: { value: '1.0' } },
          currentTag: '1.0',
          newTag: '2.0',
          status: 'running',
          registry: 'dockerhub',
          updateKind: 'major',
          updateMaturity: null,
          bouncer: 'safe',
          server: 'Local',
        },
      ]);

      const w = factory();
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalledOnce());
      await flushPromises();

      const vm = w.vm as any;
      const summary = vm.filteredSummaries[0];
      const choices = vm.resolveContainerChoices(summary);
      expect(choices[0].blocked).toBe(true);
      expect(choices[1].blocked).toBe(false);

      vm.openUpdateAction(summary);
      await nextTick();
      vm.openUpdateFromChooser(choices[0]);
      expect(vm.updateDialogContainerId).toBeNull();

      vm.openUpdateFromChooser(choices[1]);
      expect(vm.updateDialogContainerId).toBe('c2');
    });

    it('propagates releaseNotes and releaseLink from updating container onto the image summary', async () => {
      mockContainers([
        makeContainer({
          id: 'c1',
          name: 'nginx',
          displayName: 'nginx',
          security: {
            scan: {
              vulnerabilities: [{ id: 'CVE-1', severity: 'HIGH', packageName: 'openssl' }],
            },
          },
        }),
      ]);
      mockGetAllContainers.mockResolvedValue([
        {
          id: 'c1',
          name: 'nginx',
          displayName: 'nginx',
          image: { name: 'nginx', tag: { value: '1.25' } },
          newTag: '1.26',
          status: 'running',
          registry: 'dockerhub',
          updateKind: 'minor',
          updateMaturity: null,
          bouncer: 'safe',
          server: 'Local',
          releaseLink: 'https://github.com/nginx/nginx/releases',
          releaseNotes: {
            title: 'v1.26.0',
            body: 'Security and bug fixes',
            url: 'https://github.com/nginx/nginx/releases/tag/v1.26.0',
            publishedAt: '2026-04-01T00:00:00Z',
            provider: 'github',
          },
        },
      ]);

      const w = factory();
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalledOnce());
      await flushPromises();

      const vm = w.vm as any;
      const summary = vm.filteredSummaries[0];
      expect(summary.releaseNotes).toEqual({
        title: 'v1.26.0',
        body: 'Security and bug fixes',
        url: 'https://github.com/nginx/nginx/releases/tag/v1.26.0',
        publishedAt: '2026-04-01T00:00:00Z',
        provider: 'github',
      });
      expect(summary.releaseLink).toBe('https://github.com/nginx/nginx/releases');
    });

    it('populates sourceRepo and currentReleaseNotes on summaries for no-update containers', async () => {
      mockContainers([
        makeContainer({
          id: 'c1',
          name: 'nginx',
          displayName: 'nginx',
          security: {
            scan: {
              vulnerabilities: [{ id: 'CVE-1', severity: 'HIGH', packageName: 'openssl' }],
            },
          },
        }),
      ]);
      mockGetAllContainers.mockResolvedValue([
        {
          id: 'c1',
          name: 'nginx',
          displayName: 'nginx',
          image: { name: 'nginx', tag: { value: '1.25' } },
          newTag: null,
          status: 'running',
          registry: 'dockerhub',
          updateKind: null,
          updateMaturity: null,
          bouncer: 'safe',
          server: 'Local',
          sourceRepo: 'github.com/nginx/nginx',
          currentReleaseNotes: {
            title: 'v1.25.0',
            body: 'Current notes',
            url: 'https://github.com/nginx/nginx/releases/tag/v1.25.0',
            publishedAt: '2025-12-01T00:00:00Z',
            provider: 'github',
          },
        },
      ]);

      const w = factory();
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalledOnce());
      await flushPromises();

      const vm = w.vm as any;
      const summary = vm.filteredSummaries[0];
      expect(summary.hasUpdate).toBeUndefined();
      expect(summary.sourceRepo).toBe('github.com/nginx/nginx');
      expect(summary.currentReleaseNotes?.title).toBe('v1.25.0');
    });

    it('detail panel shows release notes and project link but not update button for no-update image', async () => {
      mockContainers([
        makeContainer({
          id: 'c1',
          name: 'nginx',
          displayName: 'nginx',
          security: {
            scan: {
              vulnerabilities: [{ id: 'CVE-1', severity: 'HIGH', packageName: 'openssl' }],
            },
          },
        }),
      ]);
      mockGetAllContainers.mockResolvedValue([
        {
          id: 'c1',
          name: 'nginx',
          displayName: 'nginx',
          image: { name: 'nginx', tag: { value: '1.25' } },
          newTag: null,
          status: 'running',
          registry: 'dockerhub',
          updateKind: null,
          updateMaturity: null,
          bouncer: 'safe',
          server: 'Local',
          sourceRepo: 'github.com/nginx/nginx',
          currentReleaseNotes: {
            title: 'v1.25.0',
            body: 'Current notes',
            url: 'https://github.com/nginx/nginx/releases/tag/v1.25.0',
            publishedAt: '2025-12-01T00:00:00Z',
            provider: 'github',
          },
        },
      ]);

      const w = factory();
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalledOnce());
      await flushPromises();

      const vm = w.vm as any;
      vm.openDetail(vm.filteredSummaries[0]);
      await nextTick();
      await flushPromises();

      expect(w.find('[data-test="security-detail-update-btn"]').exists()).toBe(false);
      const resources = w.get('[data-test="container-quick-links"]');
      expect(resources.find('[data-test="project-link"]').exists()).toBe(true);
      expect(resources.find('[data-test="current-release-notes-link"]').exists()).toBe(true);
      expect(resources.find('[data-test="registry-link"]').exists()).toBe(true);
      expect(resources.findAll('[data-size="sm"]')).toHaveLength(3);
    });

    it('navigateToContainerUpdate joins multiple container IDs with comma', async () => {
      mockContainers([
        makeContainer({
          id: 'c1',
          name: 'app-1',
          displayName: 'app',
          security: {
            scan: {
              vulnerabilities: [{ id: 'CVE-1', severity: 'CRITICAL', packageName: 'pkg' }],
            },
          },
        }),
        makeContainer({
          id: 'c2',
          name: 'app-2',
          displayName: 'app',
          security: {
            scan: {
              vulnerabilities: [{ id: 'CVE-2', severity: 'HIGH', packageName: 'pkg2' }],
            },
          },
        }),
      ]);
      mockGetAllContainers.mockResolvedValue([
        {
          id: 'c1',
          name: 'app-1',
          displayName: 'app',
          image: { name: 'app', tag: { value: '1.0' } },
          newTag: '2.0',
          status: 'running',
          registry: 'dockerhub',
          updateKind: 'major',
          updateMaturity: null,
          bouncer: 'safe',
          server: 'Local',
        },
        {
          id: 'c2',
          name: 'app-2',
          displayName: 'app',
          image: { name: 'app', tag: { value: '1.0' } },
          newTag: '2.0',
          status: 'running',
          registry: 'dockerhub',
          updateKind: 'major',
          updateMaturity: null,
          bouncer: 'safe',
          server: 'Local',
        },
      ]);

      const w = factory();
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalledOnce());
      await flushPromises();

      const vm = w.vm as any;
      const summary = vm.filteredSummaries[0];
      vm.navigateToContainerUpdate(summary);
      await nextTick();

      expect(mockRouterPush).toHaveBeenCalledWith({
        path: '/containers',
        query: { containerIds: 'c1,c2' },
      });
    });
  });

  describe('resource link actions', () => {
    it('forwards table-row resources to one 44px cluster without triggering the row action', async () => {
      preferences.views.security.mode = 'table';
      mockContainers([makeContainer({ id: 'c1', name: 'nginx', displayName: 'nginx' })]);
      mockGetAllContainers.mockResolvedValue([
        {
          id: 'c1',
          name: 'nginx',
          displayName: 'nginx',
          image: { name: 'nginx', tag: { value: '1.25' } },
          newTag: '1.26',
          currentTag: '1.25',
          status: 'running',
          registry: 'ghcr',
          registryName: 'GitHub Container Registry',
          registryUrl: 'https://ghcr.io/v2',
          sourceRepo: 'github.com/nginx/nginx',
          releaseLink: 'https://github.com/nginx/nginx/releases',
        },
      ]);

      const w = factory({
        DataTable: securityLinkTableStub,
        ContainerLinkActions: containerLinkActionsStub,
        ContainerUpdateDialog: containerUpdateDialogStub,
      });
      await flushPromises();

      const cluster = w.get('[data-test="container-link-actions-stub"]');
      expect(w.findAll('[data-test="container-link-actions-stub"]')).toHaveLength(1);
      expect(cluster.attributes('data-source-repo')).toBe('github.com/nginx/nginx');
      expect(cluster.attributes('data-container-id')).toBe('c1');
      expect(cluster.attributes('data-from-tag')).toBe('1.25');
      expect(cluster.attributes('data-to-tag')).toBe('1.26');
      expect(cluster.attributes('data-registry')).toBe('ghcr');
      expect(cluster.attributes('data-registry-name')).toBe('GitHub Container Registry');
      expect(cluster.attributes('data-registry-url')).toBe('https://ghcr.io/v2');
      expect(cluster.attributes('data-icon-size')).toBe('sm');

      const resourceLayout = w.get('[data-test="security-resource-actions"]');
      const tableImageLayout = resourceLayout.element.parentElement;
      const canWrapAtNarrowWidths =
        tableImageLayout?.classList.contains('flex-wrap') ||
        resourceLayout
          .classes()
          .some((className) =>
            ['w-full', 'basis-full', 'max-sm:w-full', 'max-sm:basis-full'].includes(className),
          );
      expect(canWrapAtNarrowWidths).toBe(true);

      await cluster.get('[data-link-action="registry"]').trigger('click');
      expect((w.vm as any).selectedImage).toBeNull();
    });
  });

  describe('card mode', () => {
    const cardBranchRows = [
      {
        image: 'redis',
        critical: 0,
        high: 2,
        medium: 0,
        low: 0,
        unknown: 0,
        total: 2,
        fixable: 1,
        delta: { fixed: 1, new: 0, unchanged: 1 },
      },
      {
        image: 'api',
        critical: 0,
        high: 0,
        medium: 3,
        low: 0,
        unknown: 0,
        total: 3,
        fixable: 0,
        delta: { fixed: 0, new: 2, unchanged: 1 },
      },
      {
        image: 'worker',
        critical: 0,
        high: 0,
        medium: 0,
        low: 4,
        unknown: 0,
        total: 4,
        fixable: 2,
        delta: { fixed: 1, new: 1, unchanged: 2 },
      },
      {
        image: 'clean-image',
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        unknown: 0,
        total: 0,
        fixable: 0,
      },
    ];

    it('renders security cards with severity, delta, update, and link affordances', async () => {
      preferences.views.security.mode = 'cards';
      mockContainers([
        makeContainer({
          id: 'c1',
          name: 'nginx',
          displayName: 'nginx',
          security: {
            scan: {
              vulnerabilities: [
                {
                  id: 'CVE-critical',
                  severity: 'CRITICAL',
                  packageName: 'openssl',
                  fixedVersion: '3.0.1',
                },
                {
                  id: 'CVE-high',
                  severity: 'HIGH',
                  packageName: 'curl',
                  fixedVersion: '8.0.1',
                },
                {
                  id: 'CVE-medium',
                  severity: 'MEDIUM',
                  packageName: 'zlib',
                  fixedVersion: null,
                },
                {
                  id: 'CVE-low',
                  severity: 'LOW',
                  packageName: 'busybox',
                  fixedVersion: null,
                },
              ],
            },
          },
        }),
      ]);
      mockGetAllContainers.mockResolvedValue([
        {
          id: 'c1',
          name: 'nginx',
          displayName: 'nginx',
          image: { name: 'nginx', tag: { value: '1.25' } },
          newTag: '1.26',
          status: 'running',
          registry: 'dockerhub',
          updateKind: 'patch',
          updateMaturity: null,
          bouncer: 'safe',
          server: 'Local',
          sourceRepo: 'github.com/nginx/nginx',
          releaseLink: 'https://github.com/nginx/nginx/releases',
          releaseNotes: {
            title: 'v1.26.0',
            body: 'Security and bug fixes',
            url: 'https://github.com/nginx/nginx/releases/tag/v1.26.0',
            publishedAt: '2026-04-01T00:00:00Z',
            provider: 'github',
          },
        },
      ]);

      const w = factory(securityCardStubs(cardBranchRows));
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalledOnce());
      await vi.waitFor(() => expect(mockGetAllContainers).toHaveBeenCalledOnce());
      await flushPromises();

      const table = w.get('.security-card-table');
      expect(table.attributes('data-prefer-cards')).toBe('true');
      expect(table.attributes('data-hoist-card-sort')).toBe('true');
      expect(table.attributes('data-sort-key')).toBe('critical');
      expect(table.attributes('data-sort-asc')).toBe('false');
      expect(w.get('.security-card-filter').attributes('data-mode')).toBe('cards');
      expect(w.get('.security-card-filter').attributes('data-hide-view-toggle')).toBe('false');

      const sort = w.get('.security-sort-control');
      expect(sort.attributes('data-columns')).toBe('critical,high,medium,low,fixable,total');
      await sort.get('.sort-by-high').trigger('click');
      await nextTick();
      expect(preferences.views.security.sortField).toBe('high');
      expect(w.get('.security-card-table').attributes('data-sort-key')).toBe('high');

      await w.get('.security-sort-control .sort-asc').trigger('click');
      await nextTick();
      expect(preferences.views.security.sortAsc).toBe(true);
      expect(w.get('.security-card-table').attributes('data-sort-asc')).toBe('true');

      const nginxCard = w.get('[data-card-id="nginx"]');
      expect(nginxCard.text()).toContain('nginx');
      expect(nginxCard.text()).toContain('github.com');
      expect(nginxCard.text()).toContain('Critical');
      expect(nginxCard.text()).toContain('1 Critical');
      expect(nginxCard.text()).toContain('1 High');
      expect(nginxCard.text()).toContain('1 Medium');
      expect(nginxCard.text()).toContain('1 Low');
      expect(nginxCard.text()).toContain('4 total');
      expect(nginxCard.text()).toContain('50%');
      expect(nginxCard.find('[data-test="security-card-update-btn"]').exists()).toBe(true);
      expect(nginxCard.find('[data-test="security-card-containers-link"]').exists()).toBe(true);
      expect(nginxCard.find('[data-test="security-card-resource-actions"]').exists()).toBe(true);
      expect(nginxCard.find('[data-test="container-link-actions-stub"]').exists()).toBe(true);

      await nginxCard.get('[data-test="security-card-update-btn"]').trigger('click');
      await nextTick();
      expect((w.vm as any).updateDialogContainerId).toBe('c1');

      await nginxCard.get('[data-test="security-card-containers-link"]').trigger('click');
      await nextTick();
      expect(mockRouterPush).toHaveBeenCalledWith({
        path: '/containers',
        query: { containerIds: 'c1' },
      });

      expect(w.get('[data-card-id="redis"]').text()).toContain('High');
      expect(w.get('[data-card-id="redis"]').text()).toContain('1 fixed');
      expect(w.get('[data-card-id="api"]').text()).toContain('Medium');
      expect(w.get('[data-card-id="api"]').text()).toContain('2 new');
      expect(w.get('[data-card-id="worker"]').text()).toContain('Low');
      expect(w.get('[data-card-id="worker"]').text()).toContain('1 fixed, 1 new');

      const cleanCard = w.get('[data-card-id="clean-image"]');
      expect(cleanCard.text()).toContain('Clean');
      expect(cleanCard.text()).toContain('0 total');
      expect(cleanCard.text()).toContain('0%');
      expect(cleanCard.find('[data-test="security-card-update-btn"]').exists()).toBe(false);
      expect(cleanCard.find('[data-test="container-link-actions-stub"]').exists()).toBe(false);
    });

    it('forwards card resources to one 44px cluster without triggering the card row action', async () => {
      preferences.views.security.mode = 'cards';
      mockContainers([makeContainer({ id: 'c1', name: 'nginx', displayName: 'nginx' })]);
      mockGetAllContainers.mockResolvedValue([
        {
          id: 'c1',
          name: 'nginx',
          displayName: 'nginx',
          image: { name: 'nginx', tag: { value: '1.25' } },
          newTag: '1.26',
          currentTag: '1.25',
          status: 'running',
          registry: 'ghcr',
          registryName: 'GitHub Container Registry',
          registryUrl: 'https://ghcr.io/v2',
          sourceRepo: 'github.com/nginx/nginx',
          releaseLink: 'https://github.com/nginx/nginx/releases',
        },
      ]);

      const w = factory(securityCardStubs());
      await flushPromises();

      const cluster = w.get('[data-test="container-link-actions-stub"]');
      expect(w.findAll('[data-test="container-link-actions-stub"]')).toHaveLength(1);
      expect(cluster.attributes('data-source-repo')).toBe('github.com/nginx/nginx');
      expect(cluster.attributes('data-container-id')).toBe('c1');
      expect(cluster.attributes('data-from-tag')).toBe('1.25');
      expect(cluster.attributes('data-to-tag')).toBe('1.26');
      expect(cluster.attributes('data-registry')).toBe('ghcr');
      expect(cluster.attributes('data-registry-name')).toBe('GitHub Container Registry');
      expect(cluster.attributes('data-registry-url')).toBe('https://ghcr.io/v2');
      expect(cluster.attributes('data-icon-size')).toBe('sm');

      const resourceLayout = w.get('[data-test="security-card-resource-actions"]');
      const actionLayout = resourceLayout.element.parentElement;
      const footerLayout = actionLayout?.parentElement;
      const canWrapAtNarrowWidths =
        actionLayout?.classList.contains('flex-wrap') ||
        actionLayout?.classList.contains('flex-col') ||
        footerLayout?.classList.contains('flex-wrap') ||
        footerLayout?.classList.contains('flex-col');
      expect(canWrapAtNarrowWidths).toBe(true);

      await cluster.get('[data-link-action="registry"]').trigger('click');
      expect((w.vm as any).selectedImage).toBeNull();
    });

    it('hoists security sorting when card reflow is forced in table mode', async () => {
      mockContainers([makeContainer()]);

      const w = factory(securityCardStubs());
      await vi.waitFor(() => expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalledOnce());
      await flushPromises();

      expect(w.find('.security-sort-control').exists()).toBe(false);
      expect(w.get('.security-card-table').attributes('data-prefer-cards')).toBe('false');
      expect(w.get('.security-card-table').attributes('data-hoist-card-sort')).toBe('false');
      expect(w.get('.security-card-filter').attributes('data-hide-view-toggle')).toBe('false');

      await w.get('.force-card-reflow').trigger('click');
      await nextTick();

      expect(w.find('.security-sort-control').exists()).toBe(true);
      expect(w.get('.security-card-table').attributes('data-prefer-cards')).toBe('false');
      expect(w.get('.security-card-table').attributes('data-hoist-card-sort')).toBe('true');
      expect(w.get('.security-card-filter').attributes('data-hide-view-toggle')).toBe('true');

      await w.get('.clear-card-reflow').trigger('click');
      await nextTick();

      expect(w.find('.security-sort-control').exists()).toBe(false);
      expect(w.get('.security-card-table').attributes('data-hoist-card-sort')).toBe('false');
      expect(w.get('.security-card-filter').attributes('data-hide-view-toggle')).toBe('false');
    });
  });

  describe('severity tooltip i18n', () => {
    it('localizedSeverity returns translated label, not raw uppercase string', async () => {
      mockContainers([makeContainer()]);
      const w = factory();
      await flushPromises();
      const vm = w.vm as any;
      expect(vm.localizedSeverity('CRITICAL')).toBe('Critical');
      expect(vm.localizedSeverity('HIGH')).toBe('High');
      expect(vm.localizedSeverity('MEDIUM')).toBe('Medium');
      expect(vm.localizedSeverity('LOW')).toBe('Low');
    });
  });
});
