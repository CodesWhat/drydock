import {
  type Container,
  getCanonicalContainerName,
  normalizeContainerHealth,
} from '../../../model/container.js';
import { getErrorMessage } from '../../../util/error.js';

import {
  canonicalizeContainerName,
  getContainerDisplayName,
  shouldUpdateDisplayNameFromContainerName,
} from './docker-helpers.js';
import { areRuntimeDetailsEqual, getRuntimeDetailsFromInspect } from './runtime-details.js';

type UnknownRecord = Record<string, unknown>;

interface DockerContainerInspectLike {
  State: {
    Status: string;
    Health?: {
      Status?: string;
    };
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

interface ProcessDockerEventDependencies {
  watchCronDebounced: () => Promise<void>;
  ensureRemoteAuthHeaders: () => Promise<void>;
  inspectContainer: (containerId: string) => Promise<unknown>;
  getContainerFromStore: (containerId: string) => Container | undefined;
  updateContainerFromInspect: (containerFound: Container, containerInspect: unknown) => void;
  debug: (message: string) => void;
}

function resolveContainerIdFromDockerEvent(dockerEvent: unknown) {
  // Docker event payloads are not fully consistent across engine/API versions and transports:
  // some emit the container id at the top level (`id`), while others nest it under `Actor.ID`.
  // Read both paths so the watcher works reliably against local and remote daemons.
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
    const inspectName = (
      ((containerInspect as Record<string, unknown>)?.Name as string) || ''
    ).replace(/^\//, '');
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
    } else {
      // Container exists in Docker but not in the store. Schedule a refresh so
      // the next watch cycle picks it up. This covers rename races (the original
      // case) and containers that started after the initial create-event refresh
      // ran before the container was ready (e.g. transient errors during compose
      // updates where listContainers missed the not-yet-running container).
      await dependencies.watchCronDebounced();
    }
  } catch (e: unknown) {
    dependencies.debug(
      `Unable to get container details for container id=[${containerId}] (${getErrorMessage(e)})`,
    );
  }
}

interface UpdateContainerFromInspectDependencies {
  getCustomDisplayNameFromLabels: (labels: Record<string, string>) => string | undefined;
  /**
   * Field-level write (roadmap 7-STORE, slice 9 / spec 4.3): `patch` carries
   * only the fields this event actually changed, never the container's other
   * fields as this function last read them. A whole-record write here would
   * silently revert whatever an in-flight watch cycle wrote to `result`,
   * `image` etc. in the gap between that read and this write.
   */
  updateContainer: (id: string, patch: Omit<Partial<Container>, 'id'>) => void;
  logInfo?: (message: string) => void;
  /**
   * Re-derive label-driven fields (tagFamily, includeTags, etc.) from a fresh
   * label set and write them onto the container. Called when labels change.
   */
  applyDerivedLabelFieldsToContainer?: (
    container: Container,
    labels: Record<string, string>,
  ) => void;
}

/** Fields `applyDerivedLabelFieldsToContainer` may set (`container-init.ts`). */
const LABEL_DERIVED_PATCH_FIELDS = [
  'includeTags',
  'excludeTags',
  'transformTags',
  'tagFamily',
  'tagPinInfo',
  'linkTemplate',
  'portLabel',
  'actionTriggerInclude',
  'actionTriggerExclude',
  'notificationTriggerInclude',
  'notificationTriggerExclude',
  'actionTriggerAuto',
  'triggerInclude',
  'triggerExclude',
  'dependsOn',
  'dependsOnSource',
  'dependsOnAction',
  'updatePolicy',
  'updatePolicyDeclarative',
  'updatePolicyOverrides',
  'updatePolicySources',
] as const satisfies readonly (keyof Container)[];

function pickFields<T extends object, K extends keyof T>(
  source: T,
  fields: readonly K[],
): Pick<T, K> {
  const picked = {} as Pick<T, K>;
  for (const field of fields) {
    picked[field] = source[field];
  }
  return picked;
}

/** Only the fields whose value actually differs, comparing by content. */
function diffFields<T extends object, K extends keyof T>(
  before: Pick<T, K>,
  after: Pick<T, K>,
  fields: readonly K[],
): Partial<T> {
  const patch: Partial<T> = {};
  for (const field of fields) {
    if (JSON.stringify(after[field]) !== JSON.stringify(before[field])) {
      patch[field] = after[field];
    }
  }
  return patch;
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
  const newHealth = normalizeContainerHealth(dockerContainerInspect.State.Health?.Status);
  const oldHealth = containerFound.health;
  const rawName = (dockerContainerInspect.Name || '').replace(/^\//, '');
  const canonicalizedName = canonicalizeContainerName(rawName, containerFound.id);
  const oldStatus = containerFound.status;
  const oldName = containerFound.name;
  // The update executor renames the outgoing container to
  // `${oldName}-old-${Date.now()}` before creating its replacement. Persisting
  // that transient name would poison the doc: prune can no longer name-match
  // it and stashUpdatePolicyForReplacement's rollback-name guard then skips
  // the policy stash, so the replacement loses its update policy (#535). The
  // rename is provably ours only when stripping the rollback suffix
  // reconstructs this doc's current name — treat exactly that as a no-op.
  const newName =
    getCanonicalContainerName(canonicalizedName) === oldName ? oldName : canonicalizedName;
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
  const patch: Partial<Container> = {};

  if (oldStatus !== newStatus) {
    containerFound.status = newStatus;
    patch.status = newStatus;
    changed = true;
    dependencies.logInfo?.(`Status changed from ${oldStatus} to ${newStatus}`);
  }

  if (oldHealth !== newHealth) {
    containerFound.health = newHealth;
    patch.health = newHealth;
    changed = true;
    dependencies.logInfo?.(`Health changed from ${oldHealth} to ${newHealth}`);
  }

  if (newName !== '' && oldName !== newName) {
    containerFound.name = newName;
    patch.name = newName;
    changed = true;
    dependencies.logInfo?.(`Name changed from ${oldName} to ${newName}`);
  }

  if (labelsChanged) {
    containerFound.labels = labelsToApply;
    patch.labels = labelsToApply;
    if (dependencies.applyDerivedLabelFieldsToContainer) {
      const labelDerivedBefore = pickFields(containerFound, LABEL_DERIVED_PATCH_FIELDS);
      dependencies.applyDerivedLabelFieldsToContainer(containerFound, labelsToApply);
      Object.assign(
        patch,
        diffFields(
          labelDerivedBefore,
          pickFields(containerFound, LABEL_DERIVED_PATCH_FIELDS),
          LABEL_DERIVED_PATCH_FIELDS,
        ),
      );
    }
    changed = true;
  }

  if (runtimeDetailsChanged) {
    containerFound.details = runtimeDetailsFromInspect;
    patch.details = runtimeDetailsFromInspect;
    changed = true;
  }

  if (hasCustomDisplayName) {
    if (containerFound.displayName !== customDisplayNameFromLabel) {
      containerFound.displayName = customDisplayNameFromLabel;
      patch.displayName = customDisplayNameFromLabel;
      changed = true;
    }
  } else if (shouldUpdateDisplayNameFromContainerName(newName, oldName, oldDisplayName)) {
    containerFound.displayName = getContainerDisplayName(
      newName,
      containerFound.image?.name || '',
      undefined,
    );
    patch.displayName = containerFound.displayName;
    changed = true;
  }

  if (changed) {
    dependencies.updateContainer(containerFound.id, patch);
  }
}
