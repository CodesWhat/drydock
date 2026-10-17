import { i18n, SUPPORTED_LOCALES } from '@/boot/i18n';
import { getAllRegistries } from '@/services/registry';
import { getServer } from '@/services/server';
import { getAllWatchers } from '@/services/watcher';

const operations = [
  { name: 'server', run: getServer, url: '/api/v1/server', key: 'serversView.loadError' },
  { name: 'watchers', run: getAllWatchers, url: '/api/v1/watchers', key: 'watchersView.loadError' },
  {
    name: 'registries',
    run: getAllRegistries,
    url: '/api/v1/registries',
    key: 'registriesView.loadError',
  },
];
const originalLocale = i18n.global.locale.value;
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => {
  i18n.global.locale.value = originalLocale;
  vi.unstubAllGlobals();
});

describe.each(operations)('$name loading errors', ({ run, url, key }) => {
  it.each(SUPPORTED_LOCALES)(
    'uses the existing %s translation and numeric status',
    async (locale) => {
      i18n.global.locale.value = locale;
      expect(i18n.global.te(key, locale)).toBe(true);
      vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
      await expect(run()).rejects.toThrow(`${i18n.global.t(key)} (HTTP 503)`);
      expect(fetch).toHaveBeenCalledExactlyOnceWith(url, { credentials: 'include' });
    },
  );

  it('retains the reason phrase without requiring a JSON error body', async () => {
    i18n.global.locale.value = 'fr';
    vi.mocked(fetch).mockResolvedValue(
      new Response('<html>Unavailable</html>', {
        status: 502,
        statusText: 'Upstream unavailable',
      }),
    );
    await expect(run()).rejects.toThrow(`${i18n.global.t(key)} (HTTP 502): Upstream unavailable`);
  });

  it('uses the locale selected while the request was pending', async () => {
    i18n.global.locale.value = 'en';
    vi.mocked(fetch).mockImplementation(async () => {
      i18n.global.locale.value = 'ar';
      return new Response(null, { status: 503 });
    });
    await expect(run()).rejects.toThrow(`${i18n.global.t(key, {}, { locale: 'ar' })} (HTTP 503)`);
  });

  it('preserves network errors and does not retry', async () => {
    const failure = new Error('Connection unavailable');
    vi.mocked(fetch).mockRejectedValue(failure);
    await expect(run()).rejects.toBe(failure);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(url, { credentials: 'include' });
  });
});
