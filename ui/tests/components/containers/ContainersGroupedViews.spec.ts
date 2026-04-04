import { defineComponent, nextTick, onMounted, ref } from 'vue';
import ContainersGroupedViews from '@/components/containers/ContainersGroupedViews.vue';
import type { Container } from '@/types/container';
import { mountWithPlugins } from '../../helpers/mount';

const mocked = vi.hoisted(() => ({
  context: null as any,
}));

vi.mock('@/components/containers/containersViewTemplateContext', () => ({
  useContainersViewTemplateContext: () => mocked.context,
}));

const DataTableStub = defineComponent({
  props: ['rows', 'rowClass'],
  emits: ['update:sort-key', 'update:sort-asc', 'row-click'],
  setup(props, { emit }) {
    onMounted(() => {
      emit('update:sort-key', 'status');
      emit('update:sort-asc', false);
      if (Array.isArray(props.rows) && props.rows.length > 0) {
        emit('row-click', props.rows[0]);
      }
    });
  },
  template: `
    <div class="data-table-stub">
      <div
        v-for="row in rows"
        :key="row.name"
        class="table-row-stub"
        :class="typeof rowClass === 'function' ? rowClass(row) : ''">
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
  const containerActionsEnabled = ref(true);
  const actionInProgress = ref(new Set<string>());
  const containerViewMode = ref<'table' | 'cards' | 'list'>('table');
  const tableColumns = ref([
    { key: 'icon', label: '', align: 'text-center' },
    { key: 'name', label: 'Container', align: 'text-left' },
  ]);
  const containerSortKey = ref('name');
  const containerSortAsc = ref(true);
  const selectedContainer = ref<Container | null>(null);
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
    containerActionsEnabled,
    containerActionsDisabledReason: ref('Actions disabled by server configuration'),
    actionInProgress,
    isContainerUpdateInProgress: (target: { id?: string; name?: string; _pending?: true }) =>
      Boolean(target._pending) || actionInProgress.value.has(target.id ?? target.name ?? ''),
    updateAllInGroup: spies.updateAllInGroup,
    tt: (label: string) => ({ value: label, showDelay: 400 }),
    containerViewMode,
    tableColumns,
    containerSortKey,
    containerSortAsc,
    selectedContainer,
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
      server.includes('local') ? { name: 'Local', env: 'dev' } : { name: 'Remote', env: null },
    registryColorBg: () => '#ddd',
    registryColorText: () => '#222',
    registryLabel: (registry: string) => registry,
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
      containerViewMode,
      tableActionStyle,
      openActionsMenu,
      displayContainers,
      activeFilterCount,
      filterSearch,
      containerActionsEnabled,
      actionInProgress,
      selectedContainer,
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

function mountSubject() {
  return mountWithPlugins(ContainersGroupedViews, {
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
}

describe('ContainersGroupedViews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    const pending = makeContainer({
      id: 'c-pending',
      name: 'epsilon',
      newTag: null,
      status: 'running',
      bouncer: 'safe',
      _pending: true as any,
    });

    const { context, spies } = makeContext();
    const containers = [blocked, updatable, runningNoUpdate, stoppedNoUpdate, pending];
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
    expect(spies.confirmDelete).toHaveBeenCalled();
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
    refs.actionInProgress.value = new Set(['c-disabled']);
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
    refs.actionInProgress.value = new Set(['c-local']);
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
    refs.actionInProgress.value = new Set(['c-progress-1']);
    mocked.context = context;

    const wrapper = mountSubject();
    expect(wrapper.text()).toContain('alpha');

    refs.actionInProgress.value = new Set(['c-progress-2']);
    await nextTick();
    refs.actionInProgress.value = new Set(['c-progress-3']);
    await nextTick();

    refs.tableActionStyle.value = 'icons';
    refs.actionInProgress.value = new Set(['c-progress-3']);
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
    refs.actionInProgress.value = new Set(['c-progress-1']);
    mocked.context = context;

    const wrapper = mountSubject();
    const row = rowByName(wrapper, 'alpha');

    expect(row.classes()).toContain('opacity-50');
    expect(row.text()).toContain('Updating');
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

    expect(row.classes()).toContain('opacity-50');
    expect(row.text()).toContain('Updating');
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
    refs.actionInProgress.value = new Set(['c-card-running']);
    mocked.context = context;

    const wrapper = mountSubject();

    refs.actionInProgress.value = new Set(['c-list-minor']);
    await nextTick();

    refs.containerActionsEnabled.value = false;
    refs.actionInProgress.value = new Set();
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
});
