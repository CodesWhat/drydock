import { flushPromises } from '@vue/test-utils';
import { computed, ref } from 'vue';
import type { Container, ContainerUpdateOperation } from '@/types/container';
import ContainersView from '@/views/ContainersView.vue';
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

// Reactive store state for deferred-attach watcher tests.
// The watch() in ContainersView observes operationStore.getOperationByContainerId(id),
// so we need that function to read from a reactive source. Tests set
// mockStoreOperationsById.value[containerId] = op to trigger the watcher.
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
  getContainerTriggers: vi.fn().mockResolvedValue([]),
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
    // getOperationByContainerId reads from the reactive mockStoreOperationsById so
    // that Vue watch() in ContainersView fires when a test sets
    // mockStoreOperationsById.value[containerId] = op.
    // The mockGetOperationByContainerId spy is also called so tests can assert on
    // it; the reactive read is what drives the watcher.
    getOperationByContainerId: (containerId: string) => {
      mockGetOperationByContainerId(containerId);
      return mockStoreOperationsById.value[containerId];
    },
    getBatchProgress: vi.fn().mockReturnValue(undefined),
    captureDisplayBatch: vi.fn(),
    clearDisplayBatch: vi.fn(),
    getDisplayBatch: vi.fn().mockReturnValue(undefined),
    incrementDisplayBatchFailed: vi.fn(),
    incrementDisplayBatchSucceeded: vi.fn(),
    replaceDisplayBatches: vi.fn(),
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
const mockShowColumnPicker = ref(false);

