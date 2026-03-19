import { getPreferredLabelValue } from '../../../docker/legacy-label.js';
import log from '../../../log/index.js';
import type { Container } from '../../../model/container.js';
import { recordLegacyInput } from '../../../prometheus/compatibility.js';
import * as storeContainer from '../../../store/container.js';
import type Watcher from '../../Watcher.js';
import {
  getContainerConfigValue,
  getContainerName,
  getFirstConfigString,
  getImgsetSpecificity,
  getOldContainers,
  getResolvedImgsetConfiguration,
  type ResolvedImgset,
} from './docker-helpers.js';
import type { ContainerLabelOverrides } from './docker-image-details-orchestration.js';
import {
  ddActionExclude,
  ddActionInclude,
  ddDisplayIcon,
  ddDisplayName,
  ddInspectTagPath,
  ddLinkTemplate,
  ddNotificationExclude,
  ddNotificationInclude,
  ddRegistryLookupImage,
  ddRegistryLookupUrl,
  ddTagExclude,
  ddTagFamily,
  ddTagInclude,
  ddTagTransform,
  ddTriggerExclude,
  ddTriggerInclude,
  ddWatchDigest,
  wudDisplayIcon,
  wudDisplayName,
  wudInspectTagPath,
  wudLinkTemplate,
  wudRegistryLookupImage,
  wudRegistryLookupUrl,
  wudTagExclude,
  wudTagInclude,
  wudTagTransform,
  wudTriggerExclude,
  wudTriggerInclude,
  wudWatchDigest,
} from './label.js';

const warnedLegacyLabelFallbacks = new Set<string>();
const warnedLegacyTriggerLabelFallbacks = new Set<string>();
const RECREATED_CONTAINER_NAME_PATTERN = /^([a-f0-9]{12})_(.+)$/i;
const RECREATED_CONTAINER_ALIAS_TRANSIENT_WINDOW_MS = 30 * 1000;

type ContainerLabelOverrideKey = Exclude<
  keyof ContainerLabelOverrides,
  'registryLookupImage' | 'registryLookupUrl'
>;

interface ResolvedContainerLabelOverrides {
  includeTags?: string;
  excludeTags?: string;
  transformTags?: string;
  tagFamily?: string;
  inspectTagPath?: string;
  linkTemplate?: string;
  displayName?: string;
  displayIcon?: string;
  triggerInclude?: string;
  triggerExclude?: string;
  lookupImage?: string;
}

interface ImgsetMatchCandidate {
  specificity: number;
  imgset: ResolvedImgset;
}

interface DockerContainerSummaryLike {
  Id?: unknown;
  Names?: string[];
  [key: string]: unknown;
}

export interface AliasFilterDecision {
  timestamp: string;
  containerId: string;
  containerName: string;
  baseName?: string;
  decision: 'allowed' | 'skipped';
  reason:
    | 'not-recreated-alias'
    | 'base-name-present-in-docker'
    | 'base-name-present-in-store'
    | 'fresh-recreated-alias'
    | 'alias-allowed-no-collision';
}

type DockerImgsetConfigurations = Record<string, unknown>;

interface DockerApiContainerInspector {
  getContainer: (containerId: string) => {
    inspect: () => Promise<{
      State?: {
        Status?: string;
      };
    }>;
  };
}

interface DockerWatcherSourceConfiguration {
  host?: string;
  socket?: string;
  protocol?: string;
  port?: number;
}

interface DockerWatcherSourceLike {
  name?: string;
  agent?: string;
  configuration?: DockerWatcherSourceConfiguration;
}

interface GetLabelOptions {
  warn?: (message: string) => void;
  warnedLegacyTriggerLabels?: Set<string>;
}

