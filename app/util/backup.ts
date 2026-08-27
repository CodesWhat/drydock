import type { ImageBackup } from '../model/backup.js';
import { type Container, deriveContainerIdentityKey } from '../model/container.js';

export interface ContainerBackupScope {
  containerName: string;
  containerIdentityKey?: string;
  includeLegacy: boolean;
}

/**
 * Build the ownership scope used to select backups for a container.
 * Legacy backups without an identity are safe only while one active identity
 * owns the container name.
 */
export function createContainerBackupScope(
  container: Container,
  sameNamedContainers: Container[],
): ContainerBackupScope {
  const containerIdentityKey = container.identityKey ?? deriveContainerIdentityKey(container);
  const activeIdentityKeys = new Set<string>();
  let hasUnknownIdentity = false;

  for (const candidate of sameNamedContainers) {
    if (candidate.name !== container.name) {
      continue;
    }
    const candidateIdentityKey = candidate.identityKey ?? deriveContainerIdentityKey(candidate);
    if (candidateIdentityKey) {
      activeIdentityKeys.add(candidateIdentityKey);
    } else {
      hasUnknownIdentity = true;
    }
  }

  return {
    containerName: container.name,
    containerIdentityKey,
    includeLegacy:
      Boolean(containerIdentityKey) &&
      !hasUnknownIdentity &&
      activeIdentityKeys.size === 1 &&
      activeIdentityKeys.has(containerIdentityKey as string),
  };
}

/** Build an immutable rollback reference when the backup recorded a digest. */
export function buildRollbackImageReference(
  backup: Pick<ImageBackup, 'imageName' | 'imageTag' | 'imageDigest'>,
  fallbackDigest?: string,
): string {
  const digest = backup.imageDigest || fallbackDigest;
  return digest ? `${backup.imageName}@${digest}` : `${backup.imageName}:${backup.imageTag}`;
}
