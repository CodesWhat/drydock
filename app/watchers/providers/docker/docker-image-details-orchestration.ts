import type { Container } from '../../../model/container.js';
import * as storeContainer from '../../../store/container.js';
import { parse as parseSemver, transform as transformTag } from '../../../tag/index.js';
import {
  getContainerDisplayName,
  getContainerName,
  getRepoDigest,
  isDigestToWatch,
  type ResolvedImgset,
  shouldUpdateDisplayNameFromContainerName,
} from './docker-helpers.js';
import {
  areRuntimeDetailsEqual,
  getRuntimeDetailsFromContainerSummary,
  getRuntimeDetailsFromInspect,
  mergeRuntimeDetails,
  normalizeRuntimeDetails,
} from './runtime-details.js';

export interface ContainerLabelOverrides {
  includeTags?: string;
  excludeTags?: string;
  transformTags?: string;
  tagFamily?: string;
  linkTemplate?: string;
  displayName?: string;
  displayIcon?: string;
  triggerInclude?: string;
  triggerExclude?: string;
  registryLookupImage?: string;
  registryLookupUrl?: string;
}

interface DockerContainerSummary {
  Id: string;
  Image: string;
  Labels?: Record<string, string>;
  State?: string;
  Names?: string[];
  Ports?: unknown;
  Mounts?: unknown;
}

interface DockerContainerInspectPayload {
  [key: string]: unknown;
}

interface DockerImageInspectPayload {
  Id: string;
  RepoTags?: string[];
  RepoDigests?: string[];
  Architecture?: string;
  Os?: string;
  Variant?: string;
  Created?: string;
  [key: string]: unknown;
}

interface ParsedDockerImageReference {
  path: string;
  domain?: string;
  tag?: string;
  [key: string]: unknown;
}

interface ResolvedContainerLabelOverrides {
  includeTags?: string;
  excludeTags?: string;
  transformTags?: string;
  tagFamily?: string;
  linkTemplate?: string;
  displayName?: string;
  displayIcon?: string;
  triggerInclude?: string;
  triggerExclude?: string;
  lookupImage?: string;
  inspectTagPath?: string;
}

interface ResolvedContainerConfig {
  includeTags?: string;
  excludeTags?: string;
  transformTags?: string;
  tagFamily?: string;
  linkTemplate?: string;
  displayName?: string;
  displayIcon?: string;
  triggerInclude?: string;
  triggerExclude?: string;
  lookupImage?: string;
  inspectTagPath?: string;
  watchDigest?: string;
}

interface DockerImageDetailsWatcher {
  name: string;
  configuration: {
    watchevents: boolean;
  };
  dockerApi: {
    getContainer: (id: string) => { inspect: () => Promise<DockerContainerInspectPayload> };
    getImage: (imageId: string) => { inspect: () => Promise<DockerImageInspectPayload> };
  };
  log: {
    warn: (message: string) => void;
    debug: (message: string) => void;
  };
  ensureLogger: () => void;
  ensureRemoteAuthHeaders: () => Promise<void>;
}

interface DockerImageDetailsHelpers {
  resolveLabelsFromContainer: (
    containerLabels: Record<string, string>,
    overrides?: ContainerLabelOverrides,
  ) => ResolvedContainerLabelOverrides;
  mergeConfigWithImgset: (
    labelOverrides: ResolvedContainerLabelOverrides,
    matchingImgset: ResolvedImgset | undefined,
    containerLabels: Record<string, string>,
  ) => ResolvedContainerConfig;
  normalizeContainer: (container: Container) => Container;
  resolveImageName: (
    imageName: string,
    image: DockerImageInspectPayload,
  ) => ParsedDockerImageReference | undefined;
  resolveTagName: (
    parsedImage: ParsedDockerImageReference,
    image: DockerImageInspectPayload,
    inspectTagPath: string | undefined,
    transformTagsFromLabel: string | undefined,
    containerId: string,
  ) => string;
  getMatchingImgsetConfiguration: (
    parsedImage: ParsedDockerImageReference,
  ) => ResolvedImgset | undefined;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return `${error}`;
}

