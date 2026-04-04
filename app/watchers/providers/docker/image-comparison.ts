import { RE2JS } from 're2js';
import log from '../../../log/index.js';
import {
  type Container,
  type ContainerResult,
  fullName,
  validate as validateContainer,
} from '../../../model/container.js';
import type Registry from '../../../registries/Registry.js';
import * as registry from '../../../registry/index.js';
import { suggest as suggestTag } from '../../../tag/suggest.js';
import { getErrorMessage } from '../../../util/error.js';
import { getImageForRegistryLookup } from './docker-helpers.js';
import { getTagCandidates } from './tag-candidates.js';

export interface ContainerTagLookupProvider {
  getTags: (image: Container['image']) => Promise<string[]>;
  getImageManifestDigest: (
    image: Container['image'],
    digest?: string,
  ) => Promise<{
    digest?: string;
    created?: string;
    version?: number;
  }>;
  getImagePublishedAt?: (image: Container['image'], tag?: string) => Promise<string | undefined>;
}

export interface ContainerWatchLogger {
  error: (message: string) => void;
  warn: (message: string) => void;
  debug: (message: string) => void;
}

interface SafeRegex {
  test(value: string): boolean;
}

function safeRegExp(
  pattern: string | undefined,
  logContainer: Pick<ContainerWatchLogger, 'warn'>,
): SafeRegex | null {
  if (!pattern) {
    return null;
  }

  try {
    const compiled = RE2JS.compile(pattern);
    return {
      test(value: string) {
        return compiled.matcher(value).find();
      },
    };
  } catch (error: unknown) {
    logContainer.warn(`Invalid regex pattern "${pattern}": ${getErrorMessage(error)}`);
    return null;
  }
}

function filterTagsForDigestComparison(
  container: Container,
  tags: string[],
  logContainer: Pick<ContainerWatchLogger, 'warn'>,
): string[] {
  let filteredTags = tags.filter(
    (tag) => tag !== '' && !tag.startsWith('sha') && !tag.endsWith('.sig'),
  );

  const includeTagsRegex = safeRegExp(container.includeTags, logContainer);
  if (includeTagsRegex) {
    filteredTags = filteredTags.filter((tag) => includeTagsRegex.test(tag));
  }

  const excludeTagsRegex = safeRegExp(container.excludeTags, logContainer);
  if (excludeTagsRegex) {
    filteredTags = filteredTags.filter((tag) => !excludeTagsRegex.test(tag));
  }

  return filteredTags;
}

function resolveDigestComparisonTag(
  container: Container,
  tags: string[],
  logContainer: ContainerWatchLogger,
): string | undefined {
  const filteredTags = filterTagsForDigestComparison(container, tags, logContainer);
  if (filteredTags.length === 0) {
    return undefined;
  }

  const latestTag = filteredTags.find((tag) => tag.toLowerCase() === 'latest');
  if (latestTag) {
    return latestTag;
  }

  const suggestedTag = suggestTag(
    {
      includeTags: container.includeTags,
      excludeTags: container.excludeTags,
      image: {
        ...container.image,
        tag: {
          ...container.image.tag,
          value: 'latest',
          semver: false,
        },
      },
    },
    filteredTags,
    logContainer,
  );
  if (suggestedTag) {
    return suggestedTag;
  }

  return [...filteredTags].sort((left, right) => right.localeCompare(left))[0];
}

function getRegistries(): Record<string, Registry> {
  return registry.getState().registry;
}

export function normalizeContainer(container: Container) {
  const containerWithNormalizedImage = structuredClone(container);
  const imageForMatching = getImageForRegistryLookup(containerWithNormalizedImage.image);
  const registryProvider = Object.values(getRegistries()).find((provider) =>
    provider.match(imageForMatching),
  );
  if (registryProvider) {
    containerWithNormalizedImage.image = registryProvider.normalizeImage(imageForMatching);
    containerWithNormalizedImage.image.registry.name = registryProvider.getId();
  } else {
    log.warn(`${fullName(container)} - No Registry Provider found`);
    containerWithNormalizedImage.image.registry.name = 'unknown';
  }
  return validateContainer(containerWithNormalizedImage);
}

