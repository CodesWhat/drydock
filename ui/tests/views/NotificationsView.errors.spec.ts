import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '@/boot/i18n';
import NotificationsView from '@/views/NotificationsView.vue';
import { dataViewStubs } from '../helpers/data-view-stubs';

const originalLocale = i18n.global.locale.value;
let wrapper: ReturnType<typeof mount<typeof NotificationsView>>;

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  });
  await router.push('/?q=security');
  wrapper = mount(NotificationsView, {
    global: { plugins: [router], stubs: { ...dataViewStubs, AppIcon: true } },
  });
  await flushPromises();
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => {
  wrapper?.unmount();
  i18n.global.locale.value = originalLocale;
  vi.unstubAllGlobals();
});

describe.each(['fr', 'ar'] as const)('Notifications loading errors in %s', (locale) => {
  beforeEach(() => {
    i18n.global.locale.value = locale;
  });

  it.each([
    ['/api/v1/notifications', 'notificationsView.loadError'],
    ['/api/v1/triggers', 'triggersView.loadError'],
  ])('shows the real service error for %s with status and no mutations', async (url, key) => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      input === url ? new Response(null, { status: 503 }) : Response.json({ data: [] }),
    );
    await mountView();

    expect(wrapper.text()).toContain(`${i18n.global.t(key)} (HTTP 503)`);
    expect(wrapper.text()).not.toContain('Failed to get');
    expect(wrapper.text()).not.toContain(i18n.global.t('notificationsView.loadingRules'));
    expect((wrapper.get('input[type="text"]').element as HTMLInputElement).value).toBe('security');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith('/api/v1/notifications', { credentials: 'include' });
    expect(fetch).toHaveBeenCalledWith('/api/v1/triggers', { credentials: 'include' });
  });

  it('keeps the HTTP reason next to the translated load message', async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      input === '/api/v1/notifications'
        ? new Response('<html>Bad gateway</html>', {
            status: 502,
            statusText: 'Upstream unavailable',
          })
        : Response.json({ data: [] }),
    );
    await mountView();

    expect(wrapper.text()).toContain(
      `${i18n.global.t('notificationsView.loadError')} (HTTP 502): Upstream unavailable`,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('preserves network diagnostics without retrying or changing the filter', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (input === '/api/v1/notifications') throw new Error('Connection unavailable');
      return Response.json({ data: [] });
    });
    await mountView();

    expect(wrapper.text()).toContain('Connection unavailable');
    expect((wrapper.get('input[type="text"]').element as HTMLInputElement).value).toBe('security');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
