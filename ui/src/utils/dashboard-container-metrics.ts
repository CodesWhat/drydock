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

interface DashboardContainerMetrics {
  totalContainers: number;
  runningContainers: number;
  updatesAvailable: number;
  securityIssueImageCount: number;
  securityByImage: ImageSecurityAggregate[];
}

function getContainerSecurityGroup(container: Container): { mapKey: string; key: string } {
  const image = container.image.trim();
  if (image.length > 0) {
    return { mapKey: `image:${image}`, key: image };
  }

  const id = container.id.trim();
  if (id.length > 0) {
    return { mapKey: `container:${id}`, key: id };
  }

  const name = container.name.trim();
  if (name.length > 0) {
    return { mapKey: `name:${name}`, key: name };
  }

  return { mapKey: 'unknown:container', key: 'unknown' };
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
    const securityGroup = getContainerSecurityGroup(container);

    if (container.bouncer === 'blocked' || container.bouncer === 'unsafe') {
      securityIssueImages.add(securityGroup.mapKey);
    }

    let aggregate = securityByImageMap.get(securityGroup.mapKey);
    if (!aggregate) {
      aggregate = {
        key: securityGroup.key,
        scanned: false,
        hasIssue: false,
        summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
      };
      securityByImageMap.set(securityGroup.mapKey, aggregate);
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
      if (
        totalSummaryCount > 0 ||
        container.bouncer === 'blocked' ||
        container.bouncer === 'unsafe'
      ) {
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
