import type { Container } from '../types/container';
import { getUpdateMaturity } from './update-maturity';

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
  freshUpdates: number;
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

function isContainerSecurityIssue(container: Container): boolean {
  return container.bouncer === 'blocked' || container.bouncer === 'unsafe';
}

function getOrCreateImageSecurityAggregate(
  securityByImageMap: Map<string, ImageSecurityAggregate>,
  mapKey: string,
  key: string,
): ImageSecurityAggregate {
  const existing = securityByImageMap.get(mapKey);
  if (existing) {
    return existing;
  }

  const aggregate: ImageSecurityAggregate = {
    key,
    scanned: false,
    hasIssue: false,
    summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
  };
  securityByImageMap.set(mapKey, aggregate);
  return aggregate;
}

function mergeSecuritySummary(
  aggregate: ImageSecurityAggregate,
  summary: ImageSecurityAggregate['summary'],
) {
  aggregate.summary.unknown = Math.max(aggregate.summary.unknown, summary.unknown);
  aggregate.summary.low = Math.max(aggregate.summary.low, summary.low);
  aggregate.summary.medium = Math.max(aggregate.summary.medium, summary.medium);
  aggregate.summary.high = Math.max(aggregate.summary.high, summary.high);
  aggregate.summary.critical = Math.max(aggregate.summary.critical, summary.critical);
}

function getSecuritySummaryTotal(summary: ImageSecurityAggregate['summary']): number {
  return summary.unknown + summary.low + summary.medium + summary.high + summary.critical;
}

function updateImageSecurityAggregate(
  aggregate: ImageSecurityAggregate,
  container: Container,
  hasContainerSecurityIssue: boolean,
) {
  if (container.securityScanState !== 'not-scanned') {
    aggregate.scanned = true;
  }

  if (!container.securitySummary) {
    if (hasContainerSecurityIssue) {
      aggregate.hasIssue = true;
    }
    return;
  }

  mergeSecuritySummary(aggregate, container.securitySummary);
  if (getSecuritySummaryTotal(container.securitySummary) > 0 || hasContainerSecurityIssue) {
    aggregate.hasIssue = true;
  }
}

export function buildDashboardContainerMetrics(
  containers: readonly Container[],
): DashboardContainerMetrics {
  let runningContainers = 0;
  let updatesAvailable = 0;
  let freshUpdates = 0;
  const securityIssueImages = new Set<string>();
  const securityByImageMap = new Map<string, ImageSecurityAggregate>();

  for (const container of containers) {
    if (container.status === 'running') {
      runningContainers += 1;
    }
    if (container.updateKind) {
      updatesAvailable += 1;
      if (getUpdateMaturity(container.updateDetectedAt, true) === 'fresh') {
        freshUpdates += 1;
      }
    }

    const securityGroup = getContainerSecurityGroup(container);
    const hasContainerSecurityIssue = isContainerSecurityIssue(container);

    if (hasContainerSecurityIssue) {
      securityIssueImages.add(securityGroup.mapKey);
    }

    const aggregate = getOrCreateImageSecurityAggregate(
      securityByImageMap,
      securityGroup.mapKey,
      securityGroup.key,
    );
    updateImageSecurityAggregate(aggregate, container, hasContainerSecurityIssue);
  }

  return {
    totalContainers: containers.length,
    runningContainers,
    updatesAvailable,
    freshUpdates,
    securityIssueImageCount: securityIssueImages.size,
    securityByImage: [...securityByImageMap.values()],
  };
}
