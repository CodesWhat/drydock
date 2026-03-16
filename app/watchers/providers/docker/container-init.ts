import { getPreferredLabelValue } from '../../../docker/legacy-label.js';
import log from '../../../log/index.js';
import type { Container } from '../../../model/container.js';
import * as storeContainer from '../../../store/container.js';
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
  ddDisplayIcon,
  ddDisplayName,
  ddInspectTagPath,
  ddLinkTemplate,
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
const RECREATED_CONTAINER_NAME_PATTERN = /^([a-f0-9]{12})_(.+)$/i;

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
export function getLabel(labels: Record<string, string>, ddKey: string, wudKey?: string) {
  return getPreferredLabelValue(labels, ddKey, wudKey, {
    warnedFallbacks: warnedLegacyLabelFallbacks,
    warn: (message) => log.warn(message),
  });
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
  options: { forceRemoveContainerIds?: Set<string> } = {},
) {
  const forceRemoveContainerIds = options.forceRemoveContainerIds || new Set<string>();
  const containersToRemove = getOldContainers(newContainers, containersFromTheStore);
  const newContainerNameKeys = new Set(
    newContainers
      .filter((container) => typeof container.name === 'string' && container.name !== '')
      .map((container) => `${container.watcher || ''}::${container.name}`),
  );
  for (const containerToRemove of containersToRemove) {
    if (
      typeof containerToRemove.id === 'string' &&
      forceRemoveContainerIds.has(containerToRemove.id)
    ) {
      storeContainer.deleteContainer(containerToRemove.id);
      continue;
    }
    const staleContainerNameKey = `${containerToRemove.watcher || ''}::${containerToRemove.name || ''}`;
    if (
      typeof containerToRemove.name === 'string' &&
      containerToRemove.name !== '' &&
      newContainerNameKeys.has(staleContainerNameKey)
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

function buildDockerContainerNameToIds<T extends DockerContainerSummaryLike>(containers: T[]) {
  const dockerContainerNameToIds = new Map<string, Set<string>>();

  for (const container of containers) {
    const containerName = getContainerName(container);
    const containerId = getDockerContainerId(container);
    if (containerName === '' || containerId === '') {
      continue;
    }

    const idsForName = dockerContainerNameToIds.get(containerName) || new Set<string>();
    idsForName.add(containerId);
    dockerContainerNameToIds.set(containerName, idsForName);
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

export function filterRecreatedContainerAliases<T extends DockerContainerSummaryLike>(
  containers: T[],
  containersFromTheStore: Container[],
): { containersToWatch: T[]; skippedContainerIds: Set<string> } {
  const storeContainerNames = new Set(
    containersFromTheStore
      .filter((container) => typeof container.name === 'string' && container.name !== '')
      .map((container) => container.name),
  );

  const dockerContainerNameToIds = buildDockerContainerNameToIds(containers);

  const containersToWatch: T[] = [];
  const skippedContainerIds = new Set<string>();
  for (const container of containers) {
    const containerId = getDockerContainerId(container);
    const recreatedContainerBaseName = getRecreatedContainerBaseName(container);

    if (!recreatedContainerBaseName || containerId === '') {
      containersToWatch.push(container);
      continue;
    }

    const hasDockerContainerWithBaseName = hasSiblingDockerContainerWithName(
      dockerContainerNameToIds,
      recreatedContainerBaseName,
      containerId,
    );
    const hasStoreContainerWithBaseName = storeContainerNames.has(recreatedContainerBaseName);

    if (hasDockerContainerWithBaseName || hasStoreContainerWithBaseName) {
      skippedContainerIds.add(containerId);
      continue;
    }

    containersToWatch.push(container);
  }

  return { containersToWatch, skippedContainerIds };
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
