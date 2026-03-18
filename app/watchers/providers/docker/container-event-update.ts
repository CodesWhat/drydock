import type { Container } from '../../../model/container.js';

import {
  getContainerDisplayName,
  shouldUpdateDisplayNameFromContainerName,
} from './docker-helpers.js';
import { areRuntimeDetailsEqual, getRuntimeDetailsFromInspect } from './runtime-details.js';

const RECREATED_CONTAINER_NAME_PATTERN = /^([a-f0-9]{12})_(.+)$/i;
const RECREATED_CONTAINER_ALIAS_TRANSIENT_WINDOW_MS = 30 * 1000;

export function isRecreatedContainerAlias(containerId: string, containerName: string): boolean {
  const match = containerName.match(RECREATED_CONTAINER_NAME_PATTERN);
  if (!match) {
    return false;
  }
  const [, shortIdPrefix] = match;
  return containerId.toLowerCase().startsWith(shortIdPrefix.toLowerCase());
}

function parseTimestampToMs(timestamp: unknown): number | undefined {
  if (typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0) {
    return timestamp >= 1_000_000_000_000 ? Math.trunc(timestamp) : Math.trunc(timestamp * 1000);
  }
  if (typeof timestamp === 'string' && timestamp !== '') {
    const parsed = Date.parse(timestamp);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function getContainerCreatedAtMs(containerInspect: any): number | undefined {
  return (
    parseTimestampToMs(containerInspect?.Created) ??
    parseTimestampToMs(containerInspect?.State?.StartedAt)
  );
}

function isWithinRecreatedAliasTransientWindow(
  createdAtMs: number | undefined,
  nowMs: number,
): boolean {
  if (createdAtMs === undefined) {
    return false;
  }
  const ageMs = nowMs - createdAtMs;
  if (ageMs < 0) {
    return false;
  }
  return ageMs <= RECREATED_CONTAINER_ALIAS_TRANSIENT_WINDOW_MS;
}

export interface ProcessDockerEventDependencies {
  watchCronDebounced: () => Promise<void>;
  ensureRemoteAuthHeaders: () => Promise<void>;
  inspectContainer: (containerId: string) => Promise<any>;
  getContainerFromStore: (containerId: string) => Container | undefined;
  updateContainerFromInspect: (containerFound: Container, containerInspect: unknown) => void;
  debug: (message: string) => void;
}

function resolveContainerIdFromDockerEvent(dockerEvent: any) {
  // Docker event payloads are not fully consistent across engine/API versions and transports:
  // some emit the container id at the top level (`id`), while others nest it under `Actor.ID`.
  // Read both paths so the watcher works reliably against local and remote daemons.
  if (typeof dockerEvent?.id === 'string' && dockerEvent.id !== '') {
    return dockerEvent.id;
  }

  if (typeof dockerEvent?.Actor?.ID === 'string' && dockerEvent.Actor.ID !== '') {
    return dockerEvent.Actor.ID;
  }

  return undefined;
}

export async function processDockerEvent(
  dockerEvent: any,
  dependencies: ProcessDockerEventDependencies,
) {
  const action = dockerEvent.Action;
  const containerId = resolveContainerIdFromDockerEvent(dockerEvent);

  if (action === 'destroy' || action === 'create') {
    await dependencies.watchCronDebounced();
    return;
  }

  if (!containerId) {
    dependencies.debug(`Skipping docker event action=[${action}] because container id is missing`);
    await dependencies.watchCronDebounced();
    return;
  }

  try {
    await dependencies.ensureRemoteAuthHeaders();
    const containerInspect = await dependencies.inspectContainer(containerId);
    const inspectName = (containerInspect?.Name || '').replace(/^\//, '');
    const isAlias = isRecreatedContainerAlias(containerId, inspectName);
    const isTransientAlias = isWithinRecreatedAliasTransientWindow(
      getContainerCreatedAtMs(containerInspect),
      Date.now(),
    );

    // Transient aliases should be ignored briefly during recreate/rename races.
    // Do not suppress indefinitely, otherwise a persistent alias can become a blind spot.
    if (isAlias && isTransientAlias) {
      dependencies.debug(
        `Skipping transient recreated container alias action=[${action}] id=[${containerId}]`,
      );
      await dependencies.watchCronDebounced();
      return;
    }
    if (isAlias) {
      dependencies.debug(
        `Recreated container alias persisted beyond transient window id=[${containerId}]; scheduling refresh`,
      );
      await dependencies.watchCronDebounced();
      return;
    }

    const containerFound = dependencies.getContainerFromStore(containerId);

    if (containerFound) {
      dependencies.updateContainerFromInspect(containerFound, containerInspect);
    } else if (action === 'rename') {
      // Rename can race with create and happen before the new container is in store.
      // Schedule a full refresh so the final human-readable name is captured.
      await dependencies.watchCronDebounced();
    }
  } catch (e: any) {
    dependencies.debug(
      `Unable to get container details for container id=[${containerId}] (${e.message})`,
    );
  }
}

export interface UpdateContainerFromInspectDependencies {
  getCustomDisplayNameFromLabels: (labels: Record<string, string>) => string | undefined;
  updateContainer: (container: Container) => void;
  logInfo?: (message: string) => void;
}

function areLabelsEqual(labelsA: Record<string, string>, labelsB: Record<string, string>): boolean {
  if (labelsA === labelsB) {
    return true;
  }

  const labelsAKeys = Object.keys(labelsA);
  const labelsBKeys = Object.keys(labelsB);
  if (labelsAKeys.length !== labelsBKeys.length) {
    return false;
  }

  for (const key of labelsAKeys) {
    if (labelsA[key] !== labelsB[key]) {
      return false;
    }
  }

  return true;
}

export function updateContainerFromInspect(
  containerFound: Container,
  containerInspect: any,
  dependencies: UpdateContainerFromInspectDependencies,
) {
  const newStatus = containerInspect.State.Status;
  const newName = (containerInspect.Name || '').replace(/^\//, '');
  const oldStatus = containerFound.status;
  const oldName = containerFound.name;
  const oldDisplayName = containerFound.displayName;

  const labelsFromInspect = containerInspect.Config?.Labels;
  const labelsCurrent = containerFound.labels || {};
  const labelsToApply = labelsFromInspect || labelsCurrent;
  const labelsChanged = !areLabelsEqual(labelsCurrent, labelsToApply);

  const customDisplayNameFromLabel = dependencies.getCustomDisplayNameFromLabels(labelsToApply);
  const hasCustomDisplayName =
    customDisplayNameFromLabel && customDisplayNameFromLabel.trim() !== '';
  const runtimeDetailsFromInspect = getRuntimeDetailsFromInspect(containerInspect);
  const runtimeDetailsChanged = !areRuntimeDetailsEqual(
    containerFound.details,
    runtimeDetailsFromInspect,
  );

  let changed = false;

  if (oldStatus !== newStatus) {
    containerFound.status = newStatus;
    changed = true;
    dependencies.logInfo?.(`Status changed from ${oldStatus} to ${newStatus}`);
  }

  if (newName !== '' && oldName !== newName) {
    containerFound.name = newName;
    changed = true;
    dependencies.logInfo?.(`Name changed from ${oldName} to ${newName}`);
  }

  if (labelsChanged) {
    containerFound.labels = labelsToApply;
    changed = true;
  }

  if (runtimeDetailsChanged) {
    containerFound.details = runtimeDetailsFromInspect;
    changed = true;
  }

  if (hasCustomDisplayName) {
    if (containerFound.displayName !== customDisplayNameFromLabel) {
      containerFound.displayName = customDisplayNameFromLabel;
      changed = true;
    }
  } else if (shouldUpdateDisplayNameFromContainerName(newName, oldName, oldDisplayName)) {
    containerFound.displayName = getContainerDisplayName(
      newName,
      containerFound.image?.name || '',
      undefined,
    );
    changed = true;
  }

  if (changed) {
    dependencies.updateContainer(containerFound);
  }
}
