import { describe, expect, test } from 'vitest';
import {
  buildSecurityVulnerabilityOverviewResponse,
  getSecurityIssueCount,
} from './security-overview.js';

function createContainer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    name: 'nginx',
    displayName: 'nginx',
    watcher: 'local',
    status: 'running',
    image: {
      registry: { name: 'hub', url: 'docker.io' },
      name: 'library/nginx',
      tag: { value: '1.0.0' },
    },
    ...overrides,
  };
}

describe('api/container/security-overview', () => {
  test('counts containers with critical or high vulnerabilities as security issues', () => {
    const issueCount = getSecurityIssueCount([
      createContainer({ id: 'c1', security: { scan: { summary: { critical: 1, high: 0 } } } }),
      createContainer({ id: 'c2', security: { scan: { summary: { critical: 0, high: 2 } } } }),
      createContainer({ id: 'c3', security: { scan: { summary: { critical: 0, high: 0 } } } }),
      createContainer({ id: 'c4', security: { scan: {} } }),
    ] as any[]);

    expect(issueCount).toBe(2);
  });

  test('builds paginated vulnerability overview grouped by image', () => {
    const response = buildSecurityVulnerabilityOverviewResponse(
      [
        createContainer({
          id: 'c1',
          name: 'nginx',
          displayName: 'nginx',
          security: {
            scan: {
              scannedAt: '2026-02-01T10:00:00.000Z',
              vulnerabilities: [
                {
                  id: 'CVE-2026-0001',
                  severity: 'CRITICAL',
                  packageName: 'openssl',
                  installedVersion: '3.0.0',
                },
                {
                  id: 'CVE-2026-0002',
                  severity: 'HIGH',
                  packageName: 'zlib',
                  installedVersion: '1.2.10',
                },
              ],
            },
          },
        }),
        createContainer({
          id: 'c2',
          name: 'redis',
          displayName: 'redis',
          security: {
            scan: {
              scannedAt: '2026-02-02T10:00:00.000Z',
              vulnerabilities: [
                {
                  id: 'CVE-2026-0003',
                  severity: 'MEDIUM',
                  packageName: 'jemalloc',
                  installedVersion: '5.2.1',
                },
              ],
            },
          },
        }),
      ] as any[],
      { limit: '1', offset: '1' } as any,
    );

    expect(response).toEqual({
      totalContainers: 2,
      scannedContainers: 2,
      latestScannedAt: '2026-02-02T10:00:00.000Z',
      total: 3,
      limit: 1,
      offset: 1,
      hasMore: true,
      _links: {
        self: '/api/containers/security/vulnerabilities?limit=1&offset=1',
        next: '/api/containers/security/vulnerabilities?limit=1&offset=2',
      },
      images: [
        {
          image: 'nginx',
          containerIds: ['c1'],
          vulnerabilities: [
            {
              id: 'CVE-2026-0002',
              severity: 'HIGH',
              package: 'zlib',
              version: '1.2.10',
              fixedIn: null,
              title: '',
              target: '',
              primaryUrl: '',
              publishedDate: '',
            },
          ],
        },
      ],
    });
  });

  test('normalizes malformed vulnerability payloads with safe fallbacks', () => {
    const response = buildSecurityVulnerabilityOverviewResponse(
      [
        createContainer({
          id: 'name-fallback',
          name: 'fallback-name',
          displayName: '',
          security: {
            scan: {
              scannedAt: '2026-02-10T00:00:00.000Z',
              vulnerabilities: [
                'invalid-vulnerability',
                {
                  id: 'CVE-NAME',
                  severity: 'HIGH',
                  packageName: 'pkg-name',
                },
              ],
            },
            updateScan: {
              summary: 'invalid-summary',
            },
          },
        }),
      ] as any[],
      {} as any,
    );

    expect(response.images).toEqual([
      {
        image: 'fallback-name',
        containerIds: ['name-fallback'],
        updateSummary: {
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          unknown: 0,
        },
        vulnerabilities: [
          {
            id: 'unknown',
            severity: 'UNKNOWN',
            package: 'unknown',
            version: '',
            fixedIn: null,
            title: '',
            target: '',
            primaryUrl: '',
            publishedDate: '',
          },
          {
            id: 'CVE-NAME',
            severity: 'HIGH',
            package: 'pkg-name',
            version: '',
            fixedIn: null,
            title: '',
            target: '',
            primaryUrl: '',
            publishedDate: '',
          },
        ],
      },
    ]);
  });

  test('allows overriding total container count when scanning a subset', () => {
    const response = buildSecurityVulnerabilityOverviewResponse(
      [
        createContainer({
          id: 'c1',
          security: {
            scan: {
              scannedAt: '2026-02-10T00:00:00.000Z',
              vulnerabilities: [],
            },
          },
        }),
      ] as any[],
      {} as any,
      25,
    );

    expect(response.totalContainers).toBe(25);
    expect(response.scannedContainers).toBe(1);
  });
});
