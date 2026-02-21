import { flushPromises } from '@vue/test-utils';
import { computed, ref } from 'vue';
import type { Container } from '@/types/container';
import ContainersView from '@/views/ContainersView.vue';
import { mountWithPlugins } from '../helpers/mount';

// --- Mock all services ---
vi.mock('@/services/container', () => ({
  getAllContainers: vi.fn(),
  getContainerLogs: vi.fn(),
}));

vi.mock('@/services/container-actions', () => ({
  updateContainer: vi.fn(),
  stopContainer: vi.fn(),
  restartContainer: vi.fn(),
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

vi.mock('@/composables/useContainerFilters', () => ({
  useContainerFilters: vi.fn(() => ({
    filterStatus: ref('all'),
    filterRegistry: ref('all'),
    filterBouncer: ref('all'),
    filterServer: ref('all'),
    filterKind: ref('all'),
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

const mockSelectedContainer = ref<Container | null>(null);
const mockDetailPanelOpen = ref(false);
const mockContainerFullPage = ref(false);
const mockSelectContainer = vi.fn();

vi.mock('@/composables/useDetailPanel', () => ({
  useDetailPanel: vi.fn(() => ({
    selectedContainer: mockSelectedContainer,
    detailPanelOpen: mockDetailPanelOpen,
    activeDetailTab: ref('overview'),
    panelSize: ref('sm'),
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
}));

vi.mock('primevue/useconfirm', () => ({
  useConfirm: vi.fn(() => ({ require: vi.fn() })),
}));

// --- Stub child components ---
const childStubs = {
  DataViewLayout: {
    template: '<div class="data-view-layout"><slot /><slot name="panel" /></div>',
  },
  DataFilterBar: {
    template:
      '<div class="data-filter-bar"><slot name="filters" /><slot name="extra-buttons" /></div>',
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

import { getAllContainers } from '@/services/container';
import { updateContainer as apiUpdateContainer } from '@/services/container-actions';

const mockGetAllContainers = getAllContainers as ReturnType<typeof vi.fn>;
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
  mockSelectedContainer.value = null;
  mockDetailPanelOpen.value = false;
  mockContainerFullPage.value = false;

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
});
