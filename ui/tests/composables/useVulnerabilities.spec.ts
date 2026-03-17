import { ref } from 'vue';

const { mockGetAllContainers, mockGetSecurityVulnerabilityOverview, mockComputeSecurityDelta } =
  vi.hoisted(() => ({
    mockGetAllContainers: vi.fn(),
    mockGetSecurityVulnerabilityOverview: vi.fn(),
    mockComputeSecurityDelta: vi.fn(),
  }));

vi.mock('@/services/container', () => ({
  getAllContainers: (...args: any[]) => mockGetAllContainers(...args),
  getSecurityVulnerabilityOverview: (...args: any[]) =>
    mockGetSecurityVulnerabilityOverview(...args),
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

function normalizeSeverityCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  return Math.floor(value);
}

function chooseLatestTimestamp(current: string | null, candidate: unknown): string | null {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return current;
  }
  if (current === null) {
    return candidate;
  }
  return candidate > current ? candidate : current;
}

/** Build the aggregated API response from a container fixture list. */
function setupVulnMocks(containers: any[]) {
  const images = new Map<string, any>();
  let scannedContainers = 0;
  let latestScannedAt: string | null = null;

  for (const c of containers) {
    const scan = c.security?.scan;
    if (!scan) continue;
    scannedContainers += 1;

    const image = c.displayName || c.name || 'unknown';
    const entry = images.get(image) || {
      image,
      containerIds: [] as string[],
      vulnerabilities: [] as any[],
    };

    if (typeof c.id === 'string' && c.id.length > 0 && !entry.containerIds.includes(c.id)) {
      entry.containerIds.push(c.id);
    }

    const updateSummary = c.security?.updateScan?.summary;
    if (updateSummary) {
      entry.updateSummary = {
        unknown: normalizeSeverityCount(updateSummary.unknown),
        low: normalizeSeverityCount(updateSummary.low),
        medium: normalizeSeverityCount(updateSummary.medium),
        high: normalizeSeverityCount(updateSummary.high),
        critical: normalizeSeverityCount(updateSummary.critical),
      };
    }

    latestScannedAt = chooseLatestTimestamp(latestScannedAt, scan.scannedAt);

    const vulnList = Array.isArray(scan.vulnerabilities) ? scan.vulnerabilities : [];
    for (const vulnerability of vulnList) {
      entry.vulnerabilities.push({
        id: vulnerability.id ?? 'unknown',
        severity: vulnerability.severity ?? 'UNKNOWN',
        package: vulnerability.packageName ?? vulnerability.package ?? 'unknown',
        version: vulnerability.installedVersion ?? vulnerability.version ?? '',
        fixedIn: vulnerability.fixedVersion ?? vulnerability.fixedIn ?? null,
        title: vulnerability.title ?? vulnerability.Title ?? '',
        target: vulnerability.target ?? vulnerability.Target ?? '',
        primaryUrl: vulnerability.primaryUrl ?? vulnerability.PrimaryURL ?? '',
        publishedDate: vulnerability.publishedDate ?? '',
      });
    }

    images.set(image, entry);
  }

  mockGetSecurityVulnerabilityOverview.mockResolvedValue({
    totalContainers: containers.length,
    scannedContainers,
    latestScannedAt,
    images: [...images.values()],
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

    state.secFilterFix.value = 'yes';
    expect(state.filteredSummaries.value).toHaveLength(1);
    expect(state.filteredSummaries.value[0].image).toBe('nginx');

    state.clearSecFilters();
    expect(state.secFilterSeverity.value).toBe('all');
    expect(state.secFilterFix.value).toBe('all');
    expect(state.activeSecFilterCount.value).toBe(0);
  });

  it('falls back to critical sorting and ignores asc for unknown sort fields', async () => {
    mockGetSecurityVulnerabilityOverview.mockResolvedValue({
      totalContainers: 2,
      scannedContainers: 2,
      latestScannedAt: '2026-03-01T10:00:00.000Z',
      images: [
        {
          image: 'critical-image',
          containerIds: ['c1'],
          vulnerabilities: [{ id: 'CVE-CRIT', severity: 'CRITICAL', package: 'pkg' }],
        },
        {
          image: 'low-image',
          containerIds: ['c2'],
          vulnerabilities: [{ id: 'CVE-LOW', severity: 'LOW', package: 'pkg' }],
        },
      ],
    });

    const state = useVulnerabilities({
      securitySortField: ref('unknown-sort-field'),
      securitySortAsc: ref(true),
    });
    await state.fetchVulnerabilities();

    expect(state.filteredSummaries.value.map((summary) => summary.image)).toEqual([
      'critical-image',
      'low-image',
    ]);
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
    setupVulnMocks(containers);

    const state = useVulnerabilities({
      securitySortField: ref('critical'),
      securitySortAsc: ref(false),
    });
    await state.fetchVulnerabilities();

    const summary = state.imageSummaries.value[0] as unknown as Record<string, unknown>;
    expect(summary.vulns).toBeUndefined();
    expect(state.vulnerabilitiesByImage.value.nginx).toHaveLength(2);
    expect(state.vulnerabilitiesByImage.value.nginx.map((v) => v.id)).toEqual(['CVE-1', 'CVE-2']);
  });

  it('groups vulnerabilities by image then sorts each group by severity', () => {
    const state = useVulnerabilities({
      securitySortField: ref('critical'),
      securitySortAsc: ref(false),
    });

    state.securityVulnerabilities.value = [
      {
        id: 'CVE-LOW',
        severity: 'LOW',
        package: 'pkg-low',
        version: '1.0.0',
        fixedIn: null,
        title: '',
        target: '',
        primaryUrl: '',
        image: 'ordered-image',
        publishedDate: '',
      },
      {
        id: 'CVE-UNKNOWN',
        severity: 'UNKNOWN',
        package: 'pkg-unknown',
        version: '1.0.0',
        fixedIn: null,
        title: '',
        target: '',
        primaryUrl: '',
        image: 'ordered-image',
        publishedDate: '',
      },
      {
        id: 'CVE-CRITICAL',
        severity: 'CRITICAL',
        package: 'pkg-critical',
        version: '1.0.0',
        fixedIn: null,
        title: '',
        target: '',
        primaryUrl: '',
        image: 'ordered-image',
        publishedDate: '',
      },
      {
        id: 'CVE-MEDIUM',
        severity: 'MEDIUM',
        package: 'pkg-medium',
        version: '1.0.0',
        fixedIn: null,
        title: '',
        target: '',
        primaryUrl: '',
        image: 'ordered-image',
        publishedDate: '',
      },
      {
        id: 'CVE-HIGH-OTHER',
        severity: 'HIGH',
        package: 'pkg-high-other',
        version: '1.0.0',
        fixedIn: null,
        title: '',
        target: '',
        primaryUrl: '',
        image: 'other-image',
        publishedDate: '',
      },
      {
        id: 'CVE-LOW-OTHER',
        severity: 'LOW',
        package: 'pkg-low-other',
        version: '1.0.0',
        fixedIn: null,
        title: '',
        target: '',
        primaryUrl: '',
        image: 'other-image',
        publishedDate: '',
      },
    ];

    const sortSpy = vi.spyOn(Array.prototype, 'sort');
    try {
      expect(state.vulnerabilitiesByImage.value['ordered-image'].map((v) => v.id)).toEqual([
        'CVE-CRITICAL',
        'CVE-MEDIUM',
        'CVE-LOW',
        'CVE-UNKNOWN',
      ]);
      expect(state.vulnerabilitiesByImage.value['other-image'].map((v) => v.id)).toEqual([
        'CVE-HIGH-OTHER',
        'CVE-LOW-OTHER',
      ]);
      expect(sortSpy).toHaveBeenCalled();
    } finally {
      sortSpy.mockRestore();
    }
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

    setupVulnMocks(containers);

    const state = useVulnerabilities({
      securitySortField: ref('critical'),
      securitySortAsc: ref(false),
    });
    await state.fetchVulnerabilities();

    expect(mockGetSecurityVulnerabilityOverview).toHaveBeenCalledWith();
    expect(mockGetAllContainers).not.toHaveBeenCalled();
    expect(state.securityVulnerabilities.value).toHaveLength(50);
  });

  it('handles normalization, fallback fields, duplicate ids, and all severity filters/sorts', async () => {
    const containers = [
      {
        id: 'dup-id',
        name: 'critical-image',
        displayName: 'critical-image',
        security: {
          scan: {
            scannedAt: '2026-03-01T10:00:00.000Z',
            vulnerabilities: [
              {
                id: 'CVE-CRIT',
                severity: 'critical',
                packageName: 'openssl',
                fixedVersion: '3.0.1',
              },
            ],
          },
        },
      },
      {
        id: 'dup-id',
        name: 'critical-image',
        displayName: 'critical-image',
        security: {
          scan: {
            scannedAt: '2026-03-01T10:30:00.000Z',
            vulnerabilities: [
              {
                id: 'CVE-HIGH-DUP',
                severity: 'HIGH',
                packageName: 'openssl',
                fixedVersion: null,
              },
            ],
          },
        },
      },
      {
        id: 'id-high',
        name: 'high-image',
        displayName: '',
        security: {
          scan: {
            scannedAt: '2026-03-01T11:00:00.000Z',
            vulnerabilities: [
              {
                id: 'CVE-HIGH-1',
                severity: 'HIGH',
                package: 'libssl',
                fixedIn: null,
              },
              {
                id: 'CVE-HIGH-2',
                severity: 'HIGH',
                package: 'libcrypto',
                fixedIn: '1.2.3',
              },
            ],
          },
        },
      },
      {
        id: 'id-medium',
        name: 'medium-image',
        displayName: 'medium-image',
        security: {
          scan: {
            scannedAt: '2026-03-01T11:10:00.000Z',
            vulnerabilities: [
              {
                id: 'CVE-MED',
                severity: 'MEDIUM',
                packageName: 'pkg-med',
                fixedVersion: null,
              },
            ],
          },
        },
      },
      {
        id: 'id-mixed',
        name: '',
        displayName: '',
        security: {
          scan: {
            scannedAt: '2026-03-01T11:20:00.000Z',
            vulnerabilities: [
              {
                id: 'CVE-LOW',
                severity: 'LOW',
                packageName: 'pkg-low',
                fixedVersion: '1.0.0',
              },
              {
                severity: 'negligible',
              },
              {
                id: 'CVE-NONSTRING',
                severity: 42,
                packageName: 'pkg-num',
              },
            ],
          },
        },
      },
      {
        id: 'id-empty',
        name: 'empty-image',
        displayName: 'empty-image',
        security: {
          scan: {
            scannedAt: '2026-03-01T11:30:00.000Z',
            vulnerabilities: null,
          },
        },
      },
    ];
    setupVulnMocks(containers);

    const securitySortField = ref('critical');
    const securitySortAsc = ref(false);
    const state = useVulnerabilities({ securitySortField, securitySortAsc });

    await state.fetchVulnerabilities();

    expect(state.containerIdsByImage.value['critical-image']).toEqual(['dup-id']);
    expect(state.containerIdsByImage.value['high-image']).toEqual(['id-high']);
    expect(state.containerIdsByImage.value.unknown).toEqual(['id-mixed']);

    const unknownVulnerability = state.securityVulnerabilities.value.find(
      (v) => v.id === 'unknown',
    );
    expect(unknownVulnerability).toBeDefined();
    expect(unknownVulnerability?.severity).toBe('UNKNOWN');
    expect(unknownVulnerability?.package).toBe('unknown');

    state.secFilterSeverity.value = 'HIGH';
    expect(state.filteredSummaries.value).toHaveLength(2);
    expect(state.filteredSummaries.value.every((summary) => summary.high > 0)).toBe(true);

    state.secFilterSeverity.value = 'MEDIUM';
    expect(state.filteredSummaries.value.map((summary) => summary.image)).toEqual(['medium-image']);

    state.secFilterSeverity.value = 'LOW';
    expect(state.filteredSummaries.value.map((summary) => summary.image)).toEqual(['unknown']);

    state.secFilterSeverity.value = 'UNKNOWN';
    expect(state.filteredSummaries.value.map((summary) => summary.image)).toEqual(['unknown']);

    state.secFilterSeverity.value = 'all';
    for (const field of ['high', 'medium', 'low', 'fixable', 'total'] as const) {
      securitySortField.value = field;
      const values = state.filteredSummaries.value.map((summary) => summary[field]);
      expect(values).toEqual([...values].sort((a, b) => b - a));
    }

    state.securityVulnerabilities.value = [
      {
        id: 'CVE-UNEXPECTED',
        severity: 'UNEXPECTED',
        package: 'mystery',
        version: '1.0.0',
        fixedIn: null,
        image: 'fallback-image',
        publishedDate: '',
      },
      {
        id: 'CVE-LOW-ORDER',
        severity: 'LOW',
        package: 'openssl',
        version: '3.0.0',
        fixedIn: null,
        image: 'fallback-image',
        publishedDate: '',
      },
    ];
    expect(state.vulnerabilitiesByImage.value['fallback-image'].map((v) => v.id)).toEqual([
      'CVE-LOW-ORDER',
      'CVE-UNEXPECTED',
    ]);

    state.securityVulnerabilities.value = [
      {
        id: 'CVE-LOW-FIRST',
        severity: 'LOW',
        package: 'openssl',
        version: '3.0.0',
        fixedIn: null,
        image: 'fallback-image-reversed',
        publishedDate: '',
      },
      {
        id: 'CVE-UNEXPECTED-SECOND',
        severity: 'UNEXPECTED',
        package: 'mystery',
        version: '1.0.0',
        fixedIn: null,
        image: 'fallback-image-reversed',
        publishedDate: '',
      },
    ];
    expect(state.vulnerabilitiesByImage.value['fallback-image-reversed'].map((v) => v.id)).toEqual([
      'CVE-LOW-FIRST',
      'CVE-UNEXPECTED-SECOND',
    ]);

    setupVulnMocks(containers);
    await state.fetchVulnerabilities();
    expect(state.loading.value).toBe(false);
  });

  it('applies fallback defaults for sparse and malformed API responses', async () => {
    mockGetSecurityVulnerabilityOverview.mockResolvedValue({
      totalContainers: 2,
      scannedContainers: 2,
      latestScannedAt: '2026-03-01T10:00:00.000Z',
      images: [
        {
          image: 'sparse-image',
          containerIds: ['c1'],
          vulnerabilities: [{}],
        },
        {
          image: 'non-array-vulns',
          containerIds: ['c2'],
          vulnerabilities: 'not-an-array',
        },
        {
          image: '',
          containerIds: null,
          vulnerabilities: [{ id: 'CVE-NOIMAGE', severity: 'HIGH', package: 'pkg' }],
        },
        {
          image: 'empty-ids',
          containerIds: ['', null, 42],
          vulnerabilities: [],
        },
      ],
    });

    const securitySortField = ref('bogus-field');
    const state = useVulnerabilities({
      securitySortField,
      securitySortAsc: ref(false),
    });
    await state.fetchVulnerabilities();

    expect(state.securityVulnerabilities.value).toHaveLength(2);
    const vuln = state.securityVulnerabilities.value.find((v) => v.id === 'unknown');
    expect(vuln).toBeDefined();
    expect(vuln!.package).toBe('unknown');
    expect(vuln!.version).toBe('');
    expect(vuln!.fixedIn).toBeNull();
    expect(vuln!.title).toBe('');
    expect(vuln!.target).toBe('');
    expect(vuln!.primaryUrl).toBe('');
    expect(vuln!.publishedDate).toBe('');
    expect(vuln!.image).toBe('sparse-image');

    expect(state.containerIdsByImage.value.unknown).toBeUndefined();
    expect(state.containerIdsByImage.value['empty-ids']).toBeUndefined();
  });

  it('handles non-array overview.images gracefully', async () => {
    mockGetSecurityVulnerabilityOverview.mockResolvedValue({
      totalContainers: 0,
      scannedContainers: 0,
      latestScannedAt: null,
      images: 'not-an-array',
    });

    const state = useVulnerabilities({
      securitySortField: ref('critical'),
      securitySortAsc: ref(false),
    });
    await state.fetchVulnerabilities();

    expect(state.securityVulnerabilities.value).toHaveLength(0);
    expect(state.containerIdsByImage.value).toEqual({});
  });

  it('sets an error and clears derived state when loading fails', async () => {
    mockGetSecurityVulnerabilityOverview
      .mockResolvedValueOnce({
        totalContainers: 1,
        scannedContainers: 1,
        latestScannedAt: '2026-03-01T10:00:00.000Z',
        images: [
          {
            image: 'nginx',
            containerIds: ['container-1'],
            vulnerabilities: [{ id: 'CVE-1', severity: 'HIGH', package: 'openssl' }],
          },
        ],
      })
      .mockRejectedValueOnce({ bad: true });

    const state = useVulnerabilities({
      securitySortField: ref('critical'),
      securitySortAsc: ref(false),
    });
    await state.fetchVulnerabilities();
    expect(state.securityVulnerabilities.value).toHaveLength(1);

    await state.fetchVulnerabilities();

    expect(state.loading.value).toBe(false);
    expect(state.error.value).toBe('Failed to load vulnerability data');
    expect(state.securityVulnerabilities.value).toEqual([]);
    expect(state.containerIdsByImage.value).toEqual({});
    expect(state.latestSecurityScanAt.value).toBeNull();
    expect(state.totalContainerCount.value).toBe(0);
    expect(state.scannedContainerCount.value).toBe(0);
  });
});
