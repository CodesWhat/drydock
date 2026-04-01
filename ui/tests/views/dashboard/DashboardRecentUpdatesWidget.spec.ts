import type { VueWrapper } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';
import DashboardRecentUpdatesWidget from '@/views/dashboard/components/DashboardRecentUpdatesWidget.vue';
import type { RecentUpdateRow } from '@/views/dashboard/dashboardTypes';
import { mountWithPlugins } from '../../helpers/mount';

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

function makeRecentUpdate(overrides: Partial<RecentUpdateRow> = {}): RecentUpdateRow {
  return {
    id: 'c1',
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
  };
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
          props: ['rows', 'rowClass'],
          template: `
            <div data-test="data-table-stub">
              <div
                v-for="row in rows"
                :key="row.id"
                class="dashboard-row-stub"
                :class="typeof rowClass === 'function' ? rowClass(row) : ''">
                <slot name="cell-icon" :row="row" />
                <slot name="cell-container" :row="row" />
                <slot name="cell-version" :row="row" />
                <slot name="cell-type" :row="row" />
                <slot name="cell-actions" :row="row" />
              </div>
            </div>
          `,
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

  it('shows an updating state while a dashboard row is being updated', () => {
    const wrapper = mountWidget({
      dashboardUpdateInProgress: 'c1',
    });

    const row = wrapper.find('.dashboard-row-stub');
    expect(row.classes()).toContain('opacity-50');
    expect(wrapper.text()).toContain('Updating');
  });

  it('keeps ghost dashboard rows visibly updating when provided as updating rows', () => {
    const wrapper = mountWidget({
      recentUpdates: [makeRecentUpdate({ status: 'updating' as RecentUpdateRow['status'] })],
    });

    const row = wrapper.find('.dashboard-row-stub');
    expect(row.classes()).toContain('opacity-50');
    expect(wrapper.text()).toContain('Updating');
  });
});
