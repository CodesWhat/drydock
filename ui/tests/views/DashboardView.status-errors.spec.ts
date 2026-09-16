import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '@/boot/i18n';
import { resetPreferences } from '@/preferences/store';
import DashboardView from '@/views/DashboardView.vue';
import { useDashboardData } from '@/views/dashboard/useDashboardData';
import { dataViewStubs } from '../helpers/data-view-stubs';

vi.mock('@/services/stats', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/stats')>()),
  connectStatsSummaryStream: () => ({
    pause() {},
    resume() {},
    disconnect() {},
    isPaused: () => false,
  }),
}));

const originalLocale = i18n.global.locale.value;
const url = '/api/v1/containers/recent-status';
const statuses = {
  statuses: { web: 'updated' },
  statusesByIdentity: { 'edge/local/web': 'failed' },
};
const server = { version: '1.8.0', configuration: { feature: { containeractions: false } } };
let wrapper: VueWrapper | undefined;

function successfulResponse(input: RequestInfo | URL): Response {
  if (input === url) return Response.json(statuses);
  if (input === '/api/v1/server') return Response.json(server);
  if (input === '/api/v1/settings')
    return Response.json({ updateMode: 'manual', internetlessMode: true });
  if (input === '/api/v1/approvals/summary') return Response.json({ pending: 0 });
  if (input === '/api/v1/stats/summary')
    return Response.json({
      data: {
        timestamp: '2026-09-16T00:00:00Z',
        watchedCount: 0,
        avgCpuPercent: 0,
        totalMemoryUsageBytes: 0,
        totalMemoryLimitBytes: 0,
        totalMemoryPercent: 0,
        topCpu: [],
        topMemory: [],
      },
    });
  if (
    ['/api/v1/containers', '/api/v1/agents', '/api/v1/watchers', '/api/v1/registries'].includes(
      String(input),
    )
  ) {
    return Response.json({ data: [], total: 0 });
  }
  throw new Error(`Unexpected request: ${String(input)}`);
}

async function mountView(component: Parameters<typeof mount>[0]) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  });
  await router.push('/');
  wrapper = mount(component, {
    global: {
      plugins: [router, createPinia()],
      stubs: { ...dataViewStubs, AppIcon: true, DashboardGrid: true },
    },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  resetPreferences();
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  resetPreferences();
  i18n.global.locale.value = originalLocale;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each(['fr', 'ar'] as const)('Dashboard recent-status errors in %s', (locale) => {
  beforeEach(() => {
    i18n.global.locale.value = locale;
  });

  it('shows the real HTTP service failure and recovers on the same Retry button', async () => {
    let failing = true;
    vi.mocked(fetch).mockImplementation(async (input) =>
      input === url && failing ? new Response(null, { status: 503 }) : successfulResponse(input),
    );
    const view = await mountView(DashboardView);
    expect(view.text()).toContain(`${i18n.global.t('dashboardView.dataLoadFailed')} (HTTP 503)`);
    expect(vi.mocked(fetch).mock.calls.filter(([input]) => input === url)).toHaveLength(1);
    const retry = view
      .findAll('button')
      .find((button) => button.text() === i18n.global.t('common.retry'));
    expect(retry).toBeDefined();
    failing = false;
    await retry?.trigger('click');
    await flushPromises();
    expect(view.text()).not.toContain('(HTTP 503)');
    expect(vi.mocked(fetch).mock.calls.filter(([input]) => input === url)).toHaveLength(2);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every(([, options]) => !options?.method || options.method === 'GET'),
    ).toBe(true);
  });

  it('preserves both status maps during background failures and recovers without refetching fresh static data', async () => {
    let failing = false;
    vi.mocked(fetch).mockImplementation(async (input) =>
      input === url && failing
        ? new Response(null, { status: 502, statusText: 'Upstream unavailable' })
        : successfulResponse(input),
    );
    let data!: ReturnType<typeof useDashboardData>;
    await mountView(
      defineComponent({
        setup() {
          data = useDashboardData();
          return {};
        },
        template: '<div />',
      }),
    );
    expect(data.recentStatusByContainer.value).toEqual(statuses.statuses);
    expect(data.recentStatusByIdentity.value).toEqual(statuses.statusesByIdentity);
    failing = true;
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    await data.fetchDashboardData({ background: true, skipStaticIfFresh: true });
    expect(data.error.value).toBeNull();
    expect(data.loading.value).toBe(false);
    expect(data.serverInfo.value).toEqual(server);
    expect(data.recentStatusByContainer.value).toEqual(statuses.statuses);
    expect(data.recentStatusByIdentity.value).toEqual(statuses.statusesByIdentity);
    expect(debug).toHaveBeenCalledWith(
      `${i18n.global.t('dashboardView.dataLoadFailed')} (HTTP 502): Upstream unavailable`,
    );
    failing = false;
    await data.fetchDashboardData({ background: true, skipStaticIfFresh: true });
    expect(data.error.value).toBeNull();
    expect(vi.mocked(fetch).mock.calls.filter(([input]) => input === url)).toHaveLength(3);
    for (const endpoint of [
      '/api/v1/server',
      '/api/v1/agents',
      '/api/v1/watchers',
      '/api/v1/registries',
    ]) {
      expect(vi.mocked(fetch).mock.calls.filter(([input]) => input === endpoint)).toHaveLength(1);
    }
  });
});