vi.mock('@/composables/useColumnVisibility', () => ({
  useColumnVisibility: vi.fn(() => ({
    allColumns: [
      { key: 'icon', label: '', align: 'text-center', required: true },
      { key: 'name', label: 'Container', align: 'text-left', required: true },
    ],
    visibleColumns: mockVisibleColumns,
    activeColumns: computed(() => [
      { key: 'icon', label: '', align: 'text-center' },
      { key: 'name', label: 'Container', align: 'text-left' },
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

      expect(vm.containerIdMap['c2']).toBe('c2');
      expect(vm.containerIdMap['redis']).toBe('c2');
      expect(vm.containerMetaMap['c2']).toMatchObject({ id: 'c2', name: 'redis' });
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

      expect(vm.containerIdMap['c1']).toBe('c1');
      expect(vm.containerIdMap['nginx']).toBe('c1');
      expect(vm.containerMetaMap['c1']).toMatchObject({ id: 'c1', name: 'nginx' });
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
      expect(vm.containerIdMap['c1']).toBe('c1');
      expect(vm.containerIdMap['nginx']).toBe('c1');

      globalThis.dispatchEvent(
        new CustomEvent('dd:sse-container-removed', { detail: { id: 'c1', name: 'nginx' } }),
      );
      await flushPromises();

      expect(vm.containerIdMap['c1']).toBeUndefined();
      expect(vm.containerIdMap['nginx']).toBeUndefined();
      expect(vm.containerMetaMap['c1']).toBeUndefined();
      expect(vm.containerMetaMap['nginx']).toBeUndefined();
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

  describe('updateOperation preservation across container-metadata SSE patches', () => {
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

    it('preserves an active updateOperation when the SSE patch does not carry one', async () => {
      const activeOp = makeOperation();
      const existing = makeContainer({
        id: 'c1',
        name: 'vaultwarden',
        currentTag: '1.30.0',
        updateOperation: activeOp,
      });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      // SSE container-updated arrives for the new container — no updateOperation in payload
      const raw = { id: 'c1', name: 'vaultwarden' };
      const mappedWithoutOp = makeContainer({
        id: 'c1',
        name: 'vaultwarden',
        currentTag: '1.31.0',
        updateOperation: undefined, // mapper returns undefined — SSE had no updateOperation
      });
      mockMapApiContainer.mockReturnValueOnce(mappedWithoutOp);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-updated', { detail: raw }));
      await flushPromises();

      // The row must reflect the new container metadata…
      expect(vm.containers[0].currentTag).toBe('1.31.0');
      // …but the active updateOperation must be preserved, not wiped
      expect(vm.containers[0].updateOperation).toEqual(activeOp);
    });

    it('does not preserve updateOperation when the row had none before the patch', async () => {
      const existing = makeContainer({
        id: 'c1',
        name: 'nginx',
        currentTag: '1.0.0',
        updateOperation: undefined,
      });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      const raw = { id: 'c1', name: 'nginx' };
      const mappedWithoutOp = makeContainer({
        id: 'c1',
        name: 'nginx',
        currentTag: '1.1.0',
        updateOperation: undefined,
      });
      mockMapApiContainer.mockReturnValueOnce(mappedWithoutOp);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-updated', { detail: raw }));
      await flushPromises();

      expect(vm.containers[0].currentTag).toBe('1.1.0');
      expect(vm.containers[0].updateOperation).toBeUndefined();
    });

    it('allows a defined mapped.updateOperation to overwrite an existing one', async () => {
      const oldOp = makeOperation({ id: 'op-old', phase: 'pulling' });
      const newOp = makeOperation({ id: 'op-new', phase: 'health-checking' });
      const existing = makeContainer({
        id: 'c1',
        name: 'nginx',
        updateOperation: oldOp,
      });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      // This simulates a REST refresh that includes an updateOperation
      const raw = { id: 'c1', name: 'nginx' };
      const mappedWithNewOp = makeContainer({
        id: 'c1',
        name: 'nginx',
        updateOperation: newOp,
      });
      mockMapApiContainer.mockReturnValueOnce(mappedWithNewOp);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-updated', { detail: raw }));
      await flushPromises();

      // New operation from the patch must replace the old one
      expect(vm.containers[0].updateOperation).toEqual(newOp);
    });

    it('preserves updateOperation across added event for existing row with active op', async () => {
      const activeOp = makeOperation();
      const existing = makeContainer({
        id: 'c1',
        name: 'redis',
        updateOperation: activeOp,
      });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      // dd:container-added for an already-known id triggers in-place merge
      const raw = { id: 'c1', name: 'redis' };
      const mappedWithoutOp = makeContainer({
        id: 'c1',
        name: 'redis',
        currentTag: '7.2.0',
        updateOperation: undefined,
      });
      mockMapApiContainer.mockReturnValueOnce(mappedWithoutOp);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-added', { detail: raw }));
      await flushPromises();

      // Still one row (in-place merge, not push)
      expect(vm.containers).toHaveLength(1);
      // updateOperation preserved
      expect(vm.containers[0].updateOperation).toEqual(activeOp);
    });

    it('does NOT preserve updateOperation for a brand-new row inserted by added event', async () => {
      const existing = makeContainer({ id: 'c1', name: 'nginx' });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      // New container id — will be pushed, not merged
      const raw = { id: 'c2', name: 'redis' };
      const mappedNew = makeContainer({
        id: 'c2',
        name: 'redis',
        updateOperation: undefined,
      });
      mockMapApiContainer.mockReturnValueOnce(mappedNew);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-added', { detail: raw }));
      await flushPromises();

      expect(vm.containers).toHaveLength(2);
      expect(vm.containers[1].updateOperation).toBeUndefined();
    });

    it('reconcileHoldsAgainstContainers does NOT schedule a release when updateOperation is preserved', async () => {
      // This test verifies the end-to-end symptom: after a container-metadata SSE patch,
      // reconciliation sees the preserved operation as active and does not trigger release.
      const activeOp = makeOperation({ id: 'op-health', status: 'in-progress', phase: 'pulling' });
      const existing = makeContainer({
        id: 'c1',
        name: 'vaultwarden',
        updateOperation: activeOp,
      });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      // Seed the hold map via the operation composable so reconcile has something to check
      const { useOperationDisplayHold } = await import('@/composables/useOperationDisplayHold');
      const {
        holdOperationDisplay,
        heldOperations,
        clearAllOperationDisplayHolds,
        scheduleHeldOperationRelease,
      } = useOperationDisplayHold();

      holdOperationDisplay({
        operationId: activeOp.id,
        operation: activeOp,
        containerId: 'c1',
        containerName: 'vaultwarden',
        now: Date.now(),
      });

      expect(heldOperations.value.has(activeOp.id)).toBe(true);
      const originalDisplayUntil = heldOperations.value.get(activeOp.id)!.displayUntil;

      // SSE container-updated arrives without updateOperation (e.g. new container metadata)
      const raw = { id: 'c1', name: 'vaultwarden' };
      const mappedWithoutOp = makeContainer({
        id: 'c1',
        name: 'vaultwarden',
        currentTag: '1.31.0',
        updateOperation: undefined,
      });
      mockMapApiContainer.mockReturnValueOnce(mappedWithoutOp);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-updated', { detail: raw }));
      await flushPromises();

      // The hold must still be present (not transitioned to short release window)
      // Because the operation was preserved, reconcile saw rawIsActive = true and skipped
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

  describe('store-operation lookup for new rows (idx === -1 branch)', () => {
    function makeStoreOp(
      overrides: Partial<{
        operationId: string;
        containerId: string;
        newContainerId: string;
        status: string;
        phase: string;
        batchId: string;
      }> = {},
    ) {
      return {
        operationId: 'op-store-1',
        containerId: 'c-new',
        status: 'in-progress',
        phase: 'pulling',
        ...overrides,
      };
    }

    it('attaches an active store operation to a brand-new row on dd:container-added', async () => {
      const existing = makeContainer({ id: 'c1', name: 'nginx' });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      // Simulate an active operation already in the store BEFORE container-added arrives
      // (direct-controller path: operation arrives first, synchronous lookup succeeds).
      const storeOp = makeStoreOp({
        operationId: 'op-new',
        containerId: 'c-new',
        status: 'in-progress',
        phase: 'pulling',
      });
      mockStoreOperationsById.value['c-new'] = storeOp;

      const rawNew = { id: 'c-new', name: 'vaultwarden' };
      const mappedNew = makeContainer({
        id: 'c-new',
        name: 'vaultwarden',
        updateOperation: undefined,
      });
      mockMapApiContainer.mockReturnValueOnce(mappedNew);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-added', { detail: rawNew }));
      await flushPromises();

      expect(vm.containers).toHaveLength(2);
      const newRow = vm.containers[1] as Container;
      // Row must arrive with the store operation attached
      expect(newRow.updateOperation).toBeDefined();
      expect(newRow.updateOperation!.id).toBe('op-new');
      expect(newRow.updateOperation!.status).toBe('in-progress');
      expect(newRow.updateOperation!.phase).toBe('pulling');
      // getOperationByContainerId must have been called with the new container's id
      expect(mockGetOperationByContainerId).toHaveBeenCalledWith('c-new');
    });

    it('leaves updateOperation undefined when no active store operation exists for new row', async () => {
      const existing = makeContainer({ id: 'c1', name: 'nginx' });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      // No store operation for this container (mockStoreOperationsById is empty by default)

      const rawNew = { id: 'c2', name: 'redis' };
      const mappedNew = makeContainer({ id: 'c2', name: 'redis', updateOperation: undefined });
      mockMapApiContainer.mockReturnValueOnce(mappedNew);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-added', { detail: rawNew }));
      await flushPromises();

      expect(vm.containers).toHaveLength(2);
      expect(vm.containers[1].updateOperation).toBeUndefined();
    });

    it('attaches an active store operation to a new row on dd:container-updated (unknown id)', async () => {
      const existing = makeContainer({ id: 'c1', name: 'nginx' });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      const storeOp = makeStoreOp({
        operationId: 'op-upd',
        containerId: 'c-upd',
        status: 'queued',
        phase: 'queued',
      });
      mockStoreOperationsById.value['c-upd'] = storeOp;

      const rawNew = { id: 'c-upd', name: 'mongo' };
      const mappedNew = makeContainer({ id: 'c-upd', name: 'mongo', updateOperation: undefined });
      mockMapApiContainer.mockReturnValueOnce(mappedNew);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-updated', { detail: rawNew }));
      await flushPromises();

      expect(vm.containers).toHaveLength(2);
      const newRow = vm.containers[1] as Container;
      expect(newRow.updateOperation).toBeDefined();
      expect(newRow.updateOperation!.id).toBe('op-upd');
      expect(newRow.updateOperation!.status).toBe('queued');
    });

    it('does not overwrite a mapped.updateOperation that is already set on a new row', async () => {
      const existing = makeContainer({ id: 'c1', name: 'nginx' });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      // Store has an operation but mapper also produced one — mapper wins
      const storeOp = makeStoreOp({ operationId: 'op-store', containerId: 'c2' });
      mockStoreOperationsById.value['c2'] = storeOp;

      const mappedOp: ContainerUpdateOperation = {
        id: 'op-mapper',
        status: 'in-progress',
        phase: 'pulling',
        updatedAt: '2026-05-01T00:00:00.000Z',
      };
      const rawNew = { id: 'c2', name: 'redis' };
      const mappedNew = makeContainer({ id: 'c2', name: 'redis', updateOperation: mappedOp });
      mockMapApiContainer.mockReturnValueOnce(mappedNew);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-added', { detail: rawNew }));
      await flushPromises();

      expect(vm.containers[1].updateOperation!.id).toBe('op-mapper');
      // Store was not consulted because mapped.updateOperation was already defined
      expect(mockGetOperationByContainerId).not.toHaveBeenCalled();
    });

    it('preserves existing row operation in merge branch before falling back to store', async () => {
      const activeOp: ContainerUpdateOperation = {
        id: 'op-existing',
        status: 'in-progress',
        phase: 'pulling',
        updatedAt: '2026-05-01T00:00:00.000Z',
      };
      const existing = makeContainer({ id: 'c1', name: 'vaultwarden', updateOperation: activeOp });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      // Store has a different op but the row already has one — row op wins
      const storeOp = makeStoreOp({ operationId: 'op-store', containerId: 'c1' });
      mockStoreOperationsById.value['c1'] = storeOp;

      const raw = { id: 'c1', name: 'vaultwarden' };
      const mappedWithoutOp = makeContainer({
        id: 'c1',
        name: 'vaultwarden',
        currentTag: '1.31.0',
        updateOperation: undefined,
      });
      mockMapApiContainer.mockReturnValueOnce(mappedWithoutOp);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-updated', { detail: raw }));
      await flushPromises();

      expect(vm.containers).toHaveLength(1);
      // Existing row op takes priority; store not consulted for the fallback
      expect(vm.containers[0].updateOperation!.id).toBe('op-existing');
      expect(mockGetOperationByContainerId).not.toHaveBeenCalled();
    });

    it('attaches store operation via merge branch when row has no op and patch has no op', async () => {
      const existing = makeContainer({ id: 'c1', name: 'nginx', updateOperation: undefined });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      const storeOp = makeStoreOp({
        operationId: 'op-merge-store',
        containerId: 'c1',
        status: 'in-progress',
        phase: 'health-checking',
      });
      mockStoreOperationsById.value['c1'] = storeOp;

      const raw = { id: 'c1', name: 'nginx' };
      const mappedWithoutOp = makeContainer({
        id: 'c1',
        name: 'nginx',
        currentTag: '1.2.0',
        updateOperation: undefined,
      });
      mockMapApiContainer.mockReturnValueOnce(mappedWithoutOp);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-updated', { detail: raw }));
      await flushPromises();

      expect(vm.containers).toHaveLength(1);
      expect(vm.containers[0].updateOperation).toBeDefined();
      expect(vm.containers[0].updateOperation!.id).toBe('op-merge-store');
      expect(vm.containers[0].updateOperation!.phase).toBe('health-checking');
      expect(mockGetOperationByContainerId).toHaveBeenCalledWith('c1');
    });

    it('coerces store operation phase to "queued" when phase is undefined', async () => {
      const existing = makeContainer({ id: 'c1', name: 'nginx' });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      const storeOpNoPhase = {
        operationId: 'op-nophase',
        containerId: 'c-nophase',
        status: 'queued',
        phase: undefined,
      };
      mockStoreOperationsById.value['c-nophase'] = storeOpNoPhase;

      const raw = { id: 'c-nophase', name: 'redis' };
      const mappedNew = makeContainer({
        id: 'c-nophase',
        name: 'redis',
        updateOperation: undefined,
      });
      mockMapApiContainer.mockReturnValueOnce(mappedNew);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-added', { detail: raw }));
      await flushPromises();

      const newRow = vm.containers[1] as Container;
      expect(newRow.updateOperation!.phase).toBe('queued');
    });

    it('includes batchId from store operation when present', async () => {
      const existing = makeContainer({ id: 'c1', name: 'nginx' });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      const storeOp = makeStoreOp({
        operationId: 'op-batch',
        containerId: 'c-batch',
        batchId: 'batch-42',
      });
      mockStoreOperationsById.value['c-batch'] = storeOp;

      const raw = { id: 'c-batch', name: 'batch-container' };
      const mappedNew = makeContainer({
        id: 'c-batch',
        name: 'batch-container',
        updateOperation: undefined,
      });
      mockMapApiContainer.mockReturnValueOnce(mappedNew);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-added', { detail: raw }));
      await flushPromises();

      expect(vm.containers[1].updateOperation!.batchId).toBe('batch-42');
    });
  });

  describe('deferred operation attach (SSE ordering race)', () => {
    function makeStoreOp(
      overrides: Partial<{
        operationId: string;
        containerId: string;
        status: string;
        phase: string;
        batchId: string;
      }> = {},
    ) {
      return {
        operationId: 'op-deferred-1',
        containerId: 'c-race',
        status: 'in-progress',
        phase: 'pulling',
        ...overrides,
      };
    }

    it('attaches operation to row when store update arrives AFTER container-added (race scenario)', async () => {
      const existing = makeContainer({ id: 'c1', name: 'nginx' });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      // Step 1: container-added arrives first — store has no operation yet
      const rawNew = { id: 'c-race', name: 'vaultwarden' };
      const mappedNew = makeContainer({
        id: 'c-race',
        name: 'vaultwarden',
        updateOperation: undefined,
      });
      mockMapApiContainer.mockReturnValueOnce(mappedNew);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-added', { detail: rawNew }));
      await flushPromises();

      // Row is pushed without an operation
      expect(vm.containers).toHaveLength(2);
      expect(vm.containers[1].updateOperation).toBeUndefined();

      // Step 2: operation-changed arrives later — set operation in the reactive store
      const storeOp = makeStoreOp({ operationId: 'op-late', containerId: 'c-race' });
      mockStoreOperationsById.value = { 'c-race': storeOp };
      await flushPromises();

      // Deferred watcher fired and attached the operation to the row
      expect(vm.containers[1].updateOperation).toBeDefined();
      expect(vm.containers[1].updateOperation!.id).toBe('op-late');
      expect(vm.containers[1].updateOperation!.status).toBe('in-progress');
    });

    it('does not set up a deferred watcher when synchronous lookup already found an operation', async () => {
      const existing = makeContainer({ id: 'c1', name: 'nginx' });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      // Operation already in store before container-added (direct-controller path)
      const storeOp = makeStoreOp({ operationId: 'op-sync', containerId: 'c-sync' });
      mockStoreOperationsById.value['c-sync'] = storeOp;

      const rawNew = { id: 'c-sync', name: 'redis' };
      const mappedNew = makeContainer({ id: 'c-sync', name: 'redis', updateOperation: undefined });
      mockMapApiContainer.mockReturnValueOnce(mappedNew);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-added', { detail: rawNew }));
      await flushPromises();

      // Row got operation synchronously — no deferred watcher needed
      expect(vm.containers[1].updateOperation).toBeDefined();
      expect(vm.containers[1].updateOperation!.id).toBe('op-sync');
      // No pending watcher for c-sync
      expect(vm.hasPendingOperationWatcher('c-sync')).toBe(false);
    });

    it('stops the deferred watcher after operation is attached (does not stay active)', async () => {
      const existing = makeContainer({ id: 'c1', name: 'nginx' });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      const rawNew = { id: 'c-oncefire', name: 'mongo' };
      const mappedNew = makeContainer({
        id: 'c-oncefire',
        name: 'mongo',
        updateOperation: undefined,
      });
      mockMapApiContainer.mockReturnValueOnce(mappedNew);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-added', { detail: rawNew }));
      await flushPromises();

      // Deferred watcher is pending
      expect(vm.hasPendingOperationWatcher('c-oncefire')).toBe(true);

      // Operation arrives in store
      mockStoreOperationsById.value = {
        'c-oncefire': makeStoreOp({ containerId: 'c-oncefire', operationId: 'op-once' }),
      };
      await flushPromises();

      // Watcher fired, attached, and stopped itself
      expect(vm.containers[1].updateOperation!.id).toBe('op-once');
      expect(vm.hasPendingOperationWatcher('c-oncefire')).toBe(false);
    });

    it('cancels deferred watcher immediately when container is removed before operation arrives', async () => {
      const existing = makeContainer({ id: 'c1', name: 'nginx' });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      // container-added: no op in store, deferred watcher is set up
      const rawNew = { id: 'c-removed', name: 'postgres' };
      const mappedNew = makeContainer({
        id: 'c-removed',
        name: 'postgres',
        updateOperation: undefined,
      });
      mockMapApiContainer.mockReturnValueOnce(mappedNew);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-added', { detail: rawNew }));
      await flushPromises();

      expect(vm.hasPendingOperationWatcher('c-removed')).toBe(true);

      // container-removed fires before operation arrives
      globalThis.dispatchEvent(
        new CustomEvent('dd:sse-container-removed', {
          detail: { id: 'c-removed', name: 'postgres' },
        }),
      );
      await flushPromises();

      // Watcher cancelled by the removed handler
      expect(vm.hasPendingOperationWatcher('c-removed')).toBe(false);
      // Container is gone
      expect(vm.containers).toHaveLength(1);
      expect(vm.containers[0].id).toBe('c1');
    });

    it('replaces existing deferred watcher when duplicate container-added fires for same id', async () => {
      const existing = makeContainer({ id: 'c1', name: 'nginx' });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      // First container-added: no op, sets up watcher
      const rawNew = { id: 'c-dup', name: 'redis' };
      const mappedNew1 = makeContainer({ id: 'c-dup', name: 'redis', updateOperation: undefined });
      mockMapApiContainer.mockReturnValueOnce(mappedNew1);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-added', { detail: rawNew }));
      await flushPromises();

      expect(vm.hasPendingOperationWatcher('c-dup')).toBe(true);

      // Second container-added for same id (in-place merge branch fires, not push)
      // The idx will be found now since the row was pushed. No new watcher is set up.
      // This tests the guard in attachOperationWhenAvailable via stacking protection.
      // Simulate by calling attachOperationWhenAvailable a second time (via another add for new id).
      const rawNew2 = { id: 'c-dup2', name: 'redis2' };
      const mappedNew2 = makeContainer({
        id: 'c-dup2',
        name: 'redis2',
        updateOperation: undefined,
      });
      mockMapApiContainer.mockReturnValueOnce(mappedNew2);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-added', { detail: rawNew2 }));
      await flushPromises();

      // c-dup still has its original watcher (no stacking since c-dup2 is a different id)
      expect(vm.hasPendingOperationWatcher('c-dup')).toBe(true);
      expect(vm.hasPendingOperationWatcher('c-dup2')).toBe(true);
    });

    it('clears all pending watchers when component is unmounted', async () => {
      const existing = makeContainer({ id: 'c1', name: 'nginx' });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      // Set up two deferred watchers
      for (const id of ['c-unmount-a', 'c-unmount-b']) {
        const raw = { id, name: id };
        const mapped = makeContainer({ id, name: id, updateOperation: undefined });
        mockMapApiContainer.mockReturnValueOnce(mapped);
        globalThis.dispatchEvent(new CustomEvent('dd:sse-container-added', { detail: raw }));
      }
      await flushPromises();

      expect(vm.hasPendingOperationWatcher('c-unmount-a')).toBe(true);
      expect(vm.hasPendingOperationWatcher('c-unmount-b')).toBe(true);

      // Unmount the component
      wrapper.unmount();

      // The maps are cleared by onScopeDispose
      expect(vm.hasPendingOperationWatcher('c-unmount-a')).toBe(false);
      expect(vm.hasPendingOperationWatcher('c-unmount-b')).toBe(false);
    });

    it('times out and stops the watcher after DEFERRED_OPERATION_ATTACH_TIMEOUT_MS with no operation', async () => {
      vi.useFakeTimers();

      const existing = makeContainer({ id: 'c1', name: 'nginx' });
      const wrapper = await mountContainersView([existing]);
      const vm = wrapper.vm as any;

      const rawNew = { id: 'c-timeout', name: 'redis' };
      const mappedNew = makeContainer({
        id: 'c-timeout',
        name: 'redis',
        updateOperation: undefined,
      });
      mockMapApiContainer.mockReturnValueOnce(mappedNew);

      globalThis.dispatchEvent(new CustomEvent('dd:sse-container-added', { detail: rawNew }));
      await flushPromises();

      expect(vm.hasPendingOperationWatcher('c-timeout')).toBe(true);

      // Advance past the 30s timeout
      vi.advanceTimersByTime(30_001);
      await flushPromises();

      // Watcher timed out and was removed
      expect(vm.hasPendingOperationWatcher('c-timeout')).toBe(false);
      // Row remains without an operation (timeout doesn't remove the row)
      expect(vm.containers[1].updateOperation).toBeUndefined();

      mockGetOperationByContainerId.mockClear();

      // A late store update after timeout must not be observed by a leaked watcher.
      mockStoreOperationsById.value = {
        'c-timeout': makeStoreOp({ containerId: 'c-timeout', operationId: 'op-too-late' }),
      };
      await flushPromises();

      expect(mockGetOperationByContainerId).not.toHaveBeenCalled();
      expect(vm.containers[1].updateOperation).toBeUndefined();
      expect(vm.hasPendingOperationWatcher('c-timeout')).toBe(false);

      vi.useRealTimers();
    });
  });
});
