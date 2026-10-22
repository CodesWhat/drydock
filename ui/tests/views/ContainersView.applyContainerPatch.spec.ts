import { flushPromises } from '@vue/test-utils';
import { computed, defineComponent, ref } from 'vue';
import type { Container, ContainerUpdateOperation } from '@/types/container';
import ContainersView from '@/views/ContainersView.vue';
import { useContainerSsePatchPipeline } from '@/views/containers/useContainerSsePatchPipeline';
import { mountWithPlugins } from '../helpers/mount';

// --- Hoisted values for mocks that need them in factory functions ---
const {
  mockRoute,
  mockRouterReplace,
  mockContainerActionsEnabled,
  mockLoadServerFeatures,
  mockGetOperationByContainerId,
} = vi.hoisted(() => ({
  mockRoute: {
    name: 'containers',
    path: '/containers',
    params: {} as Record<string, unknown>,
    query: {} as Record<string, unknown>,
  },
  mockRouterReplace: vi.fn().mockResolvedValue(undefined),
  mockContainerActionsEnabled: { value: true },
  mockLoadServerFeatures: vi.fn().mockResolvedValue(undefined),
  mockGetOperationByContainerId: vi.fn().mockReturnValue(undefined),
}));

// Reactive store state for the mocked operations store. Tests set
// mockStoreOperationsById.value[containerId] = op to report an active operation.
// This is declared here (after hoisting but before vi.mock calls) so the
// vi.mock('@/stores/operations') factory can close over it.
const mockStoreOperationsById = ref<Record<string, unknown>>({});

vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
  useRouter: () => ({ replace: mockRouterReplace }),
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

