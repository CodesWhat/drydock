import type { ContainerInfo, ImageInfo } from 'dockerode';
import * as backupStore from '../store/backup.js';
import { CLEANUP_EXCLUDE_LABEL } from './types.js';

const HOUR_MS = 3_600_000;

/** Drydock renames the replaced container to `<name>-old-<Date.now()>` during an update. */
const ROLLBACK_CONTAINER_NAME = /-old-(\d+)$/;

export function hoursToMs(hours: number): number {
  return hours * HOUR_MS;
}

/** True when the object carries `dd.cleanup.exclude=true`. */
export function hasExcludeLabel(labels: Record<string, string> | null | undefined): boolean {
  return labels?.[CLEANUP_EXCLUDE_LABEL] === 'true';
}

/** Docker's label filter form for prune calls: everything except excluded objects. */
export const EXCLUDE_LABEL_FILTER = `${CLEANUP_EXCLUDE_LABEL}=true`;

/**
 * A container Drydock renamed to `-old-<ts>` during an update stays protected
 * until the rollback window closes; the timestamp in the name is when the
 * rename happened. Older leftovers are ordinary stopped containers.
 */
export function isRecentRollbackContainer(
  container: ContainerInfo,
  protectHours: number,
  now: number,
): boolean {
  return (container.Names ?? []).some((name) => {
    const match = ROLLBACK_CONTAINER_NAME.exec(name);
    return match !== null && Number(match[1]) >= now - hoursToMs(protectHours);
  });
}

export interface RollbackImageProtection {
  isProtected(image: ImageInfo): boolean;
}

/**
 * Images that are the rollback backup of a recent Drydock update. The backup
 * store records them by `name:tag` and registry digest; a same-tag update
 * leaves the backup image untagged, so the digest match is what keeps it.
 * Backups are not host-scoped in the store, so the protection is global.
 */
export function buildRollbackImageProtection(
  protectHours: number,
  now: number,
): RollbackImageProtection {
  const cutoff = now - hoursToMs(protectHours);
  const refs = new Set<string>();
  const digests = new Set<string>();
  for (const backup of backupStore.getAllBackups()) {
    if (Date.parse(backup.timestamp) < cutoff) {
      continue;
    }
    refs.add(`${backup.imageName}:${backup.imageTag}`);
    if (backup.imageDigest) {
      digests.add(backup.imageDigest);
    }
  }

  return {
    isProtected(image) {
      const tagged = (image.RepoTags ?? []).some((tag) =>
        [...refs].some((ref) => tag === ref || tag.endsWith(`/${ref}`)),
      );
      if (tagged) {
        return true;
      }
      return (image.RepoDigests ?? []).some((entry) =>
        [...digests].some((digest) => entry.endsWith(`@${digest}`)),
      );
    },
  };
}
