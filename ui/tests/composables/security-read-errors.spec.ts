import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';
import { i18n } from '@/boot/i18n';
import { useSbomDetail } from '@/composables/useSbomDetail';
import { type ImageSummaryWithVulns, useVulnerabilities } from '@/composables/useVulnerabilities';
import { useContainerSecurity } from '@/views/containers/useContainerSecurity';

const originalLocale = i18n.global.locale.value;
let wrapper: VueWrapper | undefined;
const summary: ImageSummaryWithVulns = {
  image: 'nginx',
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  unknown: 0,
  total: 0,
  fixable: 0,
  vulns: [],
};
const sbom = {
  format: 'cyclonedx-json',
  generator: 'syft',
  image: 'nginx',
  generatedAt: '2026-09-16T00:00:00Z',
  document: { bomFormat: 'CycloneDX', components: [{ name: 'nginx' }] },
};

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  i18n.global.locale.value = originalLocale;
  vi.unstubAllGlobals();
});

describe.each(['fr', 'ar'] as const)('security read consumers in %s', (locale) => {
  beforeEach(() => {
    i18n.global.locale.value = locale;
  });

  it('exposes localized overview failures and clears them on an explicit successful read', async () => {
    const state = useVulnerabilities({
      securitySortField: ref('critical'),
      securitySortAsc: ref(false),
    });
    state.secFilterSeverity.value = 'HIGH';
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
    await state.fetchVulnerabilities();
    expect(state.error.value).toBe(
      `${i18n.global.t('containerComponents.vulnerabilities.loadFailed')} (HTTP 503)`,
    );
    expect(state.loading.value).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        totalContainers: 0,
        scannedContainers: 0,
        latestScannedAt: null,
        images: [],
      }),
    );
    await state.fetchVulnerabilities();
    expect(state.error.value).toBeNull();
    expect(state.secFilterSeverity.value).toBe('HIGH');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('preserves image selection and SBOM format through failure and explicit recovery', async () => {
    const state = useSbomDetail({ containerIdsByImage: ref({ nginx: ['container-1'] }) });
    state.selectedSbomFormat.value = 'cyclonedx-json';
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(null, { status: 502, statusText: 'Upstream unavailable' }),
    );
    state.openDetail(summary);
    await flushPromises();
    expect(state.detailSbomError.value).toBe(
      `${i18n.global.t('containerComponents.sbomDetail.loadFailed')} (container-1) (HTTP 502): Upstream unavailable`,
    );
    expect(state.detailSbomLoading.value).toBe(false);
    expect(state.detailOpen.value).toBe(true);
    expect(state.selectedImage.value?.image).toBe('nginx');
    expect(state.selectedSbomFormat.value).toBe('cyclonedx-json');
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      '/api/v1/containers/container-1/sbom?format=cyclonedx-json',
      { credentials: 'include' },
    );
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(sbom));
    await state.loadDetailSbom();
    expect(state.detailSbomError.value).toBeNull();
    expect(state.detailSbomDocument.value).toEqual(sbom.document);
    expect(state.detailSbomGeneratedAt.value).toBe(sbom.generatedAt);
    expect(fetch).toHaveBeenCalledTimes(2);
    state.handleDetailOpenChange(false);
  });

  it('exposes both container-detail read errors and recovers without issuing scan requests', async () => {
    let state!: ReturnType<typeof useContainerSecurity>;
    const selectedContainerId = ref<string | undefined>('container-1');
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
    wrapper = mount(
      defineComponent({
        setup() {
          state = useContainerSecurity({
            selectedContainerId,
            selectedContainerMeta: ref(undefined),
          });
          return {};
        },
        template: '<div />',
      }),
    );
    await flushPromises();
    expect(state.detailVulnerabilityError.value).toBe(
      `${i18n.global.t('containerComponents.security.loadVulnerabilitiesFailed')} (container-1) (HTTP 503)`,
    );
    expect(state.detailSbomError.value).toBe(
      `${i18n.global.t('containerComponents.sbomDetail.loadFailed')} (container-1) (HTTP 503)`,
    );
    expect(state.detailVulnerabilityLoading.value).toBe(false);
    expect(state.detailSbomLoading.value).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (input === '/api/v1/containers/container-1/vulnerabilities')
        return Response.json({
          vulnerabilities: [],
          summary: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
        });
      if (input === '/api/v1/containers/container-1/sbom?format=spdx-json')
        return Response.json(sbom);
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    await state.loadDetailSecurityData();
    expect(state.detailVulnerabilityError.value).toBeNull();
    expect(state.detailSbomError.value).toBeNull();
    expect(state.sbomDocument.value).toEqual(sbom.document);
    expect(selectedContainerId.value).toBe('container-1');
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every(([, options]) => !options?.method || options.method === 'GET'),
    ).toBe(true);
  });

  it('keeps network diagnostics intact in the overview consumer', async () => {
    const state = useVulnerabilities({
      securitySortField: ref('critical'),
      securitySortAsc: ref(false),
    });
    vi.mocked(fetch).mockRejectedValue(new Error('Connection unavailable'));
    await state.fetchVulnerabilities();
    expect(state.error.value).toBe('Connection unavailable');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