vi.mock('@/services/container', () => ({
  deleteContainer: vi.fn(),
  getAllContainers: vi.fn(),
  getContainerGroups: vi.fn().mockResolvedValue([]),
  getContainerLogs: vi.fn(),
  getContainerUpdateOperations: vi.fn().mockResolvedValue([]),
  getContainerSbom: vi.fn().mockResolvedValue({ format: 'spdx-json', document: {} }),
  getContainerTriggersWithReasons: vi
    .fn()
    .mockResolvedValue({ data: [], unassociatedTriggers: [], notificationSkips: [] }),
  getContainerVulnerabilities: vi.fn().mockResolvedValue({
    status: 'not-scanned',
    summary: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
    vulnerabilities: [],
  }),
  getUpdateOperationById: vi.fn().mockResolvedValue(null),
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

vi.mock('@/stores/operations', () => ({
  useOperationStore: () => ({
    // Pinia auto-unwraps refs; consumers see the plain Map/object directly
    displayBatches: new Map(),
    byId: {},
    batchSummaries: {},
    // getOperationByContainerId reads from the reactive mockStoreOperationsById.
    // The mockGetOperationByContainerId spy is also called so tests can assert on it.
    getOperationByContainerId: (containerId: string) => {
      mockGetOperationByContainerId(containerId);
      return mockStoreOperationsById.value[containerId];
    },
    getOperationForContainer: vi.fn().mockReturnValue(undefined),
    isContainerUpdateActive: (container: { id: string }) =>
      mockStoreOperationsById.value[container.id] !== undefined,
    getBatchProgress: vi.fn().mockReturnValue(undefined),
    getActiveBatchProgress: vi.fn().mockReturnValue([]),
    captureDisplayBatch: vi.fn(),
    clearDisplayBatch: vi.fn(),
    getDisplayBatch: vi.fn().mockReturnValue(undefined),
    incrementDisplayBatchFailed: vi.fn(),
    incrementDisplayBatchSucceeded: vi.fn(),
    replaceDisplayBatches: vi.fn(),
    seedFromContainerList: vi.fn(),
    applyOperationChanged: vi.fn(),
    applyUpdateApplied: vi.fn(),
    applyUpdateFailed: vi.fn(),
    applyBatchCompleted: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));

// Both mapApiContainer (singular) and mapApiContainers are mocked here
// so applyContainerPatch can control what mapApiContainer returns per-test.
vi.mock('@/utils/container-mapper', () => ({
  mapApiContainer: vi.fn(),
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

// --- Composable mocks ---
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

vi.mock('@/composables/useContainerFilters', async () => {
  const { useFleetDimensions } = await import('@/composables/useFleetDimensions');
  return {
    useContainerFilters: vi.fn((containers) => ({
      fleet: useFleetDimensions(containers),
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
  };
});

const mockIsMobile = ref(false);
const mockWindowNarrow = ref(false);
const mockWindowWidth = ref(1440);

vi.mock('@/composables/useBreakpoints', () => ({
  useBreakpoints: vi.fn(() => ({
    isMobile: mockIsMobile,
    windowNarrow: mockWindowNarrow,
    windowWidth: mockWindowWidth,
  })),
}));

const mockVisibleColumns = ref(
  new Set(['icon', 'name', 'version', 'kind', 'status', 'bouncer', 'server', 'registry']),
);

vi.mock('@/composables/useColumnVisibility', () => ({
  useColumnVisibility: vi.fn(() => ({
    allColumns: [
      { key: 'icon', label: '', align: 'text-center', required: true },
      { key: 'name', label: 'Container', align: 'text-left', required: true },
    ],
    visibleColumns: mockVisibleColumns,
    autoHiddenColumns: computed(() => []),
    hiddenColumnKeys: computed(() => []),
    toggleColumn: vi.fn(),
    resetColumns: vi.fn(),
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

// --- Child component stubs ---
const childStubs = {
  DataViewLayout: { template: '<div class="data-view-layout"><slot /><slot name="panel" /></div>' },
  DataFilterBar: {
    template:
      '<div class="data-filter-bar"><slot name="filters" /><slot name="extra-buttons" /><slot name="left" /><slot name="center" /></div>',
    props: ['modelValue', 'showFilters', 'filteredCount', 'totalCount', 'activeFilterCount'],
  },
  DataTable: {
    template: '<div class="data-table"></div>',
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
  },
  DataCardGrid: {
    template: '<div class="data-card-grid"></div>',
    props: ['items', 'itemKey', 'selectedKey'],
  },
  DataListAccordion: {
    template: '<div class="data-list-accordion"></div>',
    props: ['items', 'itemKey', 'selectedKey'],
  },
  DetailPanel: {
    template: '<div class="detail-panel"><slot name="header" /><slot /></div>',
    props: ['open', 'isMobile', 'size', 'showSizeControls', 'showFullPage'],
  },
  EmptyState: {
    template: '<div class="empty-state"></div>',
    props: ['icon', 'message', 'showClear'],
  },
  ContainerLogs: { template: '<div></div>', props: ['containerId', 'containerName', 'compact'] },
  UpdateMaturityBadge: { template: '<span></span>', props: ['maturity', 'tooltip', 'size'] },
  SuggestedTagBadge: { template: '<span></span>', props: ['tag', 'currentTag'] },
  ReleaseNotesLink: { template: '<span></span>', props: ['releaseNotes', 'releaseLink'] },
};

import { getAllContainers } from '@/services/container';
import { mapApiContainer, mapApiContainers } from '@/utils/container-mapper';

const mockGetAllContainers = getAllContainers as ReturnType<typeof vi.fn>;
const mockMapApiContainer = mapApiContainer as ReturnType<typeof vi.fn>;
const mockMapApiContainers = mapApiContainers as ReturnType<typeof vi.fn>;

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
    isDigestPinned: false,
    status: 'running',
    registry: 'dockerhub',
    updateKind: null,
    bouncer: 'safe',
    server: defaultServer,
    details: { ports: [], volumes: [], env: [], labels: [] },
    ...overrides,
  };
}

async function mountContainersView(containers: Container[] = [], apiContainersInput?: any[]) {
  const apiContainers =
    apiContainersInput ?? containers.map((c) => ({ ...c, displayName: c.name }));
  mockGetAllContainers.mockResolvedValue(apiContainers);
  mockMapApiContainers.mockReturnValue(containers);
  mockFilteredContainers.value = containers;
  mockSelectedContainer.value = null;
  mockDetailPanelOpen.value = false;
  mockContainerFullPage.value = false;
  mockActiveDetailTab.value = 'overview';

  const wrapper = mountWithPlugins(ContainersView, { global: { stubs: childStubs } });
  mountedWrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

describe('ContainersView — applyContainerPatch', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockRouterReplace.mockResolvedValue(undefined);
    mockStoreOperationsById.value = {};
    mockContainerActionsEnabled.value = true;
    mockIsMobile.value = false;
    mockWindowNarrow.value = false;
    mockWindowWidth.value = 1440;
    mockDetailPanelOpen.value = false;
    mockPanelSize.value = 'sm';
    mockDetailPanelStorageRead.mockReturnValue(null);
    mockRoute.name = 'containers';
    mockRoute.path = '/containers';
    mockRoute.params = {};
    mockRoute.query = {};
    const { resetPreferences } = await import('@/preferences/store');
    resetPreferences();
  });

  afterEach(() => {
    while (mountedWrappers.length > 0) {
      mountedWrappers.pop()?.unmount();
    }
  });

  describe('added', () => {
    it('pushes a new mapped row when the id is not already in the list', async () => {
      const existing = makeContainer({ id: 'c1', name: 'nginx' });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      const rawNew = { id: 'c2', name: 'redis' };
      const mappedNew = makeContainer({ id: 'c2', name: 'redis' });
      mockMapApiContainer.mockReturnValueOnce(mappedNew);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-added', { detail: rawNew }));
      await flushPromises();

      expect(vm.containers).toHaveLength(2);
      expect(vm.containers[1]).toStrictEqual(mappedNew);
    });

    it('updates the lookup maps with id and name entries after add', async () => {
      const existing = makeContainer({ id: 'c1', name: 'nginx' });
      const wrapper = await mountContainersView(
        [existing],
        [{ id: 'c1', name: 'nginx', displayName: 'nginx' }],
      );
      const vm = wrapper.vm as any;

      const rawNew = { id: 'c2', name: 'redis' };
      const mappedNew = makeContainer({ id: 'c2', name: 'redis' });
      mockMapApiContainer.mockReturnValueOnce(mappedNew);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-added', { detail: rawNew }));
      await flushPromises();

      expect(vm.containerIdMap.c2).toBe('c2');
      expect(vm.containerIdMap.redis).toBe('c2');
      expect(vm.containerMetaMap.c2).toMatchObject({ id: 'c2', name: 'redis' });
    });

    it('mutates in place when id already exists (add with duplicate id)', async () => {
      const existing = makeContainer({ id: 'c1', name: 'nginx', currentTag: '1.0.0' });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      const originalRef = vm.containers[0];
      const raw = { id: 'c1', name: 'nginx' };
      const updated = makeContainer({ id: 'c1', name: 'nginx', currentTag: '2.0.0' });
      mockMapApiContainer.mockReturnValueOnce(updated);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-added', { detail: raw }));
      await flushPromises();

      // Length must not change — in-place merge
      expect(vm.containers).toHaveLength(1);
      // The row object reference is preserved
      expect(vm.containers[0]).toBe(originalRef);
      // But its fields were updated
      expect(vm.containers[0].currentTag).toBe('2.0.0');
    });
  });

  describe('updated', () => {
    it('skips idless rows when rebuilding the container index', async () => {
      const existing = makeContainer({ id: '', name: 'idless', currentTag: '1.0.0' });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      expect(vm.containers).toHaveLength(1);
      expect(vm.containers[0].id).toBe('');
    });

    it('merges fields in place when row exists by id — preserves reference', async () => {
      const existing = makeContainer({ id: 'c1', name: 'nginx', currentTag: '1.0.0' });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      const originalRef = vm.containers[0];
      const raw = { id: 'c1', name: 'nginx' };
      const updated = makeContainer({ id: 'c1', name: 'nginx', currentTag: '1.1.0' });
      mockMapApiContainer.mockReturnValueOnce(updated);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-updated', { detail: raw }));
      await flushPromises();

      expect(vm.containers).toHaveLength(1);
      expect(vm.containers[0]).toBe(originalRef);
      expect(vm.containers[0].currentTag).toBe('1.1.0');
    });

    it('keeps cached host filter options stable unless an SSE patch changes the server set', async () => {
      const existing = makeContainer({
        id: 'c1',
        name: 'nginx',
        currentTag: '1.0.0',
        server: 'Datavault',
      });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;
      const originalServerNames = vm.serverNames;

      mockMapApiContainer.mockReturnValueOnce(
        makeContainer({
          id: 'c1',
          name: 'nginx',
          currentTag: '1.1.0',
          server: 'Datavault',
        }),
      );
      globalThis.dispatchEvent(
        new CustomEvent('dd:sse-container-updated', { detail: { id: 'c1', name: 'nginx' } }),
      );
      await flushPromises();

      expect(vm.serverNames).toBe(originalServerNames);

      mockMapApiContainer.mockReturnValueOnce(
        makeContainer({
          id: 'c1',
          name: 'nginx',
          currentTag: '1.1.0',
          server: 'Tmvault',
        }),
      );
      globalThis.dispatchEvent(
        new CustomEvent('dd:sse-container-updated', { detail: { id: 'c1', name: 'nginx' } }),
      );
      await flushPromises();

      expect(vm.serverNames).toEqual(['Tmvault']);
      expect(vm.serverNames).not.toBe(originalServerNames);
    });

    it('merges fields in place when row matched by name when id is absent', async () => {
      const existing = makeContainer({ id: 'c1', name: 'nginx', currentTag: '1.0.0' });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      const originalRef = vm.containers[0];
      // Payload has name but no id
      const raw = { name: 'nginx' };
      const updated = makeContainer({ id: 'c1', name: 'nginx', currentTag: '1.2.0' });
      mockMapApiContainer.mockReturnValueOnce(updated);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-updated', { detail: raw }));
      await flushPromises();

      expect(vm.containers).toHaveLength(1);
      expect(vm.containers[0]).toBe(originalRef);
      expect(vm.containers[0].currentTag).toBe('1.2.0');
    });

    it('uses the lookup map for name-only patches instead of scanning the container array', async () => {
      const existing = makeContainer({ id: 'c1', name: 'nginx', currentTag: '1.0.0' });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      const originalRef = vm.containers[0];
      const findIndexSpy = vi.fn(() => {
        throw new Error('container array scan should not be used');
      });
      Object.defineProperty(vm.containers, 'findIndex', {
        configurable: true,
        value: findIndexSpy,
      });

      const raw = { name: 'nginx' };
      const updated = makeContainer({ id: 'c1', name: 'nginx', currentTag: '1.3.0' });
      mockMapApiContainer.mockReturnValueOnce(updated);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-updated', { detail: raw }));
      await flushPromises();

      expect(findIndexSpy).not.toHaveBeenCalled();
      expect(vm.containers[0]).toBe(originalRef);
      expect(vm.containers[0].currentTag).toBe('1.3.0');
    });

    it('resolves id-only patches through the lookup map before mutating a row', async () => {
      const existing = makeContainer({ id: 'canonical-c1', name: 'nginx', currentTag: '1.0.0' });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      const originalRef = vm.containers[0];
      vm.containerIdMap['runtime-c1'] = 'canonical-c1';

      const raw = { id: 'runtime-c1' };
      const updated = makeContainer({
        id: 'canonical-c1',
        name: 'nginx',
        currentTag: '1.4.0',
      });
      mockMapApiContainer.mockReturnValueOnce(updated);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-updated', { detail: raw }));
      await flushPromises();

      expect(vm.containers).toHaveLength(1);
      expect(vm.containers[0]).toBe(originalRef);
      expect(vm.containers[0].currentTag).toBe('1.4.0');
    });

    it('pushes a new row for updated event when id is unknown (new container)', async () => {
      const existing = makeContainer({ id: 'c1', name: 'nginx' });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      const raw = { id: 'c3', name: 'mongo' };
      const mappedNew = makeContainer({ id: 'c3', name: 'mongo' });
      mockMapApiContainer.mockReturnValueOnce(mappedNew);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-updated', { detail: raw }));
      await flushPromises();

      expect(vm.containers).toHaveLength(2);
      expect(vm.containers[1]).toStrictEqual(mappedNew);
    });

    it('updates lookup maps after update', async () => {
      const existing = makeContainer({ id: 'c1', name: 'nginx' });
      const wrapper = await mountContainersView(
        [existing],
        [{ id: 'c1', name: 'nginx', displayName: 'nginx' }],
      );
      const vm = wrapper.vm as any;

      const raw = { id: 'c1', name: 'nginx' };
      const updated = makeContainer({ id: 'c1', name: 'nginx', currentTag: '2.0.0' });
      mockMapApiContainer.mockReturnValueOnce(updated);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-updated', { detail: raw }));
      await flushPromises();

      expect(vm.containerIdMap.c1).toBe('c1');
      expect(vm.containerIdMap.nginx).toBe('c1');
      expect(vm.containerMetaMap.c1).toMatchObject({ id: 'c1', name: 'nginx' });
    });
  });

  describe('removed', () => {
    it('removes the matching row from containers by id', async () => {
      const c1 = makeContainer({ id: 'c1', name: 'nginx' });
      const c2 = makeContainer({ id: 'c2', name: 'redis' });
      const wrapper = await mountContainersView([c1, c2]);
      const vm = wrapper.vm as any;

      globalThis.dispatchEvent(
        new CustomEvent('dd:sse-container-removed', { detail: { id: 'c1', name: 'nginx' } }),
      );
      await flushPromises();

      expect(vm.containers).toHaveLength(1);
      expect(vm.containers[0].id).toBe('c2');
    });

    it('removes the matching row from containers by name when id is absent', async () => {
      const c1 = makeContainer({ id: 'c1', name: 'nginx' });
      const c2 = makeContainer({ id: 'c2', name: 'redis' });
      const wrapper = await mountContainersView([c1, c2]);
      const vm = wrapper.vm as any;

      globalThis.dispatchEvent(
        new CustomEvent('dd:sse-container-removed', { detail: { name: 'nginx' } }),
      );
      await flushPromises();

      expect(vm.containers).toHaveLength(1);
      expect(vm.containers[0].id).toBe('c2');
    });

    it('removes lookup map entries for id and name after remove', async () => {
      const c1 = makeContainer({ id: 'c1', name: 'nginx' });
      const wrapper = await mountContainersView(
        [c1],
        [{ id: 'c1', name: 'nginx', displayName: 'nginx' }],
      );
      const vm = wrapper.vm as any;

      // Verify they're present before the remove
      expect(vm.containerIdMap.c1).toBe('c1');
      expect(vm.containerIdMap.nginx).toBe('c1');

      globalThis.dispatchEvent(
        new CustomEvent('dd:sse-container-removed', { detail: { id: 'c1', name: 'nginx' } }),
      );
      await flushPromises();

      expect(vm.containerIdMap.c1).toBeUndefined();
      expect(vm.containerIdMap.nginx).toBeUndefined();
      expect(vm.containerMetaMap.c1).toBeUndefined();
      expect(vm.containerMetaMap.nginx).toBeUndefined();
    });

    it('is a no-op when the container id is not in the list', async () => {
      const c1 = makeContainer({ id: 'c1', name: 'nginx' });
      const wrapper = await mountContainersView([c1]);
      const vm = wrapper.vm as any;

      globalThis.dispatchEvent(
        new CustomEvent('dd:sse-container-removed', {
          detail: { id: 'unknown-id', name: 'ghost' },
        }),
      );
      await flushPromises();

      // Length unchanged; no error thrown
      expect(vm.containers).toHaveLength(1);
    });
  });

  describe('fallback to full reload', () => {
    it('calls getAllContainers when detail is falsy', async () => {
      const existing = makeContainer({ id: 'c1', name: 'nginx' });
      await mountContainersView([existing]);
      mockGetAllContainers.mockClear();

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-added', { detail: null }));
      await flushPromises();

      expect(mockGetAllContainers).toHaveBeenCalledTimes(1);
    });

    it('calls getAllContainers when detail is non-object (string)', async () => {
      const existing = makeContainer({ id: 'c1', name: 'nginx' });
      await mountContainersView([existing]);
      mockGetAllContainers.mockClear();

      globalThis.dispatchEvent(
        new CustomEvent('dd:sse-container-updated', { detail: 'not-an-object' }),
      );
      await flushPromises();

      expect(mockGetAllContainers).toHaveBeenCalledTimes(1);
    });

    it('calls getAllContainers when detail lacks both id and name', async () => {
      const existing = makeContainer({ id: 'c1', name: 'nginx' });
      await mountContainersView([existing]);
      mockGetAllContainers.mockClear();

      globalThis.dispatchEvent(
        new CustomEvent('dd:sse-container-added', { detail: { image: 'nginx:latest' } }),
      );
      await flushPromises();

      expect(mockGetAllContainers).toHaveBeenCalledTimes(1);
    });

    it('calls getAllContainers when mapApiContainer throws for added event', async () => {
      const existing = makeContainer({ id: 'c1', name: 'nginx' });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;
      mockGetAllContainers.mockClear();
      mockMapApiContainer.mockImplementationOnce(() => {
        throw new Error('mapper error');
      });

      globalThis.dispatchEvent(
        new CustomEvent('dd:sse-container-added', { detail: { id: 'c2', name: 'redis' } }),
      );
      await flushPromises();

      expect(mockGetAllContainers).toHaveBeenCalledTimes(1);
      // The broken container must not be pushed
      expect(vm.containers).toHaveLength(1);
    });

    it('calls getAllContainers when mapApiContainer throws for updated event', async () => {
      const existing = makeContainer({ id: 'c1', name: 'nginx' });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;
      mockGetAllContainers.mockClear();
      mockMapApiContainer.mockImplementationOnce(() => {
        throw new Error('mapper error');
      });

      globalThis.dispatchEvent(
        new CustomEvent('dd:sse-container-updated', { detail: { id: 'c1', name: 'nginx' } }),
      );
      await flushPromises();

      expect(mockGetAllContainers).toHaveBeenCalledTimes(1);
      // Length unchanged on fallback — the broken update did not mutate rows
      expect(vm.containers).toHaveLength(1);
    });
  });

  describe('hold reconciliation across container-metadata SSE patches', () => {
    function makeOperation(
      overrides: Partial<ContainerUpdateOperation> = {},
    ): ContainerUpdateOperation {
      return {
        id: 'op-1',
        status: 'in-progress',
        phase: 'pulling',
        updatedAt: '2026-05-01T12:00:00.000Z',
        ...overrides,
      };
    }

    it('reconcileHoldsAgainstContainers does NOT schedule a release when the store still holds the operation', async () => {
      // This test verifies the end-to-end symptom: after a container-metadata SSE patch,
      // reconciliation sees the store operation as active and does not trigger release.
      const activeOp = makeOperation({ id: 'op-health', status: 'in-progress', phase: 'pulling' });
      const existing = makeContainer({
        id: 'c1',
        name: 'vaultwarden',
      });
      await mountContainersView([existing]);
      // The store still indexes the active operation for this container.
      mockStoreOperationsById.value = { c1: activeOp };

      // Seed the hold map via the operation composable so reconcile has something to check
      const { useOperationDisplayHold } = await import('@/composables/useOperationDisplayHold');
      const { holdOperationDisplay, heldOperations, clearAllOperationDisplayHolds } =
        useOperationDisplayHold();

      holdOperationDisplay({
        operationId: activeOp.id,
        operation: activeOp,
        containerId: 'c1',
        containerName: 'vaultwarden',
        now: Date.now(),
      });

      expect(heldOperations.value.has(activeOp.id)).toBe(true);
      const originalDisplayUntil = heldOperations.value.get(activeOp.id)!.displayUntil;

      // SSE container-updated arrives for the container (e.g. new container metadata)
      const raw = { id: 'c1', name: 'vaultwarden' };
      const mappedWithoutOp = makeContainer({
        id: 'c1',
        name: 'vaultwarden',
        currentTag: '1.31.0',
      });
      mockMapApiContainer.mockReturnValueOnce(mappedWithoutOp);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-updated', { detail: raw }));
      await flushPromises();

      // The hold must still be present (not transitioned to short release window)
      // Because the store still has the operation, reconcile saw it active and skipped
      const hold = heldOperations.value.get(activeOp.id);
      expect(hold).toBeDefined();
      // displayUntil must still be the long active window (10 minutes from now),
      // not the short 1500ms release window
      const shortReleaseWindow = Date.now() + 1500 + 1000; // some headroom
      expect(hold!.displayUntil).toBeGreaterThan(shortReleaseWindow);
      expect(hold!.displayUntil).toBe(originalDisplayUntil);

      clearAllOperationDisplayHolds();
    });
  });

  describe('operation patch guards', () => {
    it('ignores malformed update-operation-changed payloads', async () => {
      const c = makeContainer({ id: 'c1', name: 'nginx' });
      const wrapper = await mountContainersView(
        [c],
        [{ id: 'c1', name: 'nginx', displayName: 'nginx' }],
      );
      const vm = wrapper.vm as any;
      mockGetAllContainers.mockClear();

      globalThis.dispatchEvent(new CustomEvent('dd:sse-update-operation-changed'));
      await flushPromises();

      expect(vm.containers).toHaveLength(1);
      expect(mockGetAllContainers).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it('handles terminal operation events when no container row matches', async () => {
      const c = makeContainer({ id: 'c1', name: 'nginx' });
      const wrapper = await mountContainersView(
        [c],
        [{ id: 'c1', name: 'nginx', displayName: 'nginx' }],
      );
      const vm = wrapper.vm as any;

      globalThis.dispatchEvent(
        new CustomEvent('dd:sse-update-operation-changed', {
          detail: {
            operationId: 'op-missing-row',
            containerId: 'missing-container',
            status: 'failed',
            phase: 'failed',
            lastError: 'container disappeared',
          },
        }),
      );
      await flushPromises();

      expect(vm.containers).toHaveLength(1);
      wrapper.unmount();
    });

    it('resolves operation targets by newContainerId when containerId is absent', async () => {
      const c = makeContainer({ id: 'c1', name: 'nginx' });
      const wrapper = await mountContainersView(
        [c],
        [{ id: 'c1', name: 'nginx', displayName: 'nginx' }],
      );
      const { useOperationDisplayHold } = await import('@/composables/useOperationDisplayHold');
      const { heldOperations, clearAllOperationDisplayHolds } = useOperationDisplayHold();

      globalThis.dispatchEvent(
        new CustomEvent('dd:sse-update-operation-changed', {
          detail: {
            operationId: 'op-new-id-target',
            newContainerId: 'c1',
            status: 'in-progress',
            phase: 'pulling',
          },
        }),
      );
      await flushPromises();

      expect(heldOperations.value.get('op-new-id-target')?.operation).toMatchObject({
        id: 'op-new-id-target',
        status: 'in-progress',
        phase: 'pulling',
      });
      clearAllOperationDisplayHolds();
      wrapper.unmount();
    });

    it('ignores an unrecognized container patch kind after mapping', async () => {
      const reconcileHoldsAgainstContainers = vi.fn();
      const Harness = defineComponent({
        setup(_, { expose }) {
          const containers = ref<Container[]>([]);
          const pipeline = useContainerSsePatchPipeline({
            containers,
            containerIdMap: ref<Record<string, string>>({}),
            containerMetaMap: ref<Record<string, unknown>>({}),
            selectedContainerId: ref(undefined),
            loadContainers: vi.fn().mockResolvedValue(undefined),
            loadDetailSecurityData: vi.fn().mockResolvedValue(undefined),
            reconcileHoldsAgainstContainers,
            schedulePostTerminalReload: vi.fn(),
          });
          expose({ containers, ...pipeline });
          return () => null;
        },
      });
      const wrapper = mountWithPlugins(Harness);
      mountedWrappers.push(wrapper);
      await flushPromises();
      const vm = wrapper.vm as any;

      mockMapApiContainer.mockReturnValueOnce(makeContainer({ id: 'c-noop', name: 'noop' }));

      vm.applyContainerPatch(
        new CustomEvent('dd:sse-container-noop', {
          detail: { id: 'c-noop', name: 'noop' },
        }),
        'noop',
      );
      await flushPromises();

      expect(vm.containers).toHaveLength(0);
      expect(reconcileHoldsAgainstContainers).toHaveBeenCalledWith([]);
    });
  });
});
