import type { VueWrapper } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';
import DashboardRecentUpdatesWidget from '@/views/dashboard/components/DashboardRecentUpdatesWidget.vue';
import type {
  DashboardUpdateSequenceEntry,
  RecentUpdateRow,
} from '@/views/dashboard/dashboardTypes';
import { mountWithPlugins } from '../../helpers/mount';

const { mockIsMobile } = vi.hoisted(() => ({
  mockIsMobile: { value: false },
}));

vi.mock('@/composables/useBreakpoints', () => ({
  useBreakpoints: () => ({ isMobile: mockIsMobile }),
}));

let resizeObserverCallback: ResizeObserverCallback | undefined;
const originalResizeObserver = globalThis.ResizeObserver;
const mountedWrappers: VueWrapper[] = [];

class ResizeObserverTestMock {
  constructor(callback: ResizeObserverCallback) {
    resizeObserverCallback = callback;
  }

  observe() {
    // No-op for tests.
  }

  unobserve() {
    // No-op for tests.
  }

  disconnect() {
    // No-op for tests.
  }
}

function makeRecentUpdate<T extends Record<string, unknown> = Record<string, never>>(
  overrides: Partial<RecentUpdateRow> & T = {} as Partial<RecentUpdateRow> & T,
): RecentUpdateRow & T {
  return {
    id: 'c1',
    identityKey: '::local::nginx',
    name: 'nginx',
    image: 'nginx:1.0.0',
    icon: 'docker',
    oldVer: '1.0.0',
    newVer: '2.0.0',
    status: 'pending',
    updateKind: 'major',
    running: true,
    blocked: false,
    ...overrides,
  } as RecentUpdateRow & T;
}

function triggerResize(height: number) {
  if (!resizeObserverCallback) {
    throw new Error('ResizeObserver callback was not registered');
  }

  resizeObserverCallback(
    [
      {
        contentRect: {
          x: 0,
          y: 0,
          width: 320,
          height,
          top: 0,
          right: 320,
          bottom: height,
          left: 0,
          toJSON: () => ({}),
        },
      } as ResizeObserverEntry,
    ],
    {} as ResizeObserver,
  );
}

function mountWidget(
  overrides: Partial<InstanceType<typeof DashboardRecentUpdatesWidget>['$props']> = {},
) {
  const wrapper = mountWithPlugins(DashboardRecentUpdatesWidget, {
    props: {
      dashboardUpdateAllInProgress: false,
      dashboardUpdateError: null,
      dashboardUpdateInProgress: null,
      dashboardUpdatingById: new Map<string, true>(),
      dashboardUpdateSequence: new Map(),
      editMode: false,
      getUpdateKindColor: vi.fn(() => 'var(--dd-warning)'),
      getUpdateKindIcon: vi.fn(() => 'updates'),
      getUpdateKindMutedColor: vi.fn(() => 'var(--dd-warning-muted)'),
      pendingUpdatesCount: 1,
      recentUpdates: [makeRecentUpdate()],
      ...overrides,
    },
    global: {
      stubs: {
        DataTable: defineComponent({
          emits: ['row-click'],
          props: ['rows', 'rowClass'],
          template: `
            <div data-test="data-table-stub">
              <div
                v-for="row in rows"
                :key="row.id"
                class="dashboard-row-stub"
                :class="typeof rowClass === 'function' ? rowClass(row) : ''"
                @click="$emit('row-click', row)">
                <slot name="cell-icon" :row="row" />
                <slot name="cell-container" :row="row" />
                <slot name="cell-version" :row="row" />
                <slot name="cell-type" :row="row" />
                <slot name="cell-actions" :row="row" />
              </div>
            </div>
          `,
        }),
        ReleaseNotesLink: defineComponent({
          props: ['releaseNotes', 'currentReleaseNotes', 'releaseLink', 'iconOnly'],
          template: '<span data-test="release-notes-link-stub" />',
        }),
        ProjectLink: defineComponent({
          props: ['sourceRepo', 'iconOnly'],
          template: '<span data-test="project-link-stub" />',
        }),
      },
    },
  });
  mountedWrappers.push(wrapper);
  return wrapper;
}

