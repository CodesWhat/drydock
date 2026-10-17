import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '@/boot/i18n';
import { resetDependencyGraphState } from '@/composables/useDependencyGraph';
import { resetPreferences } from '@/preferences/store';
import AgentsView from '@/views/AgentsView.vue';
import ContainersView from '@/views/ContainersView.vue';
import { dataViewStubs } from '../helpers/data-view-stubs';

const originalLocale = i18n.global.locale.value;
let wrapper: VueWrapper | undefined;

function successfulResponse(input: RequestInfo | URL): Response {
  if (input === '/api/v1/server')
    return Response.json({ configuration: { feature: { containeractions: true } } });
  if (input === '/api/v1/settings')
    return Response.json({ updateMode: 'manual', internetlessMode: false });
  if (input === '/api/v1/containers/dependencies')
    return Response.json({ nodes: [], edges: [], cycles: [] });
  if (
    [
      '/api/v1/containers',
      '/api/v1/agents',
      '/api/v1/agents/roster',
      '/api/v1/watchers',
      '/api/v1/triggers',
    ].includes(String(input))
  )
    return Response.json({ data: [], total: 0 });
  throw new Error(`Unexpected request: ${String(input)}`);
}

async function mountView(component: typeof AgentsView | typeof ContainersView) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  });
  await router.push('/?q=security');
  wrapper = mount(component, {
    global: {
      plugins: [router, createPinia()],
      stubs: {
        ...dataViewStubs,
        AppIcon: true,
        ContainerIcon: true,
        ContainerSideDetail: true,
        ContainerFullPageDetail: true,
        ContainerGroupDialog: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  resetPreferences();
  resetDependencyGraphState();
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  resetDependencyGraphState();
  resetPreferences();
  i18n.global.locale.value = originalLocale;
  vi.unstubAllGlobals();
});

describe.each(['fr', 'ar'] as const)('inventory errors in %s', (locale) => {
  beforeEach(() => {
    i18n.global.locale.value = locale;
  });

  it.each([
    {
      name: 'containers',
      component: ContainersView,
      url: '/api/v1/containers',
      key: 'containersView.error.loadFailed',
    },
    {
      name: 'agents',
      component: AgentsView,
      url: '/api/v1/agents',
      key: 'agentsView.list.loadError',
    },
  ])('renders the actual $name service error with HTTP status', async ({ component, url, key }) => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      input === url ? new Response(null, { status: 503 }) : successfulResponse(input),
    );
    const view = await mountView(component);
    expect(view.text()).toContain(`${i18n.global.t(key)} (HTTP 503)`);
    expect(view.text()).not.toContain('Failed to get');
    expect(fetch).toHaveBeenCalledWith(url, { credentials: 'include' });
    expect(vi.mocked(fetch).mock.calls.filter(([input]) => input === url)).toHaveLength(1);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every(([, options]) => !options?.method || options.method === 'GET'),
    ).toBe(true);
  });

  it('renders a failed recheck and re-enables its button without retrying', async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      input === '/api/v1/containers/watch'
        ? new Response(null, { status: 502, statusText: 'Upstream unavailable' })
        : successfulResponse(input),
    );
    const view = await mountView(ContainersView);
    const button = view.get(
      `button[aria-label="${i18n.global.t('containerComponents.listContent.recheckTooltip')}"]`,
    );
    await button.trigger('click');
    await flushPromises();
    expect(view.text()).toContain(
      `${i18n.global.t('containersView.error.recheckFailed')} (HTTP 502): Upstream unavailable`,
    );
    expect(button.attributes('disabled')).toBeUndefined();
    expect(fetch).toHaveBeenCalledWith('/api/v1/containers/watch', {
      method: 'POST',
      credentials: 'include',
    });
    expect(
      vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST'),
    ).toHaveLength(1);
    expect(
      vi.mocked(fetch).mock.calls.filter(([input]) => input === '/api/v1/containers'),
    ).toHaveLength(1);
  });

  it('preserves network diagnostics and the agent search filter', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (input === '/api/v1/agents') throw new Error('Connection unavailable');
      return successfulResponse(input);
    });
    const view = await mountView(AgentsView);
    expect(view.text()).toContain('Connection unavailable');
    expect((view.get('input[type="text"]').element as HTMLInputElement).value).toBe('security');
    expect(
      vi.mocked(fetch).mock.calls.filter(([input]) => input === '/api/v1/agents'),
    ).toHaveLength(1);
  });
});
