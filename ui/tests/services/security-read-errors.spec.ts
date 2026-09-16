import { i18n, SUPPORTED_LOCALES } from '@/boot/i18n';
import {
  getContainerSbom,
  getContainerVulnerabilities,
  getSecurityVulnerabilityOverview,
} from '@/services/container';

const operations = [
  {
    name: 'overview',
    run: getSecurityVulnerabilityOverview,
    key: 'containerComponents.vulnerabilities.loadFailed',
    context: '',
    url: '/api/v1/containers/security/vulnerabilities',
  },
  {
    name: 'container vulnerabilities',
    run: () => getContainerVulnerabilities('container-1'),
    key: 'containerComponents.security.loadVulnerabilitiesFailed',
    context: ' (container-1)',
    url: '/api/v1/containers/container-1/vulnerabilities',
  },
  {
    name: 'SBOM',
    run: () => getContainerSbom('container-1', 'custom + format'),
    key: 'containerComponents.sbomDetail.loadFailed',
    context: ' (container-1)',
    url: '/api/v1/containers/container-1/sbom?format=custom%20%2B%20format',
  },
];
const originalLocale = i18n.global.locale.value;
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => {
  i18n.global.locale.value = originalLocale;
  vi.unstubAllGlobals();
});

describe.each(operations)('$name errors', ({ run, key, context, url }) => {
  it.each(SUPPORTED_LOCALES)(
    'uses the existing %s translation with HTTP status',
    async (locale) => {
      i18n.global.locale.value = locale;
      expect(i18n.global.te(key, locale)).toBe(true);
      vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
      await expect(run()).rejects.toThrow(`${i18n.global.t(key)}${context} (HTTP 503)`);
      expect(fetch).toHaveBeenCalledExactlyOnceWith(url, { credentials: 'include' });
    },
  );

  it('retains the HTTP reason phrase without depending on error-body JSON', async () => {
    i18n.global.locale.value = 'fr';
    vi.mocked(fetch).mockResolvedValue(
      new Response('<html>Unavailable</html>', { status: 502, statusText: 'Upstream unavailable' }),
    );
    await expect(run()).rejects.toThrow(
      `${i18n.global.t(key)}${context} (HTTP 502): Upstream unavailable`,
    );
  });

  it('uses the current locale when a pending request fails', async () => {
    i18n.global.locale.value = 'en';
    vi.mocked(fetch).mockImplementation(async () => {
      i18n.global.locale.value = 'ar';
      return new Response(null, { status: 503 });
    });
    await expect(run()).rejects.toThrow(
      `${i18n.global.t(key, {}, { locale: 'ar' })}${context} (HTTP 503)`,
    );
  });

  it('preserves network failures without retrying', async () => {
    const failure = new Error('Connection unavailable');
    vi.mocked(fetch).mockRejectedValue(failure);
    await expect(run()).rejects.toBe(failure);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(url, { credentials: 'include' });
  });
});
