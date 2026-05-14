import { defineComponent, nextTick, onMounted, ref } from 'vue';
import ContainersGroupedViews from '@/components/containers/ContainersGroupedViews.vue';
import { useToast } from '@/composables/useToast';
import { useUpdateBatches } from '@/composables/useUpdateBatches';
import type { Container } from '@/types/container';
import { mountWithPlugins } from '../../helpers/mount';

const mocked = vi.hoisted(() => ({
  context: null as any,
}));

vi.mock('@/components/containers/containersViewTemplateContext', () => ({
  useContainersViewTemplateContext: () => mocked.context,
}));

const DataTableStub = defineComponent({
  props: [
    'rows',
    'rowClass',
    'rowClickable',
    'fullWidthRow',
    'rowKey',
    'virtualScroll',
    'virtualMaxHeight',
    'rowHeight',
    'maxHeight',
  ],
  emits: ['update:sort-key', 'update:sort-asc', 'row-click'],
  setup(props, { emit }) {
    const isFullWidth = (row: Record<string, unknown>) =>
      typeof props.fullWidthRow === 'function' ? props.fullWidthRow(row) : false;
    const isClickable = (row: Record<string, unknown>) =>
      typeof props.rowClickable === 'function' ? props.rowClickable(row) : true;
    const keyFor = (row: Record<string, unknown>) => {
      if (typeof props.rowKey === 'function') {
        return props.rowKey(row);
      }
      if (typeof props.rowKey === 'string' && row[props.rowKey] != null) {
        return row[props.rowKey];
      }
      return row.name;
    };

    onMounted(() => {
      emit('update:sort-key', 'status');
      emit('update:sort-asc', false);
      if (Array.isArray(props.rows)) {
        const firstClickable = props.rows.find(
          (row: Record<string, unknown>) => !isFullWidth(row) && isClickable(row),
        );
        if (firstClickable) {
          emit('row-click', firstClickable);
        }
      }
    });

    return {
      isFullWidth,
      isClickable,
      keyFor,
    };
  },
  template: `
    <div class="data-table-stub">
      <div
        v-for="row in rows"
        :key="keyFor(row)"
        :class="[
          isFullWidth(row) ? 'full-row-stub' : 'table-row-stub',
          !isFullWidth(row) && typeof rowClass === 'function' ? rowClass(row) : '',
        ]">
        <template v-if="isFullWidth(row)">
          <slot name="full-row" :row="row" />
        </template>
        <template v-else>
          <div>
            <slot name="cell-icon" :row="row" />
            <slot name="cell-name" :row="row" />
            <slot name="cell-version" :row="row" />
            <slot name="cell-kind" :row="row" />
            <slot name="cell-status" :row="row" />
            <slot name="cell-bouncer" :row="row" />
            <slot name="cell-server" :row="row" />
            <slot name="cell-registry" :row="row" />
            <slot name="actions" :row="row" />
          </div>
        </template>
      </div>
    </div>
  `,
});

const DataCardGridStub = defineComponent({
  props: ['items'],
  emits: ['item-click'],
  template: `
    <div class="data-card-grid-stub">
      <div v-for="item in items" :key="item.name" class="card-item-stub">
        <button class="emit-card-click" @click="$emit('item-click', item)">emit-card-click</button>
        <slot name="card" :item="item" />
      </div>
    </div>
  `,
});

const DataListAccordionStub = defineComponent({
  props: ['items'],
  emits: ['item-click'],
  template: `
    <div class="data-list-accordion-stub">
      <div v-for="item in items" :key="item.name" class="list-item-stub">
        <button class="emit-list-click" @click="$emit('item-click', item)">emit-list-click</button>
        <slot name="header" :item="item" />
      </div>
    </div>
  `,
});

type DisplayContainer = Container & { _pending?: true };

function makeContainer(overrides: Partial<Container> & { _pending?: true } = {}): DisplayContainer {
  return {
    id: overrides.id ?? 'c-1',
    identityKey: overrides.identityKey ?? overrides.id ?? 'c-1',
    name: overrides.name ?? 'alpha',
    image: overrides.image ?? 'nginx',
    icon: overrides.icon ?? 'docker',
    currentTag: overrides.currentTag ?? '1.0.0',
    newTag: overrides.newTag ?? null,
    status: overrides.status ?? 'running',
    registry: overrides.registry ?? 'dockerhub',
    registryName: overrides.registryName ?? '',
    registryUrl: overrides.registryUrl ?? '',
    updateKind: overrides.updateKind ?? null,
    updateMaturity: overrides.updateMaturity ?? null,
    updateMaturityTooltip: overrides.updateMaturityTooltip,
    noUpdateReason: overrides.noUpdateReason,
    bouncer: overrides.bouncer ?? 'safe',
    registryError: overrides.registryError,
    server: overrides.server ?? 'local-main',
    isDigestPinned:
      overrides.isDigestPinned ?? overrides.currentTag?.startsWith('sha256:') ?? false,
    details: overrides.details ?? { ports: [], volumes: [], env: [], labels: [] },
    ...overrides,
  };
}

function makeContext(overrides: Record<string, unknown> = {}) {
  const filteredContainers = ref<Container[]>([]);
  const renderGroups = ref<any[]>([]);
  const groupByStack = ref(false);
  const collapsedGroups = ref(new Set<string>());
  const groupUpdateInProgress = ref(new Set<string>());
  const groupUpdateQueue = ref(new Set<string>());
  const containerActionsEnabled = ref(true);
  const actionInProgress = ref(new Map<string, 'update' | 'scan' | 'lifecycle' | 'delete'>());
  const containerViewMode = ref<'table' | 'cards' | 'list'>('table');
  const tableColumns = ref([
    { key: 'icon', label: '', align: 'text-center' },
    { key: 'name', label: 'Container', align: 'text-left' },
  ]);
  const containerSortKey = ref('name');
  const containerSortAsc = ref(true);
  const selectedContainer = ref<Container | null>(null);
  const activeDetailTab = ref('overview');
  const isCompact = ref(false);
  const tableActionStyle = ref<'icons' | 'buttons'>('icons');
  const openActionsMenu = ref<string | null>(null);
  const displayContainers = ref<Container[]>([]);
  const actionsMenuStyle = ref<Record<string, string>>({
    position: 'fixed',
    top: '10px',
    right: '10px',
  });
  const activeFilterCount = ref(0);
  const filterSearch = ref('');

  const policyMap: Record<
    string,
    { snoozed: boolean; skipped: boolean; maturityBlocked: boolean }
  > = {
    alpha: { snoozed: false, skipped: false, maturityBlocked: false },
    beta: { snoozed: true, skipped: false, maturityBlocked: false },
    gamma: { snoozed: false, skipped: true, maturityBlocked: false },
    delta: { snoozed: true, skipped: true, maturityBlocked: false },
    epsilon: { snoozed: false, skipped: false, maturityBlocked: true },
  };
  const resolvePolicyName = (target: string | { name?: string }) =>
    typeof target === 'string' ? target : (target.name ?? '');

  const spies = {
    toggleGroupCollapse: vi.fn((key: string) => {
      const next = new Set(collapsedGroups.value);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      collapsedGroups.value = next;
    }),
    updateAllInGroup: vi.fn(),
    selectContainer: vi.fn((container: Container) => {
      selectedContainer.value = container;
    }),
    toggleActionsMenu: vi.fn((key: string) => {
      openActionsMenu.value = key;
    }),
    confirmUpdate: vi.fn(),
    confirmStop: vi.fn(),
    startContainer: vi.fn(),
    confirmRestart: vi.fn(),
    scanContainer: vi.fn(),
    confirmForceUpdate: vi.fn(),
    skipUpdate: vi.fn(),
    closeActionsMenu: vi.fn(() => {
      openActionsMenu.value = null;
    }),
    confirmDelete: vi.fn(),
    clearFilters: vi.fn(),
  };

  const context = {
    filteredContainers,
    renderGroups,
    groupByStack,
    toggleGroupCollapse: spies.toggleGroupCollapse,
    collapsedGroups,
    groupUpdateInProgress,
    groupUpdateQueue,
    containerActionsEnabled,
    containerActionsDisabledReason: ref('Actions disabled by server configuration'),
    actionInProgress,
    isContainerUpdateInProgress: (target: {
      id?: string;
      name?: string;
      _pending?: true;
      updateOperation?: { status?: string };
    }) =>
      Boolean(target._pending) ||
      target.updateOperation?.status === 'in-progress' ||
      actionInProgress.value.get(target.id ?? target.name ?? '') === 'update',
    isContainerUpdateQueued: (target: {
      id?: string;
      name?: string;
      updateOperation?: { status?: string };
    }) =>
      target.updateOperation?.status === 'queued' || groupUpdateQueue.value.has(target.id ?? ''),
    isContainerScanInProgress: (target: { id?: string; name?: string }) =>
      actionInProgress.value.get(target.id ?? target.name ?? '') === 'scan',
    isContainerRowLocked: (target: {
      id?: string;
      name?: string;
      _pending?: true;
      updateOperation?: { status?: string };
    }) =>
      Boolean(target._pending) ||
      target.updateOperation?.status === 'in-progress' ||
      actionInProgress.value.get(target.id ?? target.name ?? '') === 'update' ||
      target.updateOperation?.status === 'queued' ||
      groupUpdateQueue.value.has(target.id ?? ''),
    getContainerUpdateSequenceLabel: () => null,
    updateAllInGroup: spies.updateAllInGroup,
    tt: (label: string) => ({ value: label, showDelay: 400 }),
    containerViewMode,
    tableColumns,
    containerSortKey,
    containerSortAsc,
    selectedContainer,
    activeDetailTab,
    isCompact,
    selectContainer: spies.selectContainer,
    tableActionStyle,
    openActionsMenu,
    toggleActionsMenu: spies.toggleActionsMenu,
    confirmUpdate: spies.confirmUpdate,
    confirmStop: spies.confirmStop,
    startContainer: spies.startContainer,
    confirmRestart: spies.confirmRestart,
    scanContainer: spies.scanContainer,
    confirmForceUpdate: spies.confirmForceUpdate,
    skipUpdate: spies.skipUpdate,
    closeActionsMenu: spies.closeActionsMenu,
    confirmDelete: spies.confirmDelete,
    displayContainers,
    actionsMenuStyle,
    updateKindColor: () => ({ bg: '#0b5', text: '#052' }),
    maturityColor: () => ({ bg: '#aef', text: '#056' }),
    hasRegistryError: (c: Container) =>
      typeof c.registryError === 'string' && c.registryError.trim().length > 0,
    registryErrorTooltip: (c: Container) =>
      c.registryError ? `Registry error: ${c.registryError}` : 'Registry error',
    containerPolicyTooltip: (
      target: string | { name?: string },
      kind: 'snoozed' | 'skipped' | 'maturity',
    ) => `${resolvePolicyName(target)}-${kind}-tooltip`,
    getContainerListPolicyState: (target: string | { name?: string }) =>
      policyMap[resolvePolicyName(target)] ?? {
        snoozed: false,
        skipped: false,
        maturityBlocked: false,
      },
    serverBadgeColor: () => ({ bg: '#ddd', text: '#111' }),
    parseServer: (server: string) =>
      server.includes('local') ? { name: 'Local', env: 'dev' } : { name: server, env: null },
    registryColorBg: () => '#ddd',
    registryColorText: () => '#222',
    registryLabel: (registry: string, _registryUrl?: string, registryName?: string) =>
      registryName && registryName.trim().length > 0 && registryName.toLowerCase() !== 'custom'
        ? registryName.trim()
        : registry,
    activeFilterCount,
    filterSearch,
    clearFilters: spies.clearFilters,
  } as any;

  Object.assign(context, overrides);

  return {
    context,
    refs: {
      filteredContainers,
      renderGroups,
      groupByStack,
      groupUpdateInProgress,
      groupUpdateQueue,
      containerViewMode,
      tableActionStyle,
      openActionsMenu,
      displayContainers,
      activeFilterCount,
      filterSearch,
      containerActionsEnabled,
      actionInProgress,
      selectedContainer,
      activeDetailTab,
      isCompact,
    },
    spies,
  };
}

