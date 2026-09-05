import { flushPromises } from '@vue/test-utils';
import { defineComponent } from 'vue';
import type { ApprovalDetailResponse, ApprovalRecord } from '@/services/approval';
import type { ContainerReleaseNotes } from '@/types/container';
import ApprovalsView from '@/views/ApprovalsView.vue';
import { mountWithPlugins } from '../helpers/mount';

// ── router mocks ─────────────────────────────────────────────────────────────
const { mockRoute, mockRouter } = vi.hoisted(() => ({
  mockRoute: { query: {} as Record<string, unknown>, path: '/approvals' },
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
vi.mock('@/services/approval', () => ({
  listApprovals: vi.fn(),
  getApprovalSummary: vi.fn(),
  getApproval: vi.fn(),
  approveApproval: vi.fn(),
  rejectApproval: vi.fn(),
  deferApproval: vi.fn(),
}));

vi.mock('@/services/container', () => ({
  getContainerReleaseNotes: vi.fn(),
}));

// ── toast mock ────────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
vi.mock('@/composables/useToast', () => ({
  useToast: () => mockToast,
}));

// ── confirm dialog mock ───────────────────────────────────────────────────────
const mockConfirmRequire = vi.fn();
vi.mock('@/composables/useConfirmDialog', () => ({
  useConfirmDialog: () => ({ require: mockConfirmRequire }),
}));

// ── update mode mock ──────────────────────────────────────────────────────────
const mockUpdateMode = { value: 'manual' as string };
vi.mock('@/composables/useUpdateMode', () => ({
  useUpdateMode: () => ({ updateMode: mockUpdateMode }),
}));

import {
  approveApproval,
  deferApproval,
  getApproval,
  getApprovalSummary,
  listApprovals,
  rejectApproval,
} from '@/services/approval';
import { getContainerReleaseNotes } from '@/services/container';

const mockListApprovals = listApprovals as ReturnType<typeof vi.fn>;
const mockGetApprovalSummary = getApprovalSummary as ReturnType<typeof vi.fn>;
const mockGetApproval = getApproval as ReturnType<typeof vi.fn>;
const mockApproveApproval = approveApproval as ReturnType<typeof vi.fn>;
const mockRejectApproval = rejectApproval as ReturnType<typeof vi.fn>;
const mockDeferApproval = deferApproval as ReturnType<typeof vi.fn>;
const mockGetContainerReleaseNotes = getContainerReleaseNotes as ReturnType<typeof vi.fn>;

// ── fixture helpers ───────────────────────────────────────────────────────────
function makeApproval(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    schemaVersion: 1,
    id: 'approval-1',
    containerId: 'container-1',
    containerIdentityKey: 'docker.local/app',
    containerName: 'app',
    watcher: 'local',
    image: 'ghcr.io/example/app',
    fromRef: '1.0.0',
    toRef: '1.1.0',
    candidateRef: '1.1.0',
    updateKind: 'tag',
    semverDiff: 'minor',
    createdAt: '2026-08-29T09:00:00.000Z',
    createdAtMs: 1_756_461_600_000,
    decision: 'pending',
    ...overrides,
  };
}

function makeListResponse(data: ApprovalRecord[] = [makeApproval()]) {
  return { data, total: data.length, limit: 50, offset: 0, hasMore: false };
}

function makeSummary(
  overrides: Partial<{ pending: number; deferred: number; decidedToday: number }> = {},
) {
  return { pending: 1, deferred: 0, decidedToday: 0, ...overrides };
}

function makeDetail(overrides: Partial<ApprovalDetailResponse> = {}): ApprovalDetailResponse {
  return {
    approval: makeApproval(),
    holdReasons: [],
    ...overrides,
  };
}

function makeReleaseNotes(overrides: Partial<ContainerReleaseNotes> = {}): ContainerReleaseNotes {
  return {
    title: 'v1.1.0',
    body: 'Release notes body',
    url: 'https://example.com/releases/1.1.0',
    publishedAt: '2026-08-28T00:00:00.000Z',
    provider: 'github',
    ...overrides,
  };
}

// ── component stubs ───────────────────────────────────────────────────────────
const DataTableStub = defineComponent({
  props: [
    'columns',
    'rows',
    'rowKey',
    'fixedLayout',
    'showActions',
    'actionsWidth',
    'fullWidthRow',
    'rowClass',
  ],
  template: `
    <div class="data-table" :data-row-count="rows?.length ?? 0">
      <template v-for="row in rows" :key="typeof rowKey === 'function' ? rowKey(row) : row[rowKey]">
        <div v-if="fullWidthRow && fullWidthRow(row)" class="data-table-full-row">
          <slot name="full-row" :row="row" />
        </div>
        <div v-else class="data-table-row" :data-row-id="row.id" :class="rowClass ? rowClass(row) : ''">
          <slot name="cell-containerName" :row="row" />
          <slot name="cell-image" :row="row" />
          <slot name="cell-version" :row="row" />
          <slot name="cell-scan" :row="row" />
          <slot name="cell-age" :row="row" />
          <slot name="actions" :row="row" />
        </div>
      </template>
      <slot name="empty" v-if="!rows || rows.length === 0" />
    </div>
  `,
});

const stubs: Record<string, unknown> = {
  DataViewLayout: defineComponent({ template: '<div class="data-view-layout"><slot /></div>' }),
  DataTable: DataTableStub,
  AppBadge: defineComponent({
    props: ['tone', 'size'],
    template: '<span class="app-badge" :data-tone="tone"><slot /></span>',
  }),
  AppButton: defineComponent({
    props: ['size', 'variant', 'weight', 'disabled', 'title'],
    emits: ['click'],
    template:
      '<button :disabled="disabled" :title="title" @click="$emit(\'click\', $event)"><slot /></button>',
  }),
  AppIconButton: defineComponent({
    props: ['icon', 'size', 'variant', 'tooltip', 'ariaLabel', 'ariaExpanded'],
    emits: ['click'],
    template:
      '<button :aria-label="ariaLabel" :aria-expanded="ariaExpanded" @click="$emit(\'click\', $event)"><slot /></button>',
  }),
  EmptyState: defineComponent({
    props: ['icon', 'message'],
    template: '<div class="empty-state"><span>{{ message }}</span></div>',
  }),
};

const mountedWrappers: Array<ReturnType<typeof mountWithPlugins>> = [];

async function mountView() {
  const wrapper = mountWithPlugins(ApprovalsView, { global: { stubs } });
  mountedWrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

function findButtonByText(wrapper: ReturnType<typeof mountWithPlugins>, text: string) {
  return wrapper.findAll('button').find((b) => b.text().trim() === text);
}

function findTabByText(wrapper: ReturnType<typeof mountWithPlugins>, text: string) {
  return wrapper.findAll('button').find((b) => b.text().includes(text));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ApprovalsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoute.query = {};
    mockRoute.path = '/approvals';
    mockUpdateMode.value = 'manual';
    mockListApprovals.mockResolvedValue(makeListResponse());
    mockGetApprovalSummary.mockResolvedValue(makeSummary());
    mockGetApproval.mockResolvedValue(makeDetail());
    mockApproveApproval.mockResolvedValue({ operationId: 'op-1' });
    mockRejectApproval.mockResolvedValue({ approval: makeApproval({ decision: 'rejected' }) });
    mockDeferApproval.mockResolvedValue({ approval: makeApproval({ decision: 'deferred' }) });
    mockGetContainerReleaseNotes.mockResolvedValue(makeReleaseNotes());
  });

  afterEach(() => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
    document.body.innerHTML = '';
  });

  describe('initial load', () => {
    it('calls listApprovals with the pending status by default', async () => {
      await mountView();
      expect(mockListApprovals).toHaveBeenCalledWith({ status: 'pending' });
    });

    it('renders one row when the response contains one approval', async () => {
      const wrapper = await mountView();
      expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('1');
    });

    it('renders the container name in the table', async () => {
      mockListApprovals.mockResolvedValue(
        makeListResponse([makeApproval({ containerName: 'radarr' })]),
      );
      const wrapper = await mountView();
      expect(wrapper.text()).toContain('radarr');
    });

    it('shows an empty state when there are no approvals', async () => {
      mockListApprovals.mockResolvedValue(makeListResponse([]));
      const wrapper = await mountView();
      expect(wrapper.find('.empty-state').exists()).toBe(true);
    });

    it('shows an error banner when listApprovals rejects', async () => {
      mockListApprovals.mockRejectedValue(new Error('Failed to load approvals: Bad Gateway'));
      const wrapper = await mountView();
      expect(wrapper.text()).toContain('Failed to load approvals: Bad Gateway');
    });

    it('reads the status filter from the route query', async () => {
      mockRoute.query = { status: 'deferred' };
      await mountView();
      expect(mockListApprovals).toHaveBeenCalledWith({ status: 'deferred' });
    });

    it('defaults to pending for an unrecognized status query value', async () => {
      mockRoute.query = { status: 'bogus' };
      await mountView();
      expect(mockListApprovals).toHaveBeenCalledWith({ status: 'pending' });
    });
  });

  describe('status tabs', () => {
    it('calls router.replace with the deferred status when the Deferred tab is clicked', async () => {
      const wrapper = await mountView();
      const deferredTab = findTabByText(wrapper, 'Deferred');
      expect(deferredTab).toBeDefined();
      await deferredTab!.trigger('click');
      expect(mockRouter.replace).toHaveBeenCalledWith(
        expect.objectContaining({ query: expect.objectContaining({ status: 'deferred' }) }),
      );
    });

    it('does not call router.replace for the already-active tab', async () => {
      const wrapper = await mountView();
      const pendingTab = findTabByText(wrapper, 'Pending');
      await pendingTab!.trigger('click');
      expect(mockRouter.replace).not.toHaveBeenCalled();
    });

    it('reruns listApprovals when the route query status changes externally', async () => {
      await mountView();
      expect(mockListApprovals).toHaveBeenCalledTimes(1);
      mockRouter.replace({ query: { status: 'decided' } });
      await flushPromises();
      expect(mockListApprovals).toHaveBeenCalledTimes(2);
      expect(mockListApprovals).toHaveBeenLastCalledWith({ status: 'decided' });
    });
  });

  describe('notify mode', () => {
    it('shows the notify-mode banner and disables approve', async () => {
      mockUpdateMode.value = 'notify';
      const wrapper = await mountView();
      expect(wrapper.text()).toContain('Update mode is notify');
      const approveButton = findButtonByText(wrapper, 'Approve');
      expect(approveButton!.attributes('disabled')).toBeDefined();
    });

    it('does not show the banner in manual mode', async () => {
      const wrapper = await mountView();
      expect(wrapper.text()).not.toContain('Update mode is notify');
    });
  });

  describe('scan and semver badges', () => {
    it('renders a scan badge when scan data is present', async () => {
      mockListApprovals.mockResolvedValue(
        makeListResponse([makeApproval({ scanCritical: 2, scanHigh: 1 })]),
      );
      const wrapper = await mountView();
      expect(wrapper.find('.app-badge[data-tone="danger"]').exists()).toBe(true);
    });

    it('renders a warning scan badge for high-only findings', async () => {
      mockListApprovals.mockResolvedValue(makeListResponse([makeApproval({ scanHigh: 3 })]));
      const wrapper = await mountView();
      expect(wrapper.find('.app-badge[data-tone="warning"]').exists()).toBe(true);
    });

    it('renders a dash when there is no scan data', async () => {
      const wrapper = await mountView();
      expect(wrapper.text()).toContain('—');
    });

    it.each([
      ['major', 'danger'],
      ['minor', 'warning'],
      ['patch', 'success'],
      ['prerelease', 'caution'],
      ['unknown', 'neutral'],
    ])('maps semverDiff %s to tone %s', async (semverDiff, tone) => {
      mockListApprovals.mockResolvedValue(
        makeListResponse([
          makeApproval({ semverDiff: semverDiff as ApprovalRecord['semverDiff'] }),
        ]),
      );
      const wrapper = await mountView();
      expect(wrapper.find(`.app-badge[data-tone="${tone}"]`).exists()).toBe(true);
    });
  });

  describe('expand-in-place detail', () => {
    it('fetches release notes and hold reasons on first expand', async () => {
      mockGetApproval.mockResolvedValue(
        makeDetail({
          holdReasons: [{ reason: 'scan', message: 'Critical CVE found', actionable: false }],
        }),
      );
      const wrapper = await mountView();
      const expandButton = wrapper.find('[aria-label="Show release notes and hold reasons"]');
      await expandButton.trigger('click');
      await flushPromises();

      expect(mockGetApproval).toHaveBeenCalledWith('approval-1');
      expect(mockGetContainerReleaseNotes).toHaveBeenCalledWith('container-1');
      expect(wrapper.find('[data-testid="approval-hold-reasons"]').text()).toContain(
        'Critical CVE found',
      );
      expect(wrapper.find('[data-testid="approval-release-notes"]').text()).toContain('v1.1.0');
    });

    it('collapses the detail row on a second click', async () => {
      const wrapper = await mountView();
      const expandButton = wrapper.find('[aria-label="Show release notes and hold reasons"]');
      await expandButton.trigger('click');
      await flushPromises();
      expect(wrapper.find('[data-testid="approval-detail-row"]').exists()).toBe(true);

      await expandButton.trigger('click');
      await flushPromises();
      expect(wrapper.find('[data-testid="approval-detail-row"]').exists()).toBe(false);
    });

    it('shows an empty message when there are no notes or hold reasons', async () => {
      mockGetContainerReleaseNotes.mockResolvedValue(null);
      const wrapper = await mountView();
      const expandButton = wrapper.find('[aria-label="Show release notes and hold reasons"]');
      await expandButton.trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('No release notes or hold reasons for this update');
    });

    it('does not refetch detail data already cached for the same approval', async () => {
      const wrapper = await mountView();
      const expandButton = wrapper.find('[aria-label="Show release notes and hold reasons"]');
      await expandButton.trigger('click');
      await flushPromises();
      await expandButton.trigger('click'); // collapse
      await flushPromises();
      await expandButton.trigger('click'); // expand again
      await flushPromises();
      expect(mockGetApproval).toHaveBeenCalledTimes(1);
    });
  });

  describe('approve action', () => {
    it('requires confirmation with the target version in the message', async () => {
      const wrapper = await mountView();
      const approveButton = findButtonByText(wrapper, 'Approve');
      await approveButton!.trigger('click');
      await flushPromises();

      expect(mockConfirmRequire).toHaveBeenCalledWith(
        expect.objectContaining({
          header: 'Approve update',
          message: expect.stringContaining('1.1.0'),
        }),
      );
    });

    it('appends the soft-blocker list to the confirmation message when hold reasons exist', async () => {
      mockGetApproval.mockResolvedValue(
        makeDetail({
          holdReasons: [{ reason: 'scan', message: 'High severity CVE', actionable: false }],
        }),
      );
      const wrapper = await mountView();
      const approveButton = findButtonByText(wrapper, 'Approve');
      await approveButton!.trigger('click');
      await flushPromises();

      expect(mockConfirmRequire).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('High severity CVE') }),
      );
    });

    it('calls approveApproval and shows a success toast on accept', async () => {
      const wrapper = await mountView();
      const approveButton = findButtonByText(wrapper, 'Approve');
      await approveButton!.trigger('click');
      await flushPromises();

      await mockConfirmRequire.mock.calls[0][0].accept();
      await flushPromises();

      expect(mockApproveApproval).toHaveBeenCalledWith('approval-1');
      expect(mockToast.success).toHaveBeenCalledWith('Approve requested for app');
      expect(mockListApprovals).toHaveBeenCalledTimes(2);
    });

    it('shows an error toast when approveApproval rejects', async () => {
      mockApproveApproval.mockRejectedValue(new Error('Update mode is notify'));
      const wrapper = await mountView();
      const approveButton = findButtonByText(wrapper, 'Approve');
      await approveButton!.trigger('click');
      await flushPromises();
      await mockConfirmRequire.mock.calls[0][0].accept();
      await flushPromises();

      expect(mockToast.error).toHaveBeenCalledWith('Update mode is notify');
    });
  });

  describe('reject action', () => {
    it('requires confirmation and calls rejectApproval on accept', async () => {
      const wrapper = await mountView();
      const rejectButton = findButtonByText(wrapper, 'Reject');
      await rejectButton!.trigger('click');
      await flushPromises();

      expect(mockConfirmRequire).toHaveBeenCalledWith(
        expect.objectContaining({ header: 'Reject update' }),
      );
      await mockConfirmRequire.mock.calls[0][0].accept();
      await flushPromises();

      expect(mockRejectApproval).toHaveBeenCalledWith('approval-1');
      expect(mockToast.success).toHaveBeenCalledWith('Rejected update for app');
    });

    it('shows an error toast when rejectApproval rejects', async () => {
      mockRejectApproval.mockRejectedValue(new Error('boom'));
      const wrapper = await mountView();
      const rejectButton = findButtonByText(wrapper, 'Reject');
      await rejectButton!.trigger('click');
      await flushPromises();
      await mockConfirmRequire.mock.calls[0][0].accept();
      await flushPromises();

      expect(mockToast.error).toHaveBeenCalledWith('boom');
    });
  });

  describe('defer action', () => {
    it('requires confirmation and calls deferApproval with the default day count on accept', async () => {
      const wrapper = await mountView();
      const deferButton = findButtonByText(wrapper, 'Defer');
      await deferButton!.trigger('click');
      await flushPromises();

      expect(mockConfirmRequire).toHaveBeenCalledWith(
        expect.objectContaining({ header: 'Defer update' }),
      );
      await mockConfirmRequire.mock.calls[0][0].accept();
      await flushPromises();

      expect(mockDeferApproval).toHaveBeenCalledWith('approval-1', { days: 7 });
      expect(mockToast.success).toHaveBeenCalledWith('Deferred update for app');
    });

    it('shows an error toast when deferApproval rejects', async () => {
      mockDeferApproval.mockRejectedValue(new Error('deferral failed'));
      const wrapper = await mountView();
      const deferButton = findButtonByText(wrapper, 'Defer');
      await deferButton!.trigger('click');
      await flushPromises();
      await mockConfirmRequire.mock.calls[0][0].accept();
      await flushPromises();

      expect(mockToast.error).toHaveBeenCalledWith('deferral failed');
    });
  });

  describe('refresh button', () => {
    it('re-fetches approvals and the summary when clicked', async () => {
      const wrapper = await mountView();
      const refreshButton = findButtonByText(wrapper, 'Refresh');
      await refreshButton!.trigger('click');
      await flushPromises();
      expect(mockListApprovals).toHaveBeenCalledTimes(2);
      expect(mockGetApprovalSummary).toHaveBeenCalledTimes(2);
    });
  });

  describe('keyboard shortcuts', () => {
    it('moves focus and toggles expand with j/k and Enter', async () => {
      mockListApprovals.mockResolvedValue(
        makeListResponse([
          makeApproval({ id: 'approval-1', containerName: 'app-1' }),
          makeApproval({ id: 'approval-2', containerName: 'app-2' }),
        ]),
      );
      const wrapper = await mountView();

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await flushPromises();
      expect(wrapper.find('[data-testid="approval-detail-row"]').exists()).toBe(true);
    });

    it('triggers reject via the r shortcut on the focused row', async () => {
      const wrapper = await mountView();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
      await flushPromises();
      expect(mockConfirmRequire).toHaveBeenCalledWith(
        expect.objectContaining({ header: 'Reject update' }),
      );
      void wrapper;
    });

    it('triggers defer via the d shortcut on the focused row', async () => {
      await mountView();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
      await flushPromises();
      expect(mockConfirmRequire).toHaveBeenCalledWith(
        expect.objectContaining({ header: 'Defer update' }),
      );
    });

    it('triggers approve via the a shortcut when not in notify mode', async () => {
      await mountView();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      await flushPromises();
      expect(mockConfirmRequire).toHaveBeenCalledWith(
        expect.objectContaining({ header: 'Approve update' }),
      );
    });

    it('ignores the a shortcut in notify mode', async () => {
      mockUpdateMode.value = 'notify';
      await mountView();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      await flushPromises();
      expect(mockConfirmRequire).not.toHaveBeenCalled();
    });

    it('does nothing when no row is focused yet', async () => {
      await mountView();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
      await flushPromises();
      expect(mockConfirmRequire).not.toHaveBeenCalled();
    });

    it('ignores shortcuts while typing in a text field', async () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      await mountView();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));

      const event = new KeyboardEvent('keydown', { key: 'r' });
      Object.defineProperty(event, 'target', { value: input });
      window.dispatchEvent(event);
      await flushPromises();
      expect(mockConfirmRequire).not.toHaveBeenCalled();
    });

    it('ignores shortcuts when not on the approvals route', async () => {
      await mountView();
      mockRoute.path = '/containers';
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
      await flushPromises();
      expect(mockConfirmRequire).not.toHaveBeenCalled();
    });
  });

  describe('SSE-driven refresh', () => {
    it.each(['dd:sse-approval-created', 'dd:sse-approval-decided', 'dd:sse-approval-resolved'])(
      'refetches approvals when %s fires',
      async (eventName) => {
        const wrapper = await mountView();
        expect(mockListApprovals).toHaveBeenCalledTimes(1);
        window.dispatchEvent(new CustomEvent(eventName));
        await flushPromises();
        expect(mockListApprovals).toHaveBeenCalledTimes(2);
        void wrapper;
      },
    );
  });

  describe('status parsing edge cases', () => {
    it('uses the first entry when the status query param is an array', async () => {
      mockRoute.query = { status: ['deferred', 'decided'] };
      await mountView();
      expect(mockListApprovals).toHaveBeenCalledWith({ status: 'deferred' });
    });

    it('does not reload when the route query changes to the same effective status', async () => {
      await mountView();
      expect(mockListApprovals).toHaveBeenCalledTimes(1);
      mockRouter.replace({ query: { status: 'pending' } });
      await flushPromises();
      expect(mockListApprovals).toHaveBeenCalledTimes(1);
    });
  });

  describe('overlapping list requests (stale response guard)', () => {
    it('ignores a stale successful response that resolves after a newer request', async () => {
      const first = deferred<ReturnType<typeof makeListResponse>>();
      mockListApprovals.mockImplementationOnce(() => first.promise);
      const wrapper = await mountView();

      mockListApprovals.mockResolvedValueOnce(
        makeListResponse([makeApproval({ id: 'approval-2', containerName: 'fresh' })]),
      );
      const deferredTab = findTabByText(wrapper, 'Deferred');
      await deferredTab!.trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('fresh');

      first.resolve(makeListResponse([makeApproval({ id: 'approval-1', containerName: 'stale' })]));
      await flushPromises();
      expect(wrapper.text()).toContain('fresh');
      expect(wrapper.text()).not.toContain('stale');
    });

    it('ignores a stale rejection that resolves after a newer request already succeeded', async () => {
      const first = deferred<ReturnType<typeof makeListResponse>>();
      mockListApprovals.mockImplementationOnce(() => first.promise);
      const wrapper = await mountView();

      mockListApprovals.mockResolvedValueOnce(makeListResponse());
      const deferredTab = findTabByText(wrapper, 'Deferred');
      await deferredTab!.trigger('click');
      await flushPromises();

      first.reject(new Error('stale failure'));
      await flushPromises();
      expect(wrapper.text()).not.toContain('stale failure');
    });
  });

  describe('detail cache reuse', () => {
    it('reuses the cached hold reasons for a second confirm without refetching', async () => {
      mockGetApproval.mockResolvedValue(
        makeDetail({
          holdReasons: [{ reason: 'scan', message: 'cached reason', actionable: false }],
        }),
      );
      const wrapper = await mountView();
      const expandButton = wrapper.find('[aria-label="Show release notes and hold reasons"]');
      await expandButton.trigger('click');
      await flushPromises();
      expect(mockGetApproval).toHaveBeenCalledTimes(1);

      const approveButton = findButtonByText(wrapper, 'Approve');
      await approveButton!.trigger('click');
      await flushPromises();

      expect(mockGetApproval).toHaveBeenCalledTimes(1);
      expect(mockConfirmRequire).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('cached reason') }),
      );
    });

    it('falls back to no hold reasons or release notes when both detail calls reject during expand', async () => {
      mockGetApproval.mockRejectedValueOnce(new Error('boom'));
      mockGetContainerReleaseNotes.mockRejectedValueOnce(new Error('notes failed'));
      const wrapper = await mountView();
      const expandButton = wrapper.find('[aria-label="Show release notes and hold reasons"]');
      await expandButton.trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('No release notes or hold reasons for this update');
    });

    it('falls back to no hold reasons when getApproval rejects during an approve confirmation without expanding first', async () => {
      mockGetApproval.mockRejectedValueOnce(new Error('boom'));
      const wrapper = await mountView();
      const approveButton = findButtonByText(wrapper, 'Approve');
      await approveButton!.trigger('click');
      await flushPromises();

      expect(mockGetApproval).toHaveBeenCalledTimes(1);
      expect(mockConfirmRequire).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.not.stringContaining('open hold reasons') }),
      );
    });

    it('clears the loading flag only when it still refers to the settled approval', async () => {
      const pending = deferred<ReturnType<typeof makeDetail>>();
      mockGetApproval.mockReturnValueOnce(pending.promise as unknown as Promise<never>);
      mockListApprovals.mockResolvedValue(
        makeListResponse([
          makeApproval({ id: 'approval-1', containerName: 'first' }),
          makeApproval({ id: 'approval-2', containerName: 'second' }),
        ]),
      );
      const wrapper = await mountView();
      const expandButtons = wrapper.findAll('[aria-label="Show release notes and hold reasons"]');

      await expandButtons[0].trigger('click');
      await expandButtons[0].trigger('click'); // collapse the first before its fetch resolves
      await expandButtons[1].trigger('click'); // expand the second, which resolves immediately
      await flushPromises();

      pending.resolve(makeDetail());
      await flushPromises();
      expect(wrapper.find('[data-testid="approval-detail-row"]').exists()).toBe(true);
    });
  });

  describe('scanTone branches', () => {
    it('returns neutral when scan data exists but no critical or high findings', async () => {
      mockListApprovals.mockResolvedValue(makeListResponse([makeApproval({ scanMedium: 2 })]));
      const wrapper = await mountView();
      expect(wrapper.find('.app-badge[data-tone="neutral"]').exists()).toBe(true);
    });
  });

  describe('in-flight action guards', () => {
    it('ignores a second approve while the first is still in flight', async () => {
      const pending = deferred<{ operationId: string }>();
      mockApproveApproval.mockReturnValueOnce(pending.promise);
      const wrapper = await mountView();
      const approveButton = findButtonByText(wrapper, 'Approve');
      await approveButton!.trigger('click');
      await flushPromises();
      void mockConfirmRequire.mock.calls[0][0].accept();
      await flushPromises();
      void mockConfirmRequire.mock.calls[0][0].accept();
      await flushPromises();

      expect(mockApproveApproval).toHaveBeenCalledTimes(1);
      pending.resolve({ operationId: 'op-1' });
      await flushPromises();
      void wrapper;
    });

    it('ignores a second reject while the first is still in flight', async () => {
      const pending = deferred<{ approval: ApprovalRecord }>();
      mockRejectApproval.mockReturnValueOnce(pending.promise);
      const wrapper = await mountView();
      const rejectButton = findButtonByText(wrapper, 'Reject');
      await rejectButton!.trigger('click');
      await flushPromises();
      const calls = mockConfirmRequire.mock.calls;
      void calls[calls.length - 1][0].accept();
      await flushPromises();
      void calls[calls.length - 1][0].accept();
      await flushPromises();

      expect(mockRejectApproval).toHaveBeenCalledTimes(1);
      pending.resolve({ approval: makeApproval({ decision: 'rejected' }) });
      await flushPromises();
    });

    it('ignores a second defer while the first is still in flight', async () => {
      const pending = deferred<{ approval: ApprovalRecord }>();
      mockDeferApproval.mockReturnValueOnce(pending.promise);
      const wrapper = await mountView();
      const deferButton = findButtonByText(wrapper, 'Defer');
      await deferButton!.trigger('click');
      await flushPromises();
      const calls = mockConfirmRequire.mock.calls;
      void calls[calls.length - 1][0].accept();
      await flushPromises();
      void calls[calls.length - 1][0].accept();
      await flushPromises();

      expect(mockDeferApproval).toHaveBeenCalledTimes(1);
      pending.resolve({ approval: makeApproval({ decision: 'deferred' }) });
      await flushPromises();
    });
  });

  describe('keyboard navigation edge cases', () => {
    it('does nothing when j is pressed with an empty approval list', async () => {
      mockListApprovals.mockResolvedValue(makeListResponse([]));
      await mountView();
      expect(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }))).not.toThrow();
    });

    it('moves focus backward with k after moving forward with j', async () => {
      mockListApprovals.mockResolvedValue(
        makeListResponse([
          makeApproval({ id: 'approval-1', containerName: 'first' }),
          makeApproval({ id: 'approval-2', containerName: 'second' }),
        ]),
      );
      await mountView();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await flushPromises();
      expect(mockGetApproval).toHaveBeenCalledWith('approval-1');
    });
  });
});
