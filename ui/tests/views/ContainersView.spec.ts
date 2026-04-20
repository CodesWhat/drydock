import { flushPromises } from '@vue/test-utils';
import { computed, defineComponent, reactive, ref } from 'vue';
import type { Container } from '@/types/container';
import ContainersView from '@/views/ContainersView.vue';
import { mountWithPlugins } from '../helpers/mount';

const { mockRoute, mockRouterReplace, mockContainerActionsEnabled, mockLoadServerFeatures } =
  vi.hoisted(() => ({
    mockRoute: {
      name: 'containers',
      path: '/containers',
      params: {} as Record<string, unknown>,
      query: {} as Record<string, unknown>,
    },
    mockRouterReplace: vi.fn().mockResolvedValue(undefined),
    mockContainerActionsEnabled: { value: true },
    mockLoadServerFeatures: vi.fn().mockResolvedValue(undefined),
  }));

vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
  useRouter: () => ({
    replace: mockRouterReplace,
  }),
}));

vi.mock('@/composables/useServerFeatures', () => ({
  useServerFeatures: () => ({
    featureFlags: computed(() => ({ containeractions: mockContainerActionsEnabled.value })),
    containerActionsEnabled: computed(() => mockContainerActionsEnabled.value),
    deleteEnabled: computed(() => true),
    loaded: computed(() => true),
    loading: computed(() => false),
    error: computed(() => null),
    loadServerFeatures: mockLoadServerFeatures,
    isFeatureEnabled: (name: string) =>
      name.toLowerCase() === 'containeractions' ? mockContainerActionsEnabled.value : false,
    containerActionsDisabledReason: computed(
      () => 'Container actions disabled by server configuration',
    ),
  }),
}));

// --- Mock all services ---
vi.mock('@/services/container', () => ({
  deleteContainer: vi.fn(),
  getAllContainers: vi.fn(),
  getContainerGroups: vi.fn().mockResolvedValue([]),
  getContainerLogs: vi.fn(),
  getContainerUpdateOperations: vi.fn().mockResolvedValue([]),
  getContainerSbom: vi.fn().mockResolvedValue({ format: 'spdx-json', document: {} }),
  getContainerTriggers: vi.fn().mockResolvedValue([]),
  getContainerVulnerabilities: vi.fn().mockResolvedValue({
    status: 'not-scanned',
    summary: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
    vulnerabilities: [],
  }),
  refreshAllContainers: vi.fn().mockResolvedValue([]),
  scanContainer: vi.fn().mockResolvedValue({}),
  runTrigger: vi.fn().mockResolvedValue({}),
  updateContainerPolicy: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/services/container-actions', () => ({
  startContainer: vi.fn(),
  updateContainer: vi.fn(),
  updateContainers: vi.fn(),
  stopContainer: vi.fn(),
  restartContainer: vi.fn(),
}));

vi.mock('@/services/backup', () => ({
  getBackups: vi.fn().mockResolvedValue([]),
  rollback: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/services/preview', () => ({
  previewContainer: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/utils/container-mapper', () => ({
  mapApiContainers: vi.fn((x: any) => x),
}));

vi.mock('@/utils/display', () => ({
  bouncerColor: vi.fn(() => ({ bg: 'bg', text: 'text' })),
  maturityColor: vi.fn(() => ({ bg: 'bg', text: 'text' })),
  parseServer: vi.fn((s: string) => ({ name: s, env: null })),
  registryColorBg: vi.fn(() => 'bg'),
  registryColorText: vi.fn(() => 'text'),
  registryLabel: vi.fn((r: string) => r),
  serverBadgeColor: vi.fn(() => ({ bg: 'bg', text: 'text' })),
  suggestedTagColor: vi.fn(() => ({ bg: 'bg', text: 'text' })),
  updateKindColor: vi.fn(() => ({ bg: 'bg', text: 'text' })),
}));

// --- Mock composables ---
const mockFilteredContainers = ref<Container[]>([]);
const mockActiveFilterCount = ref(0);
const mockShowFilters = ref(false);
const mockClearFilters = vi.fn();
const mockFilterSearch = ref('');
const mockFilterStatus = ref('all');
const mockFilterRegistry = ref('all');
const mockFilterBouncer = ref('all');
const mockFilterServer = ref('all');
const mockFilterKind = ref('all');
const mockFilterHidePinned = ref(false);

vi.mock('@/composables/useContainerFilters', () => ({
  useContainerFilters: vi.fn(() => ({
    filterSearch: mockFilterSearch,
    filterStatus: mockFilterStatus,
    filterRegistry: mockFilterRegistry,
    filterBouncer: mockFilterBouncer,
    filterServer: mockFilterServer,
    filterKind: mockFilterKind,
    filterHidePinned: mockFilterHidePinned,
    showFilters: mockShowFilters,
    activeFilterCount: mockActiveFilterCount,
    filteredContainers: mockFilteredContainers,
    clearFilters: mockClearFilters,
  })),
}));

vi.mock('@/composables/useBreakpoints', () => ({
  useBreakpoints: vi.fn(() => ({
    isMobile: mockIsMobile,
    windowNarrow: mockWindowNarrow,
    windowWidth: mockWindowWidth,
  })),
}));

const mockIsMobile = ref(false);
const mockWindowNarrow = ref(false);
const mockWindowWidth = ref(1440);

const mockVisibleColumns = ref(
  new Set(['icon', 'name', 'version', 'kind', 'status', 'bouncer', 'server', 'registry']),
);
const mockShowColumnPicker = ref(false);

vi.mock('@/composables/useColumnVisibility', () => ({
  useColumnVisibility: vi.fn(() => ({
    allColumns: [
      { key: 'icon', label: '', align: 'text-center', required: true },
      { key: 'name', label: 'Container', align: 'text-left', required: true },
      { key: 'version', label: 'Version', align: 'text-center', required: false },
      { key: 'kind', label: 'Kind', align: 'text-center', required: false },
      { key: 'status', label: 'Status', align: 'text-center', required: false },
      { key: 'bouncer', label: 'Bouncer', align: 'text-center', required: false },
      { key: 'server', label: 'Host', align: 'text-center', required: false },
      { key: 'registry', label: 'Registry', align: 'text-center', required: false },
    ],
    visibleColumns: mockVisibleColumns,
    activeColumns: computed(() => [
      { key: 'icon', label: '', align: 'text-center' },
      { key: 'name', label: 'Container', align: 'text-left' },
      { key: 'status', label: 'Status', align: 'text-center' },
    ]),
    showColumnPicker: mockShowColumnPicker,
    toggleColumn: vi.fn(),
  })),
}));

const mockContainerScrollBlocked = ref(false);
const mockContainerAutoFetchInterval = ref(0);

vi.mock('@/composables/useLogViewerBehavior', () => ({
  useLogViewport: () => ({
    logContainer: ref(null),
    scrollBlocked: mockContainerScrollBlocked,
    scrollToBottom: vi.fn(),
    handleLogScroll: vi.fn(),
    resumeAutoScroll: vi.fn(),
  }),
  useAutoFetchLogs: () => ({ autoFetchInterval: mockContainerAutoFetchInterval }),
  LOG_AUTO_FETCH_INTERVALS: [
    { label: 'Off', value: 0 },
    { label: '2s', value: 2000 },
    { label: '5s', value: 5000 },
    { label: '10s', value: 10000 },
    { label: '30s', value: 30000 },
  ],
}));

const mockSelectedContainer = ref<Container | null>(null);
const mockDetailPanelOpen = ref(false);
const mockContainerFullPage = ref(false);
const mockActiveDetailTab = ref('overview');
const mockPanelSize = ref<'sm' | 'md' | 'lg'>('sm');
const mockSelectContainer = vi.fn();
const mockDetailPanelStorageRead = vi.fn(() => null);

vi.mock('@/composables/useDetailPanel', () => ({
  useDetailPanel: vi.fn(() => ({
    selectedContainer: mockSelectedContainer,
    detailPanelOpen: mockDetailPanelOpen,
    activeDetailTab: mockActiveDetailTab,
    panelSize: mockPanelSize,
    containerFullPage: mockContainerFullPage,
    panelFlex: computed(() => '0 0 30%'),
    detailTabs: [
      { id: 'overview', label: 'Overview', icon: 'info' },
      { id: 'logs', label: 'Logs', icon: 'logs' },
      { id: 'actions', label: 'Actions', icon: 'triggers' },
    ],
    selectContainer: mockSelectContainer,
    openFullPage: vi.fn(),
    closeFullPage: vi.fn(),
    closePanel: vi.fn(),
  })),
  useDetailPanelStorage: vi.fn(() => ({
    read: mockDetailPanelStorageRead,
    write: vi.fn(),
    remove: vi.fn(),
  })),
}));

// --- Stub child components ---
const childStubs = {
  DataViewLayout: {
    template: '<div class="data-view-layout"><slot /><slot name="panel" /></div>',
  },
  DataFilterBar: {
    template:
      '<div class="data-filter-bar"><slot v-if="showFilters" name="filters" /><slot name="extra-buttons" /><slot name="left" /><slot name="center" /></div>',
    props: ['modelValue', 'showFilters', 'filteredCount', 'totalCount', 'activeFilterCount'],
  },
  DataTable: defineComponent({
    props: [
      'columns',
      'rows',
      'rowKey',
      'sortKey',
      'sortAsc',
      'selectedKey',
      'showActions',
      'virtualScroll',
      'virtualRowHeight',
      'virtualMaxHeight',
      'rowHeight',
      'maxHeight',
      'fullWidthRow',
      'rowInteractive',
      'rowClass',
    ],
    template: `
      <div class="data-table">
        <div v-for="row in rows" :key="rowKey ? (typeof rowKey === 'function' ? rowKey(row) : row[rowKey]) : row.id ?? row.name">
          <slot v-if="typeof fullWidthRow === 'function' && fullWidthRow(row)" name="full-row" :row="row" />
          <div v-else class="data-table-first-row">
            <slot name="cell-name" :row="row" />
            <slot name="cell-version" :row="row" />
            <slot name="cell-status" :row="row" />
            <slot name="cell-registry" :row="row" />
            <slot name="actions" :row="row" />
          </div>
        </div>
      </div>
    `,
  }),
  DataCardGrid: defineComponent({
    props: ['items', 'itemKey', 'selectedKey'],
    template: `
      <div class="data-card-grid">
        <slot v-if="items?.[0]" name="card" :item="items[0]" />
      </div>
    `,
  }),
  DataListAccordion: defineComponent({
    props: ['items', 'itemKey', 'selectedKey'],
    template: `
      <div class="data-list-accordion">
        <slot v-if="items?.[0]" name="header" :item="items[0]" />
      </div>
    `,
  }),
  DetailPanel: {
    template: '<div class="detail-panel"><slot name="header" /><slot /></div>',
    props: ['open', 'isMobile', 'size', 'showSizeControls', 'showFullPage'],
  },
  EmptyState: {
    template: '<div class="empty-state">{{ message }}</div>',
    props: ['icon', 'message', 'showClear'],
  },
  ContainerLogs: {
    template:
      '<div data-test="container-logs-stub" :data-id="containerId" :data-name="containerName" :data-compact="compact === undefined ? `false` : `true`">{{ containerName }}</div>',
    props: ['containerId', 'containerName', 'compact'],
  },
  UpdateMaturityBadge: {
    template: '<span data-test="update-maturity-badge" v-if="maturity">{{ maturity }}</span>',
    props: ['maturity', 'tooltip', 'size'],
  },
  SuggestedTagBadge: {
    template: '<span data-test="suggested-tag-badge" v-if="tag">{{ tag }}</span>',
    props: ['tag', 'currentTag'],
  },
  ReleaseNotesLink: {
    template:
      '<span data-test="release-notes-link"><a v-if="releaseLink" :href="releaseLink">Release notes</a></span>',
    props: ['releaseNotes', 'releaseLink'],
  },
};

import {
  getAllContainers,
  getContainerGroups,
  getContainerSbom,
  getContainerUpdateOperations,
  getContainerVulnerabilities,
  refreshAllContainers,
  scanContainer,
  updateContainerPolicy,
} from '@/services/container';
import {
  updateContainer as apiUpdateContainer,
  updateContainers as apiUpdateContainers,
} from '@/services/container-actions';

const mockGetAllContainers = getAllContainers as ReturnType<typeof vi.fn>;
const mockRefreshAllContainers = refreshAllContainers as ReturnType<typeof vi.fn>;
const mockGetContainerGroups = getContainerGroups as ReturnType<typeof vi.fn>;
const mockGetContainerUpdateOperations = getContainerUpdateOperations as ReturnType<typeof vi.fn>;
const mockGetContainerVulnerabilities = getContainerVulnerabilities as ReturnType<typeof vi.fn>;
const mockGetContainerSbom = getContainerSbom as ReturnType<typeof vi.fn>;
const mockScanContainer = scanContainer as ReturnType<typeof vi.fn>;
const mockUpdateContainerPolicy = updateContainerPolicy as ReturnType<typeof vi.fn>;
const mockApiUpdate = apiUpdateContainer as ReturnType<typeof vi.fn>;
const mockApiUpdateBulk = apiUpdateContainers as ReturnType<typeof vi.fn>;
const mountedWrappers: Array<{ unmount: () => void }> = [];

function makeContainer(overrides: Partial<Container> = {}): Container {
  const defaultName = overrides.name ?? 'nginx';
  const defaultServer = overrides.server ?? 'Local';
  return {
    id: 'c1',
    identityKey: overrides.identityKey ?? `::${defaultServer}::${defaultName}`,
    name: defaultName,
    image: 'nginx',
    icon: 'docker',
    currentTag: '1.0.0',
    newTag: null,
    status: 'running',
    registry: 'dockerhub',
    updateKind: null,
    updateMaturity: null,
    bouncer: 'safe',
    server: defaultServer,
    details: { ports: [], volumes: [], env: [], labels: [] },
    ...overrides,
  };
}

