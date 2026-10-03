import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { computed, defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n, SUPPORTED_LOCALES, setI18nLocale } from '@/boot/i18n';
import {
  ApprovalApiError,
  type ApprovalRecord,
  approveApproval,
  deferApproval,
  getApproval,
  getApprovalSummary,
  listApprovals,
  rejectApproval,
} from '@/services/approval';
import ApprovalsView from '@/views/ApprovalsView.vue';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('@/composables/useConfirmDialog', () => ({
  useConfirmDialog: () => ({ require: mocks.confirm }),
}));
vi.mock('@/composables/useToast', () => ({ useToast: () => mocks.toast }));
vi.mock('@/composables/useUpdateMode', () => ({
  useUpdateMode: () => ({ updateMode: computed(() => 'manual') }),
}));

const messages = {
  fr: {
    list: 'Impossible de charger les approbations',
    summary: 'Échec du chargement du résumé des approbations',
    detail: 'Échec du chargement de l’approbation',
    approve: 'Échec de l’approbation de la mise à jour',
    reject: 'Échec du rejet de la mise à jour',
    defer: 'Échec du report de la mise à jour',
  },
  ar: {
    list: 'تعذّر تحميل طلبات الموافقة',
    summary: 'فشل تحميل ملخص الموافقات',
    detail: 'فشل تحميل الموافقة',
    approve: 'فشلت الموافقة على التحديث',
    reject: 'فشل رفض التحديث',
    defer: 'فشل تأجيل التحديث',
  },
} as const;

const operations = [
  { name: 'list', run: () => listApprovals() },
  { name: 'summary', run: () => getApprovalSummary() },
  { name: 'detail', run: () => getApproval('approval/1') },
  { name: 'approve', run: () => approveApproval('approval/1') },
  { name: 'reject', run: () => rejectApproval('approval/1') },
  { name: 'defer', run: () => deferApproval('approval/1', { days: 7 }) },
] as const;

const approval: ApprovalRecord = {
  schemaVersion: 1,
  id: 'approval/1',
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
  createdAt: '2026-09-18T09:00:00.000Z',
  createdAtMs: Date.parse('2026-09-18T09:00:00.000Z'),
  decision: 'pending',
};

const tableStub = defineComponent({
  props: ['rows'],
  template:
    '<div><div v-for="row in rows" :key="row.id"><slot name="cell-containerName" :row="row" /><slot name="actions" :row="row" /></div></div>',
});

