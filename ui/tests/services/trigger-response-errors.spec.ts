import { i18n, SUPPORTED_LOCALES } from '@/boot/i18n';
import { runTrigger } from '@/services/trigger';

const originalLocale = i18n.global.locale.value;
const request = {
  triggerType: 'http',
  triggerName: 'alerts/primary',
  triggerAgent: 'edge east',
  container: { id: 'test', name: 'Test container' },
};

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => {
  i18n.global.locale.value = originalLocale;
  vi.unstubAllGlobals();
});

describe('trigger execution error responses', () => {
  it.each(SUPPORTED_LOCALES)('handles a null error body in %s', async (locale) => {
    i18n.global.locale.value = locale;
    expect(i18n.global.te('triggersView.test.defaultError', locale)).toBe(true);
    vi.mocked(fetch).mockResolvedValue(Response.json(null, { status: 502 }));

    await expect(runTrigger(request)).rejects.toThrow(
      `${i18n.global.t('triggersView.test.defaultError')} (HTTP 502)`,
    );
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      '/api/v1/triggers/http/alerts%2Fprimary/edge%20east',
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.container),
      },
    );
  });

  it.each(
    [
      {},
      [],
      'unavailable',
      42,
      false,
      { error: null },
      { error: {} },
      { error: 7 },
      { error: false },
      { error: '' },
      { error: '  \n ' },
    ].map((payload) => ({ payload })),
  )('uses a useful fallback for unusable JSON error $payload', async ({ payload }) => {
    i18n.global.locale.value = 'fr';
    vi.mocked(fetch).mockResolvedValue(Response.json(payload, { status: 503 }));
    await expect(runTrigger(request)).rejects.toThrow(
      `${i18n.global.t('triggersView.test.defaultError')} (HTTP 503)`,
    );
  });

  it('preserves provider diagnostics exactly', async () => {
    const diagnostic = 'Error when running trigger http.alerts (Provider rejected request)';
    vi.mocked(fetch).mockResolvedValue(Response.json({ error: diagnostic }, { status: 500 }));
    await expect(runTrigger(request)).rejects.toThrow(diagnostic);
  });

  it('uses the locale selected when the response arrives', async () => {
    i18n.global.locale.value = 'en';
    vi.mocked(fetch).mockImplementation(async () => {
      i18n.global.locale.value = 'ar';
      return Response.json(null, { status: 500 });
    });
    await expect(runTrigger(request)).rejects.toThrow(
      `${i18n.global.t('triggersView.test.defaultError', {}, { locale: 'ar' })} (HTTP 500)`,
    );
  });

  it('keeps exact HTTP 200 success semantics', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({}, { status: 201 }));
    await expect(runTrigger(request)).rejects.toThrow('(HTTP 201)');
  });

  it.each([null, { success: true, detail: 'complete' }])(
    'preserves successful data %j',
    async (payload) => {
      vi.mocked(fetch).mockResolvedValue(Response.json(payload));
      await expect(runTrigger({ ...request, triggerAgent: undefined })).resolves.toEqual(payload);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/triggers/http/alerts%2Fprimary',
        expect.any(Object),
      );
    },
  );

  it('preserves network errors without retrying a POST', async () => {
    const error = new Error('Connection interrupted');
    vi.mocked(fetch).mockRejectedValue(error);
    await expect(runTrigger(request)).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['text/html', '<html>Proxy failure</html>', 'html'],
    ['application/json', '{', 'invalidJson'],
  ])('preserves normalized %s parsing failures', async (contentType, body, key) => {
    i18n.global.locale.value = 'fr';
    vi.mocked(fetch).mockResolvedValue(
      new Response(body, { status: 502, headers: { 'Content-Type': contentType } }),
    );
    await expect(runTrigger(request)).rejects.toThrow(
      i18n.global.t(`common.apiResponse.${key}`, { context: 'API' }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
