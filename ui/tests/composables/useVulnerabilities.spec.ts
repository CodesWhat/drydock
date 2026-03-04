import { ref } from 'vue';

const { mockGetAllContainers, mockComputeSecurityDelta } = vi.hoisted(() => ({
  mockGetAllContainers: vi.fn(),
  mockComputeSecurityDelta: vi.fn(),
}));

vi.mock('@/services/container', () => ({
  getAllContainers: (...args: any[]) => mockGetAllContainers(...args),
}));

vi.mock('@/utils/container-mapper', async () => {
  const actual = await vi.importActual<typeof import('@/utils/container-mapper')>(
    '@/utils/container-mapper',
  );
  mockComputeSecurityDelta.mockImplementation(actual.computeSecurityDelta);
  return {
    ...actual,
    computeSecurityDelta: mockComputeSecurityDelta,
  };
});

import { useVulnerabilities } from '@/composables/useVulnerabilities';

describe('useVulnerabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches vulnerabilities, groups by image, and computes image delta', async () => {
    mockGetAllContainers.mockResolvedValue([
      {
        id: 'container-1',
        name: 'nginx',
        displayName: 'nginx',
        security: {
          scan: {
            scannedAt: '2026-03-01T10:00:00.000Z',
            vulnerabilities: [
              {
                id: 'CVE-1',
                severity: 'critical',
                packageName: 'openssl',
                fixedVersion: '1.1.2',
              },
            ],
          },
          updateScan: {
            summary: { critical: 0, high: 0, medium: 0, low: 0, unknown: 1 },
          },
        },
      },
      {
        id: 'container-2',
        name: 'nginx',
        displayName: 'nginx',
        security: {
          scan: {
            scannedAt: '2026-03-02T12:15:00.000Z',
            vulnerabilities: [
              { id: 'CVE-2', severity: 'LOW', package: 'zlib', fixedVersion: null },
            ],
          },
        },
      },
    ]);

    const securitySortField = ref('critical');
    const securitySortAsc = ref(false);
    const state = useVulnerabilities({ securitySortField, securitySortAsc });

    await state.fetchVulnerabilities();

    expect(state.loading.value).toBe(false);
    expect(state.error.value).toBeNull();
    expect(state.latestSecurityScanAt.value).toBe('2026-03-02T12:15:00.000Z');
    expect(state.securityVulnerabilities.value).toHaveLength(2);
    expect(state.containerIdsByImage.value.nginx).toEqual(['container-1', 'container-2']);
    expect(state.filteredSummaries.value).toHaveLength(1);
    expect(state.filteredSummaries.value[0].critical).toBe(1);
    expect(state.filteredSummaries.value[0].low).toBe(1);
    expect(state.filteredSummaries.value[0].fixable).toBe(1);
    expect(mockComputeSecurityDelta).toHaveBeenCalledWith(
      { critical: 1, high: 0, medium: 0, low: 1, unknown: 0 },
      { critical: 0, high: 0, medium: 0, low: 0, unknown: 1 },
    );
  });

  it('filters by severity and fix availability and can clear filters', async () => {
    mockGetAllContainers.mockResolvedValue([
      {
        id: 'container-1',
        name: 'nginx',
        displayName: 'nginx',
        security: {
          scan: {
            vulnerabilities: [
              { id: 'CVE-1', severity: 'CRITICAL', packageName: 'openssl', fixedVersion: '3.0.1' },
            ],
          },
        },
      },
      {
        id: 'container-2',
        name: 'redis',
        displayName: 'redis',
        security: {
          scan: {
            vulnerabilities: [
              { id: 'CVE-2', severity: 'LOW', packageName: 'zlib', fixedVersion: null },
            ],
          },
        },
      },
    ]);

    const state = useVulnerabilities({
      securitySortField: ref('critical'),
      securitySortAsc: ref(false),
    });
    await state.fetchVulnerabilities();

    expect(state.filteredSummaries.value).toHaveLength(2);
    state.secFilterSeverity.value = 'CRITICAL';
    expect(state.filteredSummaries.value).toHaveLength(1);
    expect(state.filteredSummaries.value[0].image).toBe('nginx');

    state.secFilterSeverity.value = 'all';
    state.secFilterFix.value = 'no';
    expect(state.filteredSummaries.value).toHaveLength(1);
    expect(state.filteredSummaries.value[0].image).toBe('redis');

    state.clearSecFilters();
    expect(state.secFilterSeverity.value).toBe('all');
    expect(state.secFilterFix.value).toBe('all');
    expect(state.activeSecFilterCount.value).toBe(0);
  });

  it('sets an error and clears derived state when loading fails', async () => {
    mockGetAllContainers.mockRejectedValue({ bad: true });

    const state = useVulnerabilities({
      securitySortField: ref('critical'),
      securitySortAsc: ref(false),
    });
    await state.fetchVulnerabilities();

    expect(state.loading.value).toBe(false);
    expect(state.error.value).toBe('Failed to load vulnerability data');
    expect(state.containerIdsByImage.value).toEqual({});
    expect(state.latestSecurityScanAt.value).toBeNull();
  });
});