async function mountContainersView(
  containers: Container[] = [],
  apiContainersInput?: any[],
  options: { initialFilterKind?: string } = {},
) {
  // The API returns raw objects; mapApiContainers transforms them
  const apiContainers =
    apiContainersInput ??
    containers.map((c) => ({
      ...c,
      displayName: c.name,
    }));
  mockGetAllContainers.mockResolvedValue(apiContainers);

  const { mapApiContainers } = await import('@/utils/container-mapper');
  (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValue(containers);

  // Sync the filteredContainers mock with the containers we're providing
  mockFilteredContainers.value = containers;
  mockActiveFilterCount.value = 0;
  mockFilterSearch.value = '';
  mockFilterStatus.value = 'all';
  mockFilterRegistry.value = 'all';
  mockFilterBouncer.value = 'all';
  mockFilterServer.value = 'all';
  mockFilterKind.value = options.initialFilterKind ?? 'all';
  mockFilterHidePinned.value = false;
  mockSelectedContainer.value = null;
  mockDetailPanelOpen.value = false;
  mockContainerFullPage.value = false;
  mockActiveDetailTab.value = 'overview';

  const wrapper = mountWithPlugins(ContainersView, {
    global: { stubs: childStubs },
  });
  mountedWrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

describe('ContainersView', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockRouterReplace.mockResolvedValue(undefined);
    mockContainerActionsEnabled.value = true;
    mockIsMobile.value = false;
    mockWindowNarrow.value = false;
    mockWindowWidth.value = 1440;
    mockDetailPanelOpen.value = false;
    mockPanelSize.value = 'sm';
    mockGetContainerGroups.mockResolvedValue([]);
    mockGetContainerUpdateOperations.mockResolvedValue([]);
    mockGetContainerVulnerabilities.mockResolvedValue({
      status: 'not-scanned',
      summary: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
      vulnerabilities: [],
    });
    mockGetContainerSbom.mockResolvedValue({ format: 'spdx-json', document: {} });
    mockScanContainer.mockResolvedValue({});
    mockUpdateContainerPolicy.mockResolvedValue({});
    mockApiUpdateBulk.mockImplementation(async (containerIds: string[]) => ({
      message: 'Container update requests processed',
      accepted: containerIds.map((containerId) => ({
        containerId,
        containerName: containerId,
        operationId: `op-${containerId}`,
      })),
      rejected: [],
    }));
    mockFilteredContainers.value = [];
    mockActiveFilterCount.value = 0;
    mockFilterSearch.value = '';
    mockFilterStatus.value = 'all';
    mockFilterRegistry.value = 'all';
    mockFilterBouncer.value = 'all';
    mockFilterServer.value = 'all';
    mockFilterKind.value = 'all';
    mockFilterHidePinned.value = false;
    mockContainerScrollBlocked.value = false;
    mockContainerAutoFetchInterval.value = 0;
    mockDetailPanelStorageRead.mockReturnValue(null);
    mockRoute.name = 'containers';
    mockRoute.path = '/containers';
    mockRoute.params = {};
    mockRoute.query = {};
    localStorage.clear();
    sessionStorage.clear();
    const { resetPreferences } = await import('@/preferences/store');
    resetPreferences();
  });

  afterEach(() => {
    while (mountedWrappers.length > 0) {
      const wrapper = mountedWrappers.pop();
      wrapper?.unmount();
    }
  });

  describe('loading containers', () => {
    it('calls getAllContainers on mount', async () => {
      await mountContainersView([]);
      expect(mockGetAllContainers).toHaveBeenCalledOnce();
    });

    it('passes mapped containers to filteredContainers', async () => {
      const containers = [makeContainer(), makeContainer({ id: 'c2', name: 'redis' })];
      await mountContainersView(containers);
      expect(mockFilteredContainers.value).toHaveLength(2);
    });

    it('falls back to API container name when displayName is missing', async () => {
      const containers = [makeContainer({ id: 'c1', name: 'nginx' })];
      const wrapper = await mountContainersView(containers, [{ id: 'c1', name: 'nginx' }]);
      const vm = wrapper.vm as any;

      vm.selectedContainer = containers[0];
      expect(vm.selectedContainerId).toBe('c1');
    });

    it('keeps duplicate display-name aliases out of id and meta lookup maps', async () => {
      const datavaultNode = makeContainer({
        id: 'c1',
        name: 'tdarr_node',
        server: 'Datavault',
      });
      const tmvaultNode = makeContainer({
        id: 'c2',
        name: 'tdarr_node',
        server: 'Tmvault',
      });
      const wrapper = await mountContainersView([datavaultNode, tmvaultNode]);
      const vm = wrapper.vm as any;

      expect(vm.containerIdMap.c1).toBe('c1');
      expect(vm.containerIdMap.c2).toBe('c2');
      expect(vm.containerIdMap.tdarr_node).toBeUndefined();
      expect(vm.containerMetaMap.c1).toMatchObject({ id: 'c1', name: 'tdarr_node' });
      expect(vm.containerMetaMap.c2).toMatchObject({ id: 'c2', name: 'tdarr_node' });
      expect(vm.containerMetaMap.tdarr_node).toBeUndefined();
    });

    describe('identical-list dedup optimisation', () => {
      it('does not reassign containers.value when a reload returns identical data', async () => {
        const container = makeContainer({ id: 'c1', name: 'nginx', status: 'running' });
        const wrapper = await mountContainersView([container]);
        const vm = wrapper.vm as any;

        const firstRef = vm.containers;

        // Simulate a second loadContainers call returning identical data
        const identicalContainer = { ...container };
        mockGetAllContainers.mockResolvedValue([
          { ...identicalContainer, displayName: identicalContainer.name },
        ]);
        const { mapApiContainers } = await import('@/utils/container-mapper');
        (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValue([identicalContainer]);

        await vm.loadContainers();
        await flushPromises();

        // The containers array reference must be the same object (no reassignment occurred)
        expect(vm.containers).toBe(firstRef);
      });

      it('reassigns containers.value when a field changes', async () => {
        const container = makeContainer({ id: 'c1', name: 'nginx', status: 'running' });
        const wrapper = await mountContainersView([container]);
        const vm = wrapper.vm as any;

        const firstRef = vm.containers;

        // New data with a changed field (newTag appeared)
        const updatedContainer = { ...container, newTag: '2.0.0', updateKind: 'major' as const };
        mockGetAllContainers.mockResolvedValue([
          { ...updatedContainer, displayName: updatedContainer.name },
        ]);
        const { mapApiContainers } = await import('@/utils/container-mapper');
        (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValue([updatedContainer]);

        await vm.loadContainers();
        await flushPromises();

        // The containers array reference must be a new object (reassignment occurred)
        expect(vm.containers).not.toBe(firstRef);
        expect(vm.containers[0].newTag).toBe('2.0.0');
      });

      it('reassigns containers.value when only nested fields change', async () => {
        const container = makeContainer({
          id: 'c1',
          name: 'nginx',
          updateOperation: {
            id: 'op-1',
            status: 'in-progress',
            phase: 'pulling',
            updatedAt: '2026-04-20T12:00:00.000Z',
          },
        });
        const wrapper = await mountContainersView([container]);
        const vm = wrapper.vm as any;

        const firstRef = vm.containers;

        const updatedContainer = makeContainer({
          ...container,
          updateOperation: {
            id: 'op-1',
            status: 'in-progress',
            phase: 'prepare',
            updatedAt: '2026-04-20T12:00:01.000Z',
          },
        });
        mockGetAllContainers.mockResolvedValue([
          { ...updatedContainer, displayName: updatedContainer.name },
        ]);
        const { mapApiContainers } = await import('@/utils/container-mapper');
        (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValue([updatedContainer]);

        await vm.loadContainers();
        await flushPromises();

        expect(vm.containers).not.toBe(firstRef);
        expect(vm.containers[0].updateOperation).toMatchObject({
          status: 'in-progress',
          phase: 'prepare',
        });
      });

      it('reassigns containers.value when container count changes', async () => {
        const container = makeContainer({ id: 'c1', name: 'nginx' });
        const wrapper = await mountContainersView([container]);
        const vm = wrapper.vm as any;

        const firstRef = vm.containers;

        // New data with an extra container
        const redis = makeContainer({ id: 'c2', name: 'redis' });
        mockGetAllContainers.mockResolvedValue([
          { ...container, displayName: container.name },
          { ...redis, displayName: redis.name },
        ]);
        const { mapApiContainers } = await import('@/utils/container-mapper');
        (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValue([container, redis]);

        await vm.loadContainers();
        await flushPromises();

        expect(vm.containers).not.toBe(firstRef);
        expect(vm.containers).toHaveLength(2);
      });

      it('reassigns containers.value when container order changes', async () => {
        const nginx = makeContainer({ id: 'c1', name: 'nginx' });
        const redis = makeContainer({ id: 'c2', name: 'redis' });
        const wrapper = await mountContainersView([nginx, redis]);
        const vm = wrapper.vm as any;

        const firstRef = vm.containers;

        // Same containers, reversed order
        mockGetAllContainers.mockResolvedValue([
          { ...redis, displayName: redis.name },
          { ...nginx, displayName: nginx.name },
        ]);
        const { mapApiContainers } = await import('@/utils/container-mapper');
        (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValue([redis, nginx]);

        await vm.loadContainers();
        await flushPromises();

        expect(vm.containers).not.toBe(firstRef);
        expect(vm.containers[0].id).toBe('c2');
      });
    });
  });

  describe('route query filters', () => {
    it('applies search query from route query', async () => {
      mockRoute.query = { q: 'nginx' };
      await mountContainersView([makeContainer()]);
      expect(mockFilterSearch.value).toBe('nginx');
    });

    it('applies search query from array route query', async () => {
      mockRoute.query = { q: ['redis'] };
      await mountContainersView([makeContainer()]);
      expect(mockFilterSearch.value).toBe('redis');
    });

    it('applies filterKind from route query', async () => {
      mockRoute.query = { filterKind: 'any' };
      await mountContainersView([makeContainer({ newTag: '2.0.0', updateKind: 'major' })]);
      expect(mockFilterKind.value).toBe('any');
    });

    it('applies filterKind from array route query', async () => {
      mockRoute.query = { filterKind: ['major'] };
      await mountContainersView([makeContainer({ newTag: '2.0.0', updateKind: 'major' })]);
      expect(mockFilterKind.value).toBe('major');
    });

    it('falls back to all for an invalid filterKind query', async () => {
      mockRoute.query = { filterKind: 'invalid-value' };
      await mountContainersView([makeContainer()]);
      expect(mockFilterKind.value).toBe('all');
    });

    it('keeps persisted filterKind when query omits filterKind', async () => {
      mockRoute.query = {};
      await mountContainersView([makeContainer()], undefined, { initialFilterKind: 'major' });
      expect(mockFilterKind.value).toBe('major');
    });

    it('applies sort from route query', async () => {
      mockRoute.query = { sort: 'status-desc' };
      const wrapper = await mountContainersView([makeContainer()]);
      const vm = wrapper.vm as any;
      expect(vm.containerSortKey).toBe('status');
      expect(vm.containerSortAsc).toBe(false);
    });

    it('applies image-age sort aliases from route query', async () => {
      mockRoute.query = { sort: 'oldest-first' };
      const wrapper = await mountContainersView([makeContainer()]);
      const vm = wrapper.vm as any;
      expect(vm.containerSortKey).toBe('imageAge');
      expect(vm.containerSortAsc).toBe(true);
    });

    it('clears dropdown filters when navigating with a search query', async () => {
      mockRoute.query = { q: 'nginx' };
      mockFilterStatus.value = 'running';
      mockFilterRegistry.value = 'dockerhub';
      mockFilterBouncer.value = 'safe';
      mockFilterServer.value = 'Local';
      mockFilterKind.value = 'any';
      await mountContainersView([makeContainer()]);
      expect(mockFilterStatus.value).toBe('all');
      expect(mockFilterRegistry.value).toBe('all');
      expect(mockFilterBouncer.value).toBe('all');
      expect(mockFilterServer.value).toBe('all');
      expect(mockFilterKind.value).toBe('all');
    });

    it('syncs filter/sort state to URL query params', async () => {
      const wrapper = await mountContainersView([makeContainer()]);
      const vm = wrapper.vm as any;

      mockFilterSearch.value = 'nginx';
      mockFilterStatus.value = 'running';
      mockFilterRegistry.value = 'dockerhub';
      mockFilterBouncer.value = 'safe';
      mockFilterServer.value = 'Local';
      mockFilterKind.value = 'major';
      vm.groupByStack = true;
      vm.containerSortKey = 'status';
      vm.containerSortAsc = false;
      await flushPromises();

      expect(mockRouterReplace).toHaveBeenCalled();
      const lastCall = mockRouterReplace.mock.calls.at(-1)?.[0];
      expect(lastCall).toEqual({
        query: expect.objectContaining({
          q: 'nginx',
          filterStatus: 'running',
          filterRegistry: 'dockerhub',
          filterBouncer: 'safe',
          filterServer: 'Local',
          filterKind: 'major',
          groupByStack: 'true',
          sort: 'status-desc',
        }),
      });
    });
  });

  describe('collapsed filter summary', () => {
    it('shows active filter chips when filters are collapsed', async () => {
      const wrapper = await mountContainersView([
        makeContainer({ newTag: '2.0.0', updateKind: 'major' }),
      ]);

      mockFilterSearch.value = 'grafana';
      mockFilterStatus.value = 'running';
      mockFilterKind.value = 'any';
      mockFilterHidePinned.value = true;
      mockActiveFilterCount.value = 3;
      await flushPromises();

      expect(wrapper.text()).toContain('Search: grafana');
      expect(wrapper.text()).toContain('Status: Running');
      expect(wrapper.text()).toContain('Kind: Has Update');
      expect(wrapper.text()).toContain('Hidden: Pinned');
    });

    it('caps long active filter chips so they do not widen the bar', async () => {
      const wrapper = await mountContainersView([
        makeContainer({ newTag: '2.0.0', updateKind: 'major' }),
      ]);

      const longSearch = 'search-value-that-should-not-expand-the-filter-bar';
      mockFilterSearch.value = longSearch;
      mockActiveFilterCount.value = 1;
      await flushPromises();

      const chip = wrapper
        .findAll('span')
        .find(
          (candidate) =>
            candidate.text().includes(longSearch) && candidate.classes().includes('max-w-[240px]'),
        );

      expect(chip).toBeDefined();
      expect(chip?.classes()).toContain('truncate');
    });

    it('hides active filter chips while the filter panel is open', async () => {
      const wrapper = await mountContainersView([
        makeContainer({ newTag: '2.0.0', updateKind: 'major' }),
      ]);

      mockFilterStatus.value = 'running';
      mockFilterKind.value = 'any';
      mockActiveFilterCount.value = 2;
      await flushPromises();

      expect(wrapper.text()).toContain('Status: Running');
      expect(wrapper.text()).toContain('Kind: Has Update');

      mockShowFilters.value = true;
      await flushPromises();

      expect(wrapper.text()).not.toContain('Status: Running');
      expect(wrapper.text()).not.toContain('Kind: Has Update');
    });
  });

  describe('route-driven logs detail', () => {
    it('opens full-page logs tab for /containers/:id/logs', async () => {
      const targetContainer = makeContainer({ id: 'container-42', name: 'api' });
      mockRoute.name = 'container-logs';
      mockRoute.path = '/containers/container-42/logs';
      mockRoute.params = { id: 'container-42' };

      await mountContainersView([targetContainer]);

      expect(mockSelectedContainer.value?.id).toBe('container-42');
      expect(mockActiveDetailTab.value).toBe('logs');
      expect(mockContainerFullPage.value).toBe(true);
      expect(mockDetailPanelOpen.value).toBe(false);
    });
  });

  describe('empty state', () => {
    it('shows empty state when no containers match filters', async () => {
      mockFilteredContainers.value = [];
      const wrapper = await mountContainersView([]);
      const empty = wrapper.find('.empty-state');
      expect(empty.exists()).toBe(true);
      expect(empty.text()).toContain('No containers match your filters');
    });
  });

  describe('view mode', () => {
    it('renders the extracted list content section component', async () => {
      const wrapper = await mountContainersView([makeContainer()]);
      expect(wrapper.find('[data-test="containers-list-content"]').exists()).toBe(true);
    });

    it('renders the extracted grouped views subsection component', async () => {
      const wrapper = await mountContainersView([makeContainer()]);
      expect(wrapper.find('[data-test="containers-grouped-views"]').exists()).toBe(true);
    });

    it('renders the extracted side-detail tab content component when a container is selected', async () => {
      const container = makeContainer();
      const wrapper = await mountContainersView([container]);

      mockSelectedContainer.value = container;
      mockDetailPanelOpen.value = true;
      await flushPromises();

      expect(wrapper.find('[data-test="container-side-tab-content"]').exists()).toBe(true);
    });

    it('renders DataTable by default (table mode)', async () => {
      const containers = [makeContainer()];
      const wrapper = await mountContainersView(containers);
      expect(wrapper.find('.data-table').exists()).toBe(true);
    });

    it('keeps DataTable actions enabled in compact mode', async () => {
      mockWindowNarrow.value = true;
      const wrapper = await mountContainersView([makeContainer()]);
      const dataTable = wrapper.findComponent(childStubs.DataTable as any);
      expect(dataTable.props('showActions')).toBe(true);
    });

    it('treats desktop as non-compact when the detail panel is closed', async () => {
      mockWindowNarrow.value = false;
      mockDetailPanelOpen.value = false;
      mockWindowWidth.value = 1440;
      const wrapper = await mountContainersView([makeContainer()]);
      expect((wrapper.vm as any).isCompact).toBe(false);
    });

    it('goes compact when detail panel is open and effective width < 1024', async () => {
      mockWindowNarrow.value = false;
      mockPanelSize.value = 'lg';
      mockWindowWidth.value = 1500;
      const wrapper = await mountContainersView([makeContainer()]);
      mockDetailPanelOpen.value = true;
      await flushPromises();
      expect((wrapper.vm as any).isCompact).toBe(true);
    });

    it('stays full-width when detail panel is open but effective width >= 1024', async () => {
      mockWindowNarrow.value = false;
      mockPanelSize.value = 'sm';
      mockWindowWidth.value = 1800;
      const wrapper = await mountContainersView([makeContainer()]);
      mockDetailPanelOpen.value = true;
      await flushPromises();
      expect((wrapper.vm as any).isCompact).toBe(false);
    });

    it('shows disabled action controls when container actions are disabled server-side', async () => {
      mockContainerActionsEnabled.value = false;
      const wrapper = await mountContainersView([makeContainer({ newTag: '1.1.0' })]);

      expect(wrapper.text()).toContain('Actions disabled');
      expect(wrapper.findAll('button[disabled]').length).toBeGreaterThan(0);
    });

    it('uses native page scrolling for the containers table so it stretches to viewport bottom', async () => {
      const wrapper = await mountContainersView([makeContainer()]);
      const dataTable = wrapper.findComponent(childStubs.DataTable as any);
      expect(dataTable.props('virtualScroll')).toBe(false);
      expect(dataTable.props('maxHeight')).toBeUndefined();
      expect(dataTable.props('virtualMaxHeight')).toBeUndefined();
    });

    it('renders DataFilterBar', async () => {
      const wrapper = await mountContainersView([makeContainer()]);
      expect(wrapper.find('.data-filter-bar').exists()).toBe(true);
    });

    it('shows registry error indicator in table rows', async () => {
      const c = makeContainer() as Container & { registryError?: string };
      c.registryError = 'Registry request failed: unauthorized';
      const wrapper = await mountContainersView([c]);

      expect(wrapper.find('.data-table [aria-label="Registry error"]').exists()).toBe(true);
    });

    it('shows registry error indicator in card rows', async () => {
      const c = makeContainer() as Container & { registryError?: string };
      c.registryError = 'Registry request failed: unauthorized';
      const wrapper = await mountContainersView([c]);

      (wrapper.vm as any).containerViewMode = 'cards';
      await flushPromises();

      expect(wrapper.find('.data-card-grid [aria-label="Registry error"]').exists()).toBe(true);
    });

    it('shows registry error indicator in list rows', async () => {
      const c = makeContainer() as Container & { registryError?: string };
      c.registryError = 'Registry request failed: unauthorized';
      const wrapper = await mountContainersView([c]);

      (wrapper.vm as any).containerViewMode = 'list';
      await flushPromises();

      expect(wrapper.find('.data-list-accordion [aria-label="Registry error"]').exists()).toBe(
        true,
      );
    });

    it('shows no-update reason in table version cell', async () => {
      const c = makeContainer({ newTag: null }) as Container & { noUpdateReason?: string };
      c.noUpdateReason = 'All tags excluded by policy';
      const wrapper = await mountContainersView([c]);

      expect(wrapper.find('.data-table').text()).toContain('All tags excluded by policy');
    });

    it('derives active list policy state from updatePolicy metadata', async () => {
      const containers = [
        makeContainer({ id: 'c1', name: 'nginx', newTag: null, updateKind: null }),
      ];
      const wrapper = await mountContainersView(containers, [
        {
          id: 'c1',
          name: 'nginx',
          displayName: 'nginx',
          updatePolicy: {
            snoozeUntil: '2099-01-01T00:00:00.000Z',
            skipTags: ['2.0.0'],
          },
        },
      ]);
      const vm = wrapper.vm as any;
      expect(vm.getContainerListPolicyState('nginx')).toEqual({
        snoozed: true,
        skipped: true,
        skipCount: 1,
        snoozeUntil: '2099-01-01T00:00:00.000Z',
        maturityBlocked: false,
      });
      expect(wrapper.find('.data-table [aria-label="Snoozed updates"]').exists()).toBe(true);
      expect(wrapper.find('.data-table [aria-label="Skipped updates"]').exists()).toBe(true);
    });
  });

  describe('skipUpdate', () => {
    it('masks newTag after skipUpdate is called', async () => {
      const containers = [makeContainer({ newTag: '2.0.0', updateKind: 'major' })];
      const wrapper = await mountContainersView(containers);

      // Access the internal skippedUpdates set via the component
      const vm = wrapper.vm as any;

      // The displayContainers should initially contain the newTag
      const before = vm.displayContainers;
      expect(before[0].newTag).toBe('2.0.0');

      // Call skipUpdate
      vm.skipUpdate('nginx');

      await flushPromises();

      const after = vm.displayContainers;
      expect(after[0].newTag).toBeUndefined();
      expect(after[0].updateKind).toBeUndefined();
    });
  });

  describe('advanced policy controls', () => {
    it('removes one skipped tag via remove-skip policy action', async () => {
      const containers = [
        makeContainer({ id: 'c1', name: 'nginx', newTag: '2.0.0', updateKind: 'major' }),
      ];
      const wrapper = await mountContainersView(containers, [
        {
          id: 'c1',
          name: 'nginx',
          displayName: 'nginx',
          updatePolicy: { skipTags: ['2.0.0', '3.0.0'] },
        },
      ]);
      const vm = wrapper.vm as any;
      mockSelectedContainer.value = containers[0];
      mockDetailPanelOpen.value = true;
      mockActiveDetailTab.value = 'actions';
      mockUpdateContainerPolicy.mockResolvedValue({ updated: true });

      await vm.removeSkipTagSelected('2.0.0');
      await flushPromises();

      expect(mockUpdateContainerPolicy).toHaveBeenCalledWith('c1', 'remove-skip', {
        kind: 'tag',
        value: '2.0.0',
      });
    });

    it('removes one skipped digest via remove-skip policy action', async () => {
      const containers = [
        makeContainer({ id: 'c1', name: 'nginx', newTag: '2.0.0', updateKind: 'major' }),
      ];
      const wrapper = await mountContainersView(containers, [
        {
          id: 'c1',
          name: 'nginx',
          displayName: 'nginx',
          updatePolicy: { skipDigests: ['sha256:abc', 'sha256:def'] },
        },
      ]);
      const vm = wrapper.vm as any;
      mockSelectedContainer.value = containers[0];
      mockDetailPanelOpen.value = true;
      mockActiveDetailTab.value = 'actions';
      mockUpdateContainerPolicy.mockResolvedValue({ updated: true });

      await vm.removeSkipDigestSelected('sha256:abc');
      await flushPromises();

      expect(mockUpdateContainerPolicy).toHaveBeenCalledWith('c1', 'remove-skip', {
        kind: 'digest',
        value: 'sha256:abc',
      });
    });

    it('snoozes to a specific date via snooze policy action', async () => {
      const containers = [
        makeContainer({ id: 'c1', name: 'nginx', newTag: '2.0.0', updateKind: 'major' }),
      ];
      const wrapper = await mountContainersView(containers);
      const vm = wrapper.vm as any;
      mockSelectedContainer.value = containers[0];
      mockDetailPanelOpen.value = true;
      mockActiveDetailTab.value = 'actions';
      mockUpdateContainerPolicy.mockResolvedValue({ updated: true });
      vm.snoozeDateInput = '2030-01-10';

      await vm.snoozeSelectedUntilDate();
      await flushPromises();

      expect(mockUpdateContainerPolicy).toHaveBeenCalledWith(
        'c1',
        'snooze',
        expect.objectContaining({
          snoozeUntil: expect.any(String),
        }),
      );
    });
  });

  describe('actionInProgress', () => {
    it('prevents concurrent actions on the same container', async () => {
      const containers = [makeContainer({ id: 'c1', name: 'nginx', newTag: '2.0.0' })];
      const wrapper = await mountContainersView(containers);
      const vm = wrapper.vm as any;

      // Simulate action already in progress on container c1
      vm.actionInProgress = new Set(['c1']);

      // Attempting the same container should be blocked
      mockApiUpdate.mockResolvedValue({});
      await vm.executeAction('nginx', mockApiUpdate);

      expect(mockApiUpdate).not.toHaveBeenCalled();
    });

    it('allows concurrent actions on different containers', async () => {
      const containers = [
        makeContainer({ id: 'c1', name: 'nginx', newTag: '2.0.0' }),
        makeContainer({ id: 'c2', name: 'redis', newTag: '8.0.0' }),
      ];
      const wrapper = await mountContainersView(containers);
      const vm = wrapper.vm as any;

      // Simulate action already in progress on container c1
      vm.actionInProgress = new Set(['c1']);

      // Attempting a different container should NOT be blocked
      mockApiUpdate.mockResolvedValue({});
      await vm.executeAction('redis', mockApiUpdate);

      expect(mockApiUpdate).toHaveBeenCalled();
    });
  });

  describe('ghost state', () => {
    it('holds a ghost container when it disappears during action', async () => {
      const containers = [makeContainer({ name: 'mycontainer' })];
      const wrapper = await mountContainersView(containers);
      const vm = wrapper.vm as any;

      // Simulate the container existing in idMap
      vm.containerIdMap = { mycontainer: 'id-123' };

      // On action completion, the container disappears from the reload
      mockApiUpdate.mockResolvedValue({});
      mockGetAllContainers.mockResolvedValue([]);
      const { mapApiContainers } = await import('@/utils/container-mapper');
      (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValue([]);
      mockFilteredContainers.value = [];

      await vm.executeAction('mycontainer', mockApiUpdate);
      await flushPromises();

      // Ghost entry should exist in actionPending
      expect(vm.actionPending.has('mycontainer')).toBe(true);
    });

    it('keeps a ghost row when only another host with the same name remains live', async () => {
      const localNode = makeContainer({
        id: 'c1',
        name: 'docker-socket-proxy',
        server: 'Datavault',
      });
      const remoteNode = makeContainer({
        id: 'c2',
        name: 'docker-socket-proxy',
        server: 'Tmvault',
      });
      const wrapper = await mountContainersView([remoteNode]);
      const vm = wrapper.vm as any;

      vm.actionPending = new Map([['docker-socket-proxy', localNode]]);

      const ghosts = vm.displayContainers.filter(
        (container: Container & { _pending?: boolean }) => {
          return container._pending;
        },
      );
      expect(ghosts).toHaveLength(1);
      expect(ghosts[0]?.id).toBe('c1');
    });

    it('uses a single poll timer for multiple pending actions', async () => {
      const first = makeContainer({ id: 'c1', name: 'alpha' });
      const second = makeContainer({ id: 'c2', name: 'beta' });
      const wrapper = await mountContainersView([first, second]);
      const vm = wrapper.vm as any;

      vm.containerIdMap = { alpha: 'id-alpha', beta: 'id-beta' };
      mockApiUpdate.mockResolvedValue({});

      mockGetAllContainers
        .mockResolvedValueOnce([{ ...second, displayName: second.name }])
        .mockResolvedValueOnce([]);

      const { mapApiContainers } = await import('@/utils/container-mapper');
      (mapApiContainers as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce([second])
        .mockReturnValueOnce([]);

      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      try {
        await vm.executeAction('alpha', mockApiUpdate);
        await vm.executeAction('beta', mockApiUpdate);
        await flushPromises();

        expect(vm.actionPending.has('alpha')).toBe(true);
        expect(vm.actionPending.has('beta')).toBe(true);
        expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      } finally {
        setIntervalSpy.mockRestore();
      }
    });
  });

  describe('container actions', () => {
    it('calls updateContainer with the correct container id', async () => {
      const containers = [makeContainer({ name: 'nginx', newTag: '2.0.0' })];
      const wrapper = await mountContainersView(containers);
      const vm = wrapper.vm as any;

      vm.containerIdMap = { nginx: 'nginx-id-1' };
      mockApiUpdate.mockResolvedValue({});

      // Re-mock so loadContainers still succeeds
      const apiContainers = containers.map((c) => ({ ...c, displayName: c.name }));
      mockGetAllContainers.mockResolvedValue(apiContainers);
      const { mapApiContainers } = await import('@/utils/container-mapper');
      (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValue(containers);

      await vm.updateContainer('nginx');
      await flushPromises();

      expect(mockApiUpdate).toHaveBeenCalledWith('nginx-id-1');
    });

    it('updates the selected duplicate-name container by id instead of the shared name map', async () => {
      const localNode = makeContainer({
        id: 'datavault-id',
        name: 'tdarr_node',
        newTag: '2.0.0',
        server: 'Datavault',
      });
      const remoteNode = makeContainer({
        id: 'tmvault-id',
        name: 'tdarr_node',
        newTag: '2.0.0',
        server: 'Tmvault',
      });
      const wrapper = await mountContainersView([localNode, remoteNode]);
      const vm = wrapper.vm as any;

      vm.containerIdMap = { tdarr_node: 'tmvault-id' };
      mockApiUpdate.mockResolvedValue({});

      const apiContainers = [localNode, remoteNode].map((container) => ({
        ...container,
        displayName: container.name,
      }));
      mockGetAllContainers.mockResolvedValue(apiContainers);
      const { mapApiContainers } = await import('@/utils/container-mapper');
      (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValue([localNode, remoteNode]);

      await vm.updateContainer(localNode);
      await flushPromises();

      expect(mockApiUpdate).toHaveBeenCalledWith('datavault-id');
    });

    it('calls scanContainer with the correct container id', async () => {
      const containers = [makeContainer({ name: 'nginx', newTag: '2.0.0' })];
      const wrapper = await mountContainersView(containers);
      const vm = wrapper.vm as any;

      vm.containerIdMap = { nginx: 'nginx-id-1' };
      mockScanContainer.mockResolvedValue({});

      const apiContainers = containers.map((c) => ({ ...c, displayName: c.name }));
      mockGetAllContainers.mockResolvedValue(apiContainers);
      const { mapApiContainers } = await import('@/utils/container-mapper');
      (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValue(containers);

      await vm.scanContainer('nginx');
      await flushPromises();

      expect(mockScanContainer).toHaveBeenCalledWith('nginx-id-1');
    });
  });

  describe('detail panel', () => {
    it('does not show detail panel when no container is selected', async () => {
      mockSelectedContainer.value = null;
      const wrapper = await mountContainersView([makeContainer()]);
      expect(wrapper.find('.detail-panel').exists()).toBe(false);
    });

    it('shows detail panel when a container is selected', async () => {
      const c = makeContainer();
      const wrapper = await mountContainersView([c]);
      // Set after mount so the helper's reset doesn't overwrite
      mockSelectedContainer.value = c;
      mockDetailPanelOpen.value = true;
      await flushPromises();
      expect(wrapper.find('.detail-panel').exists()).toBe(true);
      expect(wrapper.find('[data-test="container-side-detail"]').exists()).toBe(true);
    });

    it('loads vulnerabilities and sbom for selected container details', async () => {
      const c = makeContainer({ id: 'container-1', name: 'nginx' });
      const wrapper = await mountContainersView([c]);
      mockGetContainerVulnerabilities.mockResolvedValue({
        status: 'scanned',
        summary: { critical: 1, high: 0, medium: 0, low: 0, unknown: 0 },
        vulnerabilities: [{ id: 'CVE-2026-1', severity: 'CRITICAL' }],
      });
      mockGetContainerSbom.mockResolvedValue({
        format: 'spdx-json',
        document: { spdxVersion: 'SPDX-2.3' },
      });

      mockSelectedContainer.value = c;
      mockDetailPanelOpen.value = true;
      await flushPromises();

      expect(mockGetContainerVulnerabilities).toHaveBeenCalledWith('container-1');
      expect(mockGetContainerSbom).toHaveBeenCalledWith('container-1', 'spdx-json');

      wrapper.unmount();
    });

    it('loads and renders update operation history when opening actions tab', async () => {
      vi.useFakeTimers();
      const c = makeContainer({ id: 'container-1', name: 'nginx' });
      const wrapper = await mountContainersView([c]);

      mockGetContainerUpdateOperations.mockResolvedValue([
        {
          id: 'op-1',
          status: 'rolled-back',
          phase: 'rollback-failed',
          rollbackReason: 'health_gate_failed',
          updatedAt: '2026-02-28T10:00:00.000Z',
        },
      ]);

      mockSelectedContainer.value = c;
      mockDetailPanelOpen.value = true;
      mockActiveDetailTab.value = 'actions';
      await flushPromises();
      await vi.advanceTimersByTimeAsync(300);
      await flushPromises();

      expect(mockGetContainerUpdateOperations).toHaveBeenCalledWith('container-1');
      expect(wrapper.text()).toContain('Update Operation History');
      expect(wrapper.text()).toContain('op-1');
      expect(wrapper.text()).toContain('rolled back');
      expect(wrapper.text()).toContain('rollback failed');
      expect(wrapper.text()).toContain('health gate failed');
      vi.useRealTimers();
    });

    it('shows registry error message when selected container has one', async () => {
      const c = makeContainer() as Container & { registryError?: string };
      c.registryError = 'Registry request failed: unauthorized';
      const wrapper = await mountContainersView([c]);
      mockSelectedContainer.value = c;
      mockDetailPanelOpen.value = true;
      mockActiveDetailTab.value = 'overview';
      await flushPromises();
      expect(wrapper.text()).toContain('Registry request failed: unauthorized');
    });

    it('shows no-update reason when selected container has noUpdateReason', async () => {
      const c = makeContainer({ newTag: null }) as Container & { noUpdateReason?: string };
      c.noUpdateReason =
        'Strict tag-family policy filtered out 1 higher semver tag(s) outside the inferred family.';
      const wrapper = await mountContainersView([c]);
      mockSelectedContainer.value = c;
      mockDetailPanelOpen.value = true;
      mockActiveDetailTab.value = 'overview';
      await flushPromises();
      expect(wrapper.text()).toContain('Strict tag-family policy filtered out 1 higher semver');
    });

    it('shows release notes link when selected container has releaseLink', async () => {
      const c = makeContainer({ newTag: '2.0.0' }) as Container & { releaseLink?: string };
      c.releaseLink = 'https://example.com/changelog';
      const wrapper = await mountContainersView([c]);
      mockSelectedContainer.value = c;
      mockDetailPanelOpen.value = true;
      mockActiveDetailTab.value = 'overview';
      await flushPromises();
      const releaseLink = wrapper.find('a[href="https://example.com/changelog"]');
      expect(releaseLink.exists()).toBe(true);
    });

    it('shows trigger include/exclude filters in overview', async () => {
      const c = makeContainer({
        newTag: '2.0.0',
      } as any) as Container & { triggerInclude?: string; triggerExclude?: string };
      c.triggerInclude = 'slack.default:major';
      c.triggerExclude = 'discord.default';
      const wrapper = await mountContainersView([c]);
      mockSelectedContainer.value = c;
      mockDetailPanelOpen.value = true;
      mockActiveDetailTab.value = 'overview';
      await flushPromises();

      expect(wrapper.text()).toContain('slack.default:major');
      expect(wrapper.text()).toContain('discord.default');
    });

    it('shows image metadata in overview for selected container', async () => {
      const c = makeContainer({ id: 'container-1', name: 'nginx' });
      const wrapper = await mountContainersView(
        [c],
        [
          {
            id: 'container-1',
            name: 'nginx',
            displayName: 'nginx',
            image: {
              name: 'nginx',
              architecture: 'amd64',
              os: 'linux',
              created: '2026-01-02T03:04:05.000Z',
              digest: {
                value: 'sha256:metadata-digest',
              },
            },
          },
        ],
      );

      mockSelectedContainer.value = c;
      mockDetailPanelOpen.value = true;
      mockActiveDetailTab.value = 'overview';
      await flushPromises();

      expect(wrapper.text()).toContain('Image Metadata');
      expect(wrapper.text()).toContain('amd64');
      expect(wrapper.text()).toContain('linux');
      expect(wrapper.text()).toContain('sha256:metadata-digest');
      expect(wrapper.text()).toContain('2026');
    });

    it('shows runtime Entrypoint/Cmd origins from container labels', async () => {
      const c = makeContainer({ id: 'container-1', name: 'nginx' });
      const wrapper = await mountContainersView(
        [c],
        [
          {
            id: 'container-1',
            name: 'nginx',
            displayName: 'nginx',
            watcher: 'local',
            labels: {
              'dd.runtime.entrypoint.origin': 'explicit',
              'dd.runtime.cmd.origin': 'inherited',
            },
          },
        ],
      );

      mockSelectedContainer.value = c;
      mockDetailPanelOpen.value = true;
      mockActiveDetailTab.value = 'overview';
      await flushPromises();

      expect(wrapper.text()).toContain('Runtime Process');
      expect(wrapper.text()).toContain('Entrypoint');
      expect(wrapper.text()).toContain('Explicit');
      expect(wrapper.text()).toContain('Cmd');
      expect(wrapper.text()).toContain('Inherited');
    });

    it('shows lifecycle hooks from container labels in overview', async () => {
      const c = makeContainer({ id: 'container-1', name: 'nginx' });
      const wrapper = await mountContainersView(
        [c],
        [
          {
            id: 'container-1',
            name: 'nginx',
            displayName: 'nginx',
            watcher: 'local',
            labels: {
              'dd.hook.pre': 'echo before',
              'dd.hook.post': 'echo after',
              'dd.hook.timeout': '30000',
            },
          },
        ],
      );

      mockSelectedContainer.value = c;
      mockDetailPanelOpen.value = true;
      mockActiveDetailTab.value = 'overview';
      await flushPromises();

      expect(wrapper.text()).toContain('Lifecycle Hooks');
      expect(wrapper.text()).toContain('echo before');
      expect(wrapper.text()).toContain('echo after');
      expect(wrapper.text()).toContain('30000ms');
      expect(wrapper.text()).toContain('Template Variables');
      expect(wrapper.text()).toContain('DD_CONTAINER_NAME');
      expect(wrapper.text()).toContain('DD_UPDATE_TO');
    });

    it('shows auto-rollback config from container labels in overview', async () => {
      const c = makeContainer({ id: 'container-1', name: 'nginx' });
      const wrapper = await mountContainersView(
        [c],
        [
          {
            id: 'container-1',
            name: 'nginx',
            displayName: 'nginx',
            watcher: 'local',
            labels: {
              'dd.rollback.auto': 'true',
              'dd.rollback.window': '120000',
              'dd.rollback.interval': '5000',
            },
          },
        ],
      );

      mockSelectedContainer.value = c;
      mockDetailPanelOpen.value = true;
      mockActiveDetailTab.value = 'overview';
      await flushPromises();

      expect(wrapper.text()).toContain('Enabled');
      expect(wrapper.text()).toContain('120000ms');
      expect(wrapper.text()).toContain('5000ms');
    });

    it('shows runtime drift warning when origin metadata is unknown', async () => {
      const c = makeContainer({ id: 'container-1', name: 'nginx' });
      const wrapper = await mountContainersView(
        [c],
        [
          {
            id: 'container-1',
            name: 'nginx',
            displayName: 'nginx',
            watcher: 'local',
            labels: {},
          },
        ],
      );

      mockSelectedContainer.value = c;
      mockDetailPanelOpen.value = true;
      mockActiveDetailTab.value = 'overview';
      await flushPromises();

      expect(wrapper.text()).toContain('Runtime origin metadata is missing');
    });
  });

  describe('full page mode', () => {
    it('hides DataViewLayout when containerFullPage is true', async () => {
      const c = makeContainer();
      const wrapper = await mountContainersView([c]);
      // Set after mount so the helper's reset doesn't overwrite
      mockContainerFullPage.value = true;
      mockSelectedContainer.value = c;
      await flushPromises();
      // The v-if="!containerFullPage" should hide DataViewLayout
      expect(wrapper.find('.data-view-layout').exists()).toBe(false);
      expect(wrapper.find('[data-test="container-full-page-detail"]').exists()).toBe(true);
    });

    it('renders the extracted full-page tab content component', async () => {
      const c = makeContainer();
      const wrapper = await mountContainersView([c]);

      mockContainerFullPage.value = true;
      mockSelectedContainer.value = c;
      mockActiveDetailTab.value = 'overview';
      await flushPromises();

      expect(wrapper.find('[data-test="container-full-page-tab-content"]').exists()).toBe(true);
    });
  });

  describe('error handling', () => {
    it('sets error when getAllContainers fails', async () => {
      mockGetAllContainers.mockRejectedValue(new Error('API down'));
      const { mapApiContainers } = await import('@/utils/container-mapper');
      (mapApiContainers as ReturnType<typeof vi.fn>).mockReturnValue([]);
      mockFilteredContainers.value = [];

      const wrapper = mountWithPlugins(ContainersView, {
        global: { stubs: childStubs },
      });
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.error).toBe('API down');
    });

    it('sets error when recheckAll fails', async () => {
      const wrapper = await mountContainersView([makeContainer()]);
      const vm = wrapper.vm as any;

      mockRefreshAllContainers.mockRejectedValue(new Error('Auth expired'));

      await vm.recheckAll();
      await flushPromises();

      expect(vm.error).toBe('Auth expired');
      expect(vm.rechecking).toBe(false);
    });

    it('clears previous error when recheckAll succeeds', async () => {
      const containers = [makeContainer()];
      const wrapper = await mountContainersView(containers);
      const vm = wrapper.vm as any;

      vm.error = 'Previous error';
      mockRefreshAllContainers.mockResolvedValue([]);

      await vm.recheckAll();
      await flushPromises();

      expect(vm.error).toBeNull();
    });
  });

  describe('grouping', () => {
    beforeEach(() => {
      localStorage.removeItem('dd-preferences');
    });

    it('groupByStack defaults to false', async () => {
      const wrapper = await mountContainersView([makeContainer()]);
      const vm = wrapper.vm as any;
      expect(vm.groupByStack).toBe(false);
    });

    it('applies groupByStack=true from route query', async () => {
      mockRoute.query = { groupByStack: 'true' };
      const wrapper = await mountContainersView([makeContainer()]);
      expect((wrapper.vm as any).groupByStack).toBe(true);
    });

    it('applies groupByStack=1 from route query', async () => {
      mockRoute.query = { groupByStack: '1' };
      const wrapper = await mountContainersView([makeContainer()]);
      expect((wrapper.vm as any).groupByStack).toBe(true);
    });

    it('does not override groupByStack preference when query param is absent', async () => {
      mockRoute.query = {};
      const wrapper = await mountContainersView([makeContainer()]);
      expect((wrapper.vm as any).groupByStack).toBe(false);
    });

    it('sets groupByStack to false for invalid query values', async () => {
      mockRoute.query = { groupByStack: 'yes' };
      const wrapper = await mountContainersView([makeContainer()]);
      expect((wrapper.vm as any).groupByStack).toBe(false);
    });

    it('renderGroups returns a single flat group when groupByStack is false', async () => {
      const containers = [makeContainer(), makeContainer({ id: 'c2', name: 'redis' })];
      const wrapper = await mountContainersView(containers);
      const vm = wrapper.vm as any;
      expect(vm.renderGroups).toHaveLength(1);
      expect(vm.renderGroups[0].key).toBe('__flat__');
      expect(vm.renderGroups[0].containers).toHaveLength(2);
    });

    it('groups containers by stack membership when enabled', async () => {
      const containers = [
        makeContainer({ name: 'nginx' }),
        makeContainer({ id: 'c2', name: 'redis' }),
        makeContainer({ id: 'c3', name: 'postgres' }),
        makeContainer({ id: 'c4', name: 'mongo' }),
      ];
      const wrapper = await mountContainersView(containers);
      const vm = wrapper.vm as any;

      vm.groupByStack = true;
      vm.groupMembershipMap = {
        nginx: 'web-stack',
        redis: 'web-stack',
        postgres: 'db-stack',
        mongo: 'db-stack',
      };
      await flushPromises();

      const groups = vm.groupedContainers;
      expect(groups).toHaveLength(2);
      expect(groups[0].key).toBe('db-stack');
      expect(groups[0].containers).toHaveLength(2);
      expect(groups[1].key).toBe('web-stack');
      expect(groups[1].containers).toHaveLength(2);
    });

    it('places ungrouped containers last', async () => {
      const containers = [
        makeContainer({ name: 'nginx' }),
        makeContainer({ id: 'c2', name: 'redis' }),
        makeContainer({ id: 'c3', name: 'solo' }),
      ];
      const wrapper = await mountContainersView(containers);
      const vm = wrapper.vm as any;

      vm.groupByStack = true;
      vm.groupMembershipMap = { nginx: 'web-stack', redis: 'web-stack' };
      await flushPromises();

      const groups = vm.groupedContainers;
      expect(groups).toHaveLength(2);
      expect(groups[0].key).toBe('web-stack');
      expect(groups[1].key).toBe('__ungrouped__');
      expect(groups[1].name).toBeNull();
      expect(groups[1].containers).toHaveLength(1);
    });

    it('flattens single-container stacks into ungrouped bucket', async () => {
      const containers = [
        makeContainer({ name: 'nginx' }),
        makeContainer({ id: 'c2', name: 'redis' }),
        makeContainer({ id: 'c3', name: 'postgres' }),
      ];
      const wrapper = await mountContainersView(containers);
      const vm = wrapper.vm as any;

      vm.groupByStack = true;
      vm.groupMembershipMap = { nginx: 'web-stack', redis: 'web-stack', postgres: 'db-stack' };
      await flushPromises();

      const groups = vm.groupedContainers;
      // db-stack has only 1 container, so it should be flattened into ungrouped
      expect(groups).toHaveLength(2);
      expect(groups[0].key).toBe('web-stack');
      expect(groups[0].containers).toHaveLength(2);
      expect(groups[1].key).toBe('__ungrouped__');
      expect(groups[1].name).toBeNull();
      expect(groups[1].containers).toHaveLength(1);
      expect(groups[1].containers[0].name).toBe('postgres');
    });

    it('flattens all single-container stacks when none have multiple containers', async () => {
      const containers = [
        makeContainer({ name: 'nginx' }),
        makeContainer({ id: 'c2', name: 'redis' }),
      ];
      const wrapper = await mountContainersView(containers);
      const vm = wrapper.vm as any;

      vm.groupByStack = true;
      vm.groupMembershipMap = { nginx: 'web-stack', redis: 'db-stack' };
      await flushPromises();

      const groups = vm.groupedContainers;
      // Both stacks have only 1 container — all flattened into a single ungrouped bucket
      expect(groups).toHaveLength(1);
      expect(groups[0].key).toBe('__ungrouped__');
      expect(groups[0].containers).toHaveLength(2);
    });

    it('persists toggle state to preferences', async () => {
      const wrapper = await mountContainersView([makeContainer()]);
      const vm = wrapper.vm as any;

      vm.groupByStack = true;
      await flushPromises();
      const { flushPreferences } = await import('@/preferences/store');
      flushPreferences();
      const prefs1 = JSON.parse(localStorage.getItem('dd-preferences') ?? '{}');
      expect(prefs1.containers.groupByStack).toBe(true);

      vm.groupByStack = false;
      await flushPromises();
      flushPreferences();
      const prefs2 = JSON.parse(localStorage.getItem('dd-preferences') ?? '{}');
      expect(prefs2.containers.groupByStack).toBe(false);
    });

    it('toggles collapse state for groups', async () => {
      const wrapper = await mountContainersView([makeContainer()]);
      const vm = wrapper.vm as any;

      vm.toggleGroupCollapse('web-stack');
      expect(vm.collapsedGroups.has('web-stack')).toBe(true);

      vm.toggleGroupCollapse('web-stack');
      expect(vm.collapsedGroups.has('web-stack')).toBe(false);
    });

    it('counts updates within groups from actual container data', async () => {
      const containers = [
        makeContainer({ name: 'nginx', newTag: '2.0.0', updateKind: 'major' }),
        makeContainer({ id: 'c2', name: 'redis' }),
      ];
      const wrapper = await mountContainersView(containers);
      const vm = wrapper.vm as any;

      vm.groupByStack = true;
      vm.groupMembershipMap = { nginx: 'web-stack', redis: 'web-stack' };
      await flushPromises();

      const groups = vm.groupedContainers;
      expect(groups[0].updatesAvailable).toBe(1);
      expect(groups[0].containerCount).toBe(2);
    });

    it('shows grouped stack headers when grouping is enabled', async () => {
      const containers = [
        makeContainer({ name: 'nginx' }),
        makeContainer({ id: 'c2', name: 'redis' }),
      ];
      const wrapper = await mountContainersView(containers);
      const vm = wrapper.vm as any;

      expect(wrapper.text()).not.toContain('web-stack');

      vm.groupByStack = true;
      vm.groupMembershipMap = { nginx: 'web-stack', redis: 'web-stack' };
      await flushPromises();

      expect(wrapper.text()).toContain('web-stack');
    });

    it('updates all eligible containers in a group', async () => {
      const containers = [
        makeContainer({ id: 'c1', name: 'nginx', newTag: '2.0.0', updateKind: 'major' }),
        makeContainer({
          id: 'c2',
          name: 'redis',
          newTag: '7.0.0',
          updateKind: 'major',
          bouncer: 'blocked',
        }),
        makeContainer({ id: 'c3', name: 'postgres', newTag: '15.0.0', updateKind: 'major' }),
      ];
      const wrapper = await mountContainersView(containers);
      const vm = wrapper.vm as any;

      vm.groupByStack = true;
      vm.groupMembershipMap = { nginx: 'web-stack', redis: 'web-stack', postgres: 'web-stack' };
      await flushPromises();

      await vm.updateAllInGroup(vm.groupedContainers[0]);

      expect(mockApiUpdateBulk).toHaveBeenCalledWith(['c1', 'c3']);
      expect(mockApiUpdate).not.toHaveBeenCalled();
    });

    it('marks the first grouped container as updating while the bulk request is in flight', async () => {
      const containers = [
        makeContainer({ id: 'c1', name: 'nginx', newTag: '2.0.0', updateKind: 'major' }),
        makeContainer({ id: 'c2', name: 'redis' }),
      ];
      const wrapper = await mountContainersView(containers);
      const vm = wrapper.vm as any;
      let resolveBulkUpdate: (() => void) | undefined;
      mockApiUpdateBulk.mockImplementation(
        (containerIds: string[]) =>
          new Promise((resolve) => {
            resolveBulkUpdate = () =>
              resolve({
                message: 'Container update requests processed',
                accepted: containerIds.map((containerId) => ({
                  containerId,
                  containerName: containerId,
                  operationId: `op-${containerId}`,
                })),
                rejected: [],
              });
          }),
      );

      vm.groupByStack = true;
      vm.groupMembershipMap = { nginx: 'web-stack', redis: 'web-stack' };
      await flushPromises();

      const pending = vm.updateAllInGroup(vm.groupedContainers[0]);
      expect(vm.isContainerUpdateInProgress(containers[0])).toBe(true);

      resolveBulkUpdate?.();
      await pending;

      expect(vm.isContainerUpdateInProgress(containers[0])).toBe(true);
    });

    it('fetches groups when toggle is turned ON and map is empty', async () => {
      mockGetContainerGroups.mockResolvedValue([
        {
          name: 'my-stack',
          containers: [{ name: 'nginx', displayName: 'nginx' }],
          containerCount: 1,
          updatesAvailable: 0,
        },
      ]);
      const wrapper = await mountContainersView([makeContainer()]);
      const vm = wrapper.vm as any;

      vm.groupByStack = true;
      await flushPromises();

      expect(mockGetContainerGroups).toHaveBeenCalled();
      expect(vm.groupMembershipMap).toEqual({ nginx: 'my-stack' });
    });
  });

  describe('container logs viewer integration', () => {
    it('renders compact log viewer in side-panel logs tab', async () => {
      const c = makeContainer();
      const wrapper = await mountContainersView([c]);
      mockSelectedContainer.value = c;
      mockDetailPanelOpen.value = true;
      mockActiveDetailTab.value = 'logs';
      await flushPromises();

      const logsStubs = wrapper.findAll('[data-test="container-logs-stub"]');
      expect(logsStubs.length).toBeGreaterThan(0);
      const compactStub = logsStubs.find(
        (stub) =>
          stub.attributes('data-id') === 'c1' &&
          stub.attributes('data-name') === 'nginx' &&
          stub.attributes('data-compact') === 'true',
      );
      expect(compactStub).toBeDefined();
    });

    it('renders full-size log viewer for /containers/:id/logs route', async () => {
      const c = makeContainer({ id: 'container-42', name: 'api' });
      mockRoute.name = 'container-logs';
      mockRoute.path = '/containers/container-42/logs';
      mockRoute.params = { id: 'container-42' };

      const wrapper = await mountContainersView([c]);
      await flushPromises();

      const logsStubs = wrapper.findAll('[data-test="container-logs-stub"]');
      expect(logsStubs.length).toBeGreaterThan(0);
      const fullSizeStub = logsStubs.find(
        (stub) =>
          stub.attributes('data-id') === 'container-42' &&
          stub.attributes('data-name') === 'api' &&
          stub.attributes('data-compact') === 'false',
      );
      expect(fullSizeStub).toBeDefined();
    });
  });

  describe('coverage guards (view internals)', () => {
    it('reacts to route query changes after mount', async () => {
      const query = reactive({ q: 'nginx', filterKind: 'major', groupByStack: '' });
      mockRoute.query = query as unknown as Record<string, unknown>;
      const wrapper = await mountContainersView([makeContainer()]);
      const vm = wrapper.vm as any;

      query.q = 'redis';
      query.filterKind = 'minor';
      query.groupByStack = 'true';
      await flushPromises();

      expect(mockFilterSearch.value).toBe('redis');
      expect(mockFilterKind.value).toBe('minor');
      expect(vm.groupByStack).toBe(true);
    });

    it('handles non-string filterKind query values', async () => {
      const wrapper = await mountContainersView([makeContainer()]);
      const vm = wrapper.vm as any;

      vm.applyFilterKindFromQuery(42);
      expect(mockFilterKind.value).toBe('all');
    });

    it('covers sort toggling and all sort-key comparator branches', async () => {
      const containers = [
        makeContainer({
          id: 'c1',
          name: 'Zulu',
          image: 'nginx',
          currentTag: '1.0.0',
          status: 'running',
          server: 'Local',
          registry: 'dockerhub',
          bouncer: 'safe',
          updateKind: null,
        }),
        makeContainer({
          id: 'c2',
          name: 'alpha',
          image: 'nginx',
          currentTag: '2.0.0',
          status: 'stopped',
          server: 'Remote',
          registry: 'ghcr',
          bouncer: 'mystery' as any,
          updateKind: 'major',
        }),
        makeContainer({
          id: 'c3',
          name: 'bravo',
          image: 'busybox',
          currentTag: '1.5.0',
          status: 'running',
          server: 'Remote',
          registry: 'custom',
          bouncer: 'mystery-2' as any,
          updateKind: null,
        }),
      ];
      const wrapper = await mountContainersView(containers);
      const vm = wrapper.vm as any;

      vm.tableActionStyle = 'buttons';
      vm.containerSortKey = 'name';
      vm.containerSortAsc = true;
      vm.toggleContainerSort('name');
      void vm.sortedContainers;
      vm.toggleContainerSort('image');
      vm.containerSortAsc = false;
      void vm.sortedContainers;

      for (const key of ['image', 'status', 'server', 'registry', 'bouncer', 'kind', 'version']) {
        vm.containerSortKey = key;
        void vm.sortedContainers;
      }

      vm.containerSortKey = 'bouncer';
      mockFilteredContainers.value = [containers[0], containers[1], containers[2]];
      void vm.sortedContainers;
      mockFilteredContainers.value = [containers[1], containers[2], containers[0]];
      void vm.sortedContainers;

      vm.containerSortKey = 'kind';
      mockFilteredContainers.value = [containers[0], containers[1], containers[2]];
      void vm.sortedContainers;
      mockFilteredContainers.value = [containers[1], containers[0], containers[2]];
      void vm.sortedContainers;

      vm.containerSortKey = '__unknown__';
      void vm.sortedContainers;

      expect(vm.containerSortKey).toBe('__unknown__');
    });

    it('renderGroups flat-mode reflects sortedContainers order, not raw displayContainers order', async () => {
      // Mount with two containers in reverse-alphabetical order so that the raw
      // array order does NOT match an ascending name sort.
      const zebra = makeContainer({ id: 'c-z', name: 'zebra' });
      const apple = makeContainer({ id: 'c-a', name: 'apple' });
      // filteredContainers returns them zebra-first (un-sorted)
      const wrapper = await mountContainersView(
        [zebra, apple],
        [
          { id: 'c-z', name: 'zebra', displayName: 'zebra' },
          { id: 'c-a', name: 'apple', displayName: 'apple' },
        ],
      );
      mockFilteredContainers.value = [zebra, apple];
      const vm = wrapper.vm as any;

      vm.containerSortKey = 'name';
      vm.containerSortAsc = true;
      await flushPromises();

      // Ascending name sort: apple before zebra
      expect(vm.renderGroups[0].containers.map((c: Container) => c.id)).toEqual(['c-a', 'c-z']);

      vm.containerSortAsc = false;
      await flushPromises();

      // Descending name sort: zebra before apple
      expect(vm.renderGroups[0].containers.map((c: Container) => c.id)).toEqual(['c-z', 'c-a']);
    });

    it('covers selected container sync/meta branches and ghost pending containers', async () => {
      const live = makeContainer({ id: 'c1', name: 'nginx' });
      const wrapper = await mountContainersView([live]);
      const vm = wrapper.vm as any;

      vm.selectedContainer = makeContainer({ id: 'ghost', name: 'ghost' });
      vm.syncSelectedContainerReference();

      vm.selectedContainer = null;
      expect(vm.selectedContainerMeta).toBeUndefined();

      vm.selectedContainer = live;
      vm.containerMetaMap = { c1: 'not-an-object' };
      expect(vm.selectedContainerMeta).toBeUndefined();

      const duplicateName = makeContainer({ id: 'c2', name: 'nginx', server: 'Remote' });
      vm.containers = [duplicateName, live];
      vm.selectedContainer = makeContainer({ id: 'c1', name: 'nginx' });
      vm.syncSelectedContainerReference();
      expect(vm.selectedContainer.id).toBe('c1');

      vm.actionPending = new Map([['ghost', makeContainer({ id: 'ghost', name: 'ghost' })]]);
      const names = vm.displayContainers.map((container: Container) => container.name);
      expect(names).toContain('ghost');
    });

    it('reloads containers when the SSE connection is re-established', async () => {
      await mountContainersView([makeContainer({ id: 'c1', name: 'nginx' })]);
      const callsBeforeReconnect = mockGetAllContainers.mock.calls.length;

      globalThis.dispatchEvent(new CustomEvent('dd:sse-connected'));
      await flushPromises();

      expect(mockGetAllContainers.mock.calls.length).toBeGreaterThan(callsBeforeReconnect);
    });

    it('covers loadGroups success/skip/error paths', async () => {
      const wrapper = await mountContainersView([makeContainer({ name: 'nginx' })]);
      const vm = wrapper.vm as any;

      mockGetContainerGroups.mockResolvedValueOnce([
        {
          name: 'stack-a',
          containers: [{ name: 'nginx' }],
          containerCount: 1,
          updatesAvailable: 0,
        },
        {
          name: '',
          containers: [{ name: 'redis', displayName: 'redis' }],
          containerCount: 1,
          updatesAvailable: 0,
        },
      ]);
      await vm.loadGroups();
      expect(vm.groupMembershipMap).toEqual({ nginx: 'stack-a' });

      mockGetContainerGroups.mockRejectedValueOnce(new Error('network'));
      await vm.loadGroups();
      expect(vm.groupMembershipMap).toEqual({});
    });

    it('keeps same-named containers in their own groups when ids differ', async () => {
      const datavaultNode = makeContainer({
        id: 'c1',
        name: 'tdarr_node',
        server: 'Datavault',
      });
      const datavaultHelper = makeContainer({
        id: 'c2',
        name: 'helper-datavault',
        server: 'Datavault',
      });
      const tmvaultNode = makeContainer({
        id: 'c3',
        name: 'tdarr_node',
        server: 'Tmvault',
      });
      const tmvaultHelper = makeContainer({
        id: 'c4',
        name: 'helper-tmvault',
        server: 'Tmvault',
      });

      mockGetContainerGroups.mockResolvedValue([
        {
          name: 'stack-a',
          containers: [
            { id: 'c1', name: 'tdarr_node', displayName: 'tdarr_node' },
            { id: 'c2', name: 'helper-datavault', displayName: 'helper-datavault' },
          ],
          containerCount: 2,
          updatesAvailable: 0,
        },
        {
          name: 'stack-b',
          containers: [
            { id: 'c3', name: 'tdarr_node', displayName: 'tdarr_node' },
            { id: 'c4', name: 'helper-tmvault', displayName: 'helper-tmvault' },
          ],
          containerCount: 2,
          updatesAvailable: 0,
        },
      ]);

      const wrapper = await mountContainersView([
        datavaultNode,
        datavaultHelper,
        tmvaultNode,
        tmvaultHelper,
      ]);
      const vm = wrapper.vm as any;

      vm.groupByStack = true;
      await flushPromises();

      expect(vm.groupedContainers).toHaveLength(2);
      expect(vm.groupedContainers[0].key).toBe('stack-a');
      expect(
        vm.groupedContainers[0].containers.map((container: Container) => container.id).sort(),
      ).toEqual(['c1', 'c2']);
      expect(vm.groupedContainers[1].key).toBe('stack-b');
      expect(
        vm.groupedContainers[1].containers.map((container: Container) => container.id).sort(),
      ).toEqual(['c3', 'c4']);
    });

    it('restores saved panel state from storage when container is present', async () => {
      const c = makeContainer({ id: 'c1', name: 'nginx' });
      mockDetailPanelStorageRead.mockReturnValue({
        name: 'nginx',
        tab: 'logs',
        panel: true,
        full: true,
        size: 'lg',
      });

      const wrapper = await mountContainersView([c]);
      const vm = wrapper.vm as any;
      vm.containers = [c];

      const mountedHooks = vm.$?.m as Array<() => void> | undefined;
      mountedHooks?.[1]?.();

      expect(vm.selectedContainer?.name).toBe('nginx');
      expect(vm.activeDetailTab).toBe('logs');
      expect(vm.detailPanelOpen).toBe(true);
      expect(vm.containerFullPage).toBe(true);
      expect(vm.panelSize).toBe('lg');
    });

    it('covers menu/picker/global/sse handlers and registry fallback tooltip', async () => {
      vi.useFakeTimers();
      try {
        const c = makeContainer({ id: 'c1', name: 'nginx' });
        const wrapper = await mountContainersView(
          [c],
          [{ id: 'c1', name: 'nginx', displayName: 'nginx' }],
        );
        const vm = wrapper.vm as any;

        const event = {
          currentTarget: {
            getBoundingClientRect: () => ({ bottom: 120, right: 400, left: 80 }),
          },
        } as unknown as MouseEvent;

        vm.toggleActionsMenu('nginx', event);
        expect(vm.openActionsMenu).toBe('nginx');
        vm.toggleActionsMenu('nginx', event);
        expect(vm.openActionsMenu).toBeNull();
        vm.toggleActionsMenu('nginx', event);
        expect(vm.actionsMenuStyle.top).toBe('124px');
        vm.closeActionsMenu();
        expect(vm.openActionsMenu).toBeNull();

        vm.toggleColumnPicker(event);
        expect(vm.showColumnPicker).toBe(true);
        expect(vm.columnPickerStyle.left).toBe('80px');
        vm.toggleColumnPicker(event);
        expect(vm.showColumnPicker).toBe(false);

        vm.openActionsMenu = 'nginx';
        vm.showColumnPicker = true;
        document.dispatchEvent(new MouseEvent('click'));
        await flushPromises();
        expect(vm.openActionsMenu).toBeNull();
        expect(vm.showColumnPicker).toBe(false);

        vm.selectedContainer = null;
        globalThis.dispatchEvent(new Event('dd:sse-scan-completed'));
        await flushPromises();
        globalThis.dispatchEvent(new Event('dd:sse-container-changed'));
        await flushPromises();
        vi.advanceTimersByTime(500);
        await flushPromises();

        vm.selectedContainer = c;
        globalThis.dispatchEvent(new Event('dd:sse-scan-completed'));
        await flushPromises();
        globalThis.dispatchEvent(new Event('dd:sse-container-changed'));
        await flushPromises();
        vi.advanceTimersByTime(500);
        await flushPromises();
        expect(mockGetAllContainers.mock.calls.length).toBeGreaterThan(1);

        expect(vm.registryErrorTooltip(c)).toBe('Registry error');
      } finally {
        vi.useRealTimers();
      }
    });

    it('debounces burst dd:sse-container-changed events into one refresh cycle', async () => {
      vi.useFakeTimers();
      const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
      try {
        const c = makeContainer({ id: 'c1', name: 'nginx' });
        const wrapper = await mountContainersView(
          [c],
          [{ id: 'c1', name: 'nginx', displayName: 'nginx' }],
        );
        const vm = wrapper.vm as any;
        const containerChangedListener = addEventListenerSpy.mock.calls.findLast(
          ([eventName]) => eventName === 'dd:sse-container-changed',
        )?.[1] as EventListener | undefined;

        expect(containerChangedListener).toBeTypeOf('function');

        vm.groupByStack = true;
        vm.selectedContainer = c;
        await flushPromises();

        vi.clearAllTimers();
        mockGetAllContainers.mockClear();
        mockGetContainerGroups.mockClear();
        mockGetContainerVulnerabilities.mockClear();
        mockGetContainerSbom.mockClear();

        containerChangedListener?.(new Event('dd:sse-container-changed'));
        containerChangedListener?.(new Event('dd:sse-container-changed'));
        containerChangedListener?.(new Event('dd:sse-container-changed'));
        await flushPromises();

        expect(mockGetAllContainers).not.toHaveBeenCalled();
        expect(mockGetContainerGroups).not.toHaveBeenCalled();
        expect(mockGetContainerVulnerabilities).not.toHaveBeenCalled();
        expect(mockGetContainerSbom).not.toHaveBeenCalled();

        vi.advanceTimersByTime(499);
        await flushPromises();
        expect(mockGetAllContainers).not.toHaveBeenCalled();
        expect(mockGetContainerGroups).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        await flushPromises();

        expect(mockGetAllContainers).toHaveBeenCalledTimes(1);
        expect(mockGetContainerGroups).toHaveBeenCalledTimes(1);
        expect(mockGetContainerVulnerabilities).toHaveBeenCalledTimes(1);
        expect(mockGetContainerSbom).toHaveBeenCalledTimes(1);

        wrapper.unmount();
      } finally {
        addEventListenerSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('dd:sse-scan-completed does NOT call loadContainers (only security detail refresh)', async () => {
      vi.useFakeTimers();
      const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
      try {
        const c = makeContainer({ id: 'c1', name: 'nginx' });
        const wrapper = await mountContainersView(
          [c],
          [{ id: 'c1', name: 'nginx', displayName: 'nginx' }],
        );
        const vm = wrapper.vm as any;
        const scanCompletedListener = addEventListenerSpy.mock.calls.findLast(
          ([eventName]) => eventName === 'dd:sse-scan-completed',
        )?.[1] as EventListener | undefined;

        expect(scanCompletedListener).toBeTypeOf('function');

        mockGetAllContainers.mockClear();
        mockGetContainerVulnerabilities.mockClear();

        // No selected container: scan-completed must NOT trigger loadContainers
        vm.selectedContainer = null;
        scanCompletedListener?.(new Event('dd:sse-scan-completed'));
        await flushPromises();
        vi.runAllTimers();
        await flushPromises();

        expect(mockGetAllContainers).not.toHaveBeenCalled();

        // With selected container: scan-completed still must NOT trigger loadContainers,
        // but SHOULD trigger loadDetailSecurityData (vulnerability/sbom refresh)
        vm.selectedContainer = c;
        mockGetAllContainers.mockClear();
        mockGetContainerVulnerabilities.mockClear();
        scanCompletedListener?.(new Event('dd:sse-scan-completed'));
        await flushPromises();
        vi.runAllTimers();
        await flushPromises();

        expect(mockGetAllContainers).not.toHaveBeenCalled();
        // loadDetailSecurityData should fire (vulnerability refresh is the legit side-effect)
        expect(mockGetContainerVulnerabilities).toHaveBeenCalled();

        wrapper.unmount();
      } finally {
        addEventListenerSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('dd:sse-update-operation-changed does NOT call loadContainers', async () => {
      vi.useFakeTimers();
      const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
      try {
        const c = makeContainer({ id: 'c1', name: 'nginx' });
        const wrapper = await mountContainersView(
          [c],
          [{ id: 'c1', name: 'nginx', displayName: 'nginx' }],
        );
        const operationListener = addEventListenerSpy.mock.calls.findLast(
          ([eventName]) => eventName === 'dd:sse-update-operation-changed',
        )?.[1] as EventListener | undefined;

        expect(operationListener).toBeTypeOf('function');

        mockGetAllContainers.mockClear();

        operationListener?.(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-1',
              containerId: 'c1',
              containerName: 'nginx',
              status: 'in-progress',
              phase: 'pulling',
            },
          }),
        );
        await flushPromises();
        vi.runAllTimers();
        await flushPromises();

        expect(mockGetAllContainers).not.toHaveBeenCalled();

        wrapper.unmount();
      } finally {
        addEventListenerSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('dd:sse-container-changed DOES trigger loadContainers after debounce', async () => {
      vi.useFakeTimers();
      const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
      try {
        const c = makeContainer({ id: 'c1', name: 'nginx' });
        const wrapper = await mountContainersView(
          [c],
          [{ id: 'c1', name: 'nginx', displayName: 'nginx' }],
        );
        const containerChangedListener = addEventListenerSpy.mock.calls.findLast(
          ([eventName]) => eventName === 'dd:sse-container-changed',
        )?.[1] as EventListener | undefined;

        expect(containerChangedListener).toBeTypeOf('function');

        vi.clearAllTimers();
        mockGetAllContainers.mockClear();

        containerChangedListener?.(new Event('dd:sse-container-changed'));
        await flushPromises();
        // Before debounce fires — no call yet
        expect(mockGetAllContainers).not.toHaveBeenCalled();

        vi.advanceTimersByTime(500);
        await flushPromises();
        // After debounce fires — exactly one call
        expect(mockGetAllContainers).toHaveBeenCalledTimes(1);

        wrapper.unmount();
      } finally {
        addEventListenerSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('derives a held display update operation after raw terminal success', async () => {
      const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
      vi.useFakeTimers();
      try {
        const c = makeContainer({ id: 'c1', name: 'nginx' });
        const wrapper = await mountContainersView(
          [c],
          [{ id: 'c1', name: 'nginx', displayName: 'nginx' }],
        );
        const vm = wrapper.vm as any;
        const operationListener = addEventListenerSpy.mock.calls.findLast(
          ([eventName]) => eventName === 'dd:sse-update-operation-changed',
        )?.[1] as EventListener | undefined;

        expect(operationListener).toBeTypeOf('function');

        expect(vm.containers.find((c: any) => c.id === 'c1')?.updateOperation).toBeUndefined();

        operationListener?.(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-1',
              containerId: 'c1',
              containerName: 'nginx',
              status: 'in-progress',
              phase: 'pulling',
            },
          }),
        );

        const patched = vm.containers.find((c: any) => c.id === 'c1');
        expect(patched?.updateOperation).toBeDefined();
        expect(patched.updateOperation.status).toBe('in-progress');
        expect(patched.updateOperation.phase).toBe('pulling');
        expect(vm.displayContainers.find((c: any) => c.id === 'c1')?.updateOperation?.status).toBe(
          'in-progress',
        );

        vi.advanceTimersByTime(200);
        operationListener?.(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-1',
              containerId: 'c1',
              containerName: 'nginx',
              status: 'succeeded',
              phase: 'succeeded',
            },
          }),
        );

        const rawCleared = vm.containers.find((c: any) => c.id === 'c1');
        expect(rawCleared?.updateOperation).toBeUndefined();
        expect(vm.isContainerUpdateInProgress(rawCleared)).toBe(true);
        expect(vm.isContainerUpdateQueued(rawCleared)).toBe(false);
        expect(vm.displayContainers.find((c: any) => c.id === 'c1')?.updateOperation?.status).toBe(
          'in-progress',
        );

        vm.containers = [makeContainer({ id: 'c1', name: 'nginx' })];
        await flushPromises();
        expect(vm.isContainerUpdateInProgress(vm.containers[0])).toBe(true);
        expect(vm.displayContainers.find((c: any) => c.id === 'c1')?.updateOperation?.status).toBe(
          'in-progress',
        );

        vi.advanceTimersByTime(1499);
        await flushPromises();
        expect(vm.isContainerUpdateInProgress(vm.containers[0])).toBe(true);
        expect(vm.displayContainers.find((c: any) => c.id === 'c1')?.updateOperation?.status).toBe(
          'in-progress',
        );

        vi.advanceTimersByTime(1);
        await flushPromises();

        expect(vm.isContainerUpdateInProgress(vm.containers[0])).toBe(false);
        expect(vm.isContainerUpdateQueued(vm.containers[0])).toBe(false);
        expect(
          vm.displayContainers.find((c: any) => c.id === 'c1')?.updateOperation,
        ).toBeUndefined();

        wrapper.unmount();
      } finally {
        addEventListenerSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('keeps the display hold for the settle window when the operation fails, then releases', async () => {
      const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
      vi.useFakeTimers();
      try {
        const c = makeContainer({ id: 'c1', name: 'nginx' });
        const wrapper = await mountContainersView(
          [c],
          [{ id: 'c1', name: 'nginx', displayName: 'nginx' }],
        );
        const vm = wrapper.vm as any;
        const operationListener = addEventListenerSpy.mock.calls.findLast(
          ([eventName]) => eventName === 'dd:sse-update-operation-changed',
        )?.[1] as EventListener | undefined;

        expect(operationListener).toBeTypeOf('function');

        operationListener?.(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-1',
              containerId: 'c1',
              containerName: 'nginx',
              status: 'in-progress',
              phase: 'pulling',
            },
          }),
        );

        expect(vm.isContainerUpdateInProgress(vm.containers[0])).toBe(true);

        vi.advanceTimersByTime(200);
        operationListener?.(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-1',
              containerId: 'c1',
              containerName: 'nginx',
              status: 'failed',
              phase: 'failed',
            },
          }),
        );

        expect(vm.containers.find((c: any) => c.id === 'c1')?.updateOperation).toBeUndefined();
        // Hold remains for the settle window so the row does not jump as the raw
        // operation is cleared; released on the terminal timer.
        expect(vm.displayContainers.find((c: any) => c.id === 'c1')?.updateOperation?.status).toBe(
          'in-progress',
        );

        vi.advanceTimersByTime(1500);
        await flushPromises();
        expect(
          vm.displayContainers.find((c: any) => c.id === 'c1')?.updateOperation,
        ).toBeUndefined();
        expect(vm.isContainerUpdateInProgress(vm.containers[0])).toBe(false);

        wrapper.unmount();
      } finally {
        addEventListenerSpy.mockRestore();
        vi.useRealTimers();
      }
    });
  });

  describe('update completion toast (fix #289)', () => {
    it('fires toast.success when a tracked in-progress operation succeeds', async () => {
      const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
      vi.useFakeTimers();
      try {
        const c = makeContainer({ id: 'c1', name: 'nginx' });
        const wrapper = await mountContainersView(
          [c],
          [{ id: 'c1', name: 'nginx', displayName: 'nginx' }],
        );
        const operationListener = addEventListenerSpy.mock.calls.findLast(
          ([eventName]) => eventName === 'dd:sse-update-operation-changed',
        )?.[1] as EventListener | undefined;

        // First fire in-progress so the hold is registered
        operationListener?.(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-1',
              containerId: 'c1',
              containerName: 'nginx',
              status: 'in-progress',
              phase: 'pulling',
            },
          }),
        );

        const { useToast } = await import('@/composables/useToast');
        const { toasts } = useToast();
        const countBefore = toasts.value.length;

        // Terminal succeeded SSE — operation was tracked → toast should fire
        operationListener?.(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-1',
              containerId: 'c1',
              containerName: 'nginx',
              status: 'succeeded',
              phase: 'succeeded',
            },
          }),
        );

        expect(toasts.value.length).toBe(countBefore + 1);
        expect(toasts.value.at(-1)).toMatchObject({ tone: 'success', title: 'Updated: nginx' });

        wrapper.unmount();
      } finally {
        addEventListenerSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('fires toast.success when succeeded follows only a queued SSE (fast single update, no in-progress)', async () => {
      const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
      vi.useFakeTimers();
      try {
        const c = makeContainer({ id: 'c1', name: 'nginx' });
        const wrapper = await mountContainersView(
          [c],
          [{ id: 'c1', name: 'nginx', displayName: 'nginx' }],
        );
        const operationListener = addEventListenerSpy.mock.calls.findLast(
          ([eventName]) => eventName === 'dd:sse-update-operation-changed',
        )?.[1] as EventListener | undefined;

        // Only queued SSE fires — backend skips in-progress phase on fast standalone updates
        operationListener?.(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-fast',
              containerId: 'c1',
              containerName: 'nginx',
              status: 'queued',
              phase: 'queued',
            },
          }),
        );

        const { useToast } = await import('@/composables/useToast');
        const { toasts } = useToast();
        const countBefore = toasts.value.length;

        operationListener?.(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-fast',
              containerId: 'c1',
              containerName: 'nginx',
              status: 'succeeded',
              phase: 'succeeded',
            },
          }),
        );

        expect(toasts.value.length).toBe(countBefore + 1);
        expect(toasts.value.at(-1)).toMatchObject({ tone: 'success', title: 'Updated: nginx' });

        wrapper.unmount();
      } finally {
        addEventListenerSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('does NOT fire a toast when succeeded SSE has no tracked in-progress operation (replay guard)', async () => {
      const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
      vi.useFakeTimers();
      try {
        const c = makeContainer({ id: 'c1', name: 'nginx' });
        const wrapper = await mountContainersView(
          [c],
          [{ id: 'c1', name: 'nginx', displayName: 'nginx' }],
        );
        const operationListener = addEventListenerSpy.mock.calls.findLast(
          ([eventName]) => eventName === 'dd:sse-update-operation-changed',
        )?.[1] as EventListener | undefined;

        const { useToast } = await import('@/composables/useToast');
        const { toasts } = useToast();
        const countBefore = toasts.value.length;

        // Fire succeeded directly with no prior in-progress (replay scenario)
        operationListener?.(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-replay',
              containerId: 'c1',
              containerName: 'nginx',
              status: 'succeeded',
              phase: 'succeeded',
            },
          }),
        );

        expect(toasts.value.length).toBe(countBefore);

        wrapper.unmount();
      } finally {
        addEventListenerSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('fires individual toasts for multiple distinct containers completing in parallel', async () => {
      const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
      vi.useFakeTimers();
      try {
        const c1 = makeContainer({ id: 'c1', name: 'nginx' });
        const c2 = makeContainer({ id: 'c2', name: 'redis' });
        const wrapper = await mountContainersView(
          [c1, c2],
          [
            { id: 'c1', name: 'nginx', displayName: 'nginx' },
            { id: 'c2', name: 'redis', displayName: 'redis' },
          ],
        );
        const operationListener = addEventListenerSpy.mock.calls.findLast(
          ([eventName]) => eventName === 'dd:sse-update-operation-changed',
        )?.[1] as EventListener | undefined;

        // Register both in-progress
        operationListener?.(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-c1',
              containerId: 'c1',
              containerName: 'nginx',
              status: 'in-progress',
              phase: 'pulling',
            },
          }),
        );
        operationListener?.(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-c2',
              containerId: 'c2',
              containerName: 'redis',
              status: 'in-progress',
              phase: 'pulling',
            },
          }),
        );

        const { useToast } = await import('@/composables/useToast');
        const { toasts } = useToast();
        const countBefore = toasts.value.length;

        // Both succeed
        operationListener?.(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-c1',
              containerId: 'c1',
              containerName: 'nginx',
              status: 'succeeded',
              phase: 'succeeded',
            },
          }),
        );
        operationListener?.(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-c2',
              containerId: 'c2',
              containerName: 'redis',
              status: 'succeeded',
              phase: 'succeeded',
            },
          }),
        );

        expect(toasts.value.length).toBe(countBefore + 2);
        const newToasts = toasts.value.slice(countBefore);
        expect(newToasts.some((t) => t.title === 'Updated: nginx')).toBe(true);
        expect(newToasts.some((t) => t.title === 'Updated: redis')).toBe(true);

        wrapper.unmount();
      } finally {
        addEventListenerSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('fires toast.error when a tracked operation transitions to failed', async () => {
      const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
      vi.useFakeTimers();
      try {
        const c = makeContainer({ id: 'c1', name: 'nginx' });
        const wrapper = await mountContainersView(
          [c],
          [{ id: 'c1', name: 'nginx', displayName: 'nginx' }],
        );
        const operationListener = addEventListenerSpy.mock.calls.findLast(
          ([eventName]) => eventName === 'dd:sse-update-operation-changed',
        )?.[1] as EventListener | undefined;

        operationListener?.(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-fail',
              containerId: 'c1',
              containerName: 'nginx',
              status: 'in-progress',
              phase: 'pulling',
            },
          }),
        );

        const { useToast } = await import('@/composables/useToast');
        const { toasts } = useToast();
        const countBefore = toasts.value.length;

        operationListener?.(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-fail',
              containerId: 'c1',
              containerName: 'nginx',
              status: 'failed',
              phase: 'failed',
            },
          }),
        );

        expect(toasts.value.length).toBe(countBefore + 1);
        expect(toasts.value.at(-1)).toMatchObject({ tone: 'error', title: 'Update failed: nginx' });

        wrapper.unmount();
      } finally {
        addEventListenerSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('fires toast.error when a tracked operation rolls back', async () => {
      const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
      vi.useFakeTimers();
      try {
        const c = makeContainer({ id: 'c1', name: 'nginx' });
        const wrapper = await mountContainersView(
          [c],
          [{ id: 'c1', name: 'nginx', displayName: 'nginx' }],
        );
        const operationListener = addEventListenerSpy.mock.calls.findLast(
          ([eventName]) => eventName === 'dd:sse-update-operation-changed',
        )?.[1] as EventListener | undefined;

        operationListener?.(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-rb',
              containerId: 'c1',
              containerName: 'nginx',
              status: 'in-progress',
              phase: 'pulling',
            },
          }),
        );

        const { useToast } = await import('@/composables/useToast');
        const { toasts } = useToast();
        const countBefore = toasts.value.length;

        operationListener?.(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-rb',
              containerId: 'c1',
              containerName: 'nginx',
              status: 'rolled-back',
              phase: 'rolled-back',
            },
          }),
        );

        expect(toasts.value.length).toBe(countBefore + 1);
        expect(toasts.value.at(-1)).toMatchObject({ tone: 'error', title: 'Rolled back: nginx' });

        wrapper.unmount();
      } finally {
        addEventListenerSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('survives a long operation window without expiring the display hold (fix #289 extended hold)', async () => {
      const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
      vi.useFakeTimers();
      try {
        const c = makeContainer({ id: 'c1', name: 'nginx' });
        const wrapper = await mountContainersView(
          [c],
          [{ id: 'c1', name: 'nginx', displayName: 'nginx' }],
        );
        const vm = wrapper.vm as any;
        const operationListener = addEventListenerSpy.mock.calls.findLast(
          ([eventName]) => eventName === 'dd:sse-update-operation-changed',
        )?.[1] as EventListener | undefined;

        operationListener?.(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-slow',
              containerId: 'c1',
              containerName: 'nginx',
              status: 'queued',
              phase: 'queued',
            },
          }),
        );

        // Simulate a 60-second update — hold must survive the full window
        vi.advanceTimersByTime(60_000);
        await flushPromises();

        expect(vm.isContainerUpdateInProgress(vm.containers[0])).toBe(true);

        const { useToast } = await import('@/composables/useToast');
        const { toasts } = useToast();
        const countBefore = toasts.value.length;

        operationListener?.(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-slow',
              containerId: 'c1',
              containerName: 'nginx',
              status: 'succeeded',
              phase: 'succeeded',
            },
          }),
        );

        expect(toasts.value.length).toBe(countBefore + 1);
        expect(toasts.value.at(-1)).toMatchObject({ tone: 'success', title: 'Updated: nginx' });

        wrapper.unmount();
      } finally {
        addEventListenerSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('fires toast.error when rolled-back arrives after a 60-second operation window', async () => {
      const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
      vi.useFakeTimers();
      try {
        const c = makeContainer({ id: 'c1', name: 'nginx' });
        const wrapper = await mountContainersView(
          [c],
          [{ id: 'c1', name: 'nginx', displayName: 'nginx' }],
        );
        const vm = wrapper.vm as any;
        const operationListener = addEventListenerSpy.mock.calls.findLast(
          ([eventName]) => eventName === 'dd:sse-update-operation-changed',
        )?.[1] as EventListener | undefined;

        operationListener?.(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-slow-rb',
              containerId: 'c1',
              containerName: 'nginx',
              status: 'in-progress',
              phase: 'pulling',
            },
          }),
        );

        // Simulate a 60-second update — hold must survive the full window
        vi.advanceTimersByTime(60_000);
        await flushPromises();

        expect(vm.isContainerUpdateInProgress(vm.containers[0])).toBe(true);

        const { useToast } = await import('@/composables/useToast');
        const { toasts } = useToast();
        const countBefore = toasts.value.length;

        operationListener?.(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-slow-rb',
              containerId: 'c1',
              containerName: 'nginx',
              status: 'rolled-back',
              phase: 'rolled-back',
            },
          }),
        );

        expect(toasts.value.length).toBe(countBefore + 1);
        expect(toasts.value.at(-1)).toMatchObject({ tone: 'error', title: 'Rolled back: nginx' });

        wrapper.unmount();
      } finally {
        addEventListenerSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('keeps the display hold for the settle window when the operation rolls back, then releases', async () => {
      const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
      vi.useFakeTimers();
      try {
        const c = makeContainer({ id: 'c1', name: 'nginx' });
        const wrapper = await mountContainersView(
          [c],
          [{ id: 'c1', name: 'nginx', displayName: 'nginx' }],
        );
        const vm = wrapper.vm as any;
        const operationListener = addEventListenerSpy.mock.calls.findLast(
          ([eventName]) => eventName === 'dd:sse-update-operation-changed',
        )?.[1] as EventListener | undefined;

        operationListener?.(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-rb-hold',
              containerId: 'c1',
              containerName: 'nginx',
              status: 'in-progress',
              phase: 'pulling',
            },
          }),
        );

        expect(vm.isContainerUpdateInProgress(vm.containers[0])).toBe(true);

        vi.advanceTimersByTime(200);
        operationListener?.(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-rb-hold',
              containerId: 'c1',
              containerName: 'nginx',
              status: 'rolled-back',
              phase: 'rolled-back',
            },
          }),
        );

        expect(vm.containers.find((c: any) => c.id === 'c1')?.updateOperation).toBeUndefined();
        // Hold remains for the settle window so the row does not jump
        expect(vm.displayContainers.find((c: any) => c.id === 'c1')?.updateOperation?.status).toBe(
          'in-progress',
        );

        vi.advanceTimersByTime(1500);
        await flushPromises();
        expect(
          vm.displayContainers.find((c: any) => c.id === 'c1')?.updateOperation,
        ).toBeUndefined();
        expect(vm.isContainerUpdateInProgress(vm.containers[0])).toBe(false);

        wrapper.unmount();
      } finally {
        addEventListenerSpy.mockRestore();
        vi.useRealTimers();
      }
    });
  });

  describe('containerIds query filter', () => {
    it('shows all containers when containerIds query param is absent', async () => {
      mockRoute.query = {};
      const containers = [
        makeContainer({ id: 'c1', name: 'nginx' }),
        makeContainer({ id: 'c2', name: 'redis' }),
      ];
      const wrapper = await mountContainersView(containers);
      const vm = wrapper.vm as any;

      expect(vm.filterContainerIds.size).toBe(0);
      expect(vm.displayContainers.map((c: Container) => c.id)).toEqual(
        expect.arrayContaining(['c1', 'c2']),
      );
    });

    it('filters displayContainers to matched IDs when containerIds query param is set', async () => {
      mockRoute.query = { containerIds: 'c1,c2' };
      const containers = [
        makeContainer({ id: 'c1', name: 'nginx' }),
        makeContainer({ id: 'c2', name: 'redis' }),
        makeContainer({ id: 'c3', name: 'postgres' }),
      ];
      mockFilteredContainers.value = containers;
      const wrapper = await mountContainersView(containers);
      const vm = wrapper.vm as any;

      expect(vm.filterContainerIds.size).toBe(2);
      const displayIds = vm.displayContainers.map((c: Container) => c.id);
      expect(displayIds).toContain('c1');
      expect(displayIds).toContain('c2');
      expect(displayIds).not.toContain('c3');
    });

    it('clearContainerIdsFilter empties the set and removes query param', async () => {
      mockRoute.query = { containerIds: 'c1' };
      const containers = [makeContainer({ id: 'c1', name: 'nginx' })];
      const wrapper = await mountContainersView(containers);
      const vm = wrapper.vm as any;

      expect(vm.filterContainerIds.size).toBe(1);

      vm.clearContainerIdsFilter();
      await flushPromises();

      expect(vm.filterContainerIds.size).toBe(0);
    });

    it('reacts to route query changes updating containerIds', async () => {
      const query = reactive({ containerIds: '' }) as Record<string, unknown>;
      mockRoute.query = query;
      const containers = [
        makeContainer({ id: 'c1', name: 'nginx' }),
        makeContainer({ id: 'c2', name: 'redis' }),
      ];
      mockFilteredContainers.value = containers;
      const wrapper = await mountContainersView(containers);
      const vm = wrapper.vm as any;

      expect(vm.filterContainerIds.size).toBe(0);

      query.containerIds = 'c2';
      await flushPromises();

      expect(vm.filterContainerIds.size).toBe(1);
      expect(vm.filterContainerIds.has('c2')).toBe(true);
    });

    it('deep-link by containerIds bypasses active filters like Hide Pinned (#299)', async () => {
      // A directed deep-link (e.g. Security's "View in Containers") must always
      // show the linked container, even when Hide Pinned / kind / server filters
      // would otherwise hide it. Simulate Hide Pinned being active by shrinking
      // mockFilteredContainers to exclude the pinned row AFTER mount — the
      // deep-link still finds it because the id filter works from the raw
      // container list, not the pre-filtered one.
      mockRoute.query = { containerIds: 'pinned' };
      const containers = [
        makeContainer({
          id: 'pinned',
          name: 'grafana',
          currentTag: '12.3.2',
          tagPinned: true,
          newTag: '12.3.3',
        }),
        makeContainer({ id: 'other', name: 'nginx' }),
      ];
      const wrapper = await mountContainersView(containers);
      mockFilteredContainers.value = [containers[1]];
      await flushPromises();
      const vm = wrapper.vm as any;

      expect(vm.displayContainers.map((c: Container) => c.id)).toEqual(['pinned']);
    });
  });

  describe('sort stability during held update (fix #289)', () => {
    it('does not change sort position when status and updateKind flip mid-recreate', async () => {
      const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
      vi.useFakeTimers();
      try {
        // Two containers: nginx (minor, running) should sort BEFORE redis (patch, running) by kind
        const nginx = makeContainer({
          id: 'c1',
          name: 'nginx',
          updateKind: 'minor',
          status: 'running',
        });
        const redis = makeContainer({
          id: 'c2',
          name: 'redis',
          updateKind: 'patch',
          status: 'running',
        });
        const wrapper = await mountContainersView(
          [nginx, redis],
          [
            { id: 'c1', name: 'nginx', displayName: 'nginx' },
            { id: 'c2', name: 'redis', displayName: 'redis' },
          ],
        );
        const vm = wrapper.vm as any;
        const operationListener = addEventListenerSpy.mock.calls.findLast(
          ([eventName]) => eventName === 'dd:sse-update-operation-changed',
        )?.[1] as EventListener | undefined;

        // Set sort to 'kind' ascending (major=0, minor=1, patch=2)
        vm.containerSortKey = 'kind';
        vm.containerSortAsc = true;
        await flushPromises();

        const sortedBefore = vm.sortedContainers.map((c: any) => c.id);
        expect(sortedBefore[0]).toBe('c1'); // nginx (minor=1) before redis (patch=2)

        // nginx starts updating — captures sort snapshot
        operationListener?.(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-nginx',
              containerId: 'c1',
              containerName: 'nginx',
              status: 'in-progress',
              phase: 'pulling',
            },
          }),
        );

        // Simulate docker recreate window: nginx raw data flips to stopped + no updateKind
        vm.containers = [{ ...nginx, status: 'stopped', updateKind: null, newTag: null }, redis];
        mockFilteredContainers.value = vm.containers;
        await flushPromises();

        // sortedContainers must be stable — nginx should still be first because projection freezes sort fields
        const sortedDuring = vm.sortedContainers.map((c: any) => c.id);
        expect(sortedDuring[0]).toBe('c1');

        wrapper.unmount();
      } finally {
        addEventListenerSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('restores natural sort order once the hold window expires', async () => {
      const addEventListenerSpy = vi.spyOn(globalThis, 'addEventListener');
      vi.useFakeTimers();
      try {
        const nginx = makeContainer({
          id: 'c1',
          name: 'nginx',
          updateKind: 'minor',
          status: 'running',
        });
        const redis = makeContainer({
          id: 'c2',
          name: 'redis',
          updateKind: 'patch',
          status: 'running',
        });
        const wrapper = await mountContainersView(
          [nginx, redis],
          [
            { id: 'c1', name: 'nginx', displayName: 'nginx' },
            { id: 'c2', name: 'redis', displayName: 'redis' },
          ],
        );
        const vm = wrapper.vm as any;
        const operationListener = addEventListenerSpy.mock.calls.findLast(
          ([eventName]) => eventName === 'dd:sse-update-operation-changed',
        )?.[1] as EventListener | undefined;

        vm.containerSortKey = 'kind';
        vm.containerSortAsc = true;
        await flushPromises();

        operationListener?.(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-nginx',
              containerId: 'c1',
              containerName: 'nginx',
              status: 'in-progress',
              phase: 'pulling',
            },
          }),
        );

        // Terminal succeeded — schedules release
        operationListener?.(
          new CustomEvent('dd:sse-update-operation-changed', {
            detail: {
              operationId: 'op-nginx',
              containerId: 'c1',
              containerName: 'nginx',
              status: 'succeeded',
              phase: 'succeeded',
            },
          }),
        );

        // After reload: nginx has no updateKind (already up-to-date); redis still has patch
        const nginxUpdated = { ...nginx, updateKind: null as null, newTag: null };
        vm.containers = [nginxUpdated, redis];
        mockFilteredContainers.value = vm.containers;
        await flushPromises();

        // During hold window, projected sort fields still keep nginx in position 0
        // (updateKind='minor' frozen), so sort order is unchanged
        expect(vm.sortedContainers[0].id).toBe('c1');

        // Advance past the hold window
        vi.advanceTimersByTime(1600);
        await flushPromises();

        // Now projection releases — nginx has no updateKind (sorts to 9), redis (patch=2) wins
        expect(vm.sortedContainers[0].id).toBe('c2');

        wrapper.unmount();
      } finally {
        addEventListenerSpy.mockRestore();
        vi.useRealTimers();
      }
    });
  });
});
