import { flushPromises } from '@vue/test-utils';
import { computed, ref } from 'vue';
import type { Container } from '@/types/container';
import ContainersView from '@/views/ContainersView.vue';
import { mountWithPlugins } from '../helpers/mount';

// --- Hoisted values for mocks that need them in factory functions ---
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
});
