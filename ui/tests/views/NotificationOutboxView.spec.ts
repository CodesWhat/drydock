import { flushPromises } from '@vue/test-utils';
import { defineComponent } from 'vue';
import {
  deleteOutboxEntry,
  getOutboxEntries,
  type NotificationOutboxEntry,
  type NotificationOutboxResponse,
  retryOutboxEntry,
} from '@/services/notification-outbox';
import NotificationOutboxView from '@/views/NotificationOutboxView.vue';
import { mountWithPlugins } from '../helpers/mount';

// ── router mocks ─────────────────────────────────────────────────────────────
// `mockRoute` stays the plain object every existing test writes `mockRoute.query = {...}`
// to before mounting. `useRoute()` below wraps it in `reactive()` and `router.replace()`
// writes through that same reactive proxy so the component's `watch(() => route.query.status)`
// actually re-fires after mount — needed to exercise the tab-switch race in
// "reruns loadEntries when route query status changes" without reimplementing vue-router.
const { mockRoute, mockRouter } = vi.hoisted(() => ({
  mockRoute: { query: {} as Record<string, unknown> },
  mockRouter: { replace: vi.fn() },
}));

vi.mock('vue-router', async () => {
  const { reactive } = await import('vue');
  const routeState = reactive(mockRoute);
  mockRouter.replace.mockImplementation((to: { query?: Record<string, unknown> }) => {
    if (!to.query) return;
    for (const key of Object.keys(routeState.query)) delete routeState.query[key];
    Object.assign(routeState.query, to.query);
  });
  return {
    useRoute: () => routeState,
    useRouter: () => mockRouter,
  };
});

// ── service mocks ─────────────────────────────────────────────────────────────
vi.mock('@/services/notification-outbox', () => ({
  getOutboxEntries: vi.fn(),
  retryOutboxEntry: vi.fn(),
  deleteOutboxEntry: vi.fn(),
}));

// ── toast mock ────────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn() };
vi.mock('@/composables/useToast', () => ({
  useToast: () => mockToast,
}));

// ── typed mock helpers ────────────────────────────────────────────────────────
const mockGetOutboxEntries = getOutboxEntries as ReturnType<typeof vi.fn>;
const mockRetryOutboxEntry = retryOutboxEntry as ReturnType<typeof vi.fn>;
const mockDeleteOutboxEntry = deleteOutboxEntry as ReturnType<typeof vi.fn>;

// ── async helpers ─────────────────────────────────────────────────────────────
// Lets a test hold a getOutboxEntries() call open and resolve it on demand, so two
// overlapping loadEntries() calls can be made to settle in a chosen (possibly reversed)
// order — reproducing the tab-switch race this view's requestId guard exists to prevent.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ── fixture helpers ───────────────────────────────────────────────────────────
function makeEntry(overrides: Partial<NotificationOutboxEntry> = {}): NotificationOutboxEntry {
  return {
    id: 'e1',
    eventName: 'update-available',
    triggerId: 'slack.ops',
    attempts: 3,
    maxAttempts: 3,
    nextAttemptAt: '2026-04-29T10:00:00.000Z',
    status: 'dead-letter',
    createdAt: '2026-04-29T09:00:00.000Z',
    payload: {},
    ...overrides,
  };
}

function makeResponse(
  entries: NotificationOutboxEntry[] = [makeEntry()],
): NotificationOutboxResponse {
  return {
    data: entries,
    total: entries.length,
    counts: { pending: 0, delivered: 0, deadLetter: entries.length },
  };
}

// ── component stubs ───────────────────────────────────────────────────────────
/**
 * DataTable stub that renders all named cell slots for each row so the action
 * buttons in #cell-actions are reachable from tests.
 */
