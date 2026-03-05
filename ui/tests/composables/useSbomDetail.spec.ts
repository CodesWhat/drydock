import { ref } from 'vue';

const mockGetContainerSbom = vi.fn();

vi.mock('@/services/container', () => ({
  getContainerSbom: (...args: any[]) => mockGetContainerSbom(...args),
}));

import { useSbomDetail } from '@/composables/useSbomDetail';
import type { ImageSummaryWithVulns } from '@/composables/useVulnerabilities';

function makeSummary(overrides: Partial<ImageSummaryWithVulns> = {}): ImageSummaryWithVulns {
  return {
    image: 'nginx',
    critical: 1,
    high: 0,
    medium: 0,
    low: 1,
    unknown: 0,
    total: 2,
    fixable: 1,
    vulns: [
      {
        id: 'CVE-LOW',
        severity: 'LOW',
        package: 'zlib',
        version: '1.0.0',
        fixedIn: null,
        image: 'nginx',
        publishedDate: '',
      },
      {
        id: 'CVE-CRIT',
        severity: 'CRITICAL',
        package: 'openssl',
        version: '3.0.0',
        fixedIn: '3.0.11',
        image: 'nginx',
        publishedDate: '',
      },
    ],
    ...overrides,
  };
}

describe('useSbomDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens detail and loads sbom for the selected image', async () => {
    mockGetContainerSbom.mockResolvedValue({
      generatedAt: '2026-03-01T00:00:00.000Z',
      document: { spdxVersion: 'SPDX-2.3', packages: [{}] },
    });

    const state = useSbomDetail({
      containerIdsByImage: ref({ nginx: ['container-1'] }),
    });

    state.openDetail(makeSummary());

    await vi.waitFor(() => {
      expect(mockGetContainerSbom).toHaveBeenCalledWith('container-1', 'spdx-json');
    });

    expect(state.detailOpen.value).toBe(true);
    expect(state.selectedImage.value?.image).toBe('nginx');
    expect(state.detailSbomError.value).toBeNull();
    expect(state.detailSbomDocument.value).toEqual({ spdxVersion: 'SPDX-2.3', packages: [{}] });
    expect(state.detailSbomComponentCount.value).toBe(1);
  });

  it('counts CycloneDX components from the sbom document', async () => {
    mockGetContainerSbom.mockResolvedValue({
      generatedAt: '2026-03-01T00:00:00.000Z',
      document: { bomFormat: 'CycloneDX', components: [{}, {}, {}] },
    });

    const state = useSbomDetail({
      containerIdsByImage: ref({ nginx: ['container-1'] }),
    });

    state.openDetail(makeSummary());

    await vi.waitFor(() => {
      expect(mockGetContainerSbom).toHaveBeenCalledWith('container-1', 'spdx-json');
    });

    expect(state.detailSbomDocument.value).toEqual({
      bomFormat: 'CycloneDX',
      components: [{}, {}, {}],
    });
    expect(state.detailSbomComponentCount.value).toBe(3);
  });

  it('sets a helpful error when no container id can be resolved', async () => {
    const state = useSbomDetail({
      containerIdsByImage: ref({}),
    });

    state.openDetail(makeSummary());

    await Promise.resolve();
    expect(mockGetContainerSbom).not.toHaveBeenCalled();
    expect(state.detailSbomError.value).toBe(
      'No container identifier is available for this image.',
    );
    expect(state.detailSbomResult.value).toBeNull();
  });

  it('sorts selected image vulnerabilities by severity by default', () => {
    const state = useSbomDetail({
      containerIdsByImage: ref({ nginx: ['container-1'] }),
    });
    state.selectedImage.value = makeSummary();

    expect(state.selectedImageVulns.value.map((v) => v.id)).toEqual(['CVE-CRIT', 'CVE-LOW']);
  });

  it('reloads sbom using the currently selected format', async () => {
    mockGetContainerSbom
      .mockResolvedValueOnce({
        generatedAt: '2026-03-01T00:00:00.000Z',
        document: { spdxVersion: 'SPDX-2.3', packages: [{}] },
      })
      .mockResolvedValueOnce({
        generatedAt: '2026-03-01T00:00:00.000Z',
        document: { bomFormat: 'CycloneDX', components: [{}, {}] },
      });

    const state = useSbomDetail({
      containerIdsByImage: ref({ nginx: ['container-1'] }),
    });

    state.openDetail(makeSummary());

    await vi.waitFor(() => {
      expect(mockGetContainerSbom).toHaveBeenNthCalledWith(1, 'container-1', 'spdx-json');
    });
    expect(state.detailSbomComponentCount.value).toBe(1);

    state.selectedSbomFormat.value = 'cyclonedx-json';
    await state.loadDetailSbom();

    expect(mockGetContainerSbom).toHaveBeenNthCalledWith(2, 'container-1', 'cyclonedx-json');
    expect(state.detailSbomDocument.value).toEqual({
      bomFormat: 'CycloneDX',
      components: [{}, {}],
    });
    expect(state.detailSbomComponentCount.value).toBe(2);
  });

  it('downloads sbom json with a sanitized filename', () => {
    const createObjectUrl = vi.fn().mockReturnValue('blob:sbom-document');
    const revokeObjectUrl = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const appendChildSpy = vi.spyOn(document.body, 'appendChild');
    const removeChildSpy = vi.spyOn(document.body, 'removeChild');
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectUrl,
    });

    try {
      const state = useSbomDetail({
        containerIdsByImage: ref({ nginx: ['container-1'] }),
      });
      state.selectedImage.value = makeSummary({ image: 'ghcr.io/org/image:1.2.3' });
      state.selectedSbomFormat.value = 'cyclonedx-json';
      state.showSbomDocument.value = true;
      state.detailSbomResult.value = {
        document: {
          bomFormat: 'CycloneDX',
          components: [{ name: 'openssl' }],
        },
      };

      state.downloadDetailSbom();

      expect(createObjectUrl).toHaveBeenCalledOnce();
      expect(appendChildSpy).toHaveBeenCalledOnce();

      const link = appendChildSpy.mock.calls[0][0] as HTMLAnchorElement;
      expect(link.download).toBe('ghcr.io-org-image-1.2.3.cyclonedx-json.sbom.json');
      expect(link.getAttribute('href')).toBe('blob:sbom-document');

      expect(clickSpy).toHaveBeenCalledOnce();
      expect(removeChildSpy).toHaveBeenCalledWith(link);
      expect(revokeObjectUrl).toHaveBeenCalledWith('blob:sbom-document');
    } finally {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: originalCreateObjectURL,
      });
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: originalRevokeObjectURL,
      });
    }
  });

  it('does not throw when createObjectURL is unavailable', () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const createElementSpy = vi.spyOn(document, 'createElement');

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: undefined,
    });

    try {
      const state = useSbomDetail({
        containerIdsByImage: ref({ nginx: ['container-1'] }),
      });
      state.selectedImage.value = makeSummary();
      state.showSbomDocument.value = true;
      state.detailSbomResult.value = {
        document: {
          spdxVersion: 'SPDX-2.3',
          packages: [{ name: 'openssl' }],
        },
      };

      expect(() => state.downloadDetailSbom()).not.toThrow();
      expect(createElementSpy).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: originalCreateObjectURL,
      });
    }
  });

  it('clears selected detail state when panel closes', () => {
    const state = useSbomDetail({
      containerIdsByImage: ref({ nginx: ['container-1'] }),
    });
    state.selectedImage.value = makeSummary();
    state.showSbomDocument.value = true;
    state.detailSbomResult.value = { document: { a: 1 } };
    state.detailSbomError.value = 'bad';

    state.handleDetailOpenChange(false);

    expect(state.detailOpen.value).toBe(false);
    expect(state.selectedImage.value).toBeNull();
    expect(state.showSbomDocument.value).toBe(false);
    expect(state.detailSbomResult.value).toBeNull();
    expect(state.detailSbomError.value).toBeNull();
  });

  it('serializes sbom document json only when document display is enabled', () => {
    const state = useSbomDetail({
      containerIdsByImage: ref({ nginx: ['container-1'] }),
    });
    state.detailSbomResult.value = { document: { name: 'nginx' } };

    expect(state.showSbomDocument.value).toBe(false);
    expect(state.detailSbomDocumentJson.value).toBe('');

    state.showSbomDocument.value = true;

    expect(state.detailSbomDocumentJson.value).toBe(`{
  "name": "nginx"
}`);
  });
});
