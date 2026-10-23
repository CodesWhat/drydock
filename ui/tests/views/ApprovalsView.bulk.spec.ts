import { flushPromises } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { i18n } from '@/boot/i18n';
import type { ApprovalRecord } from '@/services/approval';
import ApprovalsView from '@/views/ApprovalsView.vue';
import { mountWithPlugins } from '../helpers/mount';

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
  return { useRoute: () => routeState, useRouter: () => mockRouter };
});

vi.mock('@/services/approval', () => ({
  listApprovals: vi.fn(),
  getApprovalSummary: vi.fn(),
  getApproval: vi.fn(),
  approveApproval: vi.fn(),
  rejectApproval: vi.fn(),
  deferApproval: vi.fn(),
  bulkDecideApprovals: vi.fn(),
}));
vi.mock('@/services/container', () => ({ getContainerReleaseNotes: vi.fn() }));

const mockToast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
vi.mock('@/composables/useToast', () => ({ useToast: () => mockToast }));
const mockConfirmRequire = vi.fn();
vi.mock('@/composables/useConfirmDialog', () => ({
  useConfirmDialog: () => ({ require: mockConfirmRequire }),
}));
const mockUpdateMode = { value: 'manual' as string };
vi.mock('@/composables/useUpdateMode', () => ({
  useUpdateMode: () => ({ updateMode: mockUpdateMode }),
}));

import {
  bulkDecideApprovals,
  getApproval,
  getApprovalSummary,
  listApprovals,
} from '@/services/approval';

const mockListApprovals = listApprovals as ReturnType<typeof vi.fn>;
const mockGetApprovalSummary = getApprovalSummary as ReturnType<typeof vi.fn>;
const mockGetApproval = getApproval as ReturnType<typeof vi.fn>;
const mockBulk = bulkDecideApprovals as ReturnType<typeof vi.fn>;