/** Get the Docker Registry by name. */
function getRegistry(registryName: string): Registry {
  const registryToReturn = getRegistries()[registryName];
  if (!registryToReturn) {
    throw new Error(`Unsupported Registry ${registryName}`);
  }
  return registryToReturn;
}

/**
 * Resolve remote digest information when digest watching is enabled.
 * Updates `container.image.digest.value` and populates digest/created on `result`.
 */
async function handleDigestWatch(
  container: Container,
  registryProvider: ContainerTagLookupProvider,
  tagsCandidates: string[],
  result: ContainerResult,
) {
  const imageToGetDigestFrom = structuredClone(container.image);
  if (tagsCandidates.length > 0) {
    [imageToGetDigestFrom.tag.value] = tagsCandidates;
  }

  const remoteDigest = await registryProvider.getImageManifestDigest(imageToGetDigestFrom);

  result.digest = remoteDigest.digest;
  result.created = remoteDigest.created;

  if (remoteDigest.version === 2) {
    const digestV2 = await registryProvider.getImageManifestDigest(
      imageToGetDigestFrom,
      container.image.digest.repo,
    );
    container.image.digest.value = digestV2.digest;
  } else {
    container.image.digest.value = container.image.digest.repo;
  }
}

export async function findNewVersion(
  container: Container,
  logContainer: ContainerWatchLogger,
): Promise<ContainerResult> {
  let registryProvider: ContainerTagLookupProvider;
  try {
    registryProvider = getRegistry(container.image.registry.name);
  } catch {
    logContainer.error(`Unsupported registry (${container.image.registry.name})`);
    return { tag: container.image.tag.value };
  }

  const result: ContainerResult = { tag: container.image.tag.value };

  const currentTag = container.image.tag.value;
  const isDigestOnlyTag = currentTag.startsWith('sha256:');

  // Digest-pinned images cannot do tag comparison, but they can still use
  // digest watch to compare the currently pinned digest against the registry.
  if (isDigestOnlyTag) {
    logContainer.debug('Digest-only image — no tag available for version comparison');
    result.noUpdateReason = 'Running by digest — no tag to compare';

    if (container.image.digest.watch && container.image.digest.repo) {
      const tags = await registryProvider.getTags(container.image);
      const comparisonTag = resolveDigestComparisonTag(container, tags, logContainer);

      if (comparisonTag) {
        await handleDigestWatch(container, registryProvider, [comparisonTag], result);
      } else {
        logContainer.debug('Digest-only image — no registry tag candidate available');
      }
    }

    return result;
  }

  // Unknown tags do not provide enough information for either tag or digest
  // comparison, so keep the previous no-update behavior.
  if (currentTag === 'unknown') {
    logContainer.debug('Digest-only image — no tag available for version comparison');
    result.noUpdateReason = 'Running by digest — no tag to compare';
    return result;
  }

  // Get all available tags
  const tags = await registryProvider.getTags(container.image);

  // Get candidate tags (based on tag name)
  const { tags: tagsCandidates, noUpdateReason } = getTagCandidates(container, tags, logContainer);
  if (noUpdateReason) {
    result.noUpdateReason = noUpdateReason;
  }

  const suggestedTag = suggestTag(container, tags, logContainer);
  if (suggestedTag !== null) {
    result.suggestedTag = suggestedTag;
  }

  // Must watch digest? => Find local/remote digests on registry
  if (container.image.digest.watch && container.image.digest.repo) {
    await handleDigestWatch(container, registryProvider, tagsCandidates, result);
  }

  // The first one in the array is the highest
  if (tagsCandidates && tagsCandidates.length > 0) {
    [result.tag] = tagsCandidates;
  }

  const publishedTag = result.tag || container.image.tag.value;
  try {
    if (typeof registryProvider.getImagePublishedAt === 'function') {
      const publishedAt = await registryProvider.getImagePublishedAt(container.image, publishedTag);
      if (typeof publishedAt === 'string') {
        result.publishedAt = publishedAt;
      }
    }
  } catch (error: unknown) {
    if (typeof logContainer.debug === 'function') {
      logContainer.debug(`Remote publish date lookup failed (${getErrorMessage(error)})`);
    }
  }

  return result;
}
