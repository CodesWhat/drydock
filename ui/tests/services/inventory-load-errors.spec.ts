import { i18n, SUPPORTED_LOCALES } from '@/boot/i18n';
import { getAgents } from '@/services/agent';
import { getAllContainers, refreshAllContainers } from '@/services/container';

const operations = [
  {
    name: 'containers',
    run: () => getAllContainers(),
    key: 'containersView.error.loadFailed',
    url: '/api/v1/containers',
    options: { credentials: 'include' },
  },
  {
    name: 'container recheck',
    run: refreshAllContainers,
    key: 'containersView.error.recheckFailed',
    url: '/api/v1/containers/watch',
    options: { method: 'POST', credentials: 'include' },
  },
  {
    name: 'agents',
    run: getAgents,
    key: 'agentsView.list.loadError',
    url: '/api/v1/agents',
    options: { credentials: 'include' },
  },
];
const originalLocale = i18n.global.locale.value;

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => {
  i18n.global.locale.value = originalLocale;
  vi.unstubAllGlobals();
});

describe.each(operations)('$name failures', ({ run, key, url, options }) => {
  it.each(SUPPORTED_LOCALES)(
    'uses the existing %s message and numeric HTTP status',
    async (locale) => {
      i18n.global.locale.value = locale;
      expect(i18n.global.te(key, locale)).toBe(true);
      vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));

      await expect(run()).rejects.toThrow(`${i18n.global.t(key)} (HTTP 503)`);
      expect(fetch).toHaveBeenCalledExactlyOnceWith(url, options);
    },
  );

  it('preserves the HTTP reason without consuming the failure body', async () => {
    i18n.global.locale.value = 'fr';
    const response = new Response('<html>Bad gateway</html>', {
      status: 502,
      statusText: 'Upstream unavailable',
    });
    vi.mocked(fetch).mockResolvedValue(response);

    await expect(run()).rejects.toThrow(`${i18n.global.t(key)} (HTTP 502): Upstream unavailable`);
    expect(response.bodyUsed).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses the locale selected when the response arrives', async () => {
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

it('preserves container query options and the caller abort signal on failure', async () => {
  i18n.global.locale.value = 'fr';
  const controller = new AbortController();
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
  await expect(
    getAllContainers({
      includeVulnerabilities: true,
      limit: 20,
      offset: 5,
      signal: controller.signal,
    }),
  ).rejects.toThrow(`${i18n.global.t('containersView.error.loadFailed')} (HTTP 503)`);
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    '/api/v1/containers?includeVulnerabilities=true&limit=20&offset=5',
    { credentials: 'include', signal: controller.signal },
  );
});

it('preserves an abort error from the caller signal', async () => {
  const controller = new AbortController();
  controller.abort();
  vi.mocked(fetch).mockRejectedValue(controller.signal.reason);
  await expect(getAllContainers(controller.signal)).rejects.toBe(controller.signal.reason);
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/v1/containers', {
    credentials: 'include',
    signal: controller.signal,
  });
});
