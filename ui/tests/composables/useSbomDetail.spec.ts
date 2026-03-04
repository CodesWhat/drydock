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
});