describe('DashboardRecentUpdatesWidget', () => {
  beforeEach(() => {
    resizeObserverCallback = undefined;
    Object.defineProperty(globalThis, 'ResizeObserver', {
      value: ResizeObserverTestMock,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      value: originalResizeObserver,
      configurable: true,
      writable: true,
    });
    mockIsMobile.value = false;
  });

  it('uses the i18n type/actions labels for mobile columns instead of empty strings', () => {
    mockIsMobile.value = true;
    const wrapper = mountWidget();
    const vm = wrapper.vm as any;
    const typeCol = vm.tableColumns.find((c: any) => c.key === 'type');
    const actionsCol = vm.tableColumns.find((c: any) => c.key === 'actions');
    expect(typeCol.label).toBe('Type');
    expect(actionsCol.label).toBe('Actions');
  });

  it("resolves the icon column's content box wide enough for its 28px icon (not just overflow-hidden)", () => {
    // DataTable hardcodes `pl-5` (20px) left padding on icon cells and clips overflow via
    // `overflow-hidden` (see DataTable.vue) — that only stops clipped content from spilling into
    // the neighboring column, it says nothing about whether the icon itself still fits. This
    // asserts the actual geometry: the icon column's fixed width minus that 20px padding must be
    // >= the 28px ContainerIcon this widget renders in its `cell-icon` slot. Mirrors the
    // Containers icon-column regression test in DataTable.spec.ts, adapted to this widget's own
    // column definition.
    const wrapper = mountWidget();
    const vm = wrapper.vm as any;
    const iconCol = vm.tableColumns.find((c: any) => c.key === 'icon');
    expect(iconCol).toBeDefined();

    const ICON_CELL_LEFT_PADDING_PX = 20; // pl-5, hardcoded by DataTable for icon columns
    const WIDGET_ICON_SIZE_PX = 28; // <ContainerIcon :icon="row.icon" :size="28" /> in cell-icon slot
    expect(iconCol.size - ICON_CELL_LEFT_PADDING_PX).toBeGreaterThanOrEqual(WIDGET_ICON_SIZE_PX);
    expect(iconCol.minSize - ICON_CELL_LEFT_PADDING_PX).toBeGreaterThanOrEqual(WIDGET_ICON_SIZE_PX);
    expect(iconCol.maxSize - ICON_CELL_LEFT_PADDING_PX).toBeGreaterThanOrEqual(WIDGET_ICON_SIZE_PX);
  });

  it('shows the compact edit-mode layout when resized below 200px', async () => {
    const wrapper = mountWidget({
      editMode: true,
      pendingUpdatesCount: 2,
    });

    triggerResize(180);
    await nextTick();

    expect(wrapper.find('h2').exists()).toBe(false);
    expect(wrapper.find('[data-test="dashboard-update-all-btn"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('2 updates available');
    expect(wrapper.find('.drag-handle').exists()).toBe(true);
    expect(wrapper.find('.app-icon-stub[data-icon="ph:dots-six"]').exists()).toBe(true);
  });

  it('shows an updating state via dashboardUpdatingById before dashboardUpdateInProgress is set', () => {
    // Asserts that the optimistic pre-API map drives the Updating badge
    // independently of dashboardUpdateInProgress (which is set after the modal).
    const wrapper = mountWidget({
      dashboardUpdatingById: new Map<string, true>([['c1', true]]),
    });

    const row = wrapper.find('.dashboard-row-stub');
    expect(row.classes()).toContain('dd-row-updating');
    expect(wrapper.text()).toContain('Updating');
  });

  it('shows an updating state while a dashboard row is being updated', () => {
    const wrapper = mountWidget({
      dashboardUpdateInProgress: 'c1',
    });

    const row = wrapper.find('.dashboard-row-stub');
    expect(row.classes()).toContain('dd-row-updating');
    expect(wrapper.text()).toContain('Updating');
  });

  it('keeps ghost dashboard rows visibly updating when provided as updating rows', () => {
    const wrapper = mountWidget({
      recentUpdates: [makeRecentUpdate({ status: 'updating' as RecentUpdateRow['status'] })],
    });

    const row = wrapper.find('.dashboard-row-stub');
    expect(row.classes()).toContain('dd-row-updating');
    expect(wrapper.text()).toContain('Updating');
  });

  it('shows queued and updating labels for local dashboard update sequences', () => {
    const wrapper = mountWidget({
      pendingUpdatesCount: 2,
      recentUpdates: [
        makeRecentUpdate(),
        makeRecentUpdate({ id: 'c2', name: 'redis', image: 'redis:7.0.0' }),
      ],
      dashboardUpdateSequence: new Map<string, DashboardUpdateSequenceEntry>([
        ['c1', { position: 1, total: 2 }],
        ['c2', { position: 2, total: 2 }],
      ]),
    });

    const rows = wrapper.findAll('.dashboard-row-stub');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.classes()).toContain('dd-row-updating');
    expect(rows[1]?.classes()).toContain('dd-row-updating');
    expect(wrapper.text()).toContain('Updating');
    expect(wrapper.text()).toContain('Queued');
    expect(wrapper.text()).not.toContain('1 of 2');
    expect(wrapper.text()).not.toContain('2 of 2');
    expect(
      wrapper.find('[data-test="dashboard-update-all-btn"]').attributes('disabled'),
    ).toBeDefined();
  });

  it('keeps duplicate-name rows distinct when local dashboard sequencing is keyed by row id', () => {
    const wrapper = mountWidget({
      pendingUpdatesCount: 2,
      recentUpdates: [
        makeRecentUpdate({ id: 'c-local', name: 'nginx', image: 'nginx:1.0.0' }),
        makeRecentUpdate({ id: 'c-edge', name: 'nginx', image: 'nginx:1.0.0' }),
      ],
      dashboardUpdateSequence: new Map<string, DashboardUpdateSequenceEntry>([
        ['c-local', { position: 1, total: 2 }],
        ['c-edge', { position: 2, total: 2 }],
      ]),
    });

    const rows = wrapper.findAll('.dashboard-row-stub');
    expect(rows).toHaveLength(2);
    expect(wrapper.text()).toContain('Updating');
    expect(wrapper.text()).toContain('Queued');
    expect(wrapper.text()).not.toContain('1 of 2');
    expect(wrapper.text()).not.toContain('2 of 2');
  });

  it('keeps pending row Update button enabled while a different row is updating', () => {
    const wrapper = mountWidget({
      pendingUpdatesCount: 2,
      recentUpdates: [
        makeRecentUpdate({ id: 'c1', status: 'updating' as RecentUpdateRow['status'] }),
        makeRecentUpdate({
          id: 'c2',
          name: 'redis',
          image: 'redis:7.0.0',
          status: 'pending' as RecentUpdateRow['status'],
        }),
      ],
      dashboardUpdateInProgress: 'c1',
      dashboardUpdateSequence: new Map<string, DashboardUpdateSequenceEntry>([
        ['c1', { position: 1, total: 2 }],
      ]),
    });

    // Row B is pending, so its Update button should render and not be disabled.
    const updateBtn = wrapper.find('[data-test="dashboard-update-btn"]');
    expect(updateBtn.exists()).toBe(true);
    expect(updateBtn.attributes('disabled')).toBeUndefined();
  });

  it('offers a manual Update Now action for a maturity-blocked row', async () => {
    const row = makeRecentUpdate({
      id: 'c-maturing',
      status: 'maturity-blocked',
      updateEligibility: {
        eligible: false,
        evaluatedAt: '2026-07-12T12:00:00.000Z',
        blockers: [
          {
            reason: 'maturity-not-reached',
            severity: 'soft',
            message: 'Update is still maturing.',
            actionable: true,
            liftableAt: '2026-07-15T12:00:00.000Z',
          },
        ],
      },
    });
    const wrapper = mountWidget({ recentUpdates: [row] });

    const updateBtn = wrapper.get('[data-test="dashboard-update-btn"]');
    await updateBtn.trigger('click');

    expect(wrapper.emitted('confirmUpdate')?.[0]?.[0]).toEqual(row);
  });

  it('emits openContainer with the row payload when a data table row is clicked', async () => {
    const row = makeRecentUpdate({ id: 'c1', name: 'nginx' });
    const wrapper = mountWidget({ recentUpdates: [row] });

    await wrapper.find('.dashboard-row-stub').trigger('click');

    const emitted = wrapper.emitted('openContainer');
    expect(emitted).toHaveLength(1);
    expect(emitted?.[0]?.[0]).toEqual(row);
  });

  it('renders ReleaseNotesLink when row has a releaseLink and no ReleaseNotesLink when it does not', () => {
    const withLink = mountWidget({
      recentUpdates: [makeRecentUpdate({ releaseLink: 'https://example.com/releases' })],
    });
    expect(withLink.find('[data-test="release-notes-link-stub"]').exists()).toBe(true);

    const withoutLink = mountWidget({
      recentUpdates: [makeRecentUpdate()],
    });
    expect(withoutLink.find('[data-test="release-notes-link-stub"]').exists()).toBe(false);
  });

  it('renders ReleaseNotesLink when row has structured releaseNotes', () => {
    const notes = {
      title: 'v2.0.0',
      body: 'changes',
      url: 'https://example.com/v2',
      publishedAt: '2026-01-01T00:00:00.000Z',
      provider: 'github',
    };
    const wrapper = mountWidget({
      recentUpdates: [makeRecentUpdate({ releaseNotes: notes })],
    });
    expect(wrapper.find('[data-test="release-notes-link-stub"]').exists()).toBe(true);
  });

  it('renders ProjectLink when row has a sourceRepo and omits it when sourceRepo is absent', () => {
    const withRepo = mountWidget({
      recentUpdates: [makeRecentUpdate({ sourceRepo: 'github.com/example/app' })],
    });
    expect(withRepo.find('[data-test="project-link-stub"]').exists()).toBe(true);

    const withoutRepo = mountWidget({
      recentUpdates: [makeRecentUpdate()],
    });
    expect(withoutRepo.find('[data-test="project-link-stub"]').exists()).toBe(false);
  });

  it('renders ReleaseNotesLink when row has only currentReleaseNotes (no releaseNotes or releaseLink)', () => {
    const currentNotes = {
      title: 'v1.0.0',
      body: 'Current release notes',
      url: 'https://example.com/v1',
      publishedAt: '2025-12-01T00:00:00Z',
      provider: 'github',
    };
    const wrapper = mountWidget({
      recentUpdates: [makeRecentUpdate({ currentReleaseNotes: currentNotes })],
    });
    expect(wrapper.find('[data-test="release-notes-link-stub"]').exists()).toBe(true);
  });

  it('renders persisted backend queue rows with phase-only labels', () => {
    const wrapper = mountWidget({
      pendingUpdatesCount: 2,
      recentUpdates: [
        makeRecentUpdate({
          status: 'queued' as RecentUpdateRow['status'],
          batchId: 'batch-1',
          queuePosition: 1,
          queueTotal: 2,
        }),
        makeRecentUpdate({
          id: 'c2',
          name: 'redis',
          image: 'redis:7.0.0',
          status: 'updating' as RecentUpdateRow['status'],
          batchId: 'batch-1',
          queuePosition: 2,
          queueTotal: 2,
        }),
      ],
    });

    expect(wrapper.text()).toContain('Queued');
    expect(wrapper.text()).toContain('Updating');
    expect(wrapper.text()).not.toContain('1 of 2');
    expect(wrapper.text()).not.toContain('2 of 2');
    expect(
      wrapper.find('[data-test="dashboard-update-all-btn"]').attributes('disabled'),
    ).toBeDefined();
  });
});
