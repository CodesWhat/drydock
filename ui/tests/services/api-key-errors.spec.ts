import { i18n, SUPPORTED_LOCALES } from '@/boot/i18n';
import { createApiKey, listApiKeys, revokeApiKey } from '@/services/api-key';

const operations = [
  { name: 'load', run: () => listApiKeys() },
  { name: 'create', run: () => createApiKey({ name: 'ci', scopes: ['read'] }) },
  { name: 'revoke', run: () => revokeApiKey('a1b2c3d4e5f6') },
] as const;
const originalLocale = i18n.global.locale.value;

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => {
  i18n.global.locale.value = originalLocale;
  vi.unstubAllGlobals();
});

describe.each(operations)('API key $name errors', ({ name, run }) => {
  it.each(SUPPORTED_LOCALES)('uses the existing %s translation and HTTP status', async (locale) => {
    i18n.global.locale.value = locale;
    const key = `configView.apiKeys.errors.${name}`;
    expect(i18n.global.te(key, locale)).toBe(true);
    vi.mocked(fetch).mockResolvedValue(new Response('null', { status: 503 }));

    await expect(run()).rejects.toThrow(`${i18n.global.t(key)} (HTTP 503)`);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    'null',
    '{}',
    '{"error":42}',
    '{"error":null}',
    '{"error":""}',
    '{"error":" \\t\\n"}',
    'false',
    '"text"',
    '<html>Bad gateway</html>',
    '{',
  ])('uses a useful fallback for response %s', async (body) => {
    i18n.global.locale.value = 'fr';
    vi.mocked(fetch).mockResolvedValue(new Response(body, { status: 502 }));

    await expect(run()).rejects.toThrow(
      `${i18n.global.t(`configView.apiKeys.errors.${name}`)} (HTTP 502)`,
    );
  });

  it('preserves a nonblank server diagnostic verbatim', async () => {
    i18n.global.locale.value = 'ar';
    const message = '  API key is missing the required scope  ';
    vi.mocked(fetch).mockResolvedValue(Response.json({ error: message }, { status: 403 }));

    await expect(run()).rejects.toHaveProperty('message', message);
  });

  it('preserves network failures without retrying', async () => {
    const error = new Error('Network unavailable');
    vi.mocked(fetch).mockRejectedValue(error);

    await expect(run()).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('resolves the locale after the request completes', async () => {
    i18n.global.locale.value = 'fr';
    vi.mocked(fetch).mockImplementation(async () => {
      i18n.global.locale.value = 'ar';
      return new Response('{}', { status: 500 });
    });

    await expect(run()).rejects.toThrow(
      `${i18n.global.t(`configView.apiKeys.errors.${name}`, {}, { locale: 'ar' })} (HTTP 500)`,
    );
  });
});
