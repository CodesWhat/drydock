import { flushPromises } from '@vue/test-utils';
import { computed, ref } from 'vue';
import type { Container } from '@/types/container';
import ContainersView from '@/views/ContainersView.vue';
import { mountWithPlugins } from '../helpers/mount';

// Regression coverage for the blank-page defect: removing the currently-open
// full-page container via SSE left containerFullPage stuck true with
// selectedContainer null, so both `v-if` branches in ContainersView.vue's
// template were false and nothing rendered. Unlike
// ContainersView.applyContainerPatch.spec.ts, this file deliberately does
// NOT mock @/composables/useDetailPanel — the bug lives in the interaction
// between the real composable's closePanel() and the real template, so the
// test has to exercise both for real rather than through stubbed refs.

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
    displayBatches: new Map(),
    byId: {},
    batchSummaries: {},
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

// --- Child component stubs ---
// ContainerFullPageDetail / ContainerSideDetail / ContainerFullPageTabContent
// are intentionally left unstubbed, matching ContainersView.spec.ts's "full
// page mode" tests — the whole point here is to assert on what actually
// renders in the DOM after the fix.
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
import { mapApiContainers } from '@/utils/container-mapper';

const mockGetAllContainers = getAllContainers as ReturnType<typeof vi.fn>;
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

  const wrapper = mountWithPlugins(ContainersView, { global: { stubs: childStubs } });
  mountedWrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

describe('ContainersView — full-page detail survives SSE removal of the open container', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockRouterReplace.mockResolvedValue(undefined);
    mockStoreOperationsById.value = {};
    mockContainerActionsEnabled.value = true;
    mockIsMobile.value = false;
    mockWindowNarrow.value = false;
    mockWindowWidth.value = 1440;
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

  it('returns to the container list instead of rendering blank when the open full-page container is removed via SSE', async () => {
    const c = makeContainer({ id: 'c1', name: 'nginx' });
    const wrapper = await mountContainersView([c]);
    const vm = wrapper.vm as any;

    vm.selectContainer(c);
    vm.openFullPage();
    await flushPromises();

    // Sanity check: the bug's precondition is real — full-page detail is
    // showing and the list layout is hidden.
    expect(vm.containerFullPage).toBe(true);
    expect(wrapper.find('[data-test="container-full-page-detail"]').exists()).toBe(true);
    expect(wrapper.find('.data-view-layout').exists()).toBe(false);

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-container-removed', { detail: { id: 'c1', name: 'nginx' } }),
    );
    await flushPromises();

    // The container is gone from the underlying list...
    expect(vm.containers).toHaveLength(0);
    // ...and the view must not go blank: it falls back to the container list
    // instead of leaving containerFullPage stuck true with no selection.
    expect(vm.selectedContainer).toBeNull();
    expect(vm.containerFullPage).toBe(false);
    expect(wrapper.find('[data-test="container-full-page-detail"]').exists()).toBe(false);
    expect(wrapper.find('.data-view-layout').exists()).toBe(true);
  });
});