describe('Approvals HTTP error feedback', () => {
  let wrapper: VueWrapper | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    setI18nLocale('en');
    vi.unstubAllGlobals();
  });

  describe.each(['fr', 'ar'] as const)('%s', (locale) => {
    beforeEach(() => setI18nLocale(locale));

    it.each(operations)(
      'localizes $name fallback and keeps HTTP diagnostics',
      async ({ name, run }) => {
        for (const body of ['null', '{}', '{"error":"  "}', '<html>unavailable</html>']) {
          fetchMock.mockResolvedValueOnce(
            new Response(body, { status: 503, statusText: 'Service Unavailable' }),
          );
          const error = await run().catch((cause: unknown) => cause);
          expect(error).toBeInstanceOf(ApprovalApiError);
          expect(error).toMatchObject({
            statusCode: 503,
            message: `${messages[locale][name]} (HTTP 503): Service Unavailable`,
          });
        }
        expect(fetchMock).toHaveBeenCalledTimes(4);
      },
    );

    async function openView() {
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/approvals', component: ApprovalsView }],
      });
      await router.push('/approvals');
      await router.isReady();
      wrapper = mount(ApprovalsView, {
        global: {
          plugins: [router],
          stubs: {
            DataTable: tableStub,
            DataViewLayout: { template: '<div><slot /></div>' },
            AppIcon: true,
          },
        },
      });
      await flushPromises();
      return wrapper;
    }

    function fixture() {
      let failList = false;
      let failWrite = true;
      const unexpected: string[] = [];
      fetchMock.mockImplementation(async (url: string, options: RequestInit = {}) => {
        if (url === '/api/v1/approvals?status=pending') {
          return failList
            ? new Response('null', { status: 502 })
            : Response.json({ data: [approval], total: 1, limit: 50, offset: 0, hasMore: false });
        }
        if (url === '/api/v1/approvals/summary')
          return Response.json({ pending: 1, deferred: 0, decidedToday: 0 });
        if (url === '/api/v1/approvals/approval%2F1')
          return Response.json({ approval, holdReasons: [] });
        if (
          /^\/api\/v1\/approvals\/approval%2F1\/(approve|reject|defer)$/.test(url) &&
          options.method === 'POST'
        ) {
          return failWrite
            ? new Response('<html>unavailable</html>', { status: 502 })
            : Response.json({ operationId: 'operation-1', approval });
        }
        unexpected.push(url);
        throw new Error(`Unexpected request ${url}`);
      });
      return {
        unexpected,
        setListFailure: (value: boolean) => {
          failList = value;
        },
        setWriteFailure: (value: boolean) => {
          failWrite = value;
        },
      };
    }

    it('renders list failure and recovers on explicit same-mount refresh', async () => {
      const server = fixture();
      server.setListFailure(true);
      const view = await openView();
      expect(view.text()).toContain(`${messages[locale].list} (HTTP 502)`);
      server.setListFailure(false);
      const refresh = view
        .findAll('button')
        .find((button) => button.text().trim() === i18n.global.t('approvalsView.refresh'));
      expect(refresh).toBeDefined();
      await refresh?.trigger('click');
      await flushPromises();
      expect(view.text()).not.toContain('HTTP 502');
      expect(view.get('[data-testid="approval-container-name"]').text()).toBe('app');
      expect(fetchMock.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(
        0,
      );
      expect(
        fetchMock.mock.calls.filter(([url]) => url === '/api/v1/approvals?status=pending'),
      ).toHaveLength(2);
      expect(server.unexpected).toEqual([]);
    });

    it.each(['approve', 'reject', 'defer'] as const)(
      'preserves confirmation and explicit retry for %s',
      async (action) => {
        const server = fixture();
        const view = await openView();
        const button = () =>
          view.get(
            `button[aria-label="${i18n.global.t(`approvalsView.actions.${action}AriaLabel`)}"]`,
          );
        const writes = () =>
          fetchMock.mock.calls.filter(([, options]) => options.method === 'POST');
        await button().trigger('click');
        await flushPromises();
        expect(mocks.confirm).toHaveBeenCalledTimes(1);
        expect(writes()).toHaveLength(0);
        await mocks.confirm.mock.calls[0][0].accept();
        await flushPromises();
        expect(mocks.toast.error).toHaveBeenCalledWith(`${messages[locale][action]} (HTTP 502)`);
        expect(writes()).toEqual([
          [
            `/api/v1/approvals/approval%2F1/${action}`,
            {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(action === 'defer' ? { days: 7 } : {}),
            },
          ],
        ]);
        expect(button().attributes('disabled')).toBeUndefined();
        server.setWriteFailure(false);
        await button().trigger('click');
        await flushPromises();
        expect(mocks.confirm).toHaveBeenCalledTimes(2);
        await mocks.confirm.mock.calls[1][0].accept();
        await flushPromises();
        expect(writes()).toHaveLength(2);
        expect(mocks.toast.success).toHaveBeenCalledTimes(1);
        expect(mocks.toast.error).toHaveBeenCalledTimes(1);
        expect(server.unexpected).toEqual([]);
      },
    );
  });

  it('uses the locale at decision-response arrival', async () => {
    setI18nLocale('fr');
    fetchMock.mockImplementation(async () => {
      setI18nLocale('ar');
      return new Response('null', { status: 502 });
    });
    await expect(approveApproval('approval/1')).rejects.toMatchObject({
      statusCode: 502,
      message: `${messages.ar.approve} (HTTP 502)`,
    });
  });

  it.each(SUPPORTED_LOCALES)(
    'provides localized fallbacks for every operation in %s',
    async (locale) => {
      setI18nLocale(locale);
      const keys = {
        list: 'approvalsView.loadError',
        summary: 'approvalsView.httpErrors.summaryLoadFailed',
        detail: 'approvalsView.httpErrors.detailLoadFailed',
        approve: 'approvalsView.httpErrors.approveFailed',
        reject: 'approvalsView.httpErrors.rejectFailed',
        defer: 'approvalsView.httpErrors.deferFailed',
      };
      for (const { name, run } of operations) {
        expect(i18n.global.te(keys[name], locale)).toBe(true);
        fetchMock.mockResolvedValueOnce(new Response('null', { status: 502 }));
        await expect(run()).rejects.toMatchObject({
          statusCode: 502,
          message: `${i18n.global.t(keys[name])} (HTTP 502)`,
        });
      }
      expect(fetchMock).toHaveBeenCalledTimes(6);
    },
  );
});
