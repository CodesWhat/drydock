import { createHash } from 'node:crypto';
import parse from 'parse-docker-image-name';
import { type Container, FILE_CONTAINER_ID_PREFIX } from '../../../model/container.js';
import { parse as parseSemver, transform as transformTag } from '../../../tag/index.js';
import { classifyTagPrecision } from '../../../tag/precision.js';
import { mergeConfigWithImgset, resolveLabelsFromContainer } from '../docker/container-init.js';
import { getContainerDisplayName } from '../docker/docker-helpers.js';
import { normalizeContainer } from '../docker/image-comparison.js';
import { applyDockerDeclarativeUpdatePolicy } from '../docker/update-policy.js';
import type { FileImageEntry } from './file-entries.js';

/** Stable id for an entry: the same watcher and name always map to the same container. */
export function getFileContainerId(watcherName: string, entryName: string): string {
  const digest = createHash('sha256').update(`${watcherName}\0${entryName}`).digest('hex');
  return `${FILE_CONTAINER_ID_PREFIX}${digest.slice(0, 24)}`;
}

/**
 * Build the synthetic container for one list entry.
 *
 * Label resolution, tag policy, registry matching and update policy run through the same
 * helpers as a discovered Docker container, so include/exclude/transform/family, registry
 * auth and trigger routing behave identically. What differs is what is unknown: nothing is
 * running, so there is no local digest and no image inspect, and digest watching stays off.
 */
export function buildFileContainer(
  watcherName: string,
  entry: FileImageEntry,
  logger?: { warn: (message: string) => void },
): Container {
  const parsedImage = parse(entry.image);
  const resolvedConfig = mergeConfigWithImgset(
    resolveLabelsFromContainer(entry.labels),
    undefined,
    entry.labels,
  );
  const tagName = parsedImage.tag || 'latest';
  const transformedTag = transformTag(resolvedConfig.transformTags, tagName);
  const parsedTag = parseSemver(transformedTag);
  const isSemver = parsedTag != null;

  const container = normalizeContainer({
    id: getFileContainerId(watcherName, entry.name),
    name: entry.name,
    status: 'unknown',
    watcher: watcherName,
    includeTags: resolvedConfig.includeTags,
    excludeTags: resolvedConfig.excludeTags,
    transformTags: resolvedConfig.transformTags,
    tagFamily: resolvedConfig.tagFamily,
    tagPinInfo: resolvedConfig.tagPinInfo,
    linkTemplate: resolvedConfig.linkTemplate,
    portLabel: resolvedConfig.portLabel,
    displayName: getContainerDisplayName(entry.name, parsedImage.path, resolvedConfig.displayName),
    displayIcon: resolvedConfig.displayIcon,
    actionTriggerInclude: resolvedConfig.actionTriggerInclude,
    actionTriggerExclude: resolvedConfig.actionTriggerExclude,
    notificationTriggerInclude: resolvedConfig.notificationTriggerInclude,
    notificationTriggerExclude: resolvedConfig.notificationTriggerExclude,
    actionTriggerAuto: resolvedConfig.actionTriggerAuto,
    triggerInclude: resolvedConfig.triggerInclude,
    triggerExclude: resolvedConfig.triggerExclude,
    image: {
      id: `file:${entry.image}`,
      registry: {
        name: 'unknown', // Overwritten by normalizeContainer
        url: parsedImage.domain ?? 'docker.io',
        lookupImage: resolvedConfig.lookupImage,
      },
      name: parsedImage.path,
      tag: {
        value: tagName,
        semver: isSemver,
        tagPrecision: classifyTagPrecision(tagName, resolvedConfig.transformTags, parsedTag),
      },
      digest: { watch: false },
      isLocalImage: false,
      architecture: 'unknown',
      os: 'unknown',
    },
    labels: { ...entry.labels },
    result: { tag: tagName },
    updateAvailable: false,
    updateKind: { kind: 'unknown' },
  } as Container);
  applyDockerDeclarativeUpdatePolicy(
    container,
    entry.labels,
    {},
    { logger, containerName: entry.name },
  );
  return container;
}
