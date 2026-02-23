import { flushPromises } from '@vue/test-utils';
import { computed, ref } from 'vue';
import type { Container } from '@/types/container';
import ContainersView from '@/views/ContainersView.vue';
import { mountWithPlugins } from '../helpers/mount';

const { mockRoute } = vi.hoisted(() => ({
  mockRoute: { query: {} as Record<string, unknown> },
}));

vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
}));

// --- Mock all services ---
vi.mock('@/services/container', () => ({
  deleteContainer: vi.fn(),
  getAllContainers: vi.fn(),
  getContainerGroups: vi.fn().mockResolvedValue([]),
  getContainerLogs: vi.fn(),
  getContainerTriggers: vi.fn().mockResolvedValue([]),
  refreshAllContainers: vi.fn().mockResolvedValue([]),
  runTrigger: vi.fn().mockResolvedValue({}),
  updateContainerPolicy: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/services/container-actions', () => ({
  startContainer: vi.fn(),
  updateContainer: vi.fn(),
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
  parseServer: vi.fn((s: string) => ({ name: s, env: null })),
  registryColorBg: vi.fn(() => 'bg'),
  registryColorText: vi.fn(() => 'text'),
  registryLabel: vi.fn((r: string) => r),
  serverBadgeColor: vi.fn(() => ({ bg: 'bg', text: 'text' })),
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

vi.mock('@/composables/useContainerFilters', () => ({
  useContainerFilters: vi.fn(() => ({
    filterSearch: mockFilterSearch,
    filterStatus: mockFilterStatus,
    filterRegistry: mockFilterRegistry,
    filterBouncer: mockFilterBouncer,
    filterServer: mockFilterServer,
    filterKind: mockFilterKind,
    showFilters: mockShowFilters,
    activeFilterCount: mockActiveFilterCount,
    filteredContainers: mockFilteredContainers,
    clearFilters: mockClearFilters,
  })),
}));

vi.mock('@/composables/useBreakpoints', () => ({
  useBreakpoints: vi.fn(() => ({
    isMobile: ref(false),
    windowNarrow: ref(false),
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
    ]),
    showColumnPicker: mockShowColumnPicker,
    toggleColumn: vi.fn(),
  })),
}));

vi.mock('@/composables/useSorting', () => ({
  useSorting: vi.fn(() => ({
    sortKey: ref('name'),
    sortAsc: ref(true),
    toggleSort: vi.fn(),
  })),
}));

const mockContainerScrollBlocked = ref(false);
const mockContainerAutoFetchInterval = ref(0);

vi.mock('@/composables/useLogViewerBehavior', () => ({
  useLogViewport: () => ({ logContainer: ref(null), scrollBlocked: mockContainerScrollBlocked, scrollToBottom: vi.fn(), handleLogScroll: vi.fn(), resumeAutoScroll: vi.fn() }),
  useAutoFetchLogs: () => ({ autoFetchInterval: mockContainerAutoFetchInterval }),
  LOG_AUTO_FETCH_INTERVALS: [{ label: 'Off', value: 0 }, { label: '2s', value: 2000 }, { label: '5s', value: 5000 }, { label: '10s', value: 10000 }, { label: '30s', value: 30000 }],
}));

const mockSelectedContainer = ref<Container | null>(null);
const mockDetailPanelOpen = ref(false);
const mockContainerFullPage = ref(false);
const mockActiveDetailTab = ref('overview');
const mockSelectContainer = vi.fn();

vi.mock('@/composables/useDetailPanel', () => ({
  useDetailPanel: vi.fn(() => ({
    selectedContainer: mockSelectedContainer,
    detailPanelOpen: mockDetailPanelOpen,
    activeDetailTab: mockActiveDetailTab,
    panelSize: ref('sm'),
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
}));

// --- Stub child components ---
const childStubs = {
  DataViewLayout: {
    template: '<div class="data-view-layout"><slot /><slot name="panel" /></div>',
  },
  DataFilterBar: {
    template:
      '<div class="data-filter-bar"><slot name="filters" /><slot name="extra-buttons" /><slot name="left" /></div>',
    props: ['modelValue', 'showFilters', 'filteredCount', 'totalCount', 'activeFilterCount'],
  },
  DataTable: {
    template: '<div class="data-table" />',
    props: ['columns', 'rows', 'rowKey', 'sortKey', 'sortAsc', 'selectedKey', 'showActions'],
  },
  DataCardGrid: {
    template: '<div class="data-card-grid" />',
    props: ['items', 'itemKey', 'selectedKey'],
  },
  DataListAccordion: {
    template: '<div class="data-list-accordion" />',
    props: ['items', 'itemKey', 'selectedKey'],
  },
  DetailPanel: {
    template: '<div class="detail-panel"><slot name="header" /><slot /></div>',
    props: ['open', 'isMobile', 'size', 'showSizeControls', 'showFullPage'],
  },
  EmptyState: {
    template: '<div class="empty-state">{{ message }}</div>',
    props: ['icon', 'message', 'showClear'],
  },
};

import { getAllContainers, getContainerGroups } from '@/services/container';
import { updateContainer as apiUpdateContainer } from '@/services/container-actions';

const mockGetAllContainers = getAllContainers as ReturnType<typeof vi.fn>;
const mockGetContainerGroups = getContainerGroups as ReturnType<typeof vi.fn>;
const mockApiUpdate = apiUpdateContainer as ReturnType<typeof vi.fn>;

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'c1',
    name: 'nginx',
    image: 'nginx',
    icon: 'docker',
    currentTag: '1.0.0',
    newTag: null,
    status: 'running',
    registry: 'dockerhub',
    updateKind: null,
    bouncer: 'safe',
    server: 'Local',
    details: { ports: [], volumes: [], env: [], labels: [] },
    ...overrides,
  };
}

async function mountContainersView(containers: Container[] = []) {
  // The API returns raw objects; mapApiContainers transforms them
  const apiContainers = containers.map((c) => ({
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
  mockFilterKind.value = 'all';
  mockSelectedContainer.value = null;
  mockDetailPanelOpen.value = false;
  mockContainerFullPage.value = false;
  mockActiveDetailTab.value = 'overview';

  const wrapper = mountWithPlugins(ContainersView, {
    global: { stubs: childStubs },
  });
  await flushPromises();
  return wrapper;
}

describe('ContainersView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFilteredContainers.value = [];
    mockActiveFilterCount.value = 0;
    mockFilterSearch.value = '';
    mockFilterStatus.value = 'all';
    mockFilterRegistry.value = 'all';
    mockFilterBouncer.value = 'all';
    mockFilterServer.value = 'all';
    mockFilterKind.value = 'all';
    mockContainerScrollBlocked.value = false;
    mockContainerAutoFetchInterval.value = 0;
    mockRoute.query = {};
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
  });

  describe('route query filters', () => {
    it('applies search query from route query', async () => {
      mockRoute.query = { q: 'nginx' };
      await mountContainersView([makeContainer()]);
      expect(mockFilterSearch.value).toBe('nginx');
    });

    it('applies filterKind from route query', async () => {
      mockRoute.query = { filterKind: 'any' };
      await mountContainersView([makeContainer({ newTag: '2.0.0', updateKind: 'major' })]);
      expect(mockFilterKind.value).toBe('any');
    });

    it('falls back to all for an invalid filterKind query', async () => {
      mockRoute.query = { filterKind: 'invalid-value' };
      await mountContainersView([makeContainer()]);
      expect(mockFilterKind.value).toBe('all');
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
    it('renders DataTable by default (table mode)', async () => {
      const containers = [makeContainer()];
      const wrapper = await mountContainersView(containers);
      expect(wrapper.find('.data-table').exists()).toBe(true);
    });

    it('renders DataFilterBar', async () => {
      const wrapper = await mountContainersView([makeContainer()]);
      expect(wrapper.find('.data-filter-bar').exists()).toBe(true);
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

  describe('actionInProgress', () => {
    it('prevents concurrent actions', async () => {
      const containers = [makeContainer({ newTag: '2.0.0' })];
      const wrapper = await mountContainersView(containers);
      const vm = wrapper.vm as any;

      // Simulate first action in progress
      vm.actionInProgress = 'nginx';

      // Attempting another action should be blocked (containerIdMap needs an entry)
      mockApiUpdate.mockResolvedValue({});
      await vm.executeAction('other', mockApiUpdate);

      // apiUpdateContainer should not be called because actionInProgress is set
      expect(mockApiUpdate).not.toHaveBeenCalled();
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
  });

  describe('grouping', () => {
    beforeEach(() => {
      localStorage.removeItem('dd-group-by-stack');
    });

    it('groupByStack defaults to false', async () => {
      const wrapper = await mountContainersView([makeContainer()]);
      const vm = wrapper.vm as any;
      expect(vm.groupByStack).toBe(false);
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
      ];
      const wrapper = await mountContainersView(containers);
      const vm = wrapper.vm as any;

      vm.groupByStack = true;
      vm.groupMembershipMap = { nginx: 'web-stack', redis: 'web-stack', postgres: 'db-stack' };
      await flushPromises();

      const groups = vm.groupedContainers;
      expect(groups).toHaveLength(2);
      expect(groups[0].key).toBe('db-stack');
      expect(groups[0].containers).toHaveLength(1);
      expect(groups[1].key).toBe('web-stack');
      expect(groups[1].containers).toHaveLength(2);
    });

    it('places ungrouped containers last', async () => {
      const containers = [
        makeContainer({ name: 'nginx' }),
        makeContainer({ id: 'c2', name: 'solo' }),
      ];
      const wrapper = await mountContainersView(containers);
      const vm = wrapper.vm as any;

      vm.groupByStack = true;
      vm.groupMembershipMap = { nginx: 'web-stack' };
      await flushPromises();

      const groups = vm.groupedContainers;
      expect(groups).toHaveLength(2);
      expect(groups[0].key).toBe('web-stack');
      expect(groups[1].key).toBe('__ungrouped__');
      expect(groups[1].name).toBeNull();
      expect(groups[1].containers).toHaveLength(1);
    });

    it('persists toggle state to localStorage', async () => {
      const wrapper = await mountContainersView([makeContainer()]);
      const vm = wrapper.vm as any;

      vm.groupByStack = true;
      await flushPromises();
      expect(localStorage.getItem('dd-group-by-stack')).toBe('true');

      vm.groupByStack = false;
      await flushPromises();
      expect(localStorage.getItem('dd-group-by-stack')).toBe('false');
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
      const containers = [makeContainer({ name: 'nginx' }), makeContainer({ id: 'c2', name: 'redis' })];
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
      mockApiUpdate.mockResolvedValue({});

      vm.groupByStack = true;
      vm.groupMembershipMap = { nginx: 'web-stack', redis: 'web-stack', postgres: 'web-stack' };
      await flushPromises();

      await vm.updateAllInGroup(vm.groupedContainers[0]);

      expect(mockApiUpdate).toHaveBeenCalledTimes(2);
      expect(mockApiUpdate).toHaveBeenNthCalledWith(1, 'c1');
      expect(mockApiUpdate).toHaveBeenNthCalledWith(2, 'c3');
    });

    it('tracks group update-all loading state during execution', async () => {
      const containers = [makeContainer({ id: 'c1', name: 'nginx', newTag: '2.0.0', updateKind: 'major' })];
      const wrapper = await mountContainersView(containers);
      const vm = wrapper.vm as any;
      let resolveUpdate: ((value: unknown) => void) | undefined;
      mockApiUpdate.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveUpdate = resolve;
          }),
      );

      vm.groupByStack = true;
      vm.groupMembershipMap = { nginx: 'web-stack' };
      await flushPromises();

      const pending = vm.updateAllInGroup(vm.groupedContainers[0]);
      expect(vm.groupUpdateInProgress.has('web-stack')).toBe(true);

      resolveUpdate?.({});
      await pending;

      expect(vm.groupUpdateInProgress.has('web-stack')).toBe(false);
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

  describe('container logs auto-fetch', () => {
    it('renders auto-fetch interval selector in logs tab', async () => {
      const c = makeContainer();
      const { getContainerLogs } = await import('@/services/container');
      (getContainerLogs as ReturnType<typeof vi.fn>).mockResolvedValue({ logs: 'line1\nline2' });

      const wrapper = await mountContainersView([c]);
      mockSelectedContainer.value = c;
      mockDetailPanelOpen.value = true;
      mockActiveDetailTab.value = 'logs';
      await flushPromises();

      const selects = wrapper.findAll('select');
      const autoFetchSelect = selects.find((s) => s.text().includes('Off'));
      expect(autoFetchSelect).toBeDefined();
    });

    it('shows scroll-paused indicator when scrollBlocked and auto-fetch active', async () => {
      const c = makeContainer();
      const { getContainerLogs } = await import('@/services/container');
      (getContainerLogs as ReturnType<typeof vi.fn>).mockResolvedValue({ logs: 'line1\nline2' });

      const wrapper = await mountContainersView([c]);
      mockSelectedContainer.value = c;
      mockDetailPanelOpen.value = true;
      mockActiveDetailTab.value = 'logs';
      await flushPromises();
      // Set after tab switch so the watcher reset has already fired
      mockContainerScrollBlocked.value = true;
      mockContainerAutoFetchInterval.value = 2000;
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('Auto-scroll paused');
      const resumeBtn = wrapper.findAll('button').find((b) => b.text().includes('Resume'));
      expect(resumeBtn).toBeDefined();
    });
  });
});
