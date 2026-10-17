import { i18n, SUPPORTED_LOCALES } from '@/boot/i18n';
import { getContainerRecentStatus } from '@/services/container';

const originalLocale = i18n.global.locale.value;
const key = 'dashboardView.dataLoadFailed';

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => {
  i18n.global.locale.value = originalLocale;
  vi.unstubAllGlobals();
});

it.each(SUPPORTED_LOCALES)('uses the existing %s fallback and HTTP status', async (locale) => {
  i18n.global.locale.value = locale;
  expect(i18n.global.te(key, locale)).toBe(true);
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));

  await expect(getContainerRecentStatus()).rejects.toThrow(`${i18n.global.t(key)} (HTTP 503)`);
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/v1/containers/recent-status', {
    credentials: 'include',
  });
});

it('preserves the reason phrase without reading an unsuccessful response body', async () => {
  i18n.global.locale.value = 'fr';
  const response = new Response('<html>Gateway unavailable</html>', {
    status: 502,
    statusText: 'Upstream unavailable',
  });
  vi.mocked(fetch).mockResolvedValue(response);
  await expect(getContainerRecentStatus()).rejects.toThrow(
    `${i18n.global.t(key)} (HTTP 502): Upstream unavailable`,
  );
  expect(response.bodyUsed).toBe(false);
});

it('uses the selected locale when the response arrives', async () => {
  i18n.global.locale.value = 'en';
  vi.mocked(fetch).mockImplementation(async () => {
    i18n.global.locale.value = 'ar';
    return new Response(null, { status: 403 });
  });
  await expect(getContainerRecentStatus()).rejects.toThrow(
    `${i18n.global.t(key, {}, { locale: 'ar' })} (HTTP 403)`,
  );
});

it('preserves successful name and identity status maps', async () => {
  const result = {
    statuses: { web: 'updated' },
    statusesByIdentity: { 'edge/local/web': 'failed' },
  };
  vi.mocked(fetch).mockResolvedValue(Response.json(result));
  await expect(getContainerRecentStatus()).resolves.toEqual(result);
});

it('preserves network diagnostics without an automatic retry', async () => {
  const error = new Error('Connection unavailable');
  vi.mocked(fetch).mockRejectedValue(error);
  await expect(getContainerRecentStatus()).rejects.toBe(error);
  expect(fetch).toHaveBeenCalledTimes(1);
});
