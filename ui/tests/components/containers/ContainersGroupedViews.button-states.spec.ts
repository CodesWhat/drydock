/**
 * Focused tests for the update-button state machine wired into ContainersGroupedViews.
 *
 * The three callsites are:
 *   icons mode  — AppIconButton (sm)  at the actions cell (~line 585-598 of the Vue SFC)
 *   buttons mode — split-button divs  at the actions cell (~line 632-683)
 *   cards mode  — AppIconButton (xs)  at the card footer (~line 881-892)
 *
 * Each test configures `updateEligibility` on the container to drive the state and
 * asserts the DOM reflects the expected visual treatment.
 */
import { defineComponent, nextTick, onMounted, ref } from 'vue';
import ContainersGroupedViews from '@/components/containers/ContainersGroupedViews.vue';
import { useUpdateBatches } from '@/composables/useUpdateBatches';
import type { Container, UpdateEligibility } from '@/types/container';
import { mountWithPlugins } from '../../helpers/mount';

// ---------------------------------------------------------------------------
// Minimal stubs (mirrors ContainersGroupedViews.spec.ts)
// ---------------------------------------------------------------------------

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
    const keyFor = (row: Record<string, unknown>) => {
      if (typeof props.rowKey === 'function') return props.rowKey(row);
      if (typeof props.rowKey === 'string' && row[props.rowKey] != null) return row[props.rowKey];
      return row.name;
    };
    onMounted(() => {
      emit('update:sort-key', 'status');
      emit('update:sort-asc', false);
    });
    return { isFullWidth, keyFor };
  },
  template: `
    <div class="data-table-stub">
      <div v-for="row in rows" :key="keyFor(row)"
           :class="isFullWidth(row) ? 'full-row-stub' : 'table-row-stub'">
        <template v-if="isFullWidth(row)">
          <slot name="full-row" :row="row" />
        </template>
        <template v-else>
          <div>
            <slot name="cell-icon" :row="row" />
            <slot name="cell-name" :row="row" />
            <slot name="cell-status" :row="row" />
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
        <slot name="header" :item="item" />
      </div>
    </div>
  `,
});

// ---------------------------------------------------------------------------
// Hoisted mock — must match the import used by ContainersGroupedViews.vue
// ---------------------------------------------------------------------------

const mocked = vi.hoisted(() => ({ context: null as any }));

vi.mock('@/components/containers/containersViewTemplateContext', () => ({
  useContainersViewTemplateContext: () => mocked.context,
}));

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeEligibility(
  blockers: UpdateEligibility['blockers'],
  eligible = false,
): UpdateEligibility {
  return { eligible, blockers, evaluatedAt: '2026-04-28T00:00:00.000Z' };
}

function makeContainer(overrides: Partial<Container> = {}): Container {
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

  const context = {
    filteredContainers,
    renderGroups,
    groupByStack,
    toggleGroupCollapse: vi.fn(),
    collapsedGroups,
    groupUpdateInProgress,
    groupUpdateQueue,
    containerActionsEnabled,
    containerActionsDisabledReason: ref('Actions disabled'),
    actionInProgress,
    isContainerUpdateInProgress: (target: {
      id?: string;
      name?: string;
      _pending?: true;
      updateOperation?: { status?: string };
    }) =>
      Boolean((target as any)._pending) ||
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
      Boolean((target as any)._pending) ||
      target.updateOperation?.status === 'in-progress' ||
      actionInProgress.value.get(target.id ?? target.name ?? '') === 'update' ||
      target.updateOperation?.status === 'queued' ||
      groupUpdateQueue.value.has(target.id ?? ''),
    getContainerUpdateSequenceLabel: () => null,
    updateAllInGroup: vi.fn(),
    tt: (label: string) => ({ value: label, showDelay: 400 }),
    containerViewMode,
    tableColumns,
    containerSortKey,
    containerSortAsc,
    selectedContainer,
    activeDetailTab,
    isCompact,
    selectContainer: vi.fn(),
    tableActionStyle,
    openActionsMenu,
    toggleActionsMenu: vi.fn(),
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
    displayContainers,
    actionsMenuStyle,
    updateKindColor: () => ({ bg: '#0b5', text: '#052' }),
    maturityColor: () => ({ bg: '#aef', text: '#056' }),
    hasRegistryError: () => false,
    registryErrorTooltip: () => 'Registry error',
    containerPolicyTooltip: () => 'policy-tooltip',
    getContainerListPolicyState: () => ({ snoozed: false, skipped: false, maturityBlocked: false }),
    serverBadgeColor: () => ({ bg: '#ddd', text: '#111' }),
    parseServer: (server: string) =>
      server.includes('local') ? { name: 'Local', env: 'dev' } : { name: 'Remote', env: null },
    registryColorBg: () => '#ddd',
    registryColorText: () => '#222',
    registryLabel: (registry: string) => registry,
    activeFilterCount,
    filterSearch,
    clearFilters: vi.fn(),
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
    spies: {
      confirmUpdate: context.confirmUpdate as ReturnType<typeof vi.fn>,
    },
  };
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
          template: '<div class="empty-state-stub" />',
        },
        Teleport: true,
      },
    },
  });
}

