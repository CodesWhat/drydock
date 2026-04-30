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
const { mockRoute, mockRouter } = vi.hoisted(() => ({
  mockRoute: { query: {} as Record<string, unknown> },
  mockRouter: { replace: vi.fn() },
}));

vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
  useRouter: () => mockRouter,
}));

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
  props: ['columns', 'rows', 'rowKey'],
  template: `
    <div class="data-table" :data-row-count="rows?.length ?? 0">
      <template v-for="row in rows" :key="row.id">
        <div class="data-table-row" :data-row-id="row.id">
          <slot name="cell-eventName" :row="row" />
          <slot name="cell-triggerId" :row="row" />
          <slot name="cell-attempts" :row="row" />
          <slot name="cell-lastError" :row="row" />
          <slot name="cell-createdAt" :row="row" />
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

    it('does not call router.replace when clicking the already-active tab', async () => {
      mockRoute.query = { status: 'dead-letter' };
      const wrapper = await mountView();

      const deadLetterTab = wrapper.findAll('button').find((b) => b.text().includes('Dead-letter'));
      expect(deadLetterTab).toBeDefined();
      await deadLetterTab!.trigger('click');

      expect(mockRouter.replace).not.toHaveBeenCalled();
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
