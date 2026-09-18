import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '@/boot/i18n';
import { useUpdateMode } from '@/composables/useUpdateMode';
import { preferences, resetPreferences } from '@/preferences/store';
import ConfigView from '@/views/ConfigView.vue';
import { dataViewStubs } from '../helpers/data-view-stubs';

const originalLocale = i18n.global.locale.value;
const state = useUpdateMode({ autoLoad: false });
let wrapper: VueWrapper | undefined;
let failOperation: 'get' | 'save' | null;
let unexpectedRequests: string[];

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  });
  await router.push('/');
  wrapper = mount(ConfigView, {
    global: {
      plugins: [router],
      stubs: { ...dataViewStubs, AppIcon: true, ToggleSwitch: true },
    },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(async () => {
  resetPreferences();
  failOperation = null;
  unexpectedRequests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      if (input === '/api/v1/settings') {
        const saving = options?.method === 'PATCH';
        if (failOperation === (saving ? 'save' : 'get')) {
          return new Response('<html>Bad gateway</html>', { status: 502 });
        }
        return Response.json({ internetlessMode: true, updateMode: saving ? 'auto' : 'manual' });
      }
      if (input === '/api/v1/server')
        return Response.json({ configuration: { webhook: { enabled: true } } });
      if (input === '/api/v1/app') return Response.json({ name: 'drydock', version: '1.8.0' });
      if (input === '/api/v1/store')
        return Response.json({ configuration: { path: '/store', file: 'dd.sqlite' } });
      if (input === '/auth/user') return Response.json({ username: 'maintainer' });
      unexpectedRequests.push(String(input));
      throw new Error(`Unexpected request: ${String(input)}`);
    }),
  );
  await state.loadUpdateMode({ force: true });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  resetPreferences();
  i18n.global.locale.value = originalLocale;
  vi.unstubAllGlobals();
  expect(unexpectedRequests).toEqual([]);
});

describe.each(['fr', 'ar'] as const)('Settings malformed HTTP responses in %s', (locale) => {
  beforeEach(() => {
    preferences.locale.language = locale;
    i18n.global.locale.value = locale;
  });

  it('renders the real refresh error and recovers without a write', async () => {
    const view = await mountView();
    failOperation = 'get';
    await state.loadUpdateMode({ force: true });
    await flushPromises();
    const message = `${i18n.global.t('common.apiResponse.invalidJson', { context: 'API' })} (HTTP 502)`;
    expect(view.text()).toContain(message);
    expect(view.text()).not.toContain('Unknown error');
    expect(view.get('[data-test="update-mode-manual"]').attributes('aria-pressed')).toBe('true');

    failOperation = null;
    await state.loadUpdateMode({ force: true });
    await flushPromises();
    expect(view.text()).not.toContain(message);
    expect(vi.mocked(fetch).mock.calls.every(([, options]) => !options?.method)).toBe(true);
  });

  it('keeps the saved mode after a failed click and permits an explicit retry', async () => {
    const view = await mountView();
    failOperation = 'save';
    await view.get('[data-test="update-mode-auto"]').trigger('click');
    await flushPromises();
    const message = `${i18n.global.t('common.apiResponse.invalidJson', { context: 'API' })} (HTTP 502)`;
    expect(view.text()).toContain(message);
    expect(view.get('[data-test="update-mode-manual"]').attributes('aria-pressed')).toBe('true');
    expect(view.get('[data-test="update-mode-auto"]').attributes('disabled')).toBeUndefined();
    expect(
      vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'PATCH'),
    ).toHaveLength(1);

    failOperation = null;
    await view.get('[data-test="update-mode-auto"]').trigger('click');
    await flushPromises();
    expect(view.text()).not.toContain(message);
    expect(view.get('[data-test="update-mode-auto"]').attributes('aria-pressed')).toBe('true');
    expect(
      vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'PATCH'),
    ).toEqual([
      [
        '/api/v1/settings',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ updateMode: 'auto' }),
        },
      ],
      [
        '/api/v1/settings',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ updateMode: 'auto' }),
        },
      ],
    ]);
  });
});
