import { ref } from 'vue';

const { mockGetAllContainers, mockGetContainerVulnerabilities, mockComputeSecurityDelta } =
  vi.hoisted(() => ({
    mockGetAllContainers: vi.fn(),
    mockGetContainerVulnerabilities: vi.fn(),
    mockComputeSecurityDelta: vi.fn(),
  }));

vi.mock('@/services/container', () => ({
  getAllContainers: (...args: any[]) => mockGetAllContainers(...args),
  getContainerVulnerabilities: (...args: any[]) => mockGetContainerVulnerabilities(...args),
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

/** Set up mockGetContainerVulnerabilities to return scan data matching the container list. */
function setupVulnMocks(containers: any[]) {
  const scanByContainerId = new Map<string, any>();
  for (const c of containers) {
    if (c.id && c.security?.scan) {
      scanByContainerId.set(c.id, c.security.scan);
    }
  }
  mockGetContainerVulnerabilities.mockImplementation((id: string) => {
    const scan = scanByContainerId.get(id);
    return Promise.resolve(scan ?? { vulnerabilities: [] });
  });
}

describe('useVulnerabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches vulnerabilities, groups by image, and computes image delta', async () => {
    const containers = [
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
    ];
    mockGetAllContainers.mockResolvedValue(containers);
    setupVulnMocks(containers);

    const securitySortField = ref('critical');
    const securitySortAsc = ref(false);
    const state = useVulnerabilities({ securitySortField, securitySortAsc });

    await state.fetchVulnerabilities();

    expect(state.loading.value).toBe(false);
    expect(state.error.value).toBeNull();
    expect(state.latestSecurityScanAt.value).toBe('2026-03-02T12:15:00.000Z');
    expect(state.securityVulnerabilities.value).toHaveLength(2);
    expect(state.containerIdsByImage.value.nginx).toEqual(['container-1', 'container-2']);
    expect(state.totalContainerCount.value).toBe(2);
    expect(state.scannedContainerCount.value).toBe(2);
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
    const containers = [
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
    ];
    mockGetAllContainers.mockResolvedValue(containers);
    setupVulnMocks(containers);

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

  it('separates image counts from grouped vulnerability lists', async () => {
    const containers = [
      {
        id: 'container-1',
        name: 'nginx',
        displayName: 'nginx',
        security: {
          scan: {
            vulnerabilities: [
              {
                id: 'CVE-1',
                severity: 'CRITICAL',
                packageName: 'openssl',
                fixedVersion: '3.0.1',
              },
              {
                id: 'CVE-2',
                severity: 'LOW',
                packageName: 'zlib',
                fixedVersion: null,
              },
            ],
          },
        },
      },
    ];
    mockGetAllContainers.mockResolvedValue(containers);
    setupVulnMocks(containers);

    const state = useVulnerabilities({
      securitySortField: ref('critical'),
      securitySortAsc: ref(false),
    });
    await state.fetchVulnerabilities();

    const summary = state.imageSummaries.value[0] as Record<string, unknown>;
    expect(summary.vulns).toBeUndefined();
    expect(state.vulnerabilitiesByImage.value.nginx).toHaveLength(2);
    expect(state.vulnerabilitiesByImage.value.nginx.map((v) => v.id)).toEqual(['CVE-1', 'CVE-2']);
  });

  it('sorts image summaries by configured field and direction', async () => {
    const containers = [
      {
        id: 'container-1',
        name: 'nginx',
        displayName: 'nginx',
        security: {
          scan: {
            vulnerabilities: [
              { id: 'CVE-1', severity: 'CRITICAL', packageName: 'openssl', fixedVersion: '3.0.1' },
              { id: 'CVE-2', severity: 'HIGH', packageName: 'libssl', fixedVersion: null },
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
              { id: 'CVE-3', severity: 'CRITICAL', packageName: 'redis', fixedVersion: null },
              { id: 'CVE-4', severity: 'CRITICAL', packageName: 'redis', fixedVersion: null },
              { id: 'CVE-5', severity: 'LOW', packageName: 'jemalloc', fixedVersion: '1.2.3' },
            ],
          },
        },
      },
      {
        id: 'container-3',
        name: 'alpine',
        displayName: 'alpine',
        security: {
          scan: {
            vulnerabilities: [
              { id: 'CVE-6', severity: 'LOW', packageName: 'busybox', fixedVersion: null },
            ],
          },
        },
      },
    ];
    mockGetAllContainers.mockResolvedValue(containers);
    setupVulnMocks(containers);

    const securitySortField = ref('critical');
    const securitySortAsc = ref(false);
    const state = useVulnerabilities({ securitySortField, securitySortAsc });
    await state.fetchVulnerabilities();

    expect(state.filteredSummaries.value.map((summary) => summary.image)).toEqual([
      'redis',
      'nginx',
      'alpine',
    ]);

    securitySortAsc.value = true;
    expect(state.filteredSummaries.value.map((summary) => summary.image)).toEqual([
      'alpine',
      'nginx',
      'redis',
    ]);

    securitySortField.value = 'image';
    expect(state.filteredSummaries.value.map((summary) => summary.image)).toEqual([
      'alpine',
      'nginx',
      'redis',
    ]);
  });

  it('counts total and scanned containers separately', async () => {
    const containers = [
      {
        id: 'container-1',
        name: 'nginx',
        displayName: 'nginx',
        security: {
          scan: {
            vulnerabilities: [
              { id: 'CVE-1', severity: 'HIGH', packageName: 'openssl', fixedVersion: '3.0.1' },
            ],
          },
        },
      },
      {
        id: 'container-2',
        name: 'redis',
        displayName: 'redis',
        security: null,
      },
      {
        id: 'container-3',
        name: 'postgres',
        displayName: 'postgres',
        security: { scan: null },
      },
    ];
    mockGetAllContainers.mockResolvedValue(containers);
    setupVulnMocks(containers);

    const state = useVulnerabilities({
      securitySortField: ref('critical'),
      securitySortAsc: ref(false),
    });
    await state.fetchVulnerabilities();

    expect(state.totalContainerCount.value).toBe(3);
    expect(state.scannedContainerCount.value).toBe(1);
  });

  it('loads vulnerabilities from the container list payload without per-container calls', async () => {
    const containers = Array.from({ length: 50 }, (_, index) => ({
      id: `container-${index + 1}`,
      name: `service-${index + 1}`,
      displayName: `service-${index + 1}`,
      security: {
        scan: {
          scannedAt: `2026-03-01T10:${String(index).padStart(2, '0')}:00.000Z`,
          vulnerabilities: [
            {
              id: `CVE-${index + 1}`,
              severity: 'HIGH',
              packageName: 'openssl',
              fixedVersion: null,
            },
          ],
        },
      },
    }));

    mockGetAllContainers.mockResolvedValue(containers);
    setupVulnMocks(containers);

    const state = useVulnerabilities({
      securitySortField: ref('critical'),
      securitySortAsc: ref(false),
    });
    await state.fetchVulnerabilities();

    expect(mockGetAllContainers).toHaveBeenCalledWith({ includeVulnerabilities: true });
    expect(mockGetContainerVulnerabilities).not.toHaveBeenCalled();
    expect(state.securityVulnerabilities.value).toHaveLength(50);
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
    expect(state.totalContainerCount.value).toBe(0);
    expect(state.scannedContainerCount.value).toBe(0);
  });
});