/**
 * Add image detail to Container.
 */
export async function addImageDetailsToContainerOrchestration(
  watcher: DockerImageDetailsWatcher,
  container: DockerContainerSummary,
  labelOverrides: ContainerLabelOverrides = {},
  helpers: DockerImageDetailsHelpers,
): Promise<Container | undefined> {
  const containerId = container.Id;
  const containerLabels: Record<string, string> = container.Labels || {};
  const dockerContainerName = getContainerName(container);
  const runtimeDetailsFromSummary = getRuntimeDetailsFromContainerSummary(container);

  // Is container already in store? Refresh volatile image fields, then return it
  const containerInStore = storeContainer.getContainer(containerId);
  if (containerInStore !== undefined && containerInStore.error === undefined) {
    watcher.ensureLogger();
    watcher.log.debug(`Container ${containerInStore.id} already in store`);
    const existingName = containerInStore.name || '';
    if (dockerContainerName !== '' && existingName !== dockerContainerName) {
      const shouldUpdateDisplayName = shouldUpdateDisplayNameFromContainerName(
        dockerContainerName,
        existingName,
        containerInStore.displayName,
      );
      containerInStore.name = dockerContainerName;
      if (shouldUpdateDisplayName) {
        containerInStore.displayName = getContainerDisplayName(
          dockerContainerName,
          containerInStore.image?.name || '',
        );
      }
    }
    const cachedRuntimeDetails = normalizeRuntimeDetails(containerInStore.details);
    let runtimeDetailsToApply = mergeRuntimeDetails(
      runtimeDetailsFromSummary,
      cachedRuntimeDetails,
    );

    // When Docker events are enabled, runtime detail updates are handled by event-driven inspect calls.
    // Skip per-cron container inspect to avoid doubling inspect API calls for every tracked container.
    if (!watcher.configuration.watchevents) {
      try {
        const containerInspect = await watcher.dockerApi.getContainer(containerId).inspect();
        runtimeDetailsToApply = mergeRuntimeDetails(
          getRuntimeDetailsFromInspect(containerInspect),
          runtimeDetailsToApply,
        );
      } catch {
        // Degrade gracefully to summary and cached details.
      }
    }
    if (!areRuntimeDetailsEqual(containerInStore.details, runtimeDetailsToApply)) {
      containerInStore.details = runtimeDetailsToApply;
    }

    // Reconcile container status from Docker summary (covers events missed during reconnect gaps)
    const summaryStatus = container.State;
    if (
      typeof summaryStatus === 'string' &&
      summaryStatus !== '' &&
      containerInStore.status !== summaryStatus
    ) {
      containerInStore.status = summaryStatus;
    }

    try {
      const currentImage = await watcher.dockerApi.getImage(container.Image).inspect();
      const freshDigestRepo = getRepoDigest(currentImage);
      const freshImageId = currentImage.Id;
      // Keep local digest value populated for digest-watch containers, even when
      // image id/repo digest are unchanged from cached state.
      if (freshDigestRepo !== undefined && containerInStore.image.digest.value === undefined) {
        containerInStore.image.digest.value = freshDigestRepo;
      }
      if (
        freshDigestRepo !== containerInStore.image.digest.repo ||
        freshImageId !== containerInStore.image.id
      ) {
        containerInStore.image.digest.repo = freshDigestRepo;
        if (freshDigestRepo !== undefined) {
          containerInStore.image.digest.value = freshDigestRepo;
        }
        containerInStore.image.id = freshImageId;
        if (currentImage.Created) {
          containerInStore.image.created = currentImage.Created;
        }
      }
    } catch {
      // Degrade gracefully to cached values
    }
    return containerInStore;
  }

  // Get container image details
  let image;
  try {
    await watcher.ensureRemoteAuthHeaders();
    image = await watcher.dockerApi.getImage(container.Image).inspect();
  } catch (e: unknown) {
    throw new Error(`Unable to inspect image for container ${containerId}: ${getErrorMessage(e)}`);
  }

  const parsedImage = helpers.resolveImageName(container.Image, image);
  if (!parsedImage) {
    return undefined;
  }

  const resolvedLabelOverrides = helpers.resolveLabelsFromContainer(
    containerLabels,
    labelOverrides,
  );

  const matchingImgset = helpers.getMatchingImgsetConfiguration(parsedImage);
  if (matchingImgset) {
    watcher.ensureLogger();
    watcher.log.debug(`Apply imgset "${matchingImgset.name}" to container ${containerId}`);
  }

  const resolvedConfig = helpers.mergeConfigWithImgset(
    resolvedLabelOverrides,
    matchingImgset,
    containerLabels,
  );

  const tagName = helpers.resolveTagName(
    parsedImage,
    image,
    resolvedConfig.inspectTagPath,
    resolvedLabelOverrides.transformTags,
    containerId,
  );

  const isSemver = parseSemver(transformTag(resolvedConfig.transformTags, tagName)) != null;
  const watchDigest = isDigestToWatch(resolvedConfig.watchDigest, parsedImage, isSemver);
  const repoDigest = getRepoDigest(image);
  let runtimeDetails = runtimeDetailsFromSummary;
  try {
    const containerInspect = await watcher.dockerApi.getContainer(containerId).inspect();
    runtimeDetails = mergeRuntimeDetails(
      getRuntimeDetailsFromInspect(containerInspect),
      runtimeDetailsFromSummary,
    );
  } catch {
    // Degrade gracefully to summary details.
  }
  if (!isSemver && !watchDigest) {
    watcher.ensureLogger();
    watcher.log.warn(
      `Image is not a semver and digest watching is disabled so drydock won't report any update for container "${dockerContainerName}". Please review the configuration to enable digest watching for this container or exclude this container from being watched`,
    );
  }
  const containerToReturn = helpers.normalizeContainer({
    id: containerId,
    name: dockerContainerName,
    status: container.State,
    watcher: watcher.name,
    includeTags: resolvedConfig.includeTags,
    excludeTags: resolvedConfig.excludeTags,
    transformTags: resolvedConfig.transformTags,
    tagFamily: resolvedConfig.tagFamily,
    linkTemplate: resolvedConfig.linkTemplate,
    displayName: getContainerDisplayName(
      dockerContainerName,
      parsedImage.path,
      resolvedConfig.displayName,
    ),
    displayIcon: resolvedConfig.displayIcon,
    triggerInclude: resolvedConfig.triggerInclude,
    triggerExclude: resolvedConfig.triggerExclude,
    image: {
      id: image.Id,
      registry: {
        name: 'unknown', // Will be overwritten by normalizeContainer
        url: parsedImage.domain,
        lookupImage: resolvedConfig.lookupImage,
      },
      name: parsedImage.path,
      tag: {
        value: tagName,
        semver: isSemver,
      },
      digest: {
        watch: watchDigest,
        repo: repoDigest,
        value: repoDigest,
      },
      architecture: image.Architecture,
      os: image.Os,
      variant: image.Variant,
      created: image.Created,
    },
    labels: containerLabels,
    details: runtimeDetails,
    result: {
      tag: tagName,
    },
    updateAvailable: false,
    updateKind: { kind: 'unknown' },
  } as Container);
  if (typeof containerToReturn.name === 'string' && containerToReturn.name !== '') {
    const containersWithSameName = storeContainer.getContainers({
      watcher: watcher.name,
      name: containerToReturn.name,
    });
    containersWithSameName
      .filter((staleContainer) => staleContainer.id !== containerToReturn.id)
      .forEach((staleContainer) => storeContainer.deleteContainer(staleContainer.id));
  }
  return containerToReturn;
}