const DataTableStub = defineComponent({
  props: ['columns', 'rows', 'rowKey', 'showActions', 'actionsWidth', 'fixedLayout'],
  template: `
    <div
      class="data-table"
      :data-row-count="rows?.length ?? 0"
      :data-show-actions="String(Boolean(showActions))"
      :data-actions-width="actionsWidth"
    >
      <template v-for="row in rows" :key="row.id">
        <div class="data-table-row" :data-row-id="row.id">
          <slot name="cell-eventName" :row="row" />
          <slot name="cell-triggerId" :row="row" />
          <slot name="cell-attempts" :row="row" />
          <slot name="cell-lastError" :row="row" />
          <slot name="cell-createdAt" :row="row" />
          <slot name="actions" :row="row" />
          <slot name="cell-actions" :row="row" />
        </div>
      </template>
      <slot name="empty" v-if="!rows || rows.length === 0" />
    </div>
  `,
});

const stubs: Record<string, unknown> = {
  DataViewLayout: defineComponent({
    template: '<div class="data-view-layout"><slot /></div>',
  }),
  DataTable: DataTableStub,
  AppBadge: defineComponent({
    props: ['tone', 'size'],
    template: '<span class="app-badge" :data-tone="tone"><slot /></span>',
  }),
  AppButton: defineComponent({
    props: ['size', 'variant', 'weight', 'disabled'],
    emits: ['click'],
    template: '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>',
  }),
  EmptyState: defineComponent({
    props: ['icon', 'message'],
    template: '<div class="empty-state"><span>{{ message }}</span></div>',
  }),
};

// ── mount helper ──────────────────────────────────────────────────────────────
async function mountView() {
  const wrapper = mountWithPlugins(NotificationOutboxView, {
    global: { stubs },
  });
  await flushPromises();
  return wrapper;
}