const containerLabelOverrideMappings = [
  { key: 'includeTags', ddKey: ddTagInclude, wudKey: wudTagInclude, overrideKey: 'includeTags' },
  { key: 'excludeTags', ddKey: ddTagExclude, wudKey: wudTagExclude, overrideKey: 'excludeTags' },
  {
    key: 'transformTags',
    ddKey: ddTagTransform,
    wudKey: wudTagTransform,
    overrideKey: 'transformTags',
  },
  {
    key: 'tagFamily',
    ddKey: ddTagFamily,
    wudKey: undefined,
    overrideKey: 'tagFamily',
  },
  {
    key: 'inspectTagPath',
    ddKey: ddInspectTagPath,
    wudKey: wudInspectTagPath,
    overrideKey: undefined,
  },
  {
    key: 'linkTemplate',
    ddKey: ddLinkTemplate,
    wudKey: wudLinkTemplate,
    overrideKey: 'linkTemplate',
  },
  { key: 'displayName', ddKey: ddDisplayName, wudKey: wudDisplayName, overrideKey: 'displayName' },
  { key: 'displayIcon', ddKey: ddDisplayIcon, wudKey: wudDisplayIcon, overrideKey: 'displayIcon' },
  {
    key: 'triggerInclude',
    ddKey: ddTriggerInclude,
    wudKey: wudTriggerInclude,
    overrideKey: 'triggerInclude',
  },
  {
    key: 'triggerExclude',
    ddKey: ddTriggerExclude,
    wudKey: wudTriggerExclude,
    overrideKey: 'triggerExclude',
  },
] as const satisfies ReadonlyArray<{
  key: keyof ResolvedContainerLabelOverrides;
  ddKey: string;
  wudKey?: string;
  overrideKey?: ContainerLabelOverrideKey;
}>;

/**
 * Get a label value, preferring the dd.* key over the wud.* fallback.
 */
export function getLabel(
  labels: Record<string, string>,
  ddKey: string,
  wudKey?: string,
  options: GetLabelOptions = {},
) {
  if (ddKey === ddTriggerInclude || ddKey === ddTriggerExclude) {
    return getPreferredTriggerLabelValue(labels, ddKey, wudKey, options);
  }

  return getPreferredLabelValue(labels, ddKey, wudKey, {
    warnedFallbacks: warnedLegacyLabelFallbacks,
    warn: options.warn || ((message) => log.warn(message)),
  });
}

function getPreferredTriggerLabelValue(
  labels: Record<string, string>,
  ddKey: string,
  wudKey: string | undefined,
  options: GetLabelOptions,
) {
  const warnedLegacyTriggerLabels =
    options.warnedLegacyTriggerLabels || warnedLegacyTriggerLabelFallbacks;
  const warn = options.warn || ((message) => log.warn(message));
  const aliasKeys =
    ddKey === ddTriggerInclude
      ? [ddActionInclude, ddNotificationInclude]
      : [ddActionExclude, ddNotificationExclude];
  const aliasValue = getFirstLabelValue(labels, aliasKeys);
  const legacyValue = labels[ddKey];

  if (aliasValue !== undefined) {
    if (legacyValue !== undefined) {
      recordLegacyInput('label', ddKey);
      warnLegacyTriggerLabel(ddKey, warnedLegacyTriggerLabels, warn);
    }
    return aliasValue;
  }

  if (legacyValue !== undefined) {
    recordLegacyInput('label', ddKey);
    warnLegacyTriggerLabel(ddKey, warnedLegacyTriggerLabels, warn);
    return legacyValue;
  }

  return getPreferredLabelValue(labels, ddKey, wudKey, {
    warnedFallbacks: warnedLegacyLabelFallbacks,
    warn,
  });
}

