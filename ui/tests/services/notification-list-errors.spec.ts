import { i18n, SUPPORTED_LOCALES } from '@/boot/i18n';
import { getAllNotificationRules } from '@/services/notification';
import { getAllTriggers } from '@/services/trigger';

const lists = [
  {
    name: 'notification rules',
    run: getAllNotificationRules,
    key: 'notificationsView.loadError',
    url: '/api/v1/notifications',
  },
  { name: 'triggers', run: getAllTriggers, key: 'triggersView.loadError', url: '/api/v1/triggers' },
];
const originalLocale = i18n.global.locale.value;

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => {
  i18n.global.locale.value = originalLocale;
  vi.unstubAllGlobals();
});

describe.each(lists)('$name list failures', ({ run, key, url }) => {
  it.each(SUPPORTED_LOCALES)('uses the existing %s message and HTTP status', async (locale) => {
    i18n.global.locale.value = locale;
    expect(i18n.global.te(key, locale)).toBe(true);
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));

    await expect(run()).rejects.toThrow(`${i18n.global.t(key)} (HTTP 503)`);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(url, { credentials: 'include' });
  });

  it('retains the HTTP reason without parsing an unsuccessful body', async () => {
    i18n.global.locale.value = 'fr';
    const response = new Response('<html>Unavailable</html>', {
      status: 502,
      statusText: 'Upstream unavailable',
    });
    vi.mocked(fetch).mockResolvedValue(response);

    await expect(run()).rejects.toThrow(`${i18n.global.t(key)} (HTTP 502): Upstream unavailable`);
    expect(response.bodyUsed).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses the selected locale when the response arrives', async () => {
    i18n.global.locale.value = 'en';
    vi.mocked(fetch).mockImplementation(async () => {
      i18n.global.locale.value = 'ar';
      return new Response(null, { status: 403 });
    });

    await expect(run()).rejects.toThrow(`${i18n.global.t(key, {}, { locale: 'ar' })} (HTTP 403)`);
  });

  it('preserves network errors without retrying', async () => {
    const error = new Error('Connection unavailable');
    vi.mocked(fetch).mockRejectedValue(error);

    await expect(run()).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
