import type { Container } from '../../../model/container.js';

import {
  getContainerDisplayName,
  shouldUpdateDisplayNameFromContainerName,
} from './docker-helpers.js';
import { areRuntimeDetailsEqual, getRuntimeDetailsFromInspect } from './runtime-details.js';

type UnknownRecord = Record<string, unknown>;

interface DockerContainerInspectLike {
  State: {
    Status: string;
  };
  Name?: string;
  Config?: {
    Labels?: Record<string, string>;
  };
}

function asUnknownRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as UnknownRecord;
}

function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  const errorRecord = asUnknownRecord(error);
  if (!errorRecord) {
    return 'unknown error';
  }
  return typeof errorRecord.message === 'string' ? errorRecord.message : 'unknown error';
}

export interface ProcessDockerEventDependencies {
  watchCronDebounced: () => Promise<void>;
  ensureRemoteAuthHeaders: () => Promise<void>;
  inspectContainer: (containerId: string) => Promise<unknown>;
  getContainerFromStore: (containerId: string) => Container | undefined;
  updateContainerFromInspect: (containerFound: Container, containerInspect: unknown) => void;
  debug: (message: string) => void;
}

function resolveContainerIdFromDockerEvent(dockerEvent: unknown) {
  const dockerEventRecord = asUnknownRecord(dockerEvent);
  if (!dockerEventRecord) {
    return undefined;
  }

  if (typeof dockerEventRecord.id === 'string' && dockerEventRecord.id !== '') {
    return dockerEventRecord.id;
  }

  const actorRecord = asUnknownRecord(dockerEventRecord.Actor);
  if (typeof actorRecord?.ID === 'string' && actorRecord.ID !== '') {
    return actorRecord.ID;
  }

  return undefined;
}

export async function processDockerEvent(
  dockerEvent: unknown,
  dependencies: ProcessDockerEventDependencies,
) {
  const action = asUnknownRecord(dockerEvent)?.Action;
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
    const containerFound = dependencies.getContainerFromStore(containerId);

    if (containerFound) {
      dependencies.updateContainerFromInspect(containerFound, containerInspect);
    } else if (action === 'rename') {
      // Rename can race with create and happen before the new container is in store.
      // Schedule a full refresh so the final human-readable name is captured.
      await dependencies.watchCronDebounced();
    }
  } catch (e: unknown) {
    dependencies.debug(
      `Unable to get container details for container id=[${containerId}] (${getErrorMessage(e)})`,
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
  containerInspect: unknown,
  dependencies: UpdateContainerFromInspectDependencies,
) {
  const dockerContainerInspect = containerInspect as DockerContainerInspectLike;
  const newStatus = dockerContainerInspect.State.Status;
  const newName = (dockerContainerInspect.Name || '').replace(/^\//, '');
  const oldStatus = containerFound.status;
  const oldName = containerFound.name;
  const oldDisplayName = containerFound.displayName;

  const labelsFromInspect = dockerContainerInspect.Config?.Labels;
  const labelsCurrent = containerFound.labels || {};
  const labelsToApply = labelsFromInspect || labelsCurrent;
  const labelsChanged = !areLabelsEqual(labelsCurrent, labelsToApply);

  const customDisplayNameFromLabel = dependencies.getCustomDisplayNameFromLabels(labelsToApply);
  const hasCustomDisplayName =
    customDisplayNameFromLabel && customDisplayNameFromLabel.trim() !== '';
  const runtimeDetailsFromInspect = getRuntimeDetailsFromInspect(dockerContainerInspect);
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