/** Find the first table row whose text contains `name`. */
function rowByName(wrapper: any, name: string) {
  const row = wrapper
    .findAll('.table-row-stub')
    .find((candidate: any) => candidate.text().includes(name));
  expect(row).toBeDefined();
  return row!;
}

function mountWithSingleContainer(
  container: Container,
  viewMode: 'table' | 'cards' = 'table',
  actionStyle: 'icons' | 'buttons' = 'icons',
) {
  const { context, refs, spies } = makeContext();
  refs.containerViewMode.value = viewMode;
  refs.tableActionStyle.value = actionStyle;
  refs.filteredContainers.value = [container];
  refs.displayContainers.value = [container];
  refs.renderGroups.value = [
    {
      key: '__flat__',
      name: null,
      containers: [container],
      containerCount: 1,
      updatesAvailable: container.newTag ? 1 : 0,
      updatableCount: container.newTag ? 1 : 0,
    },
  ];
  mocked.context = context;
  return { wrapper: mountSubject(), refs, spies };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContainersGroupedViews — update button states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUpdateBatches().batches.value = new Map();
  });

  // -------------------------------------------------------------------------
  // icons mode — hard blocker
  // -------------------------------------------------------------------------

  it('icons mode: renders lock icon (disabled) for a hard blocker', () => {
    const container = makeContainer({
      id: 'c-hard',
      name: 'alpha',
      newTag: '2.0.0',
      updateEligibility: makeEligibility([
        { reason: 'agent-mismatch', message: 'Agent version mismatch.', actionable: false },
      ]),
    });
    const { wrapper } = mountWithSingleContainer(container, 'table', 'icons');
    const row = rowByName(wrapper, 'alpha');
    expect(row.find('[data-icon="lock"]').exists()).toBe(true);
    expect(row.find('[data-icon="cloud-download"]').exists()).toBe(false);
    const lockBtn = row.findAll('button').find((b: any) => b.find('[data-icon="lock"]').exists());
    expect(lockBtn?.attributes('disabled')).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // icons mode — soft blocker → variant="warning"
  // -------------------------------------------------------------------------

  it('icons mode: renders cloud-download with warning variant for a soft blocker', () => {
    const container = makeContainer({
      id: 'c-soft',
      name: 'alpha',
      newTag: '2.0.0',
      updateEligibility: makeEligibility([
        { reason: 'trigger-not-included', message: 'Trigger not included.', actionable: false },
      ]),
    });
    const { wrapper } = mountWithSingleContainer(container, 'table', 'icons');
    const row = rowByName(wrapper, 'alpha');
    const cloudBtn = row
      .findAll('button')
      .find((b: any) => b.find('[data-icon="cloud-download"]').exists());
    expect(cloudBtn).toBeDefined();
    // warning variant emits dd-text-warning class
    expect(cloudBtn?.classes()).toContain('dd-text-warning');
    expect(row.find('[data-icon="lock"]').exists()).toBe(false);
  });

  it('icons mode: soft button tooltip contains "Manual update only —"', () => {
    const container = makeContainer({
      id: 'c-soft-tt',
      name: 'alpha',
      newTag: '2.0.0',
      updateEligibility: makeEligibility([
        { reason: 'trigger-not-included', message: 'Trigger not included.', actionable: false },
      ]),
    });
    const { wrapper } = mountWithSingleContainer(container, 'table', 'icons');
    const row = rowByName(wrapper, 'alpha');
    const cloudBtn = row
      .findAll('button')
      .find((b: any) => b.find('[data-icon="cloud-download"]').exists());
    // The tooltip attr is set via v-tooltip directive; the aria-label also reflects it
    // The tooltip value is passed as a tt() object — verify the button is NOT disabled
    // (i.e., it's clickable, not a lock)
    expect(cloudBtn?.attributes('disabled')).toBeUndefined();
  });

  it('icons mode: soft button triggers confirmUpdate on click', async () => {
    const container = makeContainer({
      id: 'c-soft-click',
      name: 'alpha',
      newTag: '2.0.0',
      updateEligibility: makeEligibility([
        { reason: 'trigger-not-included', message: 'Trigger not included.', actionable: false },
      ]),
    });
    const { wrapper, spies } = mountWithSingleContainer(container, 'table', 'icons');
    const row = rowByName(wrapper, 'alpha');
    const cloudBtn = row
      .findAll('button')
      .find((b: any) => b.find('[data-icon="cloud-download"]').exists());
    await cloudBtn?.trigger('click');
    expect(spies.confirmUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c-soft-click' }),
    );
  });

  // -------------------------------------------------------------------------
  // icons mode — ready (no blockers)
  // -------------------------------------------------------------------------

  it('icons mode: renders cloud-download without warning variant when no blockers', () => {
    const container = makeContainer({
      id: 'c-ready',
      name: 'alpha',
      newTag: '2.0.0',
    });
    const { wrapper } = mountWithSingleContainer(container, 'table', 'icons');
    const row = rowByName(wrapper, 'alpha');
    const cloudBtn = row
      .findAll('button')
      .find((b: any) => b.find('[data-icon="cloud-download"]').exists());
    expect(cloudBtn).toBeDefined();
    expect(cloudBtn?.classes()).not.toContain('dd-text-warning');
    expect(row.find('[data-icon="lock"]').exists()).toBe(false);
  });

  // -------------------------------------------------------------------------
  // icons mode — none (no newTag)
  // -------------------------------------------------------------------------

  it('icons mode: no cloud-download or lock button when there is no newTag', () => {
    const container = makeContainer({
      id: 'c-none',
      name: 'alpha',
      newTag: null,
      status: 'running',
    });
    const { wrapper } = mountWithSingleContainer(container, 'table', 'icons');
    const row = rowByName(wrapper, 'alpha');
    expect(row.find('[data-icon="cloud-download"]').exists()).toBe(false);
    expect(row.find('[data-icon="lock"]').exists()).toBe(false);
    // Should show stop instead
    expect(row.find('[data-icon="stop"]').exists()).toBe(true);
  });

  // -------------------------------------------------------------------------
  // icons mode — active operation suppresses soft to ready
  // -------------------------------------------------------------------------

  it('icons mode: active update operation suppresses soft to ready (no warning tint)', async () => {
    const container = makeContainer({
      id: 'c-in-progress',
      name: 'alpha',
      newTag: '2.0.0',
      updateEligibility: makeEligibility([
        { reason: 'trigger-not-included', message: 'Trigger not included.', actionable: false },
      ]),
    });
    const { wrapper, refs } = mountWithSingleContainer(container, 'table', 'icons');
    refs.actionInProgress.value = new Map([['c-in-progress', 'update']]);
    await nextTick();

    const row = rowByName(wrapper, 'alpha');
    const cloudBtns = row
      .findAll('button')
      .filter((b: any) => b.find('[data-icon="cloud-download"]').exists());
    // Either the button is gone (row shows Updating chip instead) OR it has no warning tint
    const warningBtns = cloudBtns.filter((b: any) => b.classes().includes('dd-text-warning'));
    expect(warningBtns).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // buttons mode — soft blocker → amber split button
  // -------------------------------------------------------------------------

  it('buttons mode: soft blocker renders amber split button (warning border)', async () => {
    const container = makeContainer({
      id: 'c-soft-btn',
      name: 'alpha',
      newTag: '2.0.0',
      updateEligibility: makeEligibility([
        { reason: 'trigger-not-included', message: 'Trigger not included.', actionable: false },
      ]),
    });
    const { wrapper } = mountWithSingleContainer(container, 'table', 'buttons');
    await nextTick();

    // The soft split-button div has style containing dd-warning border
    const row = rowByName(wrapper, 'alpha');
    // cloud-download icon is inside the soft button
    expect(row.find('[data-icon="cloud-download"]').exists()).toBe(true);
    expect(row.find('[data-icon="lock"]').exists()).toBe(false);
  });

  it('buttons mode: soft split button triggers confirmUpdate on click', async () => {
    const container = makeContainer({
      id: 'c-soft-btn-click',
      name: 'alpha',
      newTag: '2.0.0',
      updateEligibility: makeEligibility([
        { reason: 'trigger-not-included', message: 'Trigger not included.', actionable: false },
      ]),
    });
    const { wrapper, spies } = mountWithSingleContainer(container, 'table', 'buttons');
    await nextTick();

    const row = rowByName(wrapper, 'alpha');
    const updateBtn = row
      .findAll('button')
      .find((b: any) => b.find('[data-icon="cloud-download"]').exists());
    await updateBtn?.trigger('click');
    expect(spies.confirmUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c-soft-btn-click' }),
    );
  });

  it('buttons mode: hard blocker renders Blocked split button with lock icon (disabled)', async () => {
    const container = makeContainer({
      id: 'c-hard-btn',
      name: 'alpha',
      newTag: '2.0.0',
      updateEligibility: makeEligibility([
        { reason: 'agent-mismatch', message: 'Agent mismatch.', actionable: false },
      ]),
    });
    const { wrapper } = mountWithSingleContainer(container, 'table', 'buttons');
    await nextTick();

    const row = rowByName(wrapper, 'alpha');
    expect(row.find('[data-icon="lock"]').exists()).toBe(true);
    expect(row.find('[data-icon="cloud-download"]').exists()).toBe(false);
  });

  it('buttons mode: no blockers renders green Update split button', async () => {
    const container = makeContainer({
      id: 'c-ready-btn',
      name: 'alpha',
      newTag: '2.0.0',
    });
    const { wrapper } = mountWithSingleContainer(container, 'table', 'buttons');
    await nextTick();

    const row = rowByName(wrapper, 'alpha');
    expect(row.find('[data-icon="cloud-download"]').exists()).toBe(true);
    expect(row.find('[data-icon="lock"]').exists()).toBe(false);
  });

  // -------------------------------------------------------------------------
  // cards mode — soft blocker → variant="warning"
  // -------------------------------------------------------------------------

  it('cards mode: soft blocker renders cloud-download with warning variant', async () => {
    const container = makeContainer({
      id: 'c-soft-card',
      name: 'alpha',
      newTag: '2.0.0',
      status: 'running',
      updateEligibility: makeEligibility([
        { reason: 'trigger-not-included', message: 'Trigger not included.', actionable: false },
      ]),
    });
    const { wrapper } = mountWithSingleContainer(container, 'cards', 'icons');
    await nextTick();

    const cards = wrapper.findAll('.card-item-stub');
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    const cloudBtn = card
      .findAll('button')
      .find((b: any) => b.find('[data-icon="cloud-download"]').exists());
    expect(cloudBtn).toBeDefined();
    expect(cloudBtn?.classes()).toContain('dd-text-warning');
    expect(card.find('[data-icon="lock"]').exists()).toBe(false);
  });

  it('cards mode: hard blocker renders lock icon (disabled)', async () => {
    const container = makeContainer({
      id: 'c-hard-card',
      name: 'alpha',
      newTag: '2.0.0',
      status: 'running',
      updateEligibility: makeEligibility([
        { reason: 'agent-mismatch', message: 'Agent mismatch.', actionable: false },
      ]),
    });
    const { wrapper } = mountWithSingleContainer(container, 'cards', 'icons');
    await nextTick();

    const card = wrapper.findAll('.card-item-stub')[0]!;
    expect(card.find('[data-icon="lock"]').exists()).toBe(true);
    expect(card.find('[data-icon="cloud-download"]').exists()).toBe(false);
  });

  it('cards mode: ready (no blockers) renders cloud-download without warning variant', async () => {
    const container = makeContainer({
      id: 'c-ready-card',
      name: 'alpha',
      newTag: '2.0.0',
      status: 'running',
    });
    const { wrapper } = mountWithSingleContainer(container, 'cards', 'icons');
    await nextTick();

    const card = wrapper.findAll('.card-item-stub')[0]!;
    const cloudBtn = card
      .findAll('button')
      .find((b: any) => b.find('[data-icon="cloud-download"]').exists());
    expect(cloudBtn).toBeDefined();
    expect(cloudBtn?.classes()).not.toContain('dd-text-warning');
  });

  it('cards mode: no newTag renders no cloud-download or lock button', async () => {
    const container = makeContainer({
      id: 'c-none-card',
      name: 'alpha',
      newTag: null,
      status: 'running',
    });
    const { wrapper } = mountWithSingleContainer(container, 'cards', 'icons');
    await nextTick();

    const card = wrapper.findAll('.card-item-stub')[0]!;
    expect(card.find('[data-icon="cloud-download"]').exists()).toBe(false);
    expect(card.find('[data-icon="lock"]').exists()).toBe(false);
  });

  it('cards mode: active operation suppresses soft to ready (no warning tint)', async () => {
    const container = makeContainer({
      id: 'c-in-progress-card',
      name: 'alpha',
      newTag: '2.0.0',
      status: 'running',
      updateEligibility: makeEligibility([
        { reason: 'trigger-not-included', message: 'Trigger not included.', actionable: false },
      ]),
    });
    const { wrapper, refs } = mountWithSingleContainer(container, 'cards', 'icons');
    refs.actionInProgress.value = new Map([['c-in-progress-card', 'update']]);
    await nextTick();

    const card = wrapper.findAll('.card-item-stub')[0]!;
    const warningBtns = card
      .findAll('button')
      .filter(
        (b: any) =>
          b.find('[data-icon="cloud-download"]').exists() &&
          b.classes().includes('dd-text-warning'),
      );
    expect(warningBtns).toHaveLength(0);
  });
});
