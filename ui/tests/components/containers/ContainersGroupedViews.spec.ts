import { defineComponent, nextTick, onMounted, ref } from 'vue';
import CopyableTag from '@/components/CopyableTag.vue';
import ContainersGroupedViews from '@/components/containers/ContainersGroupedViews.vue';
import DataTable from '@/components/DataTable.vue';
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
    'columns',
    'hiddenColumnKeys',
    'rows',
    'rowClass',
    'rowClickable',
    'fullWidthRow',
    'rowKey',
    'virtualScroll',
    'virtualMaxHeight',
    'rowHeight',
    'maxHeight',
    'preferCards',
    'hoistCardSort',
  ],
  emits: ['update:sort-key', 'update:sort-asc', 'update:card-reflow-forced', 'row-click'],
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
    <div class="data-table-stub" :data-hidden-column-keys="JSON.stringify(hiddenColumnKeys || [])">
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
            <slot name="cell-softwareVersion" :row="row" />
            <slot name="cell-kind" :row="row" />
            <slot name="cell-status" :row="row" />
            <slot name="cell-bouncer" :row="row" />
            <slot name="cell-server" :row="row" />
            <slot name="cell-registry" :row="row" />
            <slot name="cell-uptime" :row="row" />
            <slot name="actions" :row="row" />
          </div>
        </template>
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
  const containerViewMode = ref<'table' | 'cards'>('table');
  const containerCardReflowForced = ref(false);
  const tableColumns = ref([
    { key: 'icon', label: '', align: 'text-center' },
    { key: 'name', label: 'Container', align: 'text-left' },
  ]);
  const hiddenColumnKeys = ref<string[]>([]);
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
    recheckContainer: vi.fn(),
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
    containerViewMode,
    containerCardReflowForced,
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
    tableColumns,
    hiddenColumnKeys,
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
    recheckContainer: spies.recheckContainer,
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
      containerCardReflowForced,
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
let restoreClientWidthMock: (() => void) | null = null;

function mockElementClientWidth(width: number) {
  if (!restoreClientWidthMock) {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientWidth',
    );
    restoreClientWidthMock = () => {
      if (originalDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalDescriptor);
      } else {
        delete (HTMLElement.prototype as any).clientWidth;
      }
      restoreClientWidthMock = null;
    };
  }
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return width;
    },
  });
}