function iconButtons(wrapper: any, icon: string) {
  return wrapper
    .findAll('button')
    .filter((button: any) => button.find(`[data-icon="${icon}"]`).exists());
}

function rowByName(wrapper: any, name: string) {
  const row = wrapper
    .findAll('.table-row-stub')
    .find((candidate: any) => candidate.text().includes(name));
  expect(row).toBeDefined();
  return row!;
}

let activeWrapper: ReturnType<typeof mountWithPlugins> | null = null;

function mountSubject() {
  const wrapper = mountWithPlugins(ContainersGroupedViews, {
    global: {
      stubs: {
        DataTable: DataTableStub,
        DataCardGrid: DataCardGridStub,
        DataListAccordion: DataListAccordionStub,
        EmptyState: {
          props: ['showClear'],
          template:
            '<div class="empty-state-stub"><button v-if="showClear" class="empty-clear" @click="$emit(\'clear\')">clear</button></div>',
        },
        Teleport: true,
      },
    },
  });
  activeWrapper = wrapper as any;
  return wrapper;
}

describe('ContainersGroupedViews', () => {
  afterEach(() => {
    if (activeWrapper) {
      try {
        activeWrapper.unmount();
      } catch {
        // Wrapper may have been explicitly unmounted in the test already.
      }
      activeWrapper = null;
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useUpdateBatches().batches.value = new Map();
    useToast().toasts.value = [];
  });

  it('covers grouped table interactions in icon action mode', async () => {
    const blocked = makeContainer({
      id: 'c-blocked',
      name: 'alpha',
      newTag: '2.0.0',
      updateKind: 'major',
      updateMaturity: 'fresh',
      bouncer: 'blocked',
      status: 'running',
      registryError: '401 unauthorized',
      server: 'remote-east',
    });
    const updatable = makeContainer({
      id: 'c-updatable',
      name: 'beta',
      newTag: '1.2.0',
      updateKind: 'minor',
      updateMaturity: 'settled',
      bouncer: 'safe',
      status: 'running',
      noUpdateReason: undefined,
      server: 'local-main',
    });
    const runningNoUpdate = makeContainer({
      id: 'c-running',
      name: 'gamma',
      newTag: null,
      updateKind: 'patch',
      bouncer: 'unsafe',
      status: 'running',
      noUpdateReason: 'Pinned tag',
      server: 'remote-west',
    });
    const stoppedNoUpdate = makeContainer({
      id: 'c-stopped',
      name: 'delta',
      newTag: null,
      updateKind: 'digest',
      bouncer: 'safe',
      status: 'stopped',
      server: 'local-backup',
    });
    const { context, spies } = makeContext();
    const containers = [blocked, updatable, runningNoUpdate, stoppedNoUpdate];
    context.groupByStack.value = true;
    context.containerViewMode.value = 'table';
    context.tableActionStyle.value = 'icons';
    context.filteredContainers.value = containers;
    context.displayContainers.value = containers;
    context.renderGroups.value = [
      {
        key: 'stack-a',
        name: 'stack-a',
        containers,
        containerCount: containers.length,
        updatesAvailable: 2,
        updatableCount: 1,
      },
    ];
    mocked.context = context;

    const wrapper = mountSubject();

    const groupHeader = wrapper.get('[role="button"]');
    await groupHeader.trigger('keydown.enter');
    await groupHeader.trigger('click');

    const updateAllButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Update all'));
    expect(updateAllButton).toBeDefined();
    await updateAllButton!.trigger('click');

    await rowByName(wrapper, 'alpha').find('button').trigger('click');
    await rowByName(wrapper, 'beta')
      .findAll('button')
      .find((button: any) => button.find('[data-icon="cloud-download"]').exists())!
      .trigger('click');
    await rowByName(wrapper, 'gamma')
      .findAll('button')
      .find((button: any) => button.find('[data-icon="stop"]').exists())!
      .trigger('click');
    await rowByName(wrapper, 'delta')
      .findAll('button')
      .find((button: any) => button.find('[data-icon="play"]').exists())!
      .trigger('click');
    await rowByName(wrapper, 'alpha')
      .findAll('button')
      .find((button: any) => button.find('[data-icon="more"]').exists())!
      .trigger('click');

    expect(spies.toggleGroupCollapse).toHaveBeenCalledWith('stack-a');
    expect(spies.updateAllInGroup).toHaveBeenCalled();
    expect(spies.confirmUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c-updatable', name: 'beta' }),
    );
    expect(spies.confirmStop).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c-running', name: 'gamma' }),
    );
    expect(spies.startContainer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c-stopped', name: 'delta' }),
    );
    expect(spies.toggleActionsMenu).toHaveBeenCalled();
    expect(spies.selectContainer).toHaveBeenCalled();
    expect(context.containerSortKey.value).toBe('status');
    expect(context.containerSortAsc.value).toBe(false);
  });

  it('covers button-style table actions and split buttons', async () => {
    const blockedNewTag = makeContainer({
      id: 'c-b1',
      name: 'alpha',
      newTag: '2.0.0',
      updateKind: 'major',
      bouncer: 'blocked',
      status: 'running',
    });
    const safeNewTag = makeContainer({
      id: 'c-s1',
      name: 'beta',
      newTag: '1.1.0',
      updateKind: 'minor',
      bouncer: 'safe',
      status: 'running',
    });
    const runningNoTag = makeContainer({
      id: 'c-r1',
      name: 'gamma',
      newTag: null,
      status: 'running',
      bouncer: 'unsafe',
    });
    const stoppedNoTag = makeContainer({
      id: 'c-t1',
      name: 'delta',
      newTag: null,
      status: 'stopped',
      bouncer: 'safe',
    });

    const { context, spies } = makeContext();
    const containers = [blockedNewTag, safeNewTag, runningNoTag, stoppedNoTag];
    context.groupByStack.value = true;
    context.containerViewMode.value = 'table';
    context.tableActionStyle.value = 'buttons';
    context.filteredContainers.value = containers;
    context.displayContainers.value = containers;
    context.renderGroups.value = [
      {
        key: 'stack-b',
        name: 'stack-b',
        containers,
        containerCount: containers.length,
        updatesAvailable: 2,
        updatableCount: 1,
      },
    ];
    mocked.context = context;

    const wrapper = mountSubject();

    const chevronButtons = iconButtons(wrapper, 'chevron-down');
    expect(chevronButtons.length).toBeGreaterThanOrEqual(2);
    await chevronButtons[0].trigger('click');
    await chevronButtons[1].trigger('click');

    await rowByName(wrapper, 'beta')
      .findAll('button')
      .find((button: any) => button.find('[data-icon="cloud-download"]').exists())!
      .trigger('click');
    await rowByName(wrapper, 'gamma')
      .findAll('button')
      .find((button: any) => button.find('[data-icon="stop"]').exists())!
      .trigger('click');
    await rowByName(wrapper, 'delta')
      .findAll('button')
      .find((button: any) => button.find('[data-icon="play"]').exists())!
      .trigger('click');
    await rowByName(wrapper, 'delta')
      .findAll('button')
      .find((button: any) => button.find('[data-icon="restart"]').exists())!
      .trigger('click');

    expect(spies.toggleActionsMenu).toHaveBeenCalled();
    expect(spies.confirmUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c-s1', name: 'beta' }),
    );
    expect(spies.confirmStop).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c-r1', name: 'gamma' }),
    );
    expect(spies.startContainer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c-t1', name: 'delta' }),
    );
    expect(spies.confirmRestart).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c-t1', name: 'delta' }),
    );
  });

  it('caps long server and registry labels in grouped table and card headers', async () => {
    const longServer = 'server-name-that-should-not-expand-the-table-or-card';
    const longRegistry = 'registry-name-that-should-not-expand-the-table-or-card';
    const container = makeContainer({
      id: 'c-long',
      name: 'omega',
      server: longServer,
      registry: 'custom',
      registryName: longRegistry,
    });

    const { context } = makeContext();
    context.groupByStack.value = true;
    context.containerViewMode.value = 'table';
    context.filteredContainers.value = [container];
    context.displayContainers.value = [container];
    context.renderGroups.value = [
      {
        key: 'stack-long',
        name: 'stack-long',
        containers: [container],
        containerCount: 1,
        updatesAvailable: 1,
        updatableCount: 1,
      },
    ];
    mocked.context = context;

    const wrapper = mountSubject();

    const tableServer = wrapper
      .findAll('span')
      .find(
        (candidate) =>
          candidate.text().trim() === longServer && candidate.classes().includes('max-w-[140px]'),
      );
    expect(tableServer).toBeDefined();
    expect(tableServer?.classes()).toContain('truncate');

    const tableRegistry = wrapper
      .findAll('span')
      .find(
        (candidate) =>
          candidate.text().trim() === longRegistry && candidate.classes().includes('max-w-[140px]'),
      );
    expect(tableRegistry).toBeDefined();
    expect(tableRegistry?.classes()).toContain('truncate');

    context.containerViewMode.value = 'cards';
    await nextTick();

    const cardRegistry = wrapper
      .findAll('span')
      .find(
        (candidate) =>
          candidate.text().trim() === longRegistry && candidate.classes().includes('max-w-[140px]'),
      );
    expect(cardRegistry).toBeDefined();
    expect(cardRegistry?.classes()).toContain('truncate');
  });

  it('renders normal table metadata quietly and uses concise update labels', async () => {
    const current = makeContainer({
      id: 'c-quiet-current',
      name: 'alpha',
      newTag: null,
      updateKind: null,
      status: 'running',
      server: 'local-main',
      registry: 'dockerhub',
    });
    const minor = makeContainer({
      id: 'c-quiet-minor',
      name: 'beta',
      currentTag: '1.0.0',
      newTag: '1.1.0',
      updateKind: 'minor',
      updateMaturity: 'fresh',
      status: 'running',
      server: 'local-main',
      registry: 'dockerhub',
    });

    const { context, refs } = makeContext();
    const containers = [current, minor];
    refs.containerViewMode.value = 'table';
    refs.filteredContainers.value = containers;
    refs.displayContainers.value = containers;
    refs.renderGroups.value = [
      {
        key: '__flat__',
        name: null,
        containers,
        containerCount: containers.length,
        updatesAvailable: 1,
        updatableCount: 1,
      },
    ];
    mocked.context = context;

    const wrapper = mountSubject();

    const currentRow = rowByName(wrapper, 'alpha');
    expect(currentRow.get('[data-test="container-update-state"]').text()).toContain('Current');
    expect(currentRow.get('[data-test="container-runtime-status"]').text()).toContain('running');
    expect(currentRow.get('[data-test="container-server-text"]').text()).toBe('Local');
    expect(currentRow.get('[data-test="container-registry-text"]').text()).toBe('dockerhub');
    expect(currentRow.find('[data-test="container-runtime-status"] .badge').exists()).toBe(false);
    expect(currentRow.find('[data-test="container-server-text"] .badge').exists()).toBe(false);
    expect(currentRow.find('[data-test="container-registry-text"] .badge').exists()).toBe(false);

    const minorUpdateState = rowByName(wrapper, 'beta').get('[data-test="container-update-state"]');
    expect(minorUpdateState.text()).toContain('Minor');
    expect(minorUpdateState.text()).not.toContain('Minor update');
  });

  it('renders normal card and list metadata quietly with concise update labels', async () => {
    const current = makeContainer({
      id: 'c-quiet-card-current',
      name: 'alpha',
      newTag: null,
      updateKind: null,
      status: 'running',
      server: 'local-main',
      registry: 'dockerhub',
    });
    const minor = makeContainer({
      id: 'c-quiet-card-minor',
      name: 'beta',
      currentTag: '1.0.0',
      newTag: '1.1.0',
      updateKind: 'minor',
      updateMaturity: 'fresh',
      status: 'running',
      server: 'local-main',
      registry: 'dockerhub',
    });

    const { context, refs } = makeContext();
    const containers = [current, minor];
    refs.containerViewMode.value = 'cards';
    refs.filteredContainers.value = containers;
    refs.displayContainers.value = containers;
    refs.renderGroups.value = [
      {
        key: '__flat__',
        name: null,
        containers,
        containerCount: containers.length,
        updatesAvailable: 1,
        updatableCount: 1,
      },
    ];
    mocked.context = context;

    const wrapper = mountSubject();

    const currentCard = wrapper
      .findAll('.card-item-stub')
      .find((candidate) => candidate.text().includes('alpha'));
    expect(currentCard).toBeDefined();
    expect(currentCard!.get('[data-test="container-card-update-state"]').text()).toContain(
      'Current',
    );
    expect(currentCard!.get('[data-test="container-card-runtime-status"]').text()).toContain(
      'running',
    );
    expect(currentCard!.get('[data-test="container-card-server-text"]').text()).toContain('Local');
    expect(currentCard!.get('[data-test="container-card-registry-text"]').text()).toBe('dockerhub');
    expect(currentCard!.find('[data-test="container-card-runtime-status"] .badge').exists()).toBe(
      false,
    );

    const minorCardUpdate = wrapper
      .findAll('.card-item-stub')
      .find((candidate) => candidate.text().includes('beta'))!
      .get('[data-test="container-card-update-state"]');
    expect(minorCardUpdate.text()).toContain('Minor');
    expect(minorCardUpdate.text()).not.toContain('Minor update');

    refs.containerViewMode.value = 'list';
    await nextTick();

    const currentListItem = wrapper
      .findAll('.list-item-stub')
      .find((candidate) => candidate.text().includes('alpha'));
    expect(currentListItem).toBeDefined();
    expect(currentListItem!.get('[data-test="container-list-update-state"]').text()).toContain(
      'Current',
    );
    expect(currentListItem!.get('[data-test="container-list-runtime-status"]').text()).toContain(
      'running',
    );
    expect(currentListItem!.get('[data-test="container-list-server-text"]').text()).toContain(
      'Local',
    );
    expect(
      currentListItem!.find('[data-test="container-list-runtime-status"] .badge').exists(),
    ).toBe(false);

    const minorListUpdate = wrapper
      .findAll('.list-item-stub')
      .find((candidate) => candidate.text().includes('beta'))!
      .get('[data-test="container-list-update-state"]');
    expect(minorListUpdate.text()).toContain('Minor');
    expect(minorListUpdate.text()).not.toContain('Minor update');
  });

  it('covers dropdown menu actions across blocked/updateable states', async () => {
    const blockedNoTag = makeContainer({
      id: 'c-m1',
      name: 'alpha',
      newTag: null,
      bouncer: 'blocked',
      status: 'running',
    });
    const blockedWithTag = makeContainer({
      id: 'c-m2',
      name: 'beta',
      newTag: '3.0.0',
      updateKind: 'major',
      bouncer: 'blocked',
      status: 'stopped',
    });

    const { context, refs, spies } = makeContext();
    const containers = [blockedNoTag, blockedWithTag];
    context.containerViewMode.value = 'table';
    context.tableActionStyle.value = 'icons';
    context.filteredContainers.value = containers;
    context.displayContainers.value = containers;
    context.renderGroups.value = [
      {
        key: '__flat__',
        name: null,
        containers,
        containerCount: containers.length,
        updatesAvailable: 1,
        updatableCount: 0,
      },
    ];
    mocked.context = context;

    const wrapper = mountSubject();

    async function clickMenuAction(target: string, text: string, index = 0) {
      refs.openActionsMenu.value = target;
      await nextTick();
      const matches = wrapper.findAll('button').filter((button) => button.text().trim() === text);
      expect(matches[index]).toBeDefined();
      await matches[index].trigger('click');
    }

    await clickMenuAction('c-m1', 'Stop');
    await clickMenuAction('c-m1', 'Restart');
    await clickMenuAction('c-m1', 'Scan');
    await clickMenuAction('c-m1', 'Force update');
    await clickMenuAction('c-m1', 'Delete');

    await clickMenuAction('c-m2', 'Start');
    await clickMenuAction('c-m2', 'Restart');
    await clickMenuAction('c-m2', 'Scan');
    await clickMenuAction('c-m2', 'Force update');
    await clickMenuAction('c-m2', 'Skip this update');
    await clickMenuAction('c-m2', 'Rollback');
    await clickMenuAction('c-m2', 'Delete');

    expect(spies.closeActionsMenu).toHaveBeenCalled();
    expect(spies.confirmStop).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c-m1', name: 'alpha' }),
    );
    expect(spies.startContainer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c-m2', name: 'beta' }),
    );
    expect(spies.confirmRestart).toHaveBeenCalled();
    expect(spies.scanContainer).toHaveBeenCalled();
    expect(spies.confirmForceUpdate).toHaveBeenCalled();
    expect(spies.skipUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c-m2', name: 'beta' }),
    );
    expect(spies.selectContainer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c-m2', name: 'beta' }),
    );
    expect(refs.activeDetailTab.value).toBe('actions');
    expect(spies.confirmDelete).toHaveBeenCalled();
  });

  it('does not expose an enabled update action in the dropdown for hard-blocked rows', async () => {
    const hardBlocked = makeContainer({
      id: 'c-hard-menu',
      name: 'hard-menu',
      newTag: '2.0.0',
      updateKind: 'major',
      bouncer: 'safe',
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
    });

    const { context, refs, spies } = makeContext();
    context.containerViewMode.value = 'table';
    context.tableActionStyle.value = 'icons';
    context.filteredContainers.value = [hardBlocked];
    context.displayContainers.value = [hardBlocked];
    context.renderGroups.value = [
      {
        key: '__flat__',
        name: null,
        containers: [hardBlocked],
        containerCount: 1,
        updatesAvailable: 1,
        updatableCount: 0,
      },
    ];
    mocked.context = context;

    const wrapper = mountSubject();
    refs.openActionsMenu.value = 'c-hard-menu';
    await nextTick();

    const updateButtons = wrapper
      .findAll('button')
      .filter((button) => button.text().trim() === 'Update');
    expect(updateButtons).toHaveLength(0);

    const blockedButton = wrapper
      .findAll('button')
      .find((button) => button.text().trim() === 'Blocked');
    expect(blockedButton?.attributes('disabled')).toBeDefined();
    await blockedButton?.trigger('click');

    expect(spies.confirmUpdate).not.toHaveBeenCalled();
  });

  it('renders a single teleported actions menu when one container menu is open across groups', async () => {
    const alpha = makeContainer({
      id: 'c-alpha',
      name: 'alpha',
      newTag: '2.0.0',
      bouncer: 'blocked',
      status: 'running',
    });
    const beta = makeContainer({
      id: 'c-beta',
      name: 'beta',
      newTag: null,
      status: 'stopped',
    });

    const { context, refs } = makeContext();
    context.groupByStack.value = true;
    context.containerViewMode.value = 'table';
    context.tableActionStyle.value = 'buttons';
    context.filteredContainers.value = [alpha, beta];
    context.displayContainers.value = [alpha, beta];
    context.renderGroups.value = [
      {
        key: 'stack-a',
        name: 'stack-a',
        containers: [alpha],
        containerCount: 1,
        updatesAvailable: 1,
        updatableCount: 1,
      },
      {
        key: 'stack-b',
        name: 'stack-b',
        containers: [beta],
        containerCount: 1,
        updatesAvailable: 0,
        updatableCount: 0,
      },
    ];
    refs.openActionsMenu.value = 'c-alpha';
    mocked.context = context;

    const wrapper = mountSubject();
    await nextTick();

    const deleteButtons = wrapper
      .findAll('button')
      .filter((button) => button.text().trim() === 'Delete');
    expect(deleteButtons).toHaveLength(1);
  });

  it('flattens grouped table mode into a single data table with group rows', async () => {
    const alpha = makeContainer({
      id: 'c-alpha',
      name: 'alpha',
      newTag: '2.0.0',
      updateKind: 'major',
      status: 'running',
    });
    const beta = makeContainer({
      id: 'c-beta',
      name: 'beta',
      newTag: '1.1.0',
      updateKind: 'minor',
      status: 'stopped',
    });

    const { context } = makeContext();
    context.groupByStack.value = true;
    context.containerViewMode.value = 'table';
    context.filteredContainers.value = [alpha, beta];
    context.displayContainers.value = [alpha, beta];
    context.renderGroups.value = [
      {
        key: 'stack-a',
        name: 'stack-a',
        containers: [alpha],
        containerCount: 1,
        updatesAvailable: 1,
        updatableCount: 1,
      },
      {
        key: 'stack-b',
        name: 'stack-b',
        containers: [beta],
        containerCount: 1,
        updatesAvailable: 1,
        updatableCount: 1,
      },
    ];
    mocked.context = context;

    const wrapper = mountSubject();
    await nextTick();

    expect(wrapper.findAll('.data-table-stub')).toHaveLength(1);
    expect(wrapper.findAll('.full-row-stub')).toHaveLength(2);
    expect(wrapper.findAll('.table-row-stub')).toHaveLength(2);
    expect(wrapper.text()).toContain('stack-a');
    expect(wrapper.text()).toContain('stack-b');
  });

  it('uses native page scrolling for the containers table, unbounded height', async () => {
    const normalRow = makeContainer({
      id: 'c-alpha',
      name: 'alpha',
      newTag: '1.1.0',
      updateKind: 'minor',
      status: 'running',
    });

    const { context } = makeContext();
    context.groupByStack.value = true;
    context.containerViewMode.value = 'table';
    context.filteredContainers.value = [normalRow];
    context.displayContainers.value = [normalRow];
    context.renderGroups.value = [
      {
        key: 'stack-a',
        name: 'stack-a',
        containers: [normalRow],
        containerCount: 1,
        updatesAvailable: 1,
        updatableCount: 1,
      },
    ];
    mocked.context = context;

    const wrapper = mountSubject();
    await nextTick();

    const dataTable = wrapper.findComponent(DataTableStub);
    expect(dataTable.props('virtualScroll')).toBe(false);
    expect(dataTable.props('virtualMaxHeight')).toBeUndefined();
    expect(dataTable.props('maxHeight')).toBeUndefined();
    expect(dataTable.props('rowHeight')).toBeUndefined();
  });

  it('covers card/list view events and footer action handlers', async () => {
    const running = makeContainer({
      id: 'c-card-1',
      name: 'alpha',
      newTag: '2.0.0',
      updateKind: 'major',
      updateMaturity: 'fresh',
      status: 'running',
      bouncer: 'safe',
      registryError: 'timeout',
      server: 'local-main',
    });
    const stoppedWithReason = makeContainer({
      id: 'c-card-2',
      name: 'beta',
      newTag: null,
      status: 'stopped',
      bouncer: 'unsafe',
      noUpdateReason: 'Image pinned',
      server: 'remote-east',
    });
    const stoppedPolicy = makeContainer({
      id: 'c-card-3',
      name: 'gamma',
      newTag: null,
      status: 'stopped',
      bouncer: 'safe',
      noUpdateReason: undefined,
    });
    const stoppedClean = makeContainer({
      id: 'c-card-4',
      name: 'delta',
      newTag: null,
      status: 'stopped',
      bouncer: 'safe',
      noUpdateReason: undefined,
    });

    const { context, refs, spies } = makeContext();
    const containers = [running, stoppedWithReason, stoppedPolicy, stoppedClean];
    context.containerViewMode.value = 'cards';
    context.filteredContainers.value = containers;
    context.displayContainers.value = containers;
    context.renderGroups.value = [
      {
        key: '__flat__',
        name: null,
        containers,
        containerCount: containers.length,
        updatesAvailable: 1,
        updatableCount: 1,
      },
    ];
    mocked.context = context;

    const wrapper = mountSubject();

    await wrapper.find('.emit-card-click').trigger('click');
    await iconButtons(wrapper, 'stop')[0].trigger('click');
    await iconButtons(wrapper, 'play')[0].trigger('click');
    await iconButtons(wrapper, 'restart')[0].trigger('click');
    await iconButtons(wrapper, 'security')[0].trigger('click');
    await iconButtons(wrapper, 'cloud-download')[0].trigger('click');

    refs.containerViewMode.value = 'list';
    await nextTick();
    await wrapper.find('.emit-list-click').trigger('click');

    expect(spies.selectContainer).toHaveBeenCalled();
    expect(spies.confirmStop).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c-card-1', name: 'alpha' }),
    );
    expect(spies.startContainer).toHaveBeenCalled();
    expect(spies.confirmRestart).toHaveBeenCalled();
    expect(spies.scanContainer).toHaveBeenCalled();
    expect(spies.confirmUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c-card-1', name: 'alpha' }),
    );
  });

  it('shows empty state and clears filters', async () => {
    const { context, refs, spies } = makeContext();
    refs.filteredContainers.value = [];
    refs.activeFilterCount.value = 1;
    refs.filterSearch.value = 'needle';
    mocked.context = context;

    const wrapper = mountSubject();
    const clear = wrapper.get('.empty-clear');
    await clear.trigger('click');

    expect(spies.clearFilters).toHaveBeenCalledTimes(1);
  });

  it('shows maturity-blocked policy indicator when list policy state is blocked', async () => {
    const maturityBlocked = makeContainer({
      id: 'c-mature',
      name: 'epsilon',
      newTag: null,
      updateKind: null,
      status: 'running',
    });
    const { context, refs } = makeContext();
    refs.containerViewMode.value = 'table';
    refs.filteredContainers.value = [maturityBlocked];
    refs.displayContainers.value = [maturityBlocked];
    refs.renderGroups.value = [
      {
        key: 'group-maturity',
        name: 'group-maturity',
        containers: [maturityBlocked],
        containerCount: 1,
        updatesAvailable: 0,
        updatableCount: 0,
      },
    ];
    mocked.context = context;

    const wrapper = mountSubject();
    await nextTick();

    expect(wrapper.find('[aria-label="Maturity-blocked updates"]').exists()).toBe(true);
  });

  it('keeps the stack Update all button visible when all updates are security-blocked', async () => {
    const blockedA = makeContainer({
      id: 'c-blocked-a',
      name: 'alpha',
      newTag: '2.0.0',
      updateKind: 'major',
      bouncer: 'blocked',
      status: 'running',
    });
    const blockedB = makeContainer({
      id: 'c-blocked-b',
      name: 'beta',
      newTag: '1.1.0',
      updateKind: 'minor',
      bouncer: 'blocked',
      status: 'running',
    });

    const { context, refs, spies } = makeContext();
    refs.groupByStack.value = true;
    refs.filteredContainers.value = [blockedA, blockedB];
    refs.displayContainers.value = [blockedA, blockedB];
    refs.renderGroups.value = [
      {
        key: 'stack-blocked',
        name: 'stack-blocked',
        containers: [blockedA, blockedB],
        containerCount: 2,
        updatesAvailable: 2,
        updatableCount: 0,
      },
    ];
    mocked.context = context;

    const wrapper = mountSubject();

    const updateAllButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Update all'));

    expect(updateAllButton).toBeDefined();
    expect(updateAllButton!.attributes('disabled')).toBeDefined();
    expect(updateAllButton!.find('[data-icon="lock"]').exists()).toBe(true);

    await updateAllButton!.trigger('click');
    expect(spies.updateAllInGroup).not.toHaveBeenCalled();
  });

  it('covers group-header disabled states and disabled table action click handler', async () => {
    const item = makeContainer({
      id: 'c-disabled',
      name: 'alpha',
      newTag: '2.0.0',
      updateKind: 'major',
      bouncer: 'safe',
      status: 'running',
    });
    const { context, refs } = makeContext();
    refs.groupByStack.value = true;
    refs.containerActionsEnabled.value = false;
    refs.groupUpdateInProgress.value = new Set(['stack-disabled']);
    refs.actionInProgress.value = new Map([['c-disabled', 'update']]);
    refs.filteredContainers.value = [item];
    refs.displayContainers.value = [item];
    refs.renderGroups.value = [
      {
        key: 'stack-disabled',
        name: 'stack-disabled',
        containers: [item],
        containerCount: 1,
        updatesAvailable: 1,
        updatableCount: 1,
      },
    ];
    mocked.context = context;

    const wrapper = mountSubject();
    const tableLockBtns = wrapper.findAll('button[disabled]');
    const tableLockBtn = tableLockBtns[0];
    expect(tableLockBtn).toBeDefined();
    (tableLockBtn!.element as HTMLButtonElement).disabled = false;
    await tableLockBtn!.trigger('click');
  });

  it('disables only the matching same-named row when actionInProgress is keyed by id', async () => {
    const localNode = makeContainer({
      id: 'c-local',
      name: 'tdarr_node',
      server: 'Datavault',
      newTag: '2.0.0',
      updateKind: 'major',
      bouncer: 'safe',
      status: 'running',
    });
    const remoteNode = makeContainer({
      id: 'c-remote',
      name: 'tdarr_node',
      server: 'Tmvault',
      newTag: '2.0.0',
      updateKind: 'major',
      bouncer: 'safe',
      status: 'running',
    });

    const { context, refs } = makeContext();
    refs.filteredContainers.value = [localNode, remoteNode];
    refs.displayContainers.value = [localNode, remoteNode];
    refs.renderGroups.value = [
      {
        key: '__flat__',
        name: null,
        containers: [localNode, remoteNode],
        containerCount: 2,
        updatesAvailable: 2,
        updatableCount: 2,
      },
    ];
    refs.containerViewMode.value = 'table';
    refs.tableActionStyle.value = 'icons';
    refs.actionInProgress.value = new Map([['c-local', 'update']]);
    mocked.context = context;

    const wrapper = mountSubject();
    const updateButtons = iconButtons(wrapper, 'cloud-download');

    expect(updateButtons).toHaveLength(2);
    expect(
      updateButtons.filter((button) => button.attributes('disabled') !== undefined),
    ).toHaveLength(1);
  });

  it('covers compact table badge branches across kind/maturity/policy/status variants', async () => {
    const majorBlocked = makeContainer({
      id: 'c-k1',
      name: 'alpha',
      newTag: '2.0.0',
      updateKind: 'major',
      updateMaturity: 'fresh',
      bouncer: 'blocked',
      status: 'running',
      server: 'local-main',
    });
    const minorUnsafe = makeContainer({
      id: 'c-k2',
      name: 'beta',
      newTag: '1.2.0',
      updateKind: 'minor',
      updateMaturity: 'settled',
      bouncer: 'unsafe',
      status: 'stopped',
      server: 'remote-east',
    });
    const patchSafe = makeContainer({
      id: 'c-k3',
      name: 'gamma',
      newTag: '1.0.1',
      updateKind: 'patch',
      updateMaturity: 'fresh',
      bouncer: 'safe',
      status: 'running',
      server: 'remote-west',
    });
    const digestSafe = makeContainer({
      id: 'c-k4',
      name: 'delta',
      newTag: 'sha256:abc',
      updateKind: 'digest',
      updateMaturity: 'settled',
      bouncer: 'safe',
      status: 'stopped',
      server: 'local-backup',
    });

    const { context, refs } = makeContext();
    const containers = [majorBlocked, minorUnsafe, patchSafe, digestSafe];
    refs.containerViewMode.value = 'table';
    refs.isCompact.value = true;
    refs.filteredContainers.value = containers;
    refs.displayContainers.value = containers;
    refs.renderGroups.value = [
      {
        key: '__flat__',
        name: null,
        containers,
        containerCount: containers.length,
        updatesAvailable: containers.length,
        updatableCount: containers.length,
      },
    ];
    mocked.context = context;

    const wrapper = mountSubject();
    expect(wrapper.text()).toContain('alpha');
    expect(wrapper.text()).toContain('delta');
    expect(wrapper.text()).toContain('NEW');
    expect(wrapper.text()).toContain('MATURE');
  });

  it('covers in-progress branches for icon and button-style table actions', async () => {
    const updatable = makeContainer({
      id: 'c-progress-1',
      name: 'alpha',
      newTag: '2.0.0',
      updateKind: 'major',
      bouncer: 'safe',
      status: 'running',
    });
    const runningNoTag = makeContainer({
      id: 'c-progress-2',
      name: 'beta',
      newTag: null,
      status: 'running',
      bouncer: 'unsafe',
    });
    const stoppedNoTag = makeContainer({
      id: 'c-progress-3',
      name: 'gamma',
      newTag: null,
      status: 'stopped',
      bouncer: 'safe',
    });

    const { context, refs } = makeContext();
    const containers = [updatable, runningNoTag, stoppedNoTag];
    refs.filteredContainers.value = containers;
    refs.displayContainers.value = containers;
    refs.renderGroups.value = [
      {
        key: '__flat__',
        name: null,
        containers,
        containerCount: containers.length,
        updatesAvailable: 1,
        updatableCount: 1,
      },
    ];
    refs.containerViewMode.value = 'table';
    refs.tableActionStyle.value = 'buttons';
    refs.actionInProgress.value = new Map([['c-progress-1', 'update']]);
    mocked.context = context;

    const wrapper = mountSubject();
    expect(wrapper.text()).toContain('alpha');

    refs.actionInProgress.value = new Map([['c-progress-2', 'update']]);
    await nextTick();
    refs.actionInProgress.value = new Map([['c-progress-3', 'update']]);
    await nextTick();

    refs.tableActionStyle.value = 'icons';
    refs.actionInProgress.value = new Map([['c-progress-3', 'update']]);
    await nextTick();
  });

  it('shows an explicit updating status for in-progress table rows', () => {
    const updatable = makeContainer({
      id: 'c-progress-1',
      name: 'alpha',
      newTag: '2.0.0',
      updateKind: 'major',
      bouncer: 'safe',
      status: 'running',
    });

    const { context, refs } = makeContext();
    refs.filteredContainers.value = [updatable];
    refs.displayContainers.value = [updatable];
    refs.renderGroups.value = [
      {
        key: '__flat__',
        name: null,
        containers: [updatable],
        containerCount: 1,
        updatesAvailable: 1,
        updatableCount: 1,
      },
    ];
    refs.containerViewMode.value = 'table';
    refs.actionInProgress.value = new Map([['c-progress-1', 'update']]);
    mocked.context = context;

    const wrapper = mountSubject();
    const row = rowByName(wrapper, 'alpha');

    expect(row.classes()).toContain('dd-row-updating');
    expect(row.text()).toContain('Updating');
  });

  it('applies dd-row-scanning to scanning rows so the overlay chip stays anchored', () => {
    const scanning = makeContainer({
      id: 'c-scan-1',
      name: 'alpha',
      newTag: null,
      bouncer: 'safe',
      status: 'running',
    });

    const { context, refs } = makeContext();
    refs.filteredContainers.value = [scanning];
    refs.displayContainers.value = [scanning];
    refs.renderGroups.value = [
      {
        key: '__flat__',
        name: null,
        containers: [scanning],
        containerCount: 1,
        updatesAvailable: 0,
        updatableCount: 0,
      },
    ];
    refs.containerViewMode.value = 'table';
    refs.actionInProgress.value = new Map([['c-scan-1', 'scan']]);
    mocked.context = context;

    const wrapper = mountSubject();
    const row = rowByName(wrapper, 'alpha');

    expect(row.classes()).toContain('dd-row-scanning');
    expect(row.classes()).not.toContain('dd-row-updating');
    expect(row.classes()).not.toContain('pointer-events-none');
  });

  it('prefers dd-row-updating over dd-row-scanning when a row is both updating and scanning', () => {
    const both = makeContainer({
      id: 'c-both-1',
      name: 'alpha',
      newTag: '2.0.0',
      updateKind: 'major',
      bouncer: 'safe',
      status: 'running',
    });

    const { context, refs } = makeContext({ isContainerScanInProgress: () => true });
    refs.filteredContainers.value = [both];
    refs.displayContainers.value = [both];
    refs.renderGroups.value = [
      {
        key: '__flat__',
        name: null,
        containers: [both],
        containerCount: 1,
        updatesAvailable: 1,
        updatableCount: 1,
      },
    ];
    refs.containerViewMode.value = 'table';
    refs.actionInProgress.value = new Map([['c-both-1', 'update']]);
    mocked.context = context;

    const wrapper = mountSubject();
    const row = rowByName(wrapper, 'alpha');

    expect(row.classes()).toContain('dd-row-updating');
    expect(row.classes()).toContain('pointer-events-none');
    expect(row.classes()).not.toContain('dd-row-scanning');
  });

  it('leaves table row class empty for non-scanning, non-locked rows', () => {
    const idle = makeContainer({
      id: 'c-idle-1',
      name: 'alpha',
      newTag: null,
      bouncer: 'safe',
      status: 'running',
    });

    const { context, refs } = makeContext();
    refs.filteredContainers.value = [idle];
    refs.displayContainers.value = [idle];
    refs.renderGroups.value = [
      {
        key: '__flat__',
        name: null,
        containers: [idle],
        containerCount: 1,
        updatesAvailable: 0,
        updatableCount: 0,
      },
    ];
    refs.containerViewMode.value = 'table';
    refs.actionInProgress.value = new Map();
    mocked.context = context;

    const wrapper = mountSubject();
    const row = rowByName(wrapper, 'alpha');

    expect(row.classes()).not.toContain('dd-row-scanning');
    expect(row.classes()).not.toContain('dd-row-updating');
  });

  it('keeps ghost rows dimmed and labeled updating while pending', () => {
    const pendingGhost = makeContainer({
      id: 'c-pending-1',
      name: 'alpha',
      newTag: null,
      status: 'running',
      bouncer: 'safe',
      _pending: true as const,
    });

    const { context, refs } = makeContext();
    refs.filteredContainers.value = [pendingGhost];
    refs.displayContainers.value = [pendingGhost];
    refs.renderGroups.value = [
      {
        key: '__flat__',
        name: null,
        containers: [pendingGhost],
        containerCount: 1,
        updatesAvailable: 0,
        updatableCount: 0,
      },
    ];
    refs.containerViewMode.value = 'table';
    mocked.context = context;

    const wrapper = mountSubject();
    const row = rowByName(wrapper, 'alpha');

    expect(row.classes()).toContain('dd-row-updating');
    expect(row.text()).toContain('Updating');
  });

  it('renders phase-only queued labels for grouped rows', () => {
    const queued = makeContainer({
      id: 'c-queued-1',
      name: 'alpha',
      newTag: '2.0.0',
      updateKind: 'major',
      status: 'running',
    });

    const { context, refs } = makeContext();
    refs.filteredContainers.value = [queued];
    refs.displayContainers.value = [queued];
    refs.renderGroups.value = [
      {
        key: '__flat__',
        name: null,
        containers: [queued],
        containerCount: 1,
        updatesAvailable: 1,
        updatableCount: 1,
      },
    ];
    refs.containerViewMode.value = 'table';
    refs.groupUpdateQueue.value = new Set(['c-queued-1']);
    mocked.context = context;

    const wrapper = mountSubject();
    const row = rowByName(wrapper, 'alpha');

    expect(row.text()).toContain('Queued');
    expect(row.text()).not.toContain('2 of 3');
  });

  it('shows frozen batch progress in the grouped header — counter starts at 0', () => {
    const updating = makeContainer({
      id: 'c-updating',
      name: 'alpha',
      newTag: '2.0.0',
      updateKind: 'major',
      updateOperation: {
        id: 'op-1',
        status: 'in-progress',
        phase: 'pulling',
        updatedAt: '2026-04-11T12:00:00.000Z',
      },
    });
    const queued = makeContainer({
      id: 'c-queued',
      name: 'beta',
      newTag: '2.0.0',
      updateKind: 'major',
      updateOperation: {
        id: 'op-2',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-11T12:00:01.000Z',
      },
    });
    const done = makeContainer({
      id: 'c-done',
      name: 'gamma',
      newTag: null,
      status: 'running',
    });

    const { context, refs } = makeContext();
    refs.groupByStack.value = true;
    refs.filteredContainers.value = [updating, queued, done];
    refs.displayContainers.value = [updating, queued, done];
    refs.renderGroups.value = [
      {
        key: 'stack-a',
        name: 'stack-a',
        containers: [updating, queued, done],
        containerCount: 3,
        updatesAvailable: 2,
        updatableCount: 2,
      },
    ];
    useUpdateBatches().captureBatch('stack-a', 3);
    mocked.context = context;

    const wrapper = mountSubject();

    // Counter starts at 0 — ticks only as terminal SSE events arrive.
    expect(wrapper.text()).toContain('Updating stack · 0 of 3 done');
  });

  it('ticks the batch counter as terminal SSE events arrive', async () => {
    const c1 = makeContainer({
      id: 'c-1',
      name: 'alpha',
      newTag: '2.0.0',
      updateKind: 'major',
      updateOperation: {
        id: 'op-1',
        status: 'in-progress',
        phase: 'pulling',
        updatedAt: '2026-04-28T00:00:00.000Z',
      },
    });
    const c2 = makeContainer({
      id: 'c-2',
      name: 'beta',
      newTag: '2.0.0',
      updateKind: 'major',
      updateOperation: {
        id: 'op-2',
        status: 'in-progress',
        phase: 'pulling',
        updatedAt: '2026-04-28T00:00:00.000Z',
      },
    });

    const { context, refs } = makeContext();
    refs.groupByStack.value = true;
    refs.filteredContainers.value = [c1, c2];
    refs.displayContainers.value = [c1, c2];
    refs.renderGroups.value = [
      {
        key: 'stack-a',
        name: 'stack-a',
        containers: [c1, c2],
        containerCount: 2,
        updatesAvailable: 2,
        updatableCount: 2,
      },
    ];
    useUpdateBatches().captureBatch('stack-a', 2);
    mocked.context = context;

    const wrapper = mountSubject();
    expect(wrapper.text()).toContain('Updating stack · 0 of 2 done');

    // First terminal event
    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-applied', { detail: { containerId: 'c-1' } }),
    );
    await nextTick();
    expect(wrapper.text()).toContain('Updating stack · 1 of 2 done');

    // Second terminal event
    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-applied', { detail: { containerId: 'c-2' } }),
    );
    await nextTick();
    expect(wrapper.text()).toContain('Updating stack · 2 of 2 done');
    wrapper.unmount();
  });

  it('increments failed count on dd:sse-update-failed', async () => {
    const c1 = makeContainer({ id: 'c-1', name: 'alpha', newTag: '2.0.0', updateKind: 'major' });
    const c2 = makeContainer({ id: 'c-2', name: 'beta', newTag: '2.0.0', updateKind: 'major' });

    const { context, refs } = makeContext();
    refs.groupByStack.value = true;
    refs.filteredContainers.value = [c1, c2];
    refs.displayContainers.value = [c1, c2];
    refs.renderGroups.value = [
      {
        key: 'stack-a',
        name: 'stack-a',
        containers: [c1, c2],
        containerCount: 2,
        updatesAvailable: 2,
        updatableCount: 2,
      },
    ];
    useUpdateBatches().captureBatch('stack-a', 2);
    mocked.context = context;

    const wrapper = mountSubject();

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-failed', { detail: { containerId: 'c-1' } }),
    );
    await nextTick();
    wrapper.unmount();

    const batch = useUpdateBatches().getBatch('stack-a');
    expect(batch?.failedCount).toBe(1);
    expect(batch?.succeededCount).toBe(0);
  });

  it('covers card and list pending/disabled/update-kind branches', async () => {
    const pendingCard = makeContainer({
      id: 'c-card-pending',
      name: 'alpha',
      newTag: null,
      status: 'running',
      bouncer: 'safe',
      _pending: true as any,
    });
    const runningCard = makeContainer({
      id: 'c-card-running',
      name: 'beta',
      newTag: '2.0.0',
      updateKind: 'major',
      updateMaturity: 'settled',
      status: 'running',
      bouncer: 'unsafe',
    });
    const minorList = makeContainer({
      id: 'c-list-minor',
      name: 'gamma',
      newTag: '1.1.0',
      updateKind: 'minor',
      updateMaturity: 'settled',
      status: 'stopped',
      bouncer: 'safe',
    });
    const patchList = makeContainer({
      id: 'c-list-patch',
      name: 'delta',
      newTag: '1.0.1',
      updateKind: 'patch',
      updateMaturity: 'settled',
      status: 'running',
      bouncer: 'safe',
    });
    const digestList = makeContainer({
      id: 'c-list-digest',
      name: 'epsilon',
      newTag: 'sha256:aaa',
      updateKind: 'digest',
      updateMaturity: 'settled',
      status: 'stopped',
      bouncer: 'safe',
    });

    const { context, refs } = makeContext();
    const containers = [pendingCard, runningCard, minorList, patchList, digestList];
    refs.containerViewMode.value = 'cards';
    refs.filteredContainers.value = containers;
    refs.displayContainers.value = containers;
    refs.renderGroups.value = [
      {
        key: '__flat__',
        name: null,
        containers,
        containerCount: containers.length,
        updatesAvailable: 4,
        updatableCount: 4,
      },
    ];
    refs.actionInProgress.value = new Map([['c-card-running', 'update']]);
    mocked.context = context;

    const wrapper = mountSubject();

    refs.actionInProgress.value = new Map([['c-list-minor', 'update']]);
    await nextTick();

    refs.containerActionsEnabled.value = false;
    refs.actionInProgress.value = new Map();
    await nextTick();
    const cardLockButtons = wrapper
      .findAll('button[disabled]')
      .filter((b) => b.classes().includes('w-10') || b.classes().includes('w-8'));
    const cardLockBtn = cardLockButtons[0];
    expect(cardLockBtn).toBeDefined();
    (cardLockBtn!.element as HTMLButtonElement).disabled = false;
    await cardLockBtn!.trigger('click');

    refs.containerViewMode.value = 'list';
    refs.containerActionsEnabled.value = true;
    await nextTick();
    await wrapper.find('.emit-list-click').trigger('click');
  });

  it('renders dimmed card overlay with updating and queued labels for the cards view', async () => {
    const updatingCard = makeContainer({
      id: 'c-card-updating',
      name: 'alpha',
      newTag: '2.0.0',
      updateKind: 'major',
      status: 'running',
      bouncer: 'safe',
      updateOperation: {
        id: 'op-updating',
        status: 'in-progress',
        phase: 'pulling',
        updatedAt: '2026-04-12T00:00:00.000Z',
      },
    });
    const queuedCard = makeContainer({
      id: 'c-card-queued',
      name: 'beta',
      newTag: '2.1.0',
      updateKind: 'minor',
      status: 'running',
      bouncer: 'safe',
      updateOperation: {
        id: 'op-queued',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-12T00:00:00.000Z',
      },
    });

    const { context, refs } = makeContext();
    const containers = [updatingCard, queuedCard];
    refs.containerViewMode.value = 'cards';
    refs.filteredContainers.value = containers;
    refs.displayContainers.value = containers;
    refs.renderGroups.value = [
      {
        key: '__flat__',
        name: null,
        containers,
        containerCount: containers.length,
        updatesAvailable: 2,
        updatableCount: 2,
      },
    ];
    mocked.context = context;

    const wrapper = mountSubject();
    await nextTick();

    const cards = wrapper.findAll('.card-item-stub');
    expect(cards).toHaveLength(2);

    const updatingWrapper = cards[0]!.find('.transition-opacity');
    expect(updatingWrapper.classes()).toContain('opacity-30');
    const updatingOverlay = cards[0]!.find('.absolute.inset-0');
    expect(updatingOverlay.exists()).toBe(true);
    expect(updatingOverlay.text()).toBe('Pulling…');

    const queuedWrapper = cards[1]!.find('.transition-opacity');
    expect(queuedWrapper.classes()).toContain('opacity-30');
    const queuedOverlay = cards[1]!.find('.absolute.inset-0');
    expect(queuedOverlay.exists()).toBe(true);
    expect(queuedOverlay.text()).toBe('Queued');
  });

  it('renders ReleaseNotesLink and ProjectLink in the list view when the container exposes them (#295)', async () => {
    // rc.10 wired project/release-notes links into the cards view only. Users on
    // the list accordion view (the default on many installs) never saw the new
    // links. Assert the list view renders both when sourceRepo / releaseLink
    // are populated.
    const container = makeContainer({
      id: 'c-list-links',
      name: 'grafana',
      newTag: '12.3.3',
      updateKind: 'patch',
      sourceRepo: 'github.com/grafana/grafana',
      releaseLink: 'https://github.com/grafana/grafana/releases/tag/v12.3.3',
    });
    const { context, refs } = makeContext();
    refs.containerViewMode.value = 'list';
    refs.filteredContainers.value = [container];
    refs.displayContainers.value = [container];
    refs.renderGroups.value = [
      {
        key: '__flat__',
        name: null,
        containers: [container],
        containerCount: 1,
        updatesAvailable: 1,
        updatableCount: 1,
      },
    ];
    mocked.context = context;

    const wrapper = mountSubject();
    await nextTick();

    expect(wrapper.find('[data-test="project-link"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="release-link"]').exists()).toBe(true);
  });

  it('renders icon-only ReleaseNotesLink and ProjectLink inside the table actions column (#295)', async () => {
    // rc.10 wired project/release-notes links into the cards + detail panel
    // only. Table rows never showed them. We surface them as icon-style
    // AppIconButton links in the actions column itself so they match the
    // existing action icons and give finger-friendly tap targets.
    const container = makeContainer({
      id: 'c-table-actions-links',
      name: 'grafana',
      newTag: '12.3.3',
      updateKind: 'patch',
      sourceRepo: 'github.com/grafana/grafana',
      releaseLink: 'https://github.com/grafana/grafana/releases/tag/v12.3.3',
    });
    const { context, refs } = makeContext();
    refs.containerViewMode.value = 'table';
    refs.filteredContainers.value = [container];
    refs.displayContainers.value = [container];
    refs.renderGroups.value = [
      {
        key: '__flat__',
        name: null,
        containers: [container],
        containerCount: 1,
        updatesAvailable: 1,
        updatableCount: 1,
      },
    ];
    mocked.context = context;

    const wrapper = mountSubject();
    await nextTick();

    const projectLink = wrapper.find('[data-test="project-link"]');
    const releaseLink = wrapper.find('[data-test="release-link"]');
    expect(projectLink.exists()).toBe(true);
    expect(releaseLink.exists()).toBe(true);
    expect(projectLink.element.tagName).toBe('A');
    // releaseLink is the popover trigger (button) — clicking it opens the
    // unified release-notes popover; the external link lives inside the
    // popover body. See discussion #295.
    expect(releaseLink.element.tagName).toBe('BUTTON');
    expect(releaseLink.attributes('aria-haspopup')).toBe('dialog');
  });

  it('flat-mode tableRows reads from renderGroups[0].containers, not displayContainers', async () => {
    const containerA = makeContainer({ id: 'c-a', name: 'alpha' });
    const containerB = makeContainer({ id: 'c-b', name: 'beta' });
    const { context, refs } = makeContext();
    refs.containerViewMode.value = 'table';
    refs.groupByStack.value = false;
    // renderGroups holds only containerA
    refs.renderGroups.value = [
      {
        key: '__flat__',
        name: null,
        containers: [containerA],
        containerCount: 1,
        updatesAvailable: 0,
        updatableCount: 0,
      },
    ];
    // displayContainers holds both — if tableRows reads here, 2 rows would render
    refs.displayContainers.value = [containerA, containerB];
    refs.filteredContainers.value = [containerA, containerB];
    mocked.context = context;

    const wrapper = mountSubject();
    await nextTick();

    // Only 1 row should render because tableRows sources from renderGroups[0].containers
    const rows = wrapper.findAll('.table-row-stub');
    expect(rows).toHaveLength(1);
  });

  it('tableRows falls back to displayContainers when renderGroups is empty', async () => {
    const oneContainer = makeContainer({ id: 'c-only', name: 'only' });
    const { context, refs } = makeContext();
    refs.containerViewMode.value = 'table';
    refs.groupByStack.value = false;
    // renderGroups is empty — flat branch falls back to displayContainers
    refs.renderGroups.value = [];
    refs.displayContainers.value = [oneContainer];
    refs.filteredContainers.value = [oneContainer];
    mocked.context = context;

    const wrapper = mountSubject();
    await nextTick();

    const rows = wrapper.findAll('.table-row-stub');
    expect(rows).toHaveLength(1);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Per-container counter increments (batch progress display)
  // ──────────────────────────────────────────────────────────────────────────

  function mountWithGroup(groupKey: string, groupName: string, containers: Container[]) {
    const { context, refs } = makeContext();
    refs.groupByStack.value = true;
    refs.filteredContainers.value = containers;
    refs.displayContainers.value = containers;
    refs.renderGroups.value = [
      {
        key: groupKey,
        name: groupName,
        containers,
        containerCount: containers.length,
        updatesAvailable: containers.length,
        updatableCount: containers.length,
      },
    ];
    mocked.context = context;
    return mountSubject();
  }

  it('ignores terminal events for unknown containers (no batch active)', async () => {
    const c1 = makeContainer({ id: 'c-1', name: 'alpha' });
    const wrapper = mountWithGroup('stack-a', 'stack-a', [c1]);
    // No batch captured

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-applied', { detail: { containerId: 'c-1' } }),
    );
    await nextTick();
    wrapper.unmount();

    // No batch captured, so no counter change
    expect(useUpdateBatches().getBatch('stack-a')).toBeUndefined();
  });

  it('ignores terminal events for containers not in any group', async () => {
    const c1 = makeContainer({ id: 'c-1', name: 'alpha' });
    const wrapper = mountWithGroup('stack-a', 'stack-a', [c1]);
    useUpdateBatches().captureBatch('stack-a', 1);

    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-applied', { detail: { containerId: 'not-in-group' } }),
    );
    await nextTick();
    wrapper.unmount();

    expect(useUpdateBatches().getBatch('stack-a')?.succeededCount).toBe(0);
  });

  it('ignores dd:sse-update-applied with missing containerId', async () => {
    const c1 = makeContainer({ id: 'c-1', name: 'alpha' });
    const wrapper = mountWithGroup('stack-a', 'stack-a', [c1]);
    useUpdateBatches().captureBatch('stack-a', 1);

    globalThis.dispatchEvent(new CustomEvent('dd:sse-update-applied', { detail: {} }));
    await nextTick();
    wrapper.unmount();

    expect(useUpdateBatches().getBatch('stack-a')?.succeededCount).toBe(0);
  });

  it('ignores dd:sse-update-failed with missing containerId', async () => {
    const c1 = makeContainer({ id: 'c-1', name: 'alpha' });
    const wrapper = mountWithGroup('stack-a', 'stack-a', [c1]);
    useUpdateBatches().captureBatch('stack-a', 1);

    globalThis.dispatchEvent(new CustomEvent('dd:sse-update-failed', { detail: {} }));
    await nextTick();
    wrapper.unmount();

    expect(useUpdateBatches().getBatch('stack-a')?.failedCount).toBe(0);
  });

  it('holds batch at Y of Y for ~1500ms before clearing', async () => {
    vi.useFakeTimers();

    const c1 = makeContainer({ id: 'c-1', name: 'alpha' });
    const c2 = makeContainer({ id: 'c-2', name: 'beta' });

    const { context, refs } = makeContext();
    refs.groupByStack.value = true;
    refs.filteredContainers.value = [c1, c2];
    refs.displayContainers.value = [c1, c2];
    refs.renderGroups.value = [
      {
        key: 'stack-a',
        name: 'stack-a',
        containers: [c1, c2],
        containerCount: 2,
        updatesAvailable: 2,
        updatableCount: 2,
      },
    ];
    useUpdateBatches().captureBatch('stack-a', 2);
    mocked.context = context;

    mountSubject();

    // Both containers complete
    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-applied', { detail: { containerId: 'c-1' } }),
    );
    globalThis.dispatchEvent(
      new CustomEvent('dd:sse-update-applied', { detail: { containerId: 'c-2' } }),
    );
    await nextTick();

    // Batch still present — within the hold window
    expect(useUpdateBatches().getBatch('stack-a')).toBeDefined();

    // Advance just before the hold expires
    vi.advanceTimersByTime(1400);
    expect(useUpdateBatches().getBatch('stack-a')).toBeDefined();

    // Advance past the hold
    vi.advanceTimersByTime(200);
    expect(useUpdateBatches().getBatch('stack-a')).toBeUndefined();

    vi.useRealTimers();
  });

  describe('phase-aware in-progress badge labels', () => {
    function mountWithPhase(phase: string | undefined) {
      const container = makeContainer({
        id: 'c-phase-1',
        name: 'alpha',
        newTag: '2.0.0',
        updateKind: 'major',
        bouncer: 'safe',
        status: 'running',
        updateOperation: {
          id: 'op-1',
          status: 'in-progress',
          phase: phase as any,
          updatedAt: '2026-04-01T12:00:00.000Z',
        },
      });

      const { context, refs } = makeContext();
      refs.filteredContainers.value = [container];
      refs.displayContainers.value = [container];
      refs.renderGroups.value = [
        {
          key: '__flat__',
          name: null,
          containers: [container],
          containerCount: 1,
          updatesAvailable: 1,
          updatableCount: 1,
        },
      ];
      refs.containerViewMode.value = 'table';
      mocked.context = context;
      return mountSubject();
    }

    it('shows "Scanning…" badge for phase scanning', () => {
      const wrapper = mountWithPhase('scanning');
      expect(rowByName(wrapper, 'alpha').text()).toContain('Scanning…');
    });

    it('shows "Pulling…" badge for phase pulling', () => {
      const wrapper = mountWithPhase('pulling');
      expect(rowByName(wrapper, 'alpha').text()).toContain('Pulling…');
    });

    it('shows "Updating" badge for unknown/removed phase signature-verifying (falls through to default)', () => {
      const wrapper = mountWithPhase('signature-verifying');
      expect(rowByName(wrapper, 'alpha').text()).toContain('Updating');
    });

    it('shows "Generating SBOM…" badge for phase sbom-generating', () => {
      const wrapper = mountWithPhase('sbom-generating');
      expect(rowByName(wrapper, 'alpha').text()).toContain('Generating SBOM…');
    });

    it('shows "Health-checking…" badge for phase health-gate', () => {
      const wrapper = mountWithPhase('health-gate');
      expect(rowByName(wrapper, 'alpha').text()).toContain('Health-checking…');
    });

    it('shows "Finalizing…" badge for phase health-gate-passed', () => {
      const wrapper = mountWithPhase('health-gate-passed');
      expect(rowByName(wrapper, 'alpha').text()).toContain('Finalizing…');
    });

    it('shows "Rolling back…" badge for phase rollback-started', () => {
      const wrapper = mountWithPhase('rollback-started');
      expect(rowByName(wrapper, 'alpha').text()).toContain('Rolling back…');
    });

    it('shows "Rolling back…" badge for phase rollback-deferred', () => {
      const wrapper = mountWithPhase('rollback-deferred');
      expect(rowByName(wrapper, 'alpha').text()).toContain('Rolling back…');
    });

    it('shows "Updating" badge for an unknown phase', () => {
      const wrapper = mountWithPhase('some-unknown-phase');
      expect(rowByName(wrapper, 'alpha').text()).toContain('Updating');
    });
  });

  describe('digest update row rendering', () => {
    const digestLocal = 'sha256:bcf6335aabbb1234567890abcdef1234567890abcdef1234567890abcdef12';
    const digestRemote = 'sha256:deadbeefcafe1234567890abcdef1234567890abcdef1234567890abcdef12';

    function mountDigestContainer(
      digestOverrides: Partial<Container> = {},
      contextOverrides: Record<string, unknown> = {},
    ) {
      const container = makeContainer({
        id: 'c-digest',
        name: 'alpha',
        currentTag: digestLocal,
        newTag: digestLocal,
        updateKind: 'digest',
        currentDigest: digestLocal,
        newDigest: digestRemote,
        status: 'running',
        bouncer: 'safe',
        ...digestOverrides,
      });
      const { context } = makeContext(contextOverrides);
      context.containerViewMode.value = 'table';
      context.filteredContainers.value = [container];
      context.displayContainers.value = [container];
      context.renderGroups.value = [
        {
          key: 'g',
          name: 'g',
          containers: [container],
          containerCount: 1,
          updatesAvailable: 1,
          updatableCount: 1,
        },
      ];
      mocked.context = context;
      return mountSubject();
    }

    it('renders the short form of currentDigest → newDigest for a digest-pinned update row', async () => {
      const wrapper = mountDigestContainer();
      const row = rowByName(wrapper, 'alpha');
      const text = row.text();
      expect(text).toContain('sha256:bcf6335aabbb…');
      expect(text).toContain('sha256:deadbeefcafe…');
    });

    it('does NOT render two identical currentTag strings for a digest-pinned update row', async () => {
      const wrapper = mountDigestContainer();
      const row = rowByName(wrapper, 'alpha');
      const text = row.text();
      // The full raw digest should not appear twice (identical-string bug)
      const occurrences = text.split(digestLocal).length - 1;
      expect(occurrences).toBeLessThan(2);
    });

    it('renders tag AND digest delta for a hybrid tag+digest update row (fix #342)', async () => {
      // Hybrid scenario: image has a real tag (e.g. `v8.13.2`), digest changed.
      // The version cell must show BOTH the unchanged tag (muted) AND the digest
      // delta (formatShortDigest(current) → formatShortDigest(new)).
      const wrapper = mountDigestContainer({
        currentTag: '14-vectorchord0.4.3-pgvectors0.2.0',
        newTag: '14-vectorchord0.4.3-pgvectors0.2.0',
        isDigestPinned: false,
      });
      const row = rowByName(wrapper, 'alpha');
      const text = row.text();
      expect(text).toContain('14-vectorchord0.4.3-pgvectors0.2.0');
      expect(text).toContain('sha256:bcf6335aabbb…');
      expect(text).toContain('sha256:deadbeefcafe…');
    });

    it('renders tag AND digest delta for a floating-tag + digest-watch update row (#356, updated #342)', async () => {
      // Brian's scenario: currentTag is a meaningful tag (`v8.13.2`), digest changed
      // but tag did not. The version cell must show the tag AND the digest delta.
      const wrapper = mountDigestContainer({
        currentTag: 'v8.13.2',
        newTag: 'v8.13.2',
        isDigestPinned: false,
      });
      const row = rowByName(wrapper, 'alpha');
      const text = row.text();
      expect(text).toContain('v8.13.2');
      expect(text).toContain('sha256:bcf6335aabbb…');
      expect(text).toContain('sha256:deadbeefcafe…');
    });

    it('renders tag AND digest delta for a linuxserver-style transform tag (#356, updated #342)', async () => {
      // Reporter's transformed tag like `compose-X-version-9.0.1` — floating-tag
      // alias with digest watch auto-enabled by `da1334a4`. Now shows digest delta too.
      const wrapper = mountDigestContainer({
        currentTag: 'compose-X-version-9.0.1',
        newTag: 'compose-X-version-9.0.1',
        isDigestPinned: false,
      });
      const row = rowByName(wrapper, 'alpha');
      const text = row.text();
      expect(text).toContain('compose-X-version-9.0.1');
      expect(text).toContain('sha256:bcf6335aabbb…');
      expect(text).toContain('sha256:deadbeefcafe…');
    });

    it('still renders currentTag → newTag for a tag update row', async () => {
      const container = makeContainer({
        id: 'c-tag',
        name: 'alpha',
        currentTag: '1.25',
        newTag: '1.26',
        updateKind: 'minor',
        status: 'running',
        bouncer: 'safe',
      });
      const { context } = makeContext();
      context.containerViewMode.value = 'table';
      context.filteredContainers.value = [container];
      context.displayContainers.value = [container];
      context.renderGroups.value = [
        {
          key: 'g',
          name: 'g',
          containers: [container],
          containerCount: 1,
          updatesAvailable: 1,
          updatableCount: 1,
        },
      ];
      mocked.context = context;
      const wrapper = mountSubject();
      const row = rowByName(wrapper, 'alpha');
      const text = row.text();
      expect(text).toContain('1.25');
      expect(text).toContain('1.26');
    });

    it('renders the rate-limited error pill in the version cell when registryError is set and newTag is null', async () => {
      const container = makeContainer({
        id: 'c-ratelimited',
        name: 'alpha',
        currentTag: '1.0.0',
        newTag: null,
        updateKind: null,
        status: 'running',
        bouncer: 'safe',
        registryError: '429 Too Many Requests',
        registryErrorKind: 'rate-limited',
      } as any);
      const { context } = makeContext();
      context.containerViewMode.value = 'table';
      context.filteredContainers.value = [container];
      context.displayContainers.value = [container];
      context.renderGroups.value = [
        {
          key: 'g',
          name: 'g',
          containers: [container],
          containerCount: 1,
          updatesAvailable: 0,
          updatableCount: 0,
        },
      ];
      mocked.context = context;
      const wrapper = mountSubject();
      const row = rowByName(wrapper, 'alpha');
      expect(row.text()).toContain('Rate limited');
    });

    it('renders tag AND digest delta in the card body for a hybrid tag+digest update (fix #342)', async () => {
      const container = makeContainer({
        id: 'c-card-hybrid-digest',
        name: 'alpha',
        currentTag: '14-vectorchord0.4.3-pgvectors0.2.0',
        newTag: '14-vectorchord0.4.3-pgvectors0.2.0',
        updateKind: 'digest',
        currentDigest: digestLocal,
        newDigest: digestRemote,
        isDigestPinned: false,
        status: 'running',
        bouncer: 'safe',
      });
      const { context } = makeContext();
      context.containerViewMode.value = 'cards';
      context.filteredContainers.value = [container];
      context.displayContainers.value = [container];
      context.renderGroups.value = [
        {
          key: 'g',
          name: null,
          containers: [container],
          containerCount: 1,
          updatesAvailable: 1,
          updatableCount: 1,
        },
      ];
      mocked.context = context;
      const wrapper = mountSubject();
      const card = wrapper.findAll('.card-item-stub').find((c) => c.text().includes('alpha'));
      expect(card).toBeDefined();
      const text = card!.text();
      expect(text).toContain('14-vectorchord0.4.3-pgvectors0.2.0');
      expect(text).toContain('sha256:bcf6335aabbb…');
      expect(text).toContain('sha256:deadbeefcafe…');
    });

    it('renders digest-pinned update in the card body (pure-digest, regression for #342 fix)', async () => {
      const container = makeContainer({
        id: 'c-card-pure-digest',
        name: 'alpha',
        currentTag: digestLocal,
        newTag: digestLocal,
        updateKind: 'digest',
        currentDigest: digestLocal,
        newDigest: digestRemote,
        isDigestPinned: true,
        status: 'running',
        bouncer: 'safe',
      });
      const { context } = makeContext();
      context.containerViewMode.value = 'cards';
      context.filteredContainers.value = [container];
      context.displayContainers.value = [container];
      context.renderGroups.value = [
        {
          key: 'g',
          name: null,
          containers: [container],
          containerCount: 1,
          updatesAvailable: 1,
          updatableCount: 1,
        },
      ];
      mocked.context = context;
      const wrapper = mountSubject();
      const card = wrapper.findAll('.card-item-stub').find((c) => c.text().includes('alpha'));
      expect(card).toBeDefined();
      const text = card!.text();
      expect(text).toContain('sha256:bcf6335aabbb…');
      expect(text).toContain('sha256:deadbeefcafe…');
    });

    it('renders currentTag + digest delta when BOTH tag and digest change simultaneously (hybrid both-halves)', async () => {
      // Both tag and digest change: e.g. 1.2.3 → 1.2.4 AND sha256:aaa → sha256:bbb.
      // updateKind is 'digest' so the component takes the hybrid digest branch.
      // It renders currentTag (muted) plus the digest short-form delta.
      const wrapper = mountDigestContainer({
        currentTag: '1.2.3',
        newTag: '1.2.4',
        isDigestPinned: false,
        updateKind: 'digest',
      });
      const row = rowByName(wrapper, 'alpha');
      const text = row.text();
      // currentTag is shown in the muted span
      expect(text).toContain('1.2.3');
      // digest delta is shown (both sides)
      expect(text).toContain('sha256:bcf6335aabbb…');
      expect(text).toContain('sha256:deadbeefcafe…');
    });

    it('does NOT render two identical full digest strings for a hybrid both-halves-change row (regression)', async () => {
      // Regression guard: the full raw digest should not appear twice in the row
      // even when both tag and digest change simultaneously.
      const wrapper = mountDigestContainer({
        currentTag: '1.2.3',
        newTag: '1.2.4',
        isDigestPinned: false,
        updateKind: 'digest',
      });
      const row = rowByName(wrapper, 'alpha');
      const text = row.text();
      const occurrences = text.split(digestLocal).length - 1;
      expect(occurrences).toBeLessThan(2);
    });

    it('does NOT render the registry-error pill in the version cell when newTag is set', async () => {
      const container = makeContainer({
        id: 'c-ratelimited-with-newtag',
        name: 'alpha',
        currentTag: '1.0.0',
        newTag: '1.1.0',
        updateKind: 'minor',
        status: 'running',
        bouncer: 'safe',
        registryError: '429 Too Many Requests',
        registryErrorKind: 'rate-limited',
      } as any);
      const { context } = makeContext();
      context.containerViewMode.value = 'table';
      context.filteredContainers.value = [container];
      context.displayContainers.value = [container];
      context.renderGroups.value = [
        {
          key: 'g',
          name: 'g',
          containers: [container],
          containerCount: 1,
          updatesAvailable: 1,
          updatableCount: 1,
        },
      ];
      mocked.context = context;
      const wrapper = mountSubject();
      const row = rowByName(wrapper, 'alpha');
      const text = row.text();
      expect(text).toContain('1.0.0');
      expect(text).toContain('1.1.0');
      expect(text).not.toContain('Rate limited');
    });
  });
});
