import type { Container, ContainerSecuritySummary } from '@/types/container';
import { buildDashboardContainerMetrics } from '@/utils/dashboard-container-metrics';

function makeContainer(
  overrides: Partial<Container> = {},
  securitySummary?: ContainerSecuritySummary,
): Container {
  return {
    id: 'c1',
    name: 'nginx',
    image: 'nginx',
    icon: 'docker',
    currentTag: '1.0.0',
    newTag: null,
    status: 'running',
    registry: 'dockerhub',
    updateKind: null,
    bouncer: 'safe',
    server: 'Local',
    details: { ports: [], volumes: [], env: [], labels: [] },
    securityScanState: 'not-scanned',
    securitySummary,
    ...overrides,
  };
}

describe('buildDashboardContainerMetrics', () => {
  it('computes top-level counts and groups by image', () => {
    const metrics = buildDashboardContainerMetrics([
      makeContainer({ id: 'c1', name: 'api-1', image: 'nginx', status: 'running' }),
      makeContainer({
        id: 'c2',
        name: 'api-2',
        image: 'nginx',
        status: 'stopped',
        updateKind: 'minor',
        bouncer: 'unsafe',
      }),
      makeContainer({
        id: 'c3',
        name: 'worker',
        image: 'redis',
        status: 'running',
        updateKind: 'digest',
        bouncer: 'blocked',
      }),
      makeContainer({
        id: 'c4',
        name: 'db',
        image: 'postgres',
        status: 'stopped',
      }),
    ]);

    expect(metrics.totalContainers).toBe(4);
    expect(metrics.runningContainers).toBe(2);
    expect(metrics.updatesAvailable).toBe(2);
    expect(metrics.securityIssueImageCount).toBe(2);
    expect(metrics.securityByImage).toHaveLength(3);
  });

  it('uses max severity per image across multiple containers', () => {
    const metrics = buildDashboardContainerMetrics([
      makeContainer({
        id: 'c1',
        image: 'nginx',
        securityScanState: 'scanned',
        securitySummary: { unknown: 0, low: 2, medium: 0, high: 1, critical: 0 },
      }),
      makeContainer({
        id: 'c2',
        image: 'nginx',
        securityScanState: 'scanned',
        securitySummary: { unknown: 1, low: 1, medium: 3, high: 0, critical: 2 },
      }),
    ]);

    const nginx = metrics.securityByImage.find((aggregate) => aggregate.key === 'nginx');
    expect(nginx).toMatchObject({
      scanned: true,
      hasIssue: true,
      summary: {
        unknown: 1,
        low: 2,
        medium: 3,
        high: 1,
        critical: 2,
      },
    });
  });

  it('falls back to container id when image is empty', () => {
    const metrics = buildDashboardContainerMetrics([
      makeContainer({ id: 'c1', name: 'api', image: '' }),
      makeContainer({ id: 'c2', name: '', image: '' }),
    ]);

    expect(metrics.securityByImage.map((aggregate) => aggregate.key)).toEqual(['c1', 'c2']);
  });

  it('counts security issues by deterministic group when image is empty', () => {
    const metrics = buildDashboardContainerMetrics([
      makeContainer({ id: 'c1', image: '', bouncer: 'blocked' }),
      makeContainer({ id: 'c2', image: '', bouncer: 'unsafe' }),
    ]);

    expect(metrics.securityIssueImageCount).toBe(2);
  });

  it('treats blocked and unsafe containers as issues even when summary counts are zero', () => {
    const metrics = buildDashboardContainerMetrics([
      makeContainer({
        id: 'c1',
        image: 'nginx',
        bouncer: 'blocked',
        securityScanState: 'scanned',
        securitySummary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
      }),
      makeContainer({
        id: 'c2',
        image: 'redis',
        bouncer: 'unsafe',
        securityScanState: 'scanned',
        securitySummary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
      }),
    ]);

    const byKey = Object.fromEntries(
      metrics.securityByImage.map((aggregate) => [aggregate.key, aggregate]),
    );
    expect(byKey.nginx?.hasIssue).toBe(true);
    expect(byKey.redis?.hasIssue).toBe(true);
  });
});