function mountSubject() {
  const wrapper = mountWithPlugins(ContainersGroupedViews, {
    global: {
      stubs: {
        DataTable: DataTableStub,
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

function mountSubjectWithRealDataTable(width = 800) {
  mockElementClientWidth(width);
  const wrapper = mountWithPlugins(ContainersGroupedViews, {
    global: {
      components: { CopyableTag, DataTable },
      stubs: {
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

async function mountCardsWithContainers(containers: Container[], width = 800) {
  const { context, refs, spies } = makeContext();
  refs.containerViewMode.value = 'cards';
  refs.filteredContainers.value = containers;
  refs.displayContainers.value = containers;
  refs.renderGroups.value = [
    {
      key: '__flat__',
      name: null,
      containers,
      containerCount: containers.length,
      updatesAvailable: containers.filter((container) => Boolean(container.newTag)).length,
      updatableCount: containers.filter((container) => Boolean(container.newTag)).length,
    },
  ];
  mocked.context = context;
  const wrapper = mountSubjectWithRealDataTable(width);
  await nextTick();
  return { wrapper, context, refs, spies };
}

function cardByName(wrapper: any, name: string) {
  const card = wrapper
    .findAll('[data-test="dd-card"]')
    .find((candidate: any) => candidate.text().includes(name));
  expect(card).toBeDefined();
  return card!;
}

function cardIconButton(card: any, icon: string) {
  const matches = card
    .findAll('button, a')
    .filter((candidate: any) => candidate.find(`[data-icon="${icon}"]`).exists());
  const button =
    matches.find((candidate: any) => candidate.classes().includes('min-w-8')) ?? matches[0];
  expect(button).toBeDefined();
  return button!;
}

function shortDigest(digest: string) {
  return `${digest.slice(0, 'sha256:'.length + 12)}…`;
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
    restoreClientWidthMock?.();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useUpdateBatches().batches.value = new Map();
    useToast().toasts.value = [];
  });

  it('passes tableColumns and hiddenColumnKeys straight through to DataTable', () => {
    const container = makeContainer({ id: 'c-wiring', name: 'alpha' });
    const { context } = makeContext();
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
    context.hiddenColumnKeys.value = ['registry', 'uptime'];
    mocked.context = context;

    const wrapper = mountSubject();
    const dataTable = wrapper.find('.data-table-stub');

    expect(JSON.parse(dataTable.attributes('data-hidden-column-keys')!)).toEqual([
      'registry',
      'uptime',
    ]);
  });

  it('hoists card sorting when cards are selected or measured card reflow is forced', async () => {
    const container = makeContainer({ id: 'c-hoist', name: 'alpha' });
    const { context, refs } = makeContext();
    refs.filteredContainers.value = [container];
    refs.displayContainers.value = [container];
    refs.renderGroups.value = [
      {
        key: '__flat__',
        name: null,
        containers: [container],
        containerCount: 1,
        updatesAvailable: 0,
        updatableCount: 0,
      },
    ];
    mocked.context = context;

    const wrapper = mountSubject();
    const dataTable = wrapper.findComponent(DataTableStub);

    expect(dataTable.props('hoistCardSort')).toBe(false);

    dataTable.vm.$emit('update:card-reflow-forced', true);
    await nextTick();

    expect(refs.containerCardReflowForced.value).toBe(true);
    expect(wrapper.findComponent(DataTableStub).props('hoistCardSort')).toBe(true);

    dataTable.vm.$emit('update:card-reflow-forced', false);
    refs.containerViewMode.value = 'cards';
    await nextTick();

    expect(refs.containerCardReflowForced.value).toBe(false);
    expect(wrapper.findComponent(DataTableStub).props('hoistCardSort')).toBe(true);
  });

  it('renders container cards through DataTable preferCards at wide container widths', async () => {
    const container = makeContainer({ id: 'c-card-path', name: 'alpha', newTag: '1.1.0' });

    const { wrapper } = await mountCardsWithContainers([container], 800);

    expect(wrapper.find('table').exists()).toBe(false);
    expect(wrapper.findAll('[data-test="dd-card"]')).toHaveLength(1);
    expect(cardByName(wrapper, 'alpha').text()).toContain('nginx:1.0.0');
  });

  it('keeps the #356/#370 digest guard in card mode for floating tags and digest-pinned rows', async () => {
    const currentDigest = 'sha256:111111111111aaaaaaaaaaaa';
    const newDigest = 'sha256:222222222222bbbbbbbbbbbb';
    const floatingDigest = makeContainer({
      id: 'c-floating-digest',
      name: 'floating',
      currentTag: 'v8.13.2',
      newTag: null,
      updateKind: 'digest',
      currentDigest,
      newDigest,
      isDigestPinned: false,
    } as Partial<Container>);
    const pinnedDigest = makeContainer({
      id: 'c-pinned-digest',
      name: 'pinned',
      currentTag: currentDigest,
      newTag: null,
      updateKind: 'digest',
      currentDigest,
      newDigest,
      isDigestPinned: true,
    } as Partial<Container>);

    const { wrapper } = await mountCardsWithContainers([floatingDigest, pinnedDigest], 800);
    const floatingCard = cardByName(wrapper, 'floating');
    const pinnedCard = cardByName(wrapper, 'pinned');

    expect(floatingCard.text()).toContain('v8.13.2');
    expect(floatingCard.text()).not.toContain(shortDigest(currentDigest));
    expect(floatingCard.text()).not.toContain(shortDigest(newDigest));
    expect(floatingCard.text()).not.toContain('→');

    const floatingTag = floatingCard
      .findAll('[title]')
      .find((candidate: any) =>
        candidate
          .attributes('title')
          ?.includes(`v8.13.2 — ${shortDigest(currentDigest)} → ${shortDigest(newDigest)}`),
      );
    expect(floatingTag).toBeDefined();
    expect(floatingTag!.text()).toContain('v8.13.2');

    expect(pinnedCard.text()).toContain(shortDigest(currentDigest));
    expect(pinnedCard.text()).toContain(shortDigest(newDigest));
  });

  it('renders card update states for new tags, no-update reasons, and up-to-date containers', async () => {
    const available = makeContainer({
      id: 'c-available',
      name: 'available',
      currentTag: '1.0.0',
      newTag: '1.1.0',
      updateKind: 'minor',
      updateMaturity: 'fresh',
    });
    const noUpdate = makeContainer({
      id: 'c-no-update',
      name: 'no-update',
      newTag: null,
      updateKind: null,
      noUpdateReason: 'Pinned by policy',
    });
    const current = makeContainer({
      id: 'c-current',
      name: 'current',
      newTag: null,
      updateKind: null,
    });

    const { wrapper } = await mountCardsWithContainers([available, noUpdate, current], 800);

    const availableCard = cardByName(wrapper, 'available');
    expect(availableCard.text()).toContain('1.0.0');
    expect(availableCard.text()).toContain('1.1.0');
    expect(availableCard.get('[data-test="container-card-update-state"]').text()).toContain(
      'Minor',
    );
    expect(availableCard.text()).toContain('NEW');

    const noUpdateCard = cardByName(wrapper, 'no-update');
    expect(noUpdateCard.get('[data-test="no-update-reason-badge"]').attributes('aria-label')).toBe(
      'Pinned by policy',
    );

    const currentCard = cardByName(wrapper, 'current');
    expect(currentCard.get('[data-test="container-card-update-state"]').text()).toContain(
      'Current',
    );
  });

  it('renders card overlays and header registry/policy indicators', async () => {
    const updating = makeContainer({
      id: 'c-updating-card',
      name: 'updating',
      newTag: '2.0.0',
      updateKind: 'major',
    });
    const registryError = makeContainer({
      id: 'c-registry-error-card',
      name: 'alpha',
      registryError: '401 unauthorized',
    });
    const snoozed = makeContainer({ id: 'c-snoozed-card', name: 'beta' });
    const skipped = makeContainer({ id: 'c-skipped-card', name: 'gamma' });
    const maturityBlocked = makeContainer({ id: 'c-maturity-card', name: 'epsilon' });

    const { wrapper, refs } = await mountCardsWithContainers(
      [updating, registryError, snoozed, skipped, maturityBlocked],
      800,
    );
    refs.actionInProgress.value = new Map([['c-updating-card', 'update']]);
    await nextTick();

    const updatingCard = cardByName(wrapper, 'updating');
    expect(updatingCard.classes()).toContain('dd-row-updating');
    expect(updatingCard.text()).toContain('Updating');
    expect(updatingCard.find('.dd-spin').exists()).toBe(true);

    expect(cardByName(wrapper, 'alpha').find('[aria-label="Registry error"]').exists()).toBe(true);
    expect(cardByName(wrapper, 'beta').find('[aria-label="Snoozed updates"]').exists()).toBe(true);
    expect(cardByName(wrapper, 'gamma').find('[aria-label="Skipped updates"]').exists()).toBe(true);
    expect(
      cardByName(wrapper, 'epsilon').find('[aria-label="Maturity-blocked updates"]').exists(),
    ).toBe(true);
  });

  it('renders card footer links and 44px action targets, with recheck reachable from the kebab', async () => {
    const linked = makeContainer({
      id: 'c-linked-card',
      name: 'linked',
      currentTag: 'latest',
      newTag: '1.2.0',
      updateKind: 'minor',
      suggestedTag: '1.2.0',
      releaseLink: 'https://example.test/releases/1.2.0',
      sourceRepo: 'github.com/example/project',
    });

    const { wrapper, spies } = await mountCardsWithContainers([linked], 800);
    const card = cardByName(wrapper, 'linked');

    expect(card.find('[data-test="suggested-tag-badge"]').exists()).toBe(true);
    expect(card.findAll('[data-test="release-link"]').length).toBeGreaterThan(0);
    expect(card.find('[data-test="project-link"]').exists()).toBe(true);

    for (const icon of ['file-text', 'github', 'cloud-download', 'more']) {
      const action = cardIconButton(card, icon);
      expect(action.classes()).toEqual(expect.arrayContaining(['w-11', 'h-11']));
    }

    await cardIconButton(card, 'more').trigger('click');
    await nextTick();

    expect(spies.toggleActionsMenu).toHaveBeenCalledWith('c-linked-card', expect.any(MouseEvent));

    const recheck = wrapper
      .findAll('button')
      .find((button) => button.text().trim() === 'Recheck for updates');
    expect(recheck).toBeDefined();
    await recheck!.trigger('click');
    expect(spies.recheckContainer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c-linked-card' }),
    );
  });

  it('keeps registry in the card subtitle, moves update state to the header, and leaves release/project links in the footer', async () => {
    const linked = makeContainer({
      id: 'c-card-body-layout',
      name: 'linked',
      currentTag: 'latest',
      newTag: '1.2.0',
      updateKind: 'minor',
      updateMaturity: 'fresh',
      registry: 'custom',
      registryName: 'Private Registry',
      releaseLink: 'https://example.test/releases/1.2.0',
      sourceRepo: 'github.com/example/project',
      suggestedTag: '1.2.0',
    });

    const { wrapper } = await mountCardsWithContainers([linked], 800);
    const card = cardByName(wrapper, 'linked');
    const header = card.get('.px-4.pt-4.pb-2');
    const body = card.get('.px-4.py-3.min-w-0');
    const footer = card.get('.mt-auto');

    expect(header.get('[data-test="container-card-registry-text"]').text()).toBe(
      'Private Registry',
    );
    expect(header.get('[data-test="container-card-update-state"]').text()).toContain('Minor');
    expect(body.text()).toContain('latest');
    expect(body.text()).toContain('→');
    expect(body.text()).toContain('1.2.0');
    expect(body.text()).not.toContain('Current');
    expect(body.text()).not.toContain('Latest');
    expect(body.find('[data-test="suggested-tag-badge"]').exists()).toBe(true);
    expect(body.find('[data-test="release-link"]').exists()).toBe(false);
    expect(body.find('[data-test="project-link"]').exists()).toBe(false);
    expect(footer.find('[data-test="release-link"]').exists()).toBe(true);
    expect(footer.find('[data-test="project-link"]').exists()).toBe(true);
  });

  it('suppresses the header update-state badge when the registry is in error', async () => {
    const registryError = makeContainer({
      id: 'c-card-registry-error',
      name: 'registry-error',
      registryError: '401 unauthorized',
    });

    const { wrapper } = await mountCardsWithContainers([registryError], 800);
    const card = cardByName(wrapper, 'registry-error');
    const header = card.get('.px-4.pt-4.pb-2');

    expect(header.find('[data-test="container-card-update-state"]').exists()).toBe(false);
    expect(header.find('[aria-label="Registry error"]').exists()).toBe(true);
  });

  it('renders grouped card headers as full-width rows spanning the card grid', async () => {
    const alpha = makeContainer({ id: 'c-group-card-a', name: 'alpha', newTag: '2.0.0' });
    const beta = makeContainer({ id: 'c-group-card-b', name: 'beta', newTag: '1.1.0' });
    const { context, refs } = makeContext();
    refs.groupByStack.value = true;
    refs.containerViewMode.value = 'cards';
    refs.filteredContainers.value = [alpha, beta];
    refs.displayContainers.value = [alpha, beta];
    refs.renderGroups.value = [
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

    const wrapper = mountSubjectWithRealDataTable(800);
    await nextTick();

    const listItems = wrapper.findAll('ul[role="list"] > li');
    expect(listItems[0].attributes('style')).toContain('grid-column: 1 / -1');
    expect(listItems[0].text()).toContain('stack-a');
    expect(listItems[2].attributes('style')).toContain('grid-column: 1 / -1');
    expect(listItems[2].text()).toContain('stack-b');
    expect(wrapper.findAll('[data-test="dd-card"]')).toHaveLength(2);
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
    // No suggestedTag on either fixture — no suggested-tag badge should render (#473).
    expect(
      currentRow
        .find('[data-test="container-update-state"] [data-test="suggested-tag-badge"]')
        .exists(),
    ).toBe(false);

    const minorUpdateState = rowByName(wrapper, 'beta').get('[data-test="container-update-state"]');
    expect(minorUpdateState.text()).toContain('Minor');
    expect(minorUpdateState.text()).not.toContain('Minor update');
    expect(minorUpdateState.find('[data-test="suggested-tag-badge"]').exists()).toBe(false);
  });

  it('renders the labeled suggested-tag badge for a latest-pinned container with a suggestion (#473)', async () => {
    const suggested = makeContainer({
      id: 'c-suggested',
      name: 'alpha',
      currentTag: 'latest',
      newTag: null,
      updateKind: null,
      status: 'running',
      server: 'local-main',
      registry: 'dockerhub',
      suggestedTag: 'v1.3.0',
    });

    const { context, refs } = makeContext();
    const containers = [suggested];
    refs.filteredContainers.value = containers;
    refs.displayContainers.value = containers;
    refs.renderGroups.value = [
      {
        key: '__flat__',
        name: null,
        containers,
        containerCount: containers.length,
        updatesAvailable: 0,
        updatableCount: 0,
      },
    ];
    mocked.context = context;

    const wrapper = mountSubject();

    const updateState = rowByName(wrapper, 'alpha').get('[data-test="container-update-state"]');
    const badge = updateState.get('[data-test="suggested-tag-badge"]');
    expect(badge.text()).toBe('Suggested');
    // The raw tag value must only surface via the badge's tooltip binding, never as
    // bare unlabeled text alongside the Digest/NEW badges.
    expect(updateState.text()).not.toContain('v1.3.0');
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

    it('renders the human-readable tag for a hybrid tag+digest update row (fix #356, #370)', async () => {
      // Hybrid scenario: image has a real tag, digest changed.
      // The version cell must show the tag; the digest delta moves to the tooltip.
      const wrapper = mountDigestContainer({
        currentTag: '14-vectorchord0.4.3-pgvectors0.2.0',
        newTag: '14-vectorchord0.4.3-pgvectors0.2.0',
        isDigestPinned: false,
      });
      const row = rowByName(wrapper, 'alpha');
      const text = row.text();
      expect(text).toContain('14-vectorchord0.4.3-pgvectors0.2.0');
      expect(text).not.toContain('sha256:bcf6335aabbb…');
      expect(text).not.toContain('sha256:deadbeefcafe…');
    });

    it('renders the human-readable tag for a floating-tag + digest-watch update row (#356)', async () => {
      // Brian's scenario: currentTag is a meaningful tag (`v8.13.2`), digest changed
      // but tag did not. The version cell must show the tag, NOT two sha256 strings.
      const wrapper = mountDigestContainer({
        currentTag: 'v8.13.2',
        newTag: 'v8.13.2',
        isDigestPinned: false,
      });
      const row = rowByName(wrapper, 'alpha');
      const text = row.text();
      expect(text).toContain('v8.13.2');
      expect(text).not.toContain('sha256:bcf6335aabbb…');
      expect(text).not.toContain('sha256:deadbeefcafe…');
    });

    it('renders the human-readable tag for a linuxserver-style transform tag (#356)', async () => {
      // Reporter's transformed tag like `compose-X-version-9.0.1` — floating-tag
      // alias with digest watch auto-enabled by `da1334a4`.
      const wrapper = mountDigestContainer({
        currentTag: 'compose-X-version-9.0.1',
        newTag: 'compose-X-version-9.0.1',
        isDigestPinned: false,
      });
      const row = rowByName(wrapper, 'alpha');
      const text = row.text();
      expect(text).toContain('compose-X-version-9.0.1');
      expect(text).not.toContain('sha256:bcf6335aabbb…');
      expect(text).not.toContain('sha256:deadbeefcafe…');
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

    it('renders the human-readable currentTag for a hybrid both-halves-change row (fix #356, #370)', async () => {
      // Both tag and digest change: e.g. 1.2.3 → 1.2.4 AND sha256:aaa → sha256:bbb.
      // updateKind is 'digest' so the component takes the non-pinned digest branch.
      // It renders currentTag; the digest delta moves to the tooltip.
      const wrapper = mountDigestContainer({
        currentTag: '1.2.3',
        newTag: '1.2.4',
        isDigestPinned: false,
        updateKind: 'digest',
      });
      const row = rowByName(wrapper, 'alpha');
      const text = row.text();
      // currentTag is shown
      expect(text).toContain('1.2.3');
      // digest delta is NOT shown in cell text (it's in the tooltip)
      expect(text).not.toContain('sha256:bcf6335aabbb…');
      expect(text).not.toContain('sha256:deadbeefcafe…');
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

  /**
   * REGRESSION GUARD — #356 / #370. DO NOT WEAKEN.
   *
   * The Containers list "Version" column must show the human-readable image
   * TAG (never a raw `sha256:` digest) for containers that track a floating
   * or specific tag with digest watch enabled (isDigestPinned === false),
   * even when updateKind === 'digest'. The `sha256:… → sha256:…` digest pair
   * is reserved for digest-PINNED containers (isDigestPinned === true).
   *
   * This bug regressed twice: fixed in #356 (rc.19), re-broken by the rc.20
   * #342 follow-up (commit b40d3db8), reopened as #370. These are negative
   * invariant assertions. If a change makes one of these fail, the change is
   * reintroducing a known user-facing bug — fix the change, not the test.
   */
  describe('#356 / #370 regression guard — Version column never shows raw sha256 for non-digest-pinned containers', () => {
    const digestLocal = 'sha256:bcf6335aabbb1234567890abcdef1234567890abcdef1234567890abcdef12';
    const digestRemote = 'sha256:deadbeefcafe1234567890abcdef1234567890abcdef1234567890abcdef12';

    function mountGuardContainer(overrides: Partial<Container> = {}) {
      const container = makeContainer({
        id: 'c-guard',
        name: 'alpha',
        updateKind: 'digest',
        currentDigest: digestLocal,
        newDigest: digestRemote,
        isDigestPinned: false,
        status: 'running',
        bouncer: 'safe',
        ...overrides,
      });
      const { context } = makeContext();
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
      return { wrapper: mountSubject(), container };
    }

    it.each([
      { label: 'floating tag `latest`', currentTag: 'latest', newTag: 'latest' },
      { label: 'specific semver tag `v8.13.2`', currentTag: 'v8.13.2', newTag: 'v8.13.2' },
      {
        label: 'transform-style alias `compose-X-version-9.0.1`',
        currentTag: 'compose-X-version-9.0.1',
        newTag: 'compose-X-version-9.0.1',
      },
    ])('table view — $label shows human-readable tag, never sha256 (non-pinned digest)', async ({
      currentTag,
      newTag,
    }) => {
      const { wrapper } = mountGuardContainer({ currentTag, newTag });
      const text = rowByName(wrapper, 'alpha').text();
      expect(text).toContain(currentTag);
      expect(text).not.toContain('sha256:');
    });

    it('table view — hybrid both-halves change (1.2.3 → 1.2.4, digest also changes) shows currentTag, never sha256', async () => {
      const { wrapper } = mountGuardContainer({
        currentTag: '1.2.3',
        newTag: '1.2.4',
        updateKind: 'digest',
        isDigestPinned: false,
      });
      const text = rowByName(wrapper, 'alpha').text();
      expect(text).toContain('1.2.3');
      expect(text).not.toContain('sha256:');
    });

    it('counter-case — digest-PINNED container DOES show sha256 in table view (guard is correctly scoped)', async () => {
      // This proves the invariant is specifically about non-pinned containers,
      // not a universal sha256-suppression rule. If this assertion ever breaks,
      // the digest-pinned rendering path is broken, not the guard.
      const container = makeContainer({
        id: 'c-pinned-counter',
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
      const text = rowByName(wrapper, 'alpha').text();
      expect(text).toContain('sha256:');
    });
  });

  describe('softwareVersion secondary line in version cell', () => {
    function mountWithSoftwareVersion(softwareVersion?: string) {
      const container = makeContainer({
        id: 'c-sv',
        name: 'alpha',
        currentTag: 'latest',
        newTag: null,
        updateKind: null,
        status: 'running',
        bouncer: 'safe',
        softwareVersion,
      });
      const { context } = makeContext();
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
      return { wrapper: mountSubject(), container };
    }

    it('renders softwareVersion cell with softwareVersion value when present', async () => {
      const { wrapper } = mountWithSoftwareVersion('1.25.5');
      const row = rowByName(wrapper, 'alpha');
      const svCell = row.find('[data-test="container-software-version-col"]');
      expect(svCell.exists()).toBe(true);
      expect(svCell.text()).toBe('1.25.5');
    });

    it('renders softwareVersion cell falling back to currentTag when softwareVersion is absent', async () => {
      const { wrapper } = mountWithSoftwareVersion(undefined);
      const row = rowByName(wrapper, 'alpha');
      const svCell = row.find('[data-test="container-software-version-col"]');
      expect(svCell.exists()).toBe(true);
      expect(svCell.text()).toBe('latest');
    });
  });

  it('renders uptime cell using the shared nowMs timer value', async () => {
    const startedAt = new Date(Date.now() - 30_000).toISOString();
    const container = makeContainer({
      id: 'c-uptime',
      name: 'alpha',
      status: 'running',
      details: { ports: [], volumes: [], env: [], labels: [], startedAt },
    });
    const { context } = makeContext();
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
    expect(row.text()).toContain('Up ');
  });

  it('calls recheckContainer when Recheck for updates menu action is clicked', async () => {
    const container = makeContainer({
      id: 'c-recheck',
      name: 'recheck-me',
      newTag: '2.0.0',
      updateKind: 'minor',
      status: 'running',
    });

    const { context, refs, spies } = makeContext();
    context.tableActionStyle.value = 'icons';
    context.filteredContainers.value = [container];
    context.displayContainers.value = [container];
    context.renderGroups.value = [
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
    refs.openActionsMenu.value = 'c-recheck';
    await nextTick();

    const recheckButton = wrapper
      .findAll('button')
      .find((button) => button.text().trim() === 'Recheck for updates');
    expect(recheckButton).toBeDefined();
    await recheckButton!.trigger('click');

    expect(spies.recheckContainer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c-recheck', name: 'recheck-me' }),
    );
    expect(spies.closeActionsMenu).toHaveBeenCalled();
  });
});
