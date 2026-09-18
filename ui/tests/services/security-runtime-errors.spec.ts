import { i18n, SUPPORTED_LOCALES } from '@/boot/i18n';
import { getSecurityRuntime, manageSecurityAsset } from '@/services/server';

const operations = [
  {
    name: 'runtime status',
    run: getSecurityRuntime,
    key: 'securityView.runtimeLoadError',
    url: '/api/v1/server/security/runtime',
    options: { credentials: 'include' },
  },
  {
    name: 'asset operation',
    run: () => manageSecurityAsset('grype', 'warm'),
    key: 'securityView.runtimeTools.assetOperationFailed',
    url: '/api/v1/server/security/assets/grype/warm',
    options: { method: 'POST', credentials: 'include' },
  },
];
const originalLocale = i18n.global.locale.value;
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => {
  i18n.global.locale.value = originalLocale;
  vi.unstubAllGlobals();
});

describe.each(operations)('$name errors', ({ run, key, url, options }) => {
  it.each(SUPPORTED_LOCALES)('uses the existing %s message with HTTP status', async (locale) => {
    i18n.global.locale.value = locale;
    expect(i18n.global.te(key, locale)).toBe(true);
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
    await expect(run()).rejects.toThrow(`${i18n.global.t(key)} (HTTP 503)`);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(url, options);
  });

  it.each([null, {}, { error: '' }, { error: 5 }, { error: {} }])(
    'retains status with unusable error body %j',
    async (body) => {
      i18n.global.locale.value = 'fr';
      vi.mocked(fetch).mockResolvedValue(Response.json(body, { status: 502 }));
      await expect(run()).rejects.toThrow(`${i18n.global.t(key)} (HTTP 502)`);
    },
  );

  it('retains reason phrases and server diagnostics verbatim', async () => {
    i18n.global.locale.value = 'ar';
    vi.mocked(fetch).mockResolvedValue(
      Response.json(
        { error: '  provider unavailable  ' },
        { status: 502, statusText: 'Bad gateway' },
      ),
    );
    await expect(run()).rejects.toThrow(
      `${i18n.global.t(key)} (HTTP 502): Bad gateway (  provider unavailable  )`,
    );
  });

  it('handles invalid JSON without losing status', async () => {
    i18n.global.locale.value = 'fr';
    vi.mocked(fetch).mockResolvedValue(new Response('<html>Unavailable</html>', { status: 503 }));
    await expect(run()).rejects.toThrow(`${i18n.global.t(key)} (HTTP 503)`);
  });

  it('uses the locale selected when the response arrives', async () => {
    i18n.global.locale.value = 'en';
    vi.mocked(fetch).mockImplementation(async () => {
      i18n.global.locale.value = 'fr';
      return new Response(null, { status: 503 });
    });
    await expect(run()).rejects.toThrow(`${i18n.global.t(key, {}, { locale: 'fr' })} (HTTP 503)`);
  });

  it('preserves network errors without retrying', async () => {
    const error = new Error('Connection unavailable');
    vi.mocked(fetch).mockRejectedValue(error);
    await expect(run()).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
