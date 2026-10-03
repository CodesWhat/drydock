import { i18n, SUPPORTED_LOCALES } from '@/boot/i18n';
import {
  getContainerTriggersWithReasons,
  getContainerUpdateOperations,
} from '@/services/container';
import { getContainerStats } from '@/services/stats';

const originalLocale = i18n.global.locale.value;
const operations = [
  {
    name: 'stats',
    run: getContainerStats,
    key: 'containerComponents.stats.loadFailed',
    suffix: 'stats',
  },
  {
    name: 'triggers',
    run: getContainerTriggersWithReasons,
    key: 'containerComponents.triggers.toasts.loadFailed',
    suffix: 'triggers',
  },
  {
    name: 'update history',
    run: getContainerUpdateOperations,
    key: 'containerComponents.backups.operationHistoryLoadFailed',
    suffix: 'update-operations',
  },
];

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => {
  i18n.global.locale.value = originalLocale;
  vi.unstubAllGlobals();
});

describe.each(operations)('$name read errors', ({ run, key, suffix }) => {
  it.each(SUPPORTED_LOCALES)(
    'uses the existing %s message with container and HTTP context',
    async (locale) => {
      i18n.global.locale.value = locale;
      expect(i18n.global.te(key, locale)).toBe(true);
      vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
      await expect(run('c1')).rejects.toThrow(`${i18n.global.t(key)} (c1) (HTTP 503)`);
      expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/v1/containers/c1/${suffix}`, {
        credentials: 'include',
      });
    },
  );

  it('preserves the HTTP reason without reading the failed body', async () => {
    i18n.global.locale.value = 'fr';
    const response = new Response('<html>Gateway failed</html>', {
      status: 502,
      statusText: 'Upstream unavailable',
    });
    vi.mocked(fetch).mockResolvedValue(response);
    await expect(run('c1')).rejects.toThrow(
      `${i18n.global.t(key)} (c1) (HTTP 502): Upstream unavailable`,
    );
    expect(response.bodyUsed).toBe(false);
  });

  it('uses the locale selected when the response arrives', async () => {
    i18n.global.locale.value = 'en';
    vi.mocked(fetch).mockImplementation(async () => {
      i18n.global.locale.value = 'ar';
      return new Response(null, { status: 403 });
    });
    await expect(run('c1')).rejects.toThrow(
      `${i18n.global.t(key, {}, { locale: 'ar' })} (c1) (HTTP 403)`,
    );
  });

  it('preserves network errors without retrying', async () => {
    const error = new Error('Connection unavailable');
    vi.mocked(fetch).mockRejectedValue(error);
    await expect(run('c1')).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

it('retains encoded stats paths and original container identity in the error', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 404 }));
  await expect(getContainerStats('edge/container 1')).rejects.toThrow(
    '(edge/container 1) (HTTP 404)',
  );
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/v1/containers/edge%2Fcontainer%201/stats', {
    credentials: 'include',
  });
});
