import parse from 'parse-docker-image-name';

import log from '../../../log/index.js';
import type { Container, ContainerImage } from '../../../model/container.js';
import { parse as parseSemver, transform as transformTag } from '../../../tag/index.js';
import { getErrorMessage as getSharedErrorMessage } from '../../../util/error.js';

export type TagPrecision = 'specific' | 'floating';

const UNKNOWN_CONTAINER_PROCESSING_ERROR = 'Unexpected container processing error';

export interface ResolvedImgset {
  name: string;
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
  watchDigest?: string;
  inspectTagPath?: string;
}

type UnknownRecord = Record<string, unknown>;

const RECREATED_ALIAS_PATTERN = /^([a-f0-9]{12})_(.+)$/i;

interface ContainerWithNames {
  Id?: unknown;
  Names?: string[];
}

interface ParsedImageLike {
  path?: string;
  domain?: string;
}

interface ImageWithRepoDigests {
  RepoDigests?: string[];
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

export function getErrorMessage(error: unknown, fallback = UNKNOWN_CONTAINER_PROCESSING_ERROR) {
  return getSharedErrorMessage(error, fallback);
}

export function buildFallbackContainerReport(container: Container, message: string) {
  const containerWithError = {
    ...container,
  };
  delete containerWithError.result;
  containerWithError.error = {
    message,
  };
  containerWithError.updateAvailable = false;
  if (!containerWithError.updateKind) {
    containerWithError.updateKind = { kind: 'unknown' };
  }
  return {
    container: containerWithError,
    changed: false,
  };
}

/**
 * Get old containers to prune.
 * @param newContainers
 * @param containersFromTheStore
 * @returns {*[]|*}
 */
export function getOldContainers(newContainers: Container[], containersFromTheStore: Container[]) {
  if (!containersFromTheStore || !newContainers) {
    return [];
  }
  const newContainerIds = new Set(newContainers.map((container) => container.id));
  return containersFromTheStore.filter(
    (containerFromStore) => !newContainerIds.has(containerFromStore.id),
  );
}

/**
 * Extract the raw first name from a Docker container summary, stripping only
 * the leading slash. Does NOT canonicalize alias prefixes — used by alias
 * filtering which needs to detect the raw alias pattern.
 */
export function getRawContainerName(container: { Names?: string[] }): string {
  const names = container.Names;
  if (!names || names.length === 0) {
    return '';
  }
  const first = names[0];
  return typeof first === 'string' ? first.replace(/^\//, '') : '';
}

/**
 * Extract the canonical container name. Unconditionally strips Docker recreate
 * alias prefixes (e.g. `8bf70beac570_termix` → `termix`) when the name matches
 * the `^[a-f0-9]{12}_.+` pattern.
 *
 * Previous versions only stripped when the hex prefix matched the container ID,
 * but this failed in environments where the Docker API (via socket proxies like
 * linuxserver/socket-proxy) returned unexpected ID formats or timing. The
 * unconditional approach is safe because no legitimate container naming
 * convention uses a 12-character lowercase hex prefix followed by underscore.
 *
 * When Names contains both an alias and the canonical name during a rename,
 * prefers the non-alias entry.
 */
export function getContainerName(container: ContainerWithNames) {
  const names = container.Names;
  if (!names || names.length === 0) {
    return '';
  }

  // When Docker renames a container during recreate, Names may contain both
  // the transient alias ("/8bf70beac570_termix") and the canonical name ("/termix").
  // Prefer the first non-alias name.
  if (names.length > 1) {
    for (const raw of names) {
      if (typeof raw !== 'string') {
        continue;
      }
      const stripped = raw.replace(/^\//, '');
      if (!RECREATED_ALIAS_PATTERN.test(stripped)) {
        return stripped;
      }
    }
  }

  // Single name (or all names are aliases) — unconditionally strip alias prefix.
  const containerName = getRawContainerName(container);
  const aliasMatch = containerName.match(RECREATED_ALIAS_PATTERN);
  if (aliasMatch) {
    return aliasMatch[2];
  }

  return containerName;
}

/**
 * Strip a Docker recreate alias prefix from a container name unconditionally.
 * Used by the event-update path where Docker inspect returns a single Name
 * rather than a Names array.
 */
export function canonicalizeContainerName(name: string, _containerId?: string): string {
  const aliasMatch = name.match(RECREATED_ALIAS_PATTERN);
  if (aliasMatch) {
    return aliasMatch[2];
  }
  return name;
}

export function getContainerDisplayName(
  containerName: string,
  parsedImagePath: string,
  displayName?: string,
) {
  if (displayName && displayName.trim() !== '') {
    return displayName;
  }

  return containerName;
}

function normalizeConfigStringValue(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const valueTrimmed = value.trim();
  return valueTrimmed === '' ? undefined : valueTrimmed;
}

function getNestedValue(value: unknown, path: string) {
  return path
    .split('.')
    .filter((item) => item !== '')
    .reduce<unknown>((nestedValue, item) => {
      if (!isRecord(nestedValue)) {
        return undefined;
      }
      return nestedValue[item];
    }, value);
}

export function getFirstConfigString(value: unknown, paths: string[]) {
  for (const path of paths) {
    const pathValue = normalizeConfigStringValue(getNestedValue(value, path));
    if (pathValue !== undefined) {
      return pathValue;
    }
  }
  return undefined;
}

function getImageReferenceCandidates(path?: string, domain?: string) {
  const pathNormalized = normalizeConfigStringValue(path)?.toLowerCase();
  if (!pathNormalized) {
    return [];
  }
  const domainNormalized = normalizeConfigStringValue(domain)?.toLowerCase();
  const pathWithoutLibraryPrefix = pathNormalized.startsWith('library/')
    ? pathNormalized.substring('library/'.length)
    : pathNormalized;
  const candidates = new Set<string>([
    pathNormalized,
    pathWithoutLibraryPrefix,
    `docker.io/${pathNormalized}`,
    `docker.io/${pathWithoutLibraryPrefix}`,
    `registry-1.docker.io/${pathNormalized}`,
    `registry-1.docker.io/${pathWithoutLibraryPrefix}`,
  ]);
  if (domainNormalized) {
    candidates.add(`${domainNormalized}/${pathNormalized}`);
    candidates.add(`${domainNormalized}/${pathWithoutLibraryPrefix}`);
  }
  return Array.from(candidates).filter((candidate) => candidate !== '');
}

export function getImageReferenceCandidatesFromPattern(pattern: string) {
  const patternNormalized = normalizeConfigStringValue(pattern);
  if (!patternNormalized) {
    return [];
  }
  try {
    const parsedPattern = parse(patternNormalized.toLowerCase());
    if (!parsedPattern.path) {
      return [patternNormalized.toLowerCase()];
    }
    return getImageReferenceCandidates(parsedPattern.path, parsedPattern.domain);
  } catch (_error: unknown) {
    log.debug(`Invalid imgset image pattern "${patternNormalized}" - using normalized value`);
    return [patternNormalized.toLowerCase()];
  }
}

function getImageReferenceCandidatesFromParsedImage(parsedImage: ParsedImageLike) {
  return getImageReferenceCandidates(parsedImage?.path, parsedImage?.domain);
}

export function getImgsetSpecificity(imagePattern: string, parsedImage: ParsedImageLike) {
  const patternCandidates = getImageReferenceCandidatesFromPattern(imagePattern);
  if (patternCandidates.length === 0) {
    return -1;
  }
  const imageCandidates = getImageReferenceCandidatesFromParsedImage(parsedImage);
  if (imageCandidates.length === 0) {
    return -1;
  }
  const imageCandidateSet = new Set(imageCandidates);

  const hasMatch = patternCandidates.some((patternCandidate) =>
    imageCandidateSet.has(patternCandidate),
  );
  if (!hasMatch) {
    return -1;
  }
  return patternCandidates.reduce(
    (maxSpecificity, patternCandidate) => Math.max(maxSpecificity, patternCandidate.length),
    0,
  );
}

export function getResolvedImgsetConfiguration(
  name: string,
  imgsetConfiguration: unknown,
): ResolvedImgset {
  return {
    name,
    includeTags: getFirstConfigString(imgsetConfiguration, [
      'tag.include',
      'includeTags',
      'include',
    ]),
    excludeTags: getFirstConfigString(imgsetConfiguration, [
      'tag.exclude',
      'excludeTags',
      'exclude',
    ]),
    transformTags: getFirstConfigString(imgsetConfiguration, [
      'tag.transform',
      'transformTags',
      'transform',
    ]),
    tagFamily: getFirstConfigString(imgsetConfiguration, ['tag.family', 'tagFamily']),
    linkTemplate: getFirstConfigString(imgsetConfiguration, ['link.template', 'linkTemplate']),
    displayName: getFirstConfigString(imgsetConfiguration, ['display.name', 'displayName']),
    displayIcon: getFirstConfigString(imgsetConfiguration, ['display.icon', 'displayIcon']),
    triggerInclude: getFirstConfigString(imgsetConfiguration, [
      'trigger.include',
      'triggerInclude',
    ]),
    triggerExclude: getFirstConfigString(imgsetConfiguration, [
      'trigger.exclude',
      'triggerExclude',
    ]),
    registryLookupImage: getFirstConfigString(imgsetConfiguration, [
      'registry.lookup.image',
      'registryLookupImage',
      'lookupImage',
    ]),
    registryLookupUrl: getFirstConfigString(imgsetConfiguration, [
      'registry.lookup.url',
      'registryLookupUrl',
      'lookupUrl',
    ]),
    watchDigest: getFirstConfigString(imgsetConfiguration, ['watch.digest', 'watchDigest']),
    inspectTagPath: getFirstConfigString(imgsetConfiguration, [
      'inspect.tag.path',
      'inspectTagPath',
    ]),
  };
}

export function getContainerConfigValue(
  labelValue: string | undefined,
  imgsetValue: string | undefined,
) {
  return normalizeConfigStringValue(labelValue) || normalizeConfigStringValue(imgsetValue);
}

export function normalizeConfigNumberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsedNumber = Number(value);
    if (Number.isFinite(parsedNumber)) {
      return parsedNumber;
    }
  }
  return undefined;
}

export function getFirstConfigNumber(value: unknown, paths: string[]) {
  for (const path of paths) {
    const pathValue = normalizeConfigNumberValue(getNestedValue(value, path));
    if (pathValue !== undefined) {
      return pathValue;
    }
  }
  return undefined;
}

/**
 * Get image repo digest.
 * @param containerImage
 * @returns {*} digest
 */
export function getRepoDigest(containerImage: ImageWithRepoDigests) {
  if (!containerImage.RepoDigests || containerImage.RepoDigests.length === 0) {
    return undefined;
  }
  const fullDigest = containerImage.RepoDigests[0];
  const digestSplit = fullDigest.split('@');
  return digestSplit[1];
}

/**
 * Resolve a value in a Docker inspect payload from a slash-separated path.
 * Example: Config/Labels/org.opencontainers.image.version
 */
export function getInspectValueByPath(containerInspect: unknown, path: string) {
  if (!path) {
    return undefined;
  }
  const pathSegments = path.split('/').filter((segment) => segment !== '');
  return pathSegments.reduce<unknown>((value, key) => {
    if (value === undefined || value === null) {
      return undefined;
    }
    return (value as UnknownRecord)[key];
  }, containerInspect);
}

/**
 * Try to derive a semver tag from a Docker inspect path.
 */
export function getSemverTagFromInspectPath(
  containerInspect: unknown,
  inspectPath: string,
  transformTags: string,
) {
  const inspectValue = getInspectValueByPath(containerInspect, inspectPath);
  if (inspectValue === undefined || inspectValue === null) {
    return undefined;
  }
  const tagValue = `${inspectValue}`.trim();
  if (tagValue === '') {
    return undefined;
  }
  const parsedTag = parseSemver(transformTag(transformTags, tagValue));
  return parsedTag?.version;
}

/**
 * Return true if container must be watched.
 * @param watchLabelValue the value of the dd.watch label
 * @param watchByDefault true if containers must be watched by default
 * @returns {boolean}
 */
export function isContainerToWatch(watchLabelValue: string, watchByDefault: boolean) {
  return watchLabelValue !== undefined && watchLabelValue !== ''
    ? watchLabelValue.toLowerCase() === 'true'
    : watchByDefault;
}

/**
 * Return true if container digest must be watched.
 * @param {string} watchDigestLabelValue - the value of dd.watch.digest label
 * @param {object} parsedImage - object containing at least `domain` property
 * @param {boolean} isSemver - true if the current image tag is a semver tag
 * @param {TagPrecision} tagPrecision - whether the tag is specific or floating
 * @returns {boolean}
 */
export function isDigestToWatch(
  watchDigestLabelValue: string,
  parsedImage: ParsedImageLike,
  isSemver: boolean,
  tagPrecision: TagPrecision,
  currentTag?: string,
) {
  const domain = parsedImage.domain;
  const isDockerHub =
    !domain || domain === '' || domain === 'docker.io' || domain.endsWith('.docker.io');

  if (watchDigestLabelValue !== undefined && watchDigestLabelValue !== '') {
    const shouldWatch = watchDigestLabelValue.toLowerCase() === 'true';
    if (shouldWatch && isDockerHub) {
      log.warn(
        `Watching digest for image ${parsedImage.path} with domain ${domain} may result in throttled requests`,
      );
    }
    return shouldWatch;
  }

  // Specific semver releases (1.4.5) — immutable, no digest watching needed
  if (isSemver && tagPrecision === 'specific') {
    return false;
  }

  // Digest-pinned images have no meaningful tag-comparison path, so enable
  // digest watching even on Docker Hub when the current ref is already sha256-based.
  if (typeof currentTag === 'string' && currentTag.startsWith('sha256:')) {
    return true;
  }

  // Floating tags (v3, 1, 1.4, latest, stable)
  // Docker Hub stays opt-in because of its documented pull/abuse throttling.
  return !isDockerHub;
}

export function shouldUpdateDisplayNameFromContainerName(
  newName: string,
  oldName: string,
  oldDisplayName: string | undefined,
) {
  return (
    newName !== '' &&
    oldName !== newName &&
    (oldDisplayName === oldName || oldDisplayName === undefined || oldDisplayName === '')
  );
}

/**
 * Build an image candidate used for registry matching and tag lookups.
 * The lookup value can be:
 * - an image reference (preferred): ghcr.io/user/image or library/nginx
 * - a legacy registry url: https://registry-1.docker.io
 */
export function getImageForRegistryLookup(image: ContainerImage) {
  const lookupImage = image.registry.lookupImage || image.registry.lookupUrl || '';
  const lookupImageTrimmed = lookupImage.trim();
  if (lookupImageTrimmed === '') {
    return image;
  }

  // Legacy fallback: support plain registry URL values from older experiments.
  if (/^https?:\/\//i.test(lookupImageTrimmed)) {
    try {
      const lookupUrl = new URL(lookupImageTrimmed).hostname;
      return {
        ...image,
        registry: {
          ...image.registry,
          url: lookupUrl,
        },
      };
    } catch (_error: unknown) {
      log.debug(`Invalid registry lookup URL "${lookupImageTrimmed}" - using image defaults`);
      return image;
    }
  }

  const parsedLookupImage = parse(lookupImageTrimmed);
  const parsedPath = parsedLookupImage.path;
  const parsedDomain = parsedLookupImage.domain;

  // If only a registry hostname was provided, keep the original image name.
  if (parsedPath && !parsedDomain && !lookupImageTrimmed.includes('/')) {
    return {
      ...image,
      registry: {
        ...image.registry,
        url: parsedPath,
      },
    };
  }

  if (!parsedPath) {
    return image;
  }

  return {
    ...image,
    registry: {
      ...image.registry,
      url: parsedDomain || 'registry-1.docker.io',
    },
    name: parsedPath,
  };
}