// ── tests ─────────────────────────────────────────────────────────────────────
describe('NotificationOutboxView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoute.query = {};
    mockGetOutboxEntries.mockResolvedValue(makeResponse());
    mockRetryOutboxEntry.mockResolvedValue(makeEntry({ status: 'pending' }));
    mockDeleteOutboxEntry.mockResolvedValue(undefined);
  });

  describe('initial load', () => {
    it('renders the translated Outbox heading', async () => {
      const wrapper = await mountView();

      expect(wrapper.find('h2').text()).toBe('Outbox');
      expect(wrapper.text()).not.toContain('Notification outbox');
    });

    it('calls getOutboxEntries with dead-letter by default on mount', async () => {
      await mountView();

      expect(mockGetOutboxEntries).toHaveBeenCalledWith('dead-letter');
    });

    it('renders one row when the response contains one entry', async () => {
      const wrapper = await mountView();

      expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('1');
    });

    it('renders the eventName text in the table', async () => {
      mockGetOutboxEntries.mockResolvedValue(
        makeResponse([makeEntry({ eventName: 'security-alert' })]),
      );
      const wrapper = await mountView();

      expect(wrapper.text()).toContain('security-alert');
    });

    it('renders the triggerId text in the table', async () => {
      mockGetOutboxEntries.mockResolvedValue(
        makeResponse([makeEntry({ triggerId: 'smtp.notifications' })]),
      );
      const wrapper = await mountView();

      expect(wrapper.text()).toContain('smtp.notifications');
    });

    it('uses the shared DataTable action column instead of a custom actions data column', async () => {
      const wrapper = await mountView();
      const table = wrapper.findComponent(DataTableStub);
      const columnKeys = (table.props('columns') as Array<{ key: string }>).map((col) => col.key);

      expect(table.props('showActions')).toBe(true);
      expect(table.props('actionsWidth')).toBe('180px');
      expect(table.props('fixedLayout')).toBe(true);
      expect(columnKeys).not.toContain('actions');
    });

    it('keeps dense table text intentional with truncation instead of random wrapping', async () => {
      mockGetOutboxEntries.mockResolvedValue(
        makeResponse([
          makeEntry({
            eventName: 'container.update.available.with.long.identifier',
            triggerId: 'slack.homelab.production.notifications',
            containerId: 'linuxserver/radarr:5.27.5-ls300',
            lastError: 'Slack webhook returned a very long diagnostic message from the receiver',
          }),
        ]),
      );
      const wrapper = await mountView();

      expect(wrapper.find('[data-testid="outbox-event-name"]').classes()).toEqual(
        expect.arrayContaining(['block', 'truncate', 'whitespace-nowrap']),
      );
      expect(wrapper.find('[data-testid="outbox-trigger-id"]').classes()).toEqual(
        expect.arrayContaining(['block', 'truncate', 'whitespace-nowrap']),
      );
      expect(wrapper.find('[data-testid="outbox-last-error"]').classes()).toEqual(
        expect.arrayContaining(['line-clamp-2', 'break-words']),
      );
      expect(wrapper.find('[data-testid="outbox-created-at"]').classes()).toEqual(
        expect.arrayContaining(['block', 'whitespace-nowrap']),
      );
    });

    it('shows empty state when response has no entries', async () => {
      mockGetOutboxEntries.mockResolvedValue(makeResponse([]));
      const wrapper = await mountView();

      expect(wrapper.find('.empty-state').exists()).toBe(true);
    });
  });

  describe('status filter from route query', () => {
    it('calls getOutboxEntries with pending when route query status=pending', async () => {
      mockRoute.query = { status: 'pending' };
      await mountView();

      expect(mockGetOutboxEntries).toHaveBeenCalledWith('pending');
    });

    it('calls getOutboxEntries with delivered when route query status=delivered', async () => {
      mockRoute.query = { status: 'delivered' };
      await mountView();

      expect(mockGetOutboxEntries).toHaveBeenCalledWith('delivered');
    });

    it('defaults to dead-letter for an unrecognised status query value', async () => {
      mockRoute.query = { status: 'bogus' };
      await mountView();

      expect(mockGetOutboxEntries).toHaveBeenCalledWith('dead-letter');
    });
  });

  describe('status tab navigation', () => {
    it('calls router.replace with the pending status when Pending tab is clicked', async () => {
      const wrapper = await mountView();

      const pendingTab = wrapper.findAll('button').find((b) => b.text().includes('Pending'));
      expect(pendingTab).toBeDefined();
      await pendingTab!.trigger('click');

      expect(mockRouter.replace).toHaveBeenCalledWith(
        expect.objectContaining({ query: expect.objectContaining({ status: 'pending' }) }),
      );
    });

    it('calls router.replace with delivered when Delivered tab is clicked', async () => {
      const wrapper = await mountView();

      const deliveredTab = wrapper.findAll('button').find((b) => b.text().includes('Delivered'));
      expect(deliveredTab).toBeDefined();
      await deliveredTab!.trigger('click');

      expect(mockRouter.replace).toHaveBeenCalledWith(
        expect.objectContaining({ query: expect.objectContaining({ status: 'delivered' }) }),
      );
    });

    it('reruns loadEntries with the new status when the route query changes', async () => {
      const wrapper = await mountView();
      expect(mockGetOutboxEntries).toHaveBeenCalledTimes(1);

      const pendingTab = wrapper.findAll('button').find((b) => b.text().includes('Pending'))!;
      await pendingTab.trigger('click');
      await flushPromises();

      expect(mockGetOutboxEntries).toHaveBeenCalledTimes(2);
      expect(mockGetOutboxEntries).toHaveBeenLastCalledWith('pending');
    });

    it('does not call router.replace when clicking the already-active tab', async () => {
      mockRoute.query = { status: 'dead-letter' };
      const wrapper = await mountView();

      const deadLetterTab = wrapper.findAll('button').find((b) => b.text().includes('Dead-letter'));
      expect(deadLetterTab).toBeDefined();
      await deadLetterTab!.trigger('click');

      expect(mockRouter.replace).not.toHaveBeenCalled();
    });
  });

  describe('overlapping tab switches (out-of-order responses)', () => {
    it("keeps the later-selected tab's data when an earlier tab's request resolves last", async () => {
      const deadLetterRequest = deferred<NotificationOutboxResponse>();
      const pendingResponse = makeResponse([
        makeEntry({ id: 'p1', eventName: 'pending-event', status: 'pending' }),
      ]);

      mockGetOutboxEntries.mockImplementation((requestedStatus: string) =>
        requestedStatus === 'dead-letter'
          ? deadLetterRequest.promise
          : Promise.resolve(pendingResponse),
      );

      // Initial mount fires the dead-letter load, which stays in flight (unresolved).
      const wrapper = await mountView();

      // Switching to Pending fires a second, later request that resolves immediately.
      const pendingTab = wrapper.findAll('button').find((b) => b.text().includes('Pending'))!;
      await pendingTab.trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('pending-event');

      // The stale dead-letter request now resolves after the newer pending one already
      // applied. Without the requestId guard this clobbers the pending tab's rows.
      deadLetterRequest.resolve(
        makeResponse([makeEntry({ id: 'd1', eventName: 'dead-letter-event' })]),
      );
      await flushPromises();

      expect(wrapper.text()).toContain('pending-event');
      expect(wrapper.text()).not.toContain('dead-letter-event');
    });

    it('does not resurrect a stale error banner when a later request resolves successfully first', async () => {
      const deadLetterRequest = deferred<NotificationOutboxResponse>();
      const pendingResponse = makeResponse([
        makeEntry({ id: 'p1', eventName: 'pending-event', status: 'pending' }),
      ]);

      mockGetOutboxEntries.mockImplementation((requestedStatus: string) =>
        requestedStatus === 'dead-letter'
          ? deadLetterRequest.promise
          : Promise.resolve(pendingResponse),
      );

      const wrapper = await mountView();

      const pendingTab = wrapper.findAll('button').find((b) => b.text().includes('Pending'))!;
      await pendingTab.trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('pending-event');

      // The stale dead-letter request rejects after the newer pending one already
      // succeeded. Without the requestId guard this paints an error banner over data
      // that is actually current.
      deadLetterRequest.reject(new Error('stale dead-letter failure'));
      await flushPromises();

      expect(wrapper.text()).toContain('pending-event');
      expect(wrapper.text()).not.toContain('stale dead-letter failure');
    });
  });

  describe('retry button', () => {
    it('is visible for dead-letter rows', async () => {
      mockGetOutboxEntries.mockResolvedValue(
        makeResponse([makeEntry({ id: 'e1', status: 'dead-letter' })]),
      );
      const wrapper = await mountView();

      const retryButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Retry');
      expect(retryButton).toBeDefined();
    });

    it('is not rendered for non-dead-letter rows', async () => {
      mockGetOutboxEntries.mockResolvedValue(
        makeResponse([makeEntry({ id: 'e1', status: 'pending' })]),
      );
      const wrapper = await mountView();

      const retryButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Retry');
      expect(retryButton).toBeUndefined();
    });

    it('calls retryOutboxEntry with the entry id and shows success toast', async () => {
      mockGetOutboxEntries.mockResolvedValue(
        makeResponse([
          makeEntry({ id: 'e1', eventName: 'update-available', status: 'dead-letter' }),
        ]),
      );
      const wrapper = await mountView();

      const retryButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Retry')!;
      await retryButton.trigger('click');
      await flushPromises();

      expect(mockRetryOutboxEntry).toHaveBeenCalledWith('e1');
      expect(mockToast.success).toHaveBeenCalledWith('Requeued: update-available');
    });

    it('refreshes the list after a successful retry', async () => {
      const wrapper = await mountView();

      const retryButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Retry')!;
      await retryButton.trigger('click');
      await flushPromises();

      // initial mount + refresh after retry = 2 calls
      expect(mockGetOutboxEntries).toHaveBeenCalledTimes(2);
    });

    it('shows error toast when retryOutboxEntry throws', async () => {
      mockRetryOutboxEntry.mockRejectedValue(new Error('network error'));
      const wrapper = await mountView();

      const retryButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Retry')!;
      await retryButton.trigger('click');
      await flushPromises();

      expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('network error'));
    });
  });

  describe('discard button', () => {
    it('is rendered for all rows', async () => {
      mockGetOutboxEntries.mockResolvedValue(
        makeResponse([
          makeEntry({ id: 'e1', status: 'dead-letter' }),
          makeEntry({ id: 'e2', status: 'pending' }),
        ]),
      );
      const wrapper = await mountView();

      const discardButtons = wrapper.findAll('button').filter((b) => b.text().trim() === 'Discard');
      expect(discardButtons).toHaveLength(2);
    });

    it('calls deleteOutboxEntry with the entry id and shows success toast', async () => {
      mockGetOutboxEntries.mockResolvedValue(
        makeResponse([
          makeEntry({ id: 'e1', eventName: 'update-available', status: 'dead-letter' }),
        ]),
      );
      const wrapper = await mountView();

      const discardButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Discard')!;
      await discardButton.trigger('click');
      await flushPromises();

      expect(mockDeleteOutboxEntry).toHaveBeenCalledWith('e1');
      expect(mockToast.success).toHaveBeenCalledWith('Discarded: update-available');
    });

    it('refreshes the list after a successful discard', async () => {
      const wrapper = await mountView();

      const discardButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Discard')!;
      await discardButton.trigger('click');
      await flushPromises();

      expect(mockGetOutboxEntries).toHaveBeenCalledTimes(2);
    });

    it('shows error toast when deleteOutboxEntry throws', async () => {
      mockDeleteOutboxEntry.mockRejectedValue(new Error('delete failed'));
      const wrapper = await mountView();

      const discardButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Discard')!;
      await discardButton.trigger('click');
      await flushPromises();

      expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('delete failed'));
    });
  });

  describe('error banner', () => {
    it('displays the error message when getOutboxEntries rejects', async () => {
      mockGetOutboxEntries.mockRejectedValue(
        new Error('Failed to load outbox: Service Unavailable'),
      );
      const wrapper = await mountView();

      expect(wrapper.text()).toContain('Failed to load outbox: Service Unavailable');
    });

    it('clears the error after a successful reload', async () => {
      mockGetOutboxEntries
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(makeResponse());

      const wrapper = await mountView();
      expect(wrapper.text()).toContain('boom');

      // Click Refresh button
      const refreshButton = wrapper.findAll('button').find((b) => b.text().includes('Refresh'))!;
      await refreshButton.trigger('click');
      await flushPromises();

      expect(wrapper.text()).not.toContain('boom');
    });
  });

  describe('refresh button', () => {
    it('re-fetches entries when clicked', async () => {
      const wrapper = await mountView();

      const refreshButton = wrapper.findAll('button').find((b) => b.text().includes('Refresh'))!;
      await refreshButton.trigger('click');
      await flushPromises();

      expect(mockGetOutboxEntries).toHaveBeenCalledTimes(2);
    });
  });

  describe('formatTimestamp helper (via render)', () => {
    it('renders a human-readable timestamp for a valid ISO date', async () => {
      mockGetOutboxEntries.mockResolvedValue(
        makeResponse([makeEntry({ createdAt: '2026-01-15T12:00:00.000Z' })]),
      );
      const wrapper = await mountView();

      // The rendered date should not equal the raw ISO string (it was formatted)
      expect(wrapper.text()).not.toContain('2026-01-15T12:00:00.000Z');
    });

    it('renders an em-dash for undefined createdAt', async () => {
      mockGetOutboxEntries.mockResolvedValue(
        makeResponse([{ ...makeEntry(), createdAt: undefined as unknown as string }]),
      );
      const wrapper = await mountView();

      expect(wrapper.text()).toContain('—');
    });
  });
});
