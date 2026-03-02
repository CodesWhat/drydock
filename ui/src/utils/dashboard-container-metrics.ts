import type { Container } from '../types/container';

export interface ImageSecurityAggregate {
  key: string;
  scanned: boolean;
  hasIssue: boolean;
  summary: {
    unknown: number;
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
}

export interface DashboardContainerMetrics {
  totalContainers: number;
  runningContainers: number;
  updatesAvailable: number;
  securityIssueImageCount: number;
  securityByImage: ImageSecurityAggregate[];
}

export function buildDashboardContainerMetrics(
  containers: readonly Container[],
): DashboardContainerMetrics {
  let runningContainers = 0;
  let updatesAvailable = 0;
  const securityIssueImages = new Set<string>();
  const securityByImageMap = new Map<string, ImageSecurityAggregate>();

  for (const container of containers) {
    if (container.status === 'running') {
      runningContainers += 1;
    }
    if (container.updateKind) {
      updatesAvailable += 1;
    }
    if (container.bouncer === 'blocked' || container.bouncer === 'unsafe') {
      securityIssueImages.add(container.image);
    }

    const key = container.image || container.name || container.id;
    let aggregate = securityByImageMap.get(key);
    if (!aggregate) {
      aggregate = {
        key,
        scanned: false,
        hasIssue: false,
        summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
      };
      securityByImageMap.set(key, aggregate);
    }

    if (container.securityScanState !== 'not-scanned') {
      aggregate.scanned = true;
    }

    if (container.securitySummary) {
      const summary = container.securitySummary;
      aggregate.summary.unknown = Math.max(aggregate.summary.unknown, summary.unknown);
      aggregate.summary.low = Math.max(aggregate.summary.low, summary.low);
      aggregate.summary.medium = Math.max(aggregate.summary.medium, summary.medium);
      aggregate.summary.high = Math.max(aggregate.summary.high, summary.high);
      aggregate.summary.critical = Math.max(aggregate.summary.critical, summary.critical);

      const totalSummaryCount =
        summary.unknown + summary.low + summary.medium + summary.high + summary.critical;
      if (totalSummaryCount > 0) {
        aggregate.hasIssue = true;
      }
      continue;
    }

    if (container.bouncer === 'blocked' || container.bouncer === 'unsafe') {
      aggregate.hasIssue = true;
    }
  }

  return {
    totalContainers: containers.length,
    runningContainers,
    updatesAvailable,
    securityIssueImageCount: securityIssueImages.size,
    securityByImage: [...securityByImageMap.values()],
  };
}
