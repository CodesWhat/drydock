import type { ImageBackup } from '../model/backup.js';
import { type Container, deriveContainerIdentityKey } from '../model/container.js';
import { getErrorMessage } from './error.js';

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

/**
 * Build an immutable rollback reference when the backup recorded a digest.
 * The tag stays in the reference (`repo:tag@sha256:...`), the same form the
 * update path pins to: the daemon resolves the image by digest, so a retag
 * cannot change what is pulled, while the operator still sees which version
 * the rollback restored.
 */
export function buildRollbackImageReference(
  backup: Pick<ImageBackup, 'imageName' | 'imageTag' | 'imageDigest'>,
  fallbackDigest?: string,
): string {
  const digest = backup.imageDigest || fallbackDigest;
  if (!digest) {
    return `${backup.imageName}:${backup.imageTag}`;
  }
  return backup.imageTag
    ? `${backup.imageName}:${backup.imageTag}@${digest}`
    : `${backup.imageName}@${digest}`;
}

/** Thrown when a rollback has no digest and the security policy requires one. */
export class RollbackDigestRequiredError extends Error {}

/** Minimal shape of the post-pull identity binder a Docker-family trigger exposes. */
export interface RollbackImageIdentityBinder {
  bindPulledImageIdentity?: (
    dockerApi: unknown,
    imageReference: string,
    container: unknown,
    logContainer: { info: (msg: string) => void; warn: (msg: string) => void },
  ) => Promise<{ imageIdentity?: string; skipSecurityGate?: boolean }>;
  /**
   * Reports the same required/optional/disabled decision the update path
   * enforces, without coupling this module to the trigger's security gate
   * internals. A trigger that doesn't expose this counts as `disabled`.
   */
  getRollbackIdentityBindingPolicy?: (container: unknown) => 'required' | 'optional' | 'disabled';
}

/** Minimal shape of the Docker API needed to inspect a local image reference. */
interface RollbackLocalImageInspectApi {
  getImage?: (imageReference: string) => { inspect: () => Promise<{ Id?: string } | undefined> };
}

/**
 * Resolve the reference a rollback should pull and recreate from.
 *
 * Records written after backup-time digest capture already carry
 * `imageDigest` and go straight to `buildRollbackImageReference`. Older
 * records without one resolve a digest from the retained local image at
 * rollback time, through the same post-pull identity binding policy the
 * update path enforces (DR-32/DR-21): under a `required` policy, no
 * resolvable digest refuses the rollback rather than deploying whatever the
 * mutable tag now resolves to; under `optional`/`disabled`, or when the
 * trigger exposes no binder at all, it falls back to the tag and logs a
 * warning so the operator can see the rollback was not pinned.
 *
 * The local `repo:tag` the binder would inspect is only a valid digest
 * source when it still points at the retained backup image. A same-tag
 * update (`latest` -> `latest`) moves that local reference onto the newly
 * running image before the rollback ever runs, so inspecting it would pin
 * the "rollback" to the image already deployed rather than the one that was
 * backed up. Before calling the binder, this compares the local image's ID
 * to the container's current running image ID and treats a match as no
 * digest being available, following the same required/optional/disabled
 * policy as everywhere else in this function.
 */
export async function resolveRollbackImageReference(
  trigger: RollbackImageIdentityBinder,
  dockerApi: unknown,
  container: unknown,
  backup: Pick<ImageBackup, 'imageName' | 'imageTag' | 'imageDigest'>,
  logContainer: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<string> {
  if (backup.imageDigest) {
    return buildRollbackImageReference(backup);
  }

  if (typeof trigger.bindPulledImageIdentity !== 'function') {
    logContainer.warn(
      `No digest recorded for the backup of ${backup.imageName}:${backup.imageTag}; rolling back to the mutable tag`,
    );
    return buildRollbackImageReference(backup);
  }

  const localImageReference = `${backup.imageName}:${backup.imageTag}`;
  const runningImageId = (container as { image?: { id?: string } } | undefined)?.image?.id;
  let localImageId: string | undefined;
  try {
    const inspectApi = dockerApi as RollbackLocalImageInspectApi;
    if (typeof inspectApi.getImage === 'function') {
      const localImageInspect = await inspectApi.getImage(localImageReference).inspect();
      localImageId = localImageInspect?.Id?.trim();
    }
  } catch {
    localImageId = undefined;
  }

  if (localImageId && runningImageId && localImageId === runningImageId) {
    const policy =
      typeof trigger.getRollbackIdentityBindingPolicy === 'function'
        ? trigger.getRollbackIdentityBindingPolicy(container)
        : 'disabled';
    if (policy === 'required') {
      throw new RollbackDigestRequiredError(
        `Cannot roll back ${backup.imageName}:${backup.imageTag} to an immutable reference: the local tag now points at the running image, not the retained backup`,
      );
    }
    logContainer.warn(
      `The local ${backup.imageName}:${backup.imageTag} tag now points at the running image; no digest for the backup of ${backup.imageName}:${backup.imageTag}; rolling back to the mutable tag`,
    );
    return buildRollbackImageReference(backup);
  }

  let resolvedDigest: string | undefined;
  try {
    const binding = await trigger.bindPulledImageIdentity(
      dockerApi,
      localImageReference,
      container,
      logContainer,
    );
    if (binding.imageIdentity) {
      const separatorIndex = binding.imageIdentity.indexOf('@');
      resolvedDigest =
        separatorIndex >= 0 ? binding.imageIdentity.substring(separatorIndex + 1) : undefined;
    }
  } catch (error: unknown) {
    throw new RollbackDigestRequiredError(
      `Cannot roll back ${backup.imageName}:${backup.imageTag} to an immutable reference: ${getErrorMessage(error)}`,
    );
  }

  if (!resolvedDigest) {
    logContainer.warn(
      `No digest could be established for the rollback of ${backup.imageName}:${backup.imageTag}; rolling back to the mutable tag`,
    );
    return buildRollbackImageReference(backup);
  }

  return buildRollbackImageReference(backup, resolvedDigest);
}
