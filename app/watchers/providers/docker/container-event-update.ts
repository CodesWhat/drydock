import type { Container } from '../../../model/container.js';

import {
  getContainerDisplayName,
  shouldUpdateDisplayNameFromContainerName,
} from './docker-helpers.js';
import { areRuntimeDetailsEqual, getRuntimeDetailsFromInspect } from './runtime-details.js';

export interface ProcessDockerEventDependencies {
  watchCronDebounced: () => Promise<void>;
  ensureRemoteAuthHeaders: () => Promise<void>;
  inspectContainer: (containerId: string) => Promise<any>;
  getContainerFromStore: (containerId: string) => Container | undefined;
  updateContainerFromInspect: (containerFound: Container, containerInspect: any) => void;
  debug: (message: string) => void;
}

export async function processDockerEvent(
  dockerEvent: any,
  dependencies: ProcessDockerEventDependencies,
) {
  const action = dockerEvent.Action;
  const containerId = dockerEvent.id;

  if (action === 'destroy' || action === 'create') {
    await dependencies.watchCronDebounced();
    return;
  }

  try {
    await dependencies.ensureRemoteAuthHeaders();
    const containerInspect = await dependencies.inspectContainer(containerId);
    const containerFound = dependencies.getContainerFromStore(containerId);

    if (containerFound) {
      dependencies.updateContainerFromInspect(containerFound, containerInspect);
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
