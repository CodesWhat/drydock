import { i18n, SUPPORTED_LOCALES } from '@/boot/i18n';
import { CURRENT_SCHEMA_VERSION, DEFAULTS } from '@/preferences/schema';
import { previewNotificationTemplates, updateNotificationRule } from '@/services/notification';
import { getPreferences, updatePreferences } from '@/services/preferences';
import { clearIconCache, getSettings, updateSettings } from '@/services/settings';

const operations = [
  { name: 'get settings', run: getSettings },
  { name: 'update settings', run: () => updateSettings({ updateMode: 'manual' }) },
  { name: 'clear icon cache', run: clearIconCache },
  { name: 'get preferences', run: getPreferences },
  { name: 'update preferences', run: () => updatePreferences(CURRENT_SCHEMA_VERSION, DEFAULTS) },
  {
    name: 'update notification rule',
    run: () => updateNotificationRule('security-alert', { enabled: true }),
  },
  {
    name: 'preview notification templates',
    run: () => previewNotificationTemplates('security-alert', 'slack.ops', {}),
  },
];

describe.each(operations)('$name error responses', ({ run }) => {
  const originalFetch = globalThis.fetch;
  const originalLocale = i18n.global.locale.value;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    i18n.global.locale.value = originalLocale;
  });

  it.each([
    ['null', null],
    ['boolean', true],
    ['number', 42],
    ['string', 'not an envelope'],
    ['array', []],
    ['missing field', {}],
    ['null error', { error: null }],
    ['numeric error', { error: 42 }],
    ['object error', { error: { message: 'not a string' } }],
    ['array error', { error: ['not a string'] }],
    ['empty error', { error: '' }],
    ['blank error', { error: ' \t ' }],
  ])('preserves HTTP status for a %s body', async (_name, body) => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(run()).rejects.toThrow(new Error('HTTP 503'));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves a nonblank server diagnostic verbatim', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: '  Server diagnostic  ' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(run()).rejects.toThrow(new Error('  Server diagnostic  '));
  });

  it.each(SUPPORTED_LOCALES)(
    'localizes malformed JSON in %s and retains HTTP status',
    async (locale) => {
      i18n.global.locale.value = locale;
      expect(i18n.global.te('common.apiResponse.invalidJson', locale)).toBe(true);
      vi.mocked(fetch).mockResolvedValue(new Response('{broken', { status: 502 }));
      await expect(run()).rejects.toThrow(
        new Error(
          `${i18n.global.t('common.apiResponse.invalidJson', { context: 'API' })} (HTTP 502)`,
        ),
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('uses the locale selected when the malformed body arrives', async () => {
    i18n.global.locale.value = 'en';
    vi.mocked(fetch).mockImplementation(async () => {
      i18n.global.locale.value = 'ar';
      return new Response('<html>Bad gateway</html>', { status: 503 });
    });
    await expect(run()).rejects.toThrow(
      `${i18n.global.t('common.apiResponse.invalidJson', { context: 'API' }, { locale: 'ar' })} (HTTP 503)`,
    );
  });

  it('preserves transport failure identity', async () => {
    const failure = new TypeError('Network unavailable');
    vi.mocked(fetch).mockRejectedValue(failure);
    await expect(run()).rejects.toBe(failure);
  });
});