function makeApproval(id: string, overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    schemaVersion: 1,
    id,
    containerId: `container-${id}`,
    containerIdentityKey: `docker.local/${id}`,
    containerName: `app-${id}`,
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

function listOf(...ids: string[]) {
  const data = ids.map((id) => makeApproval(id));
  return { data, total: data.length, limit: 0, offset: 0, hasMore: false };
}

const DataTableStub = defineComponent({
  props: ['columns', 'rows', 'rowKey', 'fullWidthRow', 'rowClass'],
  template: `
    <div class="data-table" :data-columns="columns.map((c) => c.key).join(',')">
      <div class="data-table-header"><slot name="header-select" /></div>
      <template v-for="row in rows" :key="typeof rowKey === 'function' ? rowKey(row) : row[rowKey]">
        <div v-if="fullWidthRow && fullWidthRow(row)" class="data-table-full-row">
          <slot name="full-row" :row="row" />
        </div>
        <div v-else class="data-table-row" :data-row-id="row.id">
          <slot name="cell-select" :row="row" />
          <slot name="actions" :row="row" />
        </div>
      </template>
    </div>
  `,
});

const stubs: Record<string, unknown> = {
  DataViewLayout: defineComponent({ template: '<div><slot /></div>' }),
  DataTable: DataTableStub,
  AppBadge: defineComponent({ template: '<span><slot /></span>' }),
  AppButton: defineComponent({
    props: ['disabled', 'title'],
    emits: ['click'],
    template:
      '<button :disabled="disabled" :title="title" @click="$emit(\'click\', $event)"><slot /></button>',
  }),
  AppIconButton: defineComponent({
    emits: ['click'],
    template: '<button @click="$emit(\'click\', $event)"><slot /></button>',
  }),
  EmptyState: defineComponent({ template: '<div class="empty-state" />' }),
};

const mounted: Array<ReturnType<typeof mountWithPlugins>> = [];

async function mountView() {
  const wrapper = mountWithPlugins(ApprovalsView, { global: { stubs } });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

type Wrapper = Awaited<ReturnType<typeof mountView>>;

const rowBoxes = (wrapper: Wrapper) => wrapper.findAll('[data-testid="approval-select"]');
const selectAll = (wrapper: Wrapper) => wrapper.find('[data-testid="approval-select-all"]');
const bar = (wrapper: Wrapper) => wrapper.find('[data-testid="approval-selection-bar"]');
const bulkApprove = (wrapper: Wrapper) => wrapper.find('[data-testid="approval-bulk-approve"]');
const bulkReject = (wrapper: Wrapper) => wrapper.find('[data-testid="approval-bulk-reject"]');

describe('ApprovalsView bulk selection', () => {
  const originalLocale = i18n.global.locale.value;

  beforeEach(() => {
    vi.clearAllMocks();
    i18n.global.locale.value = 'en';
    mockRoute.query = {};
    mockRoute.path = '/approvals';
    mockUpdateMode.value = 'manual';
    mockListApprovals.mockResolvedValue(listOf('a', 'b', 'c'));
    mockGetApprovalSummary.mockResolvedValue({ pending: 3, deferred: 0, decidedToday: 0 });
    mockBulk.mockResolvedValue({ accepted: [], rejected: [] });
    mockGetApproval.mockImplementation((id: string) =>
      Promise.resolve({ approval: makeApproval(id), holdReasons: [] }),
    );
  });

  afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = '';
    i18n.global.locale.value = originalLocale;
  });

  it('adds a select column on the pending tab and hides the bar until something is selected', async () => {
    const wrapper = await mountView();

    expect(wrapper.find('.data-table').attributes('data-columns')).toMatch(/^select,/);
    expect(rowBoxes(wrapper)).toHaveLength(3);
    expect(bar(wrapper).exists()).toBe(false);
  });

  it('has no select column on the decided tab', async () => {
    mockRoute.query = { status: 'decided' };
    const wrapper = await mountView();

    expect(wrapper.find('.data-table').attributes('data-columns')).not.toContain('select');
    expect(selectAll(wrapper).exists()).toBe(false);
  });

  it('selects and deselects single rows and reports the count', async () => {
    const wrapper = await mountView();

    await rowBoxes(wrapper)[0].trigger('click');
    await rowBoxes(wrapper)[1].trigger('click');
    expect(bar(wrapper).text()).toContain('Selected: 2');

    await rowBoxes(wrapper)[0].trigger('click');
    expect(bar(wrapper).text()).toContain('Selected: 1');

    await rowBoxes(wrapper)[1].trigger('click');
    expect(bar(wrapper).exists()).toBe(false);
  });

  it('select-all toggles every visible row and shows the indeterminate state for a partial selection', async () => {
    const wrapper = await mountView();
    const box = selectAll(wrapper).element as HTMLInputElement;

    await rowBoxes(wrapper)[0].trigger('click');
    expect(box.indeterminate).toBe(true);
    expect(box.checked).toBe(false);

    await selectAll(wrapper).trigger('click');
    expect(bar(wrapper).text()).toContain('Selected: 3');
    expect(box.indeterminate).toBe(false);
    expect(box.checked).toBe(true);

    await selectAll(wrapper).trigger('click');
    expect(bar(wrapper).exists()).toBe(false);
  });

  it('select-all does nothing on an empty list', async () => {
    mockListApprovals.mockResolvedValue(listOf());
    const wrapper = await mountView();

    await selectAll(wrapper).trigger('click');

    expect(bar(wrapper).exists()).toBe(false);
  });

  it('clears the selection from the bar', async () => {
    const wrapper = await mountView();
    await selectAll(wrapper).trigger('click');

    await wrapper.find('[data-testid="approval-bulk-clear"]').trigger('click');

    expect(bar(wrapper).exists()).toBe(false);
  });

  it('drops selected ids that a reload removed from the list', async () => {
    const wrapper = await mountView();
    await selectAll(wrapper).trigger('click');

    mockListApprovals.mockResolvedValue(listOf('a'));
    await wrapper.find('button').trigger('click');
    await flushPromises();

    expect(bar(wrapper).text()).toContain('Selected: 1');
  });

  it('keeps the selection when a reload returns the same rows', async () => {
    const wrapper = await mountView();
    await selectAll(wrapper).trigger('click');

    await wrapper.find('button').trigger('click');
    await flushPromises();

    expect(bar(wrapper).text()).toContain('Selected: 3');
  });

  describe('bulk approve', () => {
    it('asks for confirmation naming the count before calling the API', async () => {
      const wrapper = await mountView();
      await selectAll(wrapper).trigger('click');

      await bulkApprove(wrapper).trigger('click');
      await flushPromises();

      expect(mockBulk).not.toHaveBeenCalled();
      expect(mockConfirmRequire).toHaveBeenCalledWith(
        expect.objectContaining({
          header: 'Approve selected updates',
          severity: 'warn',
          acceptLabel: 'Approve selected',
          rejectLabel: 'Cancel',
          message: expect.stringContaining('(3)'),
        }),
      );
    });

    it('sends the selected ids on accept, toasts, clears the selection and reloads', async () => {
      mockBulk.mockResolvedValue({
        accepted: [
          { id: 'a', containerId: 'c', containerName: 'a', decision: 'approved', operationId: 'o' },
          { id: 'b', containerId: 'c', containerName: 'b', decision: 'approved', operationId: 'o' },
        ],
        rejected: [],
      });
      const wrapper = await mountView();
      await rowBoxes(wrapper)[0].trigger('click');
      await rowBoxes(wrapper)[1].trigger('click');
      await bulkApprove(wrapper).trigger('click');
      await flushPromises();

      await mockConfirmRequire.mock.calls[0][0].accept();
      await flushPromises();

      expect(mockBulk).toHaveBeenCalledWith(['a', 'b'], 'approve');
      expect(mockToast.success).toHaveBeenCalledWith('Approve requested for selected updates: 2');
      expect(mockToast.warning).not.toHaveBeenCalled();
      expect(bar(wrapper).exists()).toBe(false);
      expect(mockListApprovals).toHaveBeenCalledTimes(2);
    });

    it('warns with the distinct per-row reasons when some rows were refused', async () => {
      mockBulk.mockResolvedValue({
        accepted: [
          { id: 'a', containerId: 'c', containerName: 'a', decision: 'approved', operationId: 'o' },
        ],
        rejected: [
          { id: 'b', statusCode: 409, message: 'Approval already decided' },
          { id: 'c', statusCode: 409, message: 'Approval already decided' },
        ],
      });
      const wrapper = await mountView();
      await selectAll(wrapper).trigger('click');
      await bulkApprove(wrapper).trigger('click');
      await flushPromises();

      await mockConfirmRequire.mock.calls[0][0].accept();
      await flushPromises();

      expect(mockToast.success).toHaveBeenCalledTimes(1);
      expect(mockToast.warning).toHaveBeenCalledWith(
        'Some updates could not be decided (2): Approval already decided',
      );
    });

    it('joins different refusal reasons', async () => {
      mockBulk.mockResolvedValue({
        accepted: [],
        rejected: [
          { id: 'a', statusCode: 409, message: 'Update mode is notify' },
          { id: 'b', statusCode: 404, message: 'Approval not found' },
        ],
      });
      const wrapper = await mountView();
      await selectAll(wrapper).trigger('click');
      await bulkApprove(wrapper).trigger('click');
      await flushPromises();

      await mockConfirmRequire.mock.calls[0][0].accept();
      await flushPromises();

      expect(mockToast.success).not.toHaveBeenCalled();
      expect(mockToast.warning).toHaveBeenCalledWith(
        'Some updates could not be decided (2): Update mode is notify; Approval not found',
      );
    });

    it('toasts the API error and keeps the selection when the call fails', async () => {
      mockBulk.mockRejectedValue(new Error('Confirmation required'));
      const wrapper = await mountView();
      await selectAll(wrapper).trigger('click');
      await bulkApprove(wrapper).trigger('click');
      await flushPromises();

      await mockConfirmRequire.mock.calls[0][0].accept();
      await flushPromises();

      expect(mockToast.error).toHaveBeenCalledWith('Confirmation required');
      expect(bar(wrapper).text()).toContain('Selected: 3');
    });

    it('falls back to the generic message when the failure carries none', async () => {
      mockBulk.mockRejectedValue(undefined);
      const wrapper = await mountView();
      await selectAll(wrapper).trigger('click');
      await bulkApprove(wrapper).trigger('click');
      await flushPromises();

      await mockConfirmRequire.mock.calls[0][0].accept();
      await flushPromises();

      expect(mockToast.error).toHaveBeenCalledWith('Failed to decide the selected updates');
    });

    it('is disabled in notify mode with the mode as the reason', async () => {
      mockUpdateMode.value = 'notify';
      const wrapper = await mountView();
      await selectAll(wrapper).trigger('click');

      expect(bulkApprove(wrapper).attributes('disabled')).toBeDefined();
      expect(bulkApprove(wrapper).attributes('title')).toBe(
        'Update mode is notify; approve is disabled',
      );
      expect(bulkReject(wrapper).attributes('disabled')).toBeUndefined();
    });

    it('ignores a second accept while the first call is in flight', async () => {
      let resolve!: (value: unknown) => void;
      mockBulk.mockReturnValueOnce(new Promise((res) => (resolve = res)));
      const wrapper = await mountView();
      await selectAll(wrapper).trigger('click');
      await bulkApprove(wrapper).trigger('click');
      await flushPromises();
      const { accept } = mockConfirmRequire.mock.calls[0][0];

      void accept();
      await flushPromises();
      expect(bulkApprove(wrapper).attributes('disabled')).toBeDefined();
      void accept();
      await flushPromises();

      expect(mockBulk).toHaveBeenCalledTimes(1);
      resolve({ accepted: [], rejected: [] });
      await flushPromises();
    });

    it('approves only the rows that were confirmed, even if the selection changes before accept', async () => {
      const wrapper = await mountView();
      await selectAll(wrapper).trigger('click');
      await bulkApprove(wrapper).trigger('click');
      await flushPromises();
      await wrapper.find('[data-testid="approval-bulk-clear"]').trigger('click');

      await mockConfirmRequire.mock.calls[0][0].accept();
      await flushPromises();

      expect(mockBulk).toHaveBeenCalledWith(['a', 'b', 'c'], 'approve');
    });

    it('lists the soft hold reasons of the selected rows in the confirmation', async () => {
      mockGetApproval.mockImplementation((id: string) =>
        Promise.resolve({
          approval: makeApproval(id),
          holdReasons:
            id === 'b'
              ? [
                  {
                    reason: 'snoozed',
                    severity: 'soft',
                    message: 'Snoozed until Friday',
                    actionable: true,
                  },
                ]
              : [],
        }),
      );
      const wrapper = await mountView();
      await selectAll(wrapper).trigger('click');

      await bulkApprove(wrapper).trigger('click');
      await flushPromises();

      const { message } = mockConfirmRequire.mock.calls[0][0];
      expect(message).toContain('(3)');
      expect(message).toContain(
        'These updates have open hold reasons that approving overrides:\n• app-b: Snoozed until Friday',
      );
      expect(message).not.toContain('Blocked and skipped');
    });

    it('excludes hard-blocked rows from the approve and names them in the confirmation', async () => {
      mockGetApproval.mockImplementation((id: string) =>
        Promise.resolve({
          approval: makeApproval(id),
          holdReasons: [],
          eligibility: {
            eligible: id !== 'c',
            evaluatedAt: '2026-08-29T09:00:00.000Z',
            blockers:
              id === 'c'
                ? [
                    {
                      reason: 'security-scan-blocked',
                      severity: 'hard',
                      message: 'Scan blocked',
                      actionable: false,
                    },
                  ]
                : id === 'a'
                  ? [{ reason: 'snoozed', severity: 'soft', message: 'soft', actionable: true }]
                  : [],
          },
        }),
      );
      const wrapper = await mountView();
      await selectAll(wrapper).trigger('click');

      await bulkApprove(wrapper).trigger('click');
      await flushPromises();

      const options = mockConfirmRequire.mock.calls[0][0];
      expect(options.message).toContain('(2)');
      expect(options.message).toContain('Blocked and skipped (1):\n• app-c: Scan blocked');
      await options.accept();
      await flushPromises();
      expect(mockBulk).toHaveBeenCalledWith(['a', 'b'], 'approve');
    });

    it('treats a blocker with no severity as hard', async () => {
      mockGetApproval.mockImplementation((id: string) =>
        Promise.resolve({
          approval: makeApproval(id),
          holdReasons: [],
          eligibility: {
            eligible: false,
            evaluatedAt: 'x',
            blockers:
              id === 'a'
                ? [{ reason: 'trigger-excluded', message: 'Excluded', actionable: false }]
                : [],
          },
        }),
      );
      const wrapper = await mountView();
      await selectAll(wrapper).trigger('click');

      await bulkApprove(wrapper).trigger('click');
      await flushPromises();

      expect(mockConfirmRequire.mock.calls[0][0].message).toContain('• app-a: Excluded');
    });

    it('opens no dialog and warns when every selected row is hard-blocked', async () => {
      mockListApprovals.mockResolvedValue(listOf('a'));
      mockGetApproval.mockResolvedValue({
        approval: makeApproval('a'),
        holdReasons: [],
        eligibility: {
          eligible: false,
          evaluatedAt: 'x',
          blockers: [
            { reason: 'x', severity: 'hard', message: 'One', actionable: false },
            { reason: 'y', severity: 'hard', message: 'Two', actionable: false },
          ],
        },
      });
      const wrapper = await mountView();
      await selectAll(wrapper).trigger('click');

      await bulkApprove(wrapper).trigger('click');
      await flushPromises();

      expect(mockConfirmRequire).not.toHaveBeenCalled();
      expect(mockToast.warning).toHaveBeenCalledWith(
        'Some updates could not be decided (1): • app-a: One; Two',
      );
    });

    it('proceeds without hold information for a row whose detail cannot be loaded', async () => {
      mockGetApproval.mockRejectedValue(new Error('down'));
      const wrapper = await mountView();
      await selectAll(wrapper).trigger('click');

      await bulkApprove(wrapper).trigger('click');
      await flushPromises();

      expect(mockConfirmRequire.mock.calls[0][0].message).toContain('(3)');
    });

    it('reuses cached details on a second confirmation', async () => {
      const wrapper = await mountView();
      await selectAll(wrapper).trigger('click');
      await bulkApprove(wrapper).trigger('click');
      await flushPromises();
      await bulkApprove(wrapper).trigger('click');
      await flushPromises();

      expect(mockGetApproval).toHaveBeenCalledTimes(3);
    });
  });

  describe('bulk reject', () => {
    it('confirms, then rejects the selection', async () => {
      mockBulk.mockResolvedValue({
        accepted: [{ id: 'a', containerId: 'c', containerName: 'a', decision: 'rejected' }],
        rejected: [],
      });
      const wrapper = await mountView();
      await rowBoxes(wrapper)[0].trigger('click');
      await bulkReject(wrapper).trigger('click');

      expect(mockConfirmRequire).toHaveBeenCalledWith(
        expect.objectContaining({
          header: 'Reject selected updates',
          acceptLabel: 'Reject selected',
          message: expect.stringContaining('(1)'),
        }),
      );
      await mockConfirmRequire.mock.calls[0][0].accept();
      await flushPromises();

      expect(mockBulk).toHaveBeenCalledWith(['a'], 'reject');
      expect(mockToast.success).toHaveBeenCalledWith('Rejected selected updates: 1');
    });
  });

  it('disables the row actions and bulk buttons while a single row is being decided', async () => {
    let resolve!: (value: unknown) => void;
    const { approveApproval } = await import('@/services/approval');
    (approveApproval as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise((res) => (resolve = res)),
    );
    const wrapper = await mountView();
    await selectAll(wrapper).trigger('click');

    const rowApprove = wrapper
      .findAll('.data-table-row button')
      .find((button) => button.text().trim() === 'Approve');
    await rowApprove!.trigger('click');
    await flushPromises();
    void mockConfirmRequire.mock.calls[0][0].accept();
    await flushPromises();

    expect(bulkApprove(wrapper).attributes('disabled')).toBeDefined();
    expect(bulkReject(wrapper).attributes('disabled')).toBeDefined();
    resolve({ operationId: 'o' });
    await flushPromises();
  });
});
