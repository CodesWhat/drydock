import type { ApprovalRecord } from '@/services/approval';
import { daysToMs } from '../../utils/time';
import { containers } from './containers';

type DemoContainer = (typeof containers)[number];

function toRecord(
  containerName: string,
  overrides: Partial<ApprovalRecord> & { createdDaysAgo: number },
): ApprovalRecord {
  const container = containers.find((c) => c.name === containerName) as DemoContainer;
  const { createdDaysAgo, ...rest } = overrides;
  const createdAtMs = Date.now() - daysToMs(createdDaysAgo);
  const fromRef = `${container.image.name}:${container.image.tag.value}`;
  const toTag = container.result?.tag ?? container.image.tag.value;
  const toRef = `${container.image.name}:${toTag}`;
  const scan = container.security?.updateScan?.summary ?? container.security?.scan?.summary;
  return {
    schemaVersion: 1,
    id: `apr-${container.name}-${toTag}`,
    containerId: container.id,
    containerIdentityKey: `${container.watcher}.${container.name}`,
    containerName: container.name,
    watcher: container.watcher,
    image: container.image.name,
    fromRef,
    toRef,
    candidateRef: toRef,
    updateKind: container.updateKind?.kind === 'digest' ? 'digest' : 'tag',
    semverDiff: (container.updateKind?.semverDiff ?? 'unknown') as ApprovalRecord['semverDiff'],
    ...(scan
      ? {
          scanCritical: scan.critical,
          scanHigh: scan.high,
          scanMedium: scan.medium,
          scanLow: scan.low,
          scanUnknown: scan.unknown,
          scanAt: new Date(createdAtMs).toISOString(),
        }
      : {}),
    createdAt: new Date(createdAtMs).toISOString(),
    createdAtMs,
    decision: 'pending',
    ...rest,
  };
}

/** Seeded from the demo containers that report an available update. */
export function createApprovalSeed(): ApprovalRecord[] {
  return [
    toRecord('grafana', {
      createdDaysAgo: 2,
      releaseNotesUrl: 'https://github.com/grafana/grafana/releases/tag/v11.4.0',
    }),
    toRecord('loki', { createdDaysAgo: 3 }),
    toRecord('jellyfin', {
      createdDaysAgo: 4,
      releaseNotesUrl: 'https://github.com/jellyfin/jellyfin/releases/tag/v10.10.6',
    }),
    toRecord('authelia', { createdDaysAgo: 1 }),
    toRecord('prowlarr', {
      createdDaysAgo: 5,
      decision: 'deferred',
      decidedAt: new Date(Date.now() - daysToMs(1)).toISOString(),
      decidedBy: 'demo',
      decisionNote: 'Waiting for the weekend maintenance window',
      deferredUntil: new Date(Date.now() + daysToMs(4)).toISOString(),
    }),
  ];
}