function getFirstLabelValue(labels: Record<string, string>, keys: readonly string[]) {
  for (const key of keys) {
    const value = labels[key];
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function warnLegacyTriggerLabel(
  ddKey: string,
  warnedLegacyTriggerLabels: Set<string>,
  warn: (message: string) => void,
) {
  if (warnedLegacyTriggerLabels.has(ddKey)) {
    return;
  }
  warnedLegacyTriggerLabels.add(ddKey);

  const aliasKeySuffix = ddKey === ddTriggerInclude ? 'include' : 'exclude';

  warn(
    `Legacy Docker label "${ddKey}" is deprecated. Please migrate to "dd.action.${aliasKeySuffix}" or "dd.notification.${aliasKeySuffix}" before removal in v1.7.0.`,
  );
}

/**
 * Prune old containers from the store.
 * Containers that still exist in Docker (e.g. stopped) get their status updated
 * instead of being removed, so the UI can still show them with a start button.
 * @param newContainers
 * @param containersFromTheStore
 * @param dockerApi
 */
export async function pruneOldContainers(
  newContainers: Container[],
  containersFromTheStore: Container[],
  dockerApi: DockerApiContainerInspector,
  options: {
    forceRemoveContainerIds?: Set<string>;
    sameSourceContainersFromStore?: Container[];
  } = {},
) {
  const forceRemoveContainerIds = options.forceRemoveContainerIds || new Set<string>();
  const containersToRemove = getOldContainers(newContainers, containersFromTheStore);
  const containersToNamePrune = getOldContainers(
    newContainers,
    options.sameSourceContainersFromStore || containersFromTheStore,
  );
  const newContainerNames = new Set(
    newContainers
      .filter((container) => typeof container.name === 'string' && container.name !== '')
      .map((container) => container.name),
  );
  const deletedContainerIds = new Set<string>();
  for (const staleContainer of containersToNamePrune) {
    if (
      typeof staleContainer.name === 'string' &&
      staleContainer.name !== '' &&
      newContainerNames.has(staleContainer.name)
    ) {
      storeContainer.deleteContainer(staleContainer.id);
      deletedContainerIds.add(staleContainer.id);
    }
  }
  for (const containerToRemove of containersToRemove) {
    if (deletedContainerIds.has(containerToRemove.id)) {
      continue;
    }
    if (
      typeof containerToRemove.id === 'string' &&
      forceRemoveContainerIds.has(containerToRemove.id)
    ) {
      storeContainer.deleteContainer(containerToRemove.id);
      continue;
    }
    try {
      const inspectResult = await dockerApi.getContainer(containerToRemove.id).inspect();
      const newStatus = inspectResult?.State?.Status;
      if (newStatus) {
        storeContainer.updateContainer({ ...containerToRemove, status: newStatus });
      }
    } catch (_error: unknown) {
      // Container no longer exists in Docker — remove from store
      storeContainer.deleteContainer(containerToRemove.id);
    }
  }
}

function normalizeWatcherSourceStringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized === '' ? undefined : normalized;
}

export function getDockerWatcherRegistryId(watcherName: string, agent?: string): string {
  const normalizedWatcherName = normalizeWatcherSourceStringValue(watcherName);
  if (!normalizedWatcherName) {
    return '';
  }
  const normalizedAgent = normalizeWatcherSourceStringValue(agent);
  if (!normalizedAgent) {
    return `docker.${normalizedWatcherName}`;
  }
  return `${normalizedAgent}.docker.${normalizedWatcherName}`;
}

export function getDockerWatcherSourceKey(watcher: DockerWatcherSourceLike): string {
  const normalizedAgent = normalizeWatcherSourceStringValue(watcher.agent) || '';
  const normalizedHost = normalizeWatcherSourceStringValue(watcher.configuration?.host);
  if (normalizedHost) {
    const normalizedProtocol =
      normalizeWatcherSourceStringValue(watcher.configuration?.protocol)?.toLowerCase() || 'http';
    const normalizedPort =
      typeof watcher.configuration?.port === 'number' &&
      Number.isFinite(watcher.configuration.port) &&
      watcher.configuration.port > 0
        ? Math.trunc(watcher.configuration.port)
        : 2375;
    return `agent:${normalizedAgent}|tcp:${normalizedProtocol}://${normalizedHost.toLowerCase()}:${normalizedPort}`;
  }

  const normalizedSocket =
    normalizeWatcherSourceStringValue(watcher.configuration?.socket) || '/var/run/docker.sock';
  return `agent:${normalizedAgent}|socket:${normalizedSocket}`;
}

export function isDockerWatcher(
  watcher: Watcher | undefined,
): watcher is Watcher & { type: 'docker' } {
  return !!watcher && watcher.type === 'docker';
}

function getRecreatedContainerBaseName(container: { Id?: unknown; Names?: string[] }) {
  const containerId = typeof container.Id === 'string' ? container.Id : '';
  if (containerId === '') {
    return undefined;
  }

  const containerName = getContainerName(container);
  if (containerName === '') {
    return undefined;
  }

  const recreatedNameMatch = containerName.match(RECREATED_CONTAINER_NAME_PATTERN);
  if (!recreatedNameMatch) {
    return undefined;
  }

  const [, shortIdPrefix, baseName] = recreatedNameMatch;
  if (baseName === '' || !containerId.toLowerCase().startsWith(shortIdPrefix.toLowerCase())) {
    return undefined;
  }

  return baseName;
}

function getDockerContainerId(container: { Id?: unknown }) {
  return typeof container.Id === 'string' ? container.Id : '';
}

function getContainerCreatedAtMs(container: Record<string, unknown>): number | undefined {
  const created = container.Created;
  if (typeof created === 'number' && Number.isFinite(created) && created > 0) {
    // Docker list payloads typically expose Created as Unix seconds.
    // Handle both seconds and milliseconds defensively.
    return created >= 1_000_000_000_000 ? Math.trunc(created) : Math.trunc(created * 1000);
  }

  if (typeof created !== 'string') {
    return undefined;
  }

  const createdValue = created.trim();
  if (createdValue === '') {
    return undefined;
  }

  const numericCreatedValue = Number(createdValue);
  if (Number.isFinite(numericCreatedValue) && numericCreatedValue > 0) {
    return numericCreatedValue >= 1_000_000_000_000
      ? Math.trunc(numericCreatedValue)
      : Math.trunc(numericCreatedValue * 1000);
  }

  const parsedDateValue = Date.parse(createdValue);
  return Number.isNaN(parsedDateValue) ? undefined : parsedDateValue;
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

function buildDockerContainerNameToIds<T extends DockerContainerSummaryLike>(containers: T[]) {
  const dockerContainerNameToIds = new Map<string, Set<string>>();

  for (const container of containers) {
    const containerId = getDockerContainerId(container);
    if (containerId === '') {
      continue;
    }

    const normalizedContainerNames = Array.from(
      new Set(
        (Array.isArray(container.Names) ? container.Names : [])
          .map((name) => (typeof name === 'string' ? name.replace(/^\//, '') : ''))
          .filter((name) => name !== ''),
      ),
    );

    if (normalizedContainerNames.length === 0) {
      const fallbackName = getContainerName(container);
      if (fallbackName !== '') {
        normalizedContainerNames.push(fallbackName);
      }
    }

    for (const containerName of normalizedContainerNames) {
      const idsForName = dockerContainerNameToIds.get(containerName) || new Set<string>();
      idsForName.add(containerId);
      dockerContainerNameToIds.set(containerName, idsForName);
    }
  }

  return dockerContainerNameToIds;
}

function hasSiblingDockerContainerWithName(
  dockerContainerNameToIds: Map<string, Set<string>>,
  containerName: string,
  containerId: string,
) {
  const containerIds = dockerContainerNameToIds.get(containerName);
  if (!containerIds) {
    return false;
  }

  for (const currentContainerId of containerIds) {
    if (currentContainerId !== containerId) {
      return true;
    }
  }

  return false;
}

function hasCurrentContainerWithName(container: DockerContainerSummaryLike, containerName: string) {
  if (!Array.isArray(container.Names) || container.Names.length === 0) {
    return false;
  }

  return container.Names.some(
    (name) => typeof name === 'string' && name.replace(/^\//, '') === containerName,
  );
}

export function filterRecreatedContainerAliases<T extends DockerContainerSummaryLike>(
  containers: T[],
  containersFromTheStore: Container[],
): { containersToWatch: T[]; skippedContainerIds: Set<string>; decisions: AliasFilterDecision[] } {
  const storeContainerNames = new Set(
    containersFromTheStore
      .filter((container) => typeof container.name === 'string' && container.name !== '')
      .map((container) => container.name),
  );

  const dockerContainerNameToIds = buildDockerContainerNameToIds(containers);
  const nowMs = Date.now();

  const containersToWatch: T[] = [];
  const skippedContainerIds = new Set<string>();
  const decisions: AliasFilterDecision[] = [];
  const nowIso = new Date(nowMs).toISOString();
  for (const container of containers) {
    const containerId = getDockerContainerId(container);
    const containerName = getContainerName(container);
    const displayContainerName = containerName || '(unknown)';
    const recreatedContainerBaseName = getRecreatedContainerBaseName(container);

    if (!recreatedContainerBaseName || containerId === '') {
      containersToWatch.push(container);
      decisions.push({
        timestamp: nowIso,
        containerId: containerId || '(unknown)',
        containerName: displayContainerName,
        decision: 'allowed',
        reason: 'not-recreated-alias',
      });
      continue;
    }

    const hasDockerSiblingContainerWithBaseName = hasSiblingDockerContainerWithName(
      dockerContainerNameToIds,
      recreatedContainerBaseName,
      containerId,
    );
    const hasCurrentContainerWithBaseName = hasCurrentContainerWithName(
      container,
      recreatedContainerBaseName,
    );
    const hasDockerContainerWithBaseName =
      hasDockerSiblingContainerWithBaseName || hasCurrentContainerWithBaseName;
    const hasStoreContainerWithBaseName = storeContainerNames.has(recreatedContainerBaseName);
    const isFreshAlias = isWithinRecreatedAliasTransientWindow(
      getContainerCreatedAtMs(container),
      nowMs,
    );

    if (hasDockerContainerWithBaseName || hasStoreContainerWithBaseName || isFreshAlias) {
      skippedContainerIds.add(containerId);
      const reason = hasDockerContainerWithBaseName
        ? 'base-name-present-in-docker'
        : hasStoreContainerWithBaseName
          ? 'base-name-present-in-store'
          : 'fresh-recreated-alias';
      decisions.push({
        timestamp: nowIso,
        containerId,
        containerName: displayContainerName,
        baseName: recreatedContainerBaseName,
        decision: 'skipped',
        reason,
      });
      continue;
    }

    containersToWatch.push(container);
    decisions.push({
      timestamp: nowIso,
      containerId,
      containerName: displayContainerName,
      baseName: recreatedContainerBaseName,
      decision: 'allowed',
      reason: 'alias-allowed-no-collision',
    });
  }

  return { containersToWatch, skippedContainerIds, decisions };
}

export function resolveLabelsFromContainer(
  containerLabels: Record<string, string>,
  overrides: ContainerLabelOverrides = {},
) {
  const resolvedOverrides: ResolvedContainerLabelOverrides = {
    lookupImage: resolveLookupImageFromContainerLabels(containerLabels, overrides),
  };

  for (const { key, ddKey, wudKey, overrideKey } of containerLabelOverrideMappings) {
    const overrideValue = overrideKey ? overrides[overrideKey] : undefined;
    resolvedOverrides[key] = overrideValue || getLabel(containerLabels, ddKey, wudKey);
  }

  return resolvedOverrides;
}

function resolveLookupImageFromContainerLabels(
  containerLabels: Record<string, string>,
  overrides: ContainerLabelOverrides,
) {
  return (
    overrides.registryLookupImage ||
    getLabel(containerLabels, ddRegistryLookupImage, wudRegistryLookupImage) ||
    overrides.registryLookupUrl ||
    getLabel(containerLabels, ddRegistryLookupUrl, wudRegistryLookupUrl)
  );
}

export function mergeConfigWithImgset(
  labelOverrides: ResolvedContainerLabelOverrides,
  matchingImgset: ResolvedImgset | undefined,
  containerLabels: Record<string, string>,
) {
  return {
    includeTags: getContainerConfigValue(labelOverrides.includeTags, matchingImgset?.includeTags),
    excludeTags: getContainerConfigValue(labelOverrides.excludeTags, matchingImgset?.excludeTags),
    transformTags: getContainerConfigValue(
      labelOverrides.transformTags,
      matchingImgset?.transformTags,
    ),
    tagFamily: getContainerConfigValue(labelOverrides.tagFamily, matchingImgset?.tagFamily),
    linkTemplate: getContainerConfigValue(
      labelOverrides.linkTemplate,
      matchingImgset?.linkTemplate,
    ),
    displayName: getContainerConfigValue(labelOverrides.displayName, matchingImgset?.displayName),
    displayIcon: getContainerConfigValue(labelOverrides.displayIcon, matchingImgset?.displayIcon),
    triggerInclude: getContainerConfigValue(
      labelOverrides.triggerInclude,
      matchingImgset?.triggerInclude,
    ),
    triggerExclude: getContainerConfigValue(
      labelOverrides.triggerExclude,
      matchingImgset?.triggerExclude,
    ),
    lookupImage:
      getContainerConfigValue(labelOverrides.lookupImage, matchingImgset?.registryLookupImage) ||
      getContainerConfigValue(undefined, matchingImgset?.registryLookupUrl),
    inspectTagPath: getContainerConfigValue(
      labelOverrides.inspectTagPath,
      matchingImgset?.inspectTagPath,
    ),
    watchDigest: getContainerConfigValue(
      getLabel(containerLabels, ddWatchDigest, wudWatchDigest),
      matchingImgset?.watchDigest,
    ),
  };
}

function getImgsetMatchCandidate(
  imgsetName: string,
  imgsetConfiguration: unknown,
  parsedImage: unknown,
): ImgsetMatchCandidate | undefined {
  const imagePattern = getFirstConfigString(imgsetConfiguration, ['image', 'match']);
  if (!imagePattern) {
    return undefined;
  }

  const specificity = getImgsetSpecificity(imagePattern, parsedImage);
  if (specificity < 0) {
    return undefined;
  }

  return {
    specificity,
    imgset: getResolvedImgsetConfiguration(imgsetName, imgsetConfiguration),
  };
}

function isBetterImgsetMatch(candidate: ImgsetMatchCandidate, currentBest: ImgsetMatchCandidate) {
  if (candidate.specificity !== currentBest.specificity) {
    return candidate.specificity > currentBest.specificity;
  }

  return candidate.imgset.name.localeCompare(currentBest.imgset.name) < 0;
}

export function getMatchingImgsetConfiguration(
  parsedImage: unknown,
  configuredImgsets: DockerImgsetConfigurations | undefined,
): ResolvedImgset | undefined {
  if (!configuredImgsets || typeof configuredImgsets !== 'object') {
    return undefined;
  }

  let bestMatch: ImgsetMatchCandidate | undefined;
  for (const [imgsetName, imgsetConfiguration] of Object.entries(configuredImgsets)) {
    const candidate = getImgsetMatchCandidate(imgsetName, imgsetConfiguration, parsedImage);
    if (!candidate) {
      continue;
    }

    if (!bestMatch || isBetterImgsetMatch(candidate, bestMatch)) {
      bestMatch = candidate;
    }
  }

  return bestMatch?.imgset;
}
