import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '@/boot/i18n';
import { resetPreferences } from '@/preferences/store';
import SecurityView from '@/views/SecurityView.vue';
import type { SecurityRuntimeStatus } from '@/views/security/securityViewTypes';
import { dataViewStubs } from '../helpers/data-view-stubs';

const runtimeUrl = '/api/v1/server/security/runtime';
const originalLocale = i18n.global.locale.value;
let wrapper: VueWrapper | undefined;
const readyRuntime: SecurityRuntimeStatus = {
  checkedAt: '2026-09-16T00:00:00Z',
  ready: true,
  backend: 'docker',
  availabilityPolicy: 'block',
  gate: { mode: 'on', allowNoWorse: false },
  scanner: {
    enabled: true,
    command: 'trivy',
    commandAvailable: true,
    status: 'ready',
    message: 'Ready',
    scanner: 'trivy',
    server: '',
  },
  signature: {
    enabled: false,
    command: '',
    commandAvailable: null,
    status: 'disabled',
    message: '',
  },
  sbom: { enabled: false, formats: [], generator: 'trivy' },
  providers: [],
  requirements: [],
  assets: [
    { provider: 'grype', backend: 'docker', configuredImage: 'example/grype', state: 'missing' },
  ],
};

function successfulResponse(input: RequestInfo | URL): Response {
  if (input === runtimeUrl) return Response.json(readyRuntime);
  if (input === '/api/v1/settings')
    return Response.json({ updateMode: 'manual', internetlessMode: false });
  if (input === '/api/v1/containers') return Response.json({ data: [], total: 0 });
  if (input === '/api/v1/containers/security/vulnerabilities')
    return Response.json({
      totalContainers: 0,
      scannedContainers: 0,
      latestScannedAt: null,
      images: [],
    });
  throw new Error(`Unexpected request: ${String(input)}`);
}

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  });
  await router.push('/');
  wrapper = mount(SecurityView, {
    global: {
      plugins: [router, createPinia()],
      stubs: {
        ...dataViewStubs,
        AppIcon: true,
        SecurityDetailPanel: true,
        SecurityContainerChooser: true,
        ContainerUpdateDialog: true,
      },
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
});

describe.each(['fr', 'ar'] as const)('runtime failure feedback in %s', (locale) => {
  beforeEach(() => {
    i18n.global.locale.value = locale;
  });

  it('shows a failed runtime read and recovers through an explicit read-only retry', async () => {
    let attempts = 0;
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (input === runtimeUrl && attempts++ === 0) return new Response(null, { status: 503 });
      return successfulResponse(input);
    });
    const view = await mountView();
    expect(view.get('[role="alert"]').text()).toContain(
      `${i18n.global.t('securityView.runtimeLoadError')} (HTTP 503)`,
    );
    expect(
      view.get('[data-testid="security-empty-scan-now"]').attributes('disabled'),
    ).toBeUndefined();
    const filter = view.get('select');
    await filter.setValue('HIGH');
    const callsBefore = vi.mocked(fetch).mock.calls.length;
    const retry = view.get('[role="alert"] button');
    expect(retry.text()).toBe(i18n.global.t('common.retry'));
    await retry.trigger('click');
    await flushPromises();
    expect(view.find('[role="alert"]').exists()).toBe(false);
    expect((filter.element as HTMLSelectElement).value).toBe('HIGH');
    expect(vi.mocked(fetch).mock.calls.slice(callsBefore)).toEqual([
      [runtimeUrl, { credentials: 'include' }],
    ]);
  });

  it('keeps a repeated read failure visible without an automatic retry', async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      input === runtimeUrl
        ? new Response('<html>Unavailable</html>', { status: 502 })
        : successfulResponse(input),
    );
    const view = await mountView();
    expect(view.get('[role="alert"]').text()).toContain('(HTTP 502)');
    await view.get('[role="alert"] button').trigger('click');
    await flushPromises();
    expect(view.get('[role="alert"]').text()).toContain(
      `${i18n.global.t('securityView.runtimeLoadError')} (HTTP 502)`,
    );
    expect(vi.mocked(fetch).mock.calls.filter(([input]) => input === runtimeUrl)).toHaveLength(2);
  });

  it('renders a failed asset operation and retains its existing retry control', async () => {
    const assetUrl = '/api/v1/server/security/assets/grype/pull';
    vi.mocked(fetch).mockImplementation(async (input) =>
      input === assetUrl
        ? Response.json(
            { error: 'pull denied <b>diagnostic</b>' },
            { status: 503, statusText: 'Unavailable' },
          )
        : successfulResponse(input),
    );
    const view = await mountView();
    const label = i18n.global.t('securityView.runtimeTools.pullAsset', { provider: 'grype' });
    const button = view.findAll('button').find((candidate) => candidate.text() === label);
    expect(button).toBeDefined();
    await button?.trigger('click');
    await flushPromises();
    const alert = view.get('[role="alert"]');
    expect(alert.text()).toContain(
      `${i18n.global.t('securityView.runtimeTools.assetOperationFailed')} (HTTP 503): Unavailable (pull denied <b>diagnostic</b>)`,
    );
    expect(alert.find('b').exists()).toBe(false);
    expect(alert.find('button').exists()).toBe(false);
    expect(button?.attributes('disabled')).toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(assetUrl, { method: 'POST', credentials: 'include' });
    expect(
      vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST'),
    ).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls.filter(([input]) => input === runtimeUrl)).toHaveLength(1);
  });

  it('shows network diagnostics when the runtime request cannot complete', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (input === runtimeUrl) throw new Error('Connection unavailable');
      return successfulResponse(input);
    });
    const view = await mountView();
    expect(view.get('[role="alert"]').text()).toContain('Connection unavailable');
    expect(vi.mocked(fetch).mock.calls.filter(([input]) => input === runtimeUrl)).toHaveLength(1);
  });
});
