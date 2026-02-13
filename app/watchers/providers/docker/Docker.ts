import fs from 'node:fs';
import axios from 'axios';
import Dockerode from 'dockerode';
import Joi from 'joi';
import JoiCronExpression from 'joi-cron-expression';
import RE2 from 're2';

const joi = JoiCronExpression(Joi);

import debounceImport from 'just-debounce';
import cron from 'node-cron';
import parse from 'parse-docker-image-name';

const debounce: typeof import('just-debounce').default =
  (debounceImport as any).default || (debounceImport as any);

import * as event from '../../../event/index.js';
import log from '../../../log/index.js';
import {
  type Container,
  type ContainerImage,
  fullName,
  validate as validateContainer,
} from '../../../model/container.js';
import { getMaintenanceSkipCounter, getWatchContainerGauge } from '../../../prometheus/watcher.js';
import type { ComponentConfiguration } from '../../../registry/Component.js';
import * as registry from '../../../registry/index.js';
import { resolveConfiguredPath } from '../../../runtime/paths.js';
import * as storeContainer from '../../../store/container.js';
import {
  isGreater as isGreaterSemver,
  parse as parseSemver,
  transform as transformTag,
} from '../../../tag/index.js';
import Watcher from '../../Watcher.js';
import {
  ddDisplayIcon,
  ddDisplayName,
  ddInspectTagPath,
  ddLinkTemplate,
  ddRegistryLookupImage,
  ddRegistryLookupUrl,
  ddTagExclude,
  ddTagInclude,
  ddTagTransform,
  ddTriggerExclude,
  ddTriggerInclude,
  ddWatch,
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
  wudWatch,
  wudWatchDigest,
} from './label.js';
import { getNextMaintenanceWindow, isInMaintenanceWindow } from './maintenance.js';

export interface DockerWatcherConfiguration extends ComponentConfiguration {
  socket: string;
  host?: string;
  protocol?: 'http' | 'https' | 'ssh';
  port: number;
  auth?: {
    type?: 'basic' | 'bearer' | 'oidc';
    user?: string;
    password?: string;
    bearer?: string;
    oidc?: any;
  };
  cafile?: string;
  certfile?: string;
  keyfile?: string;
  cron: string;
  jitter: number;
  watchbydefault: boolean;
  watchall: boolean;
  watchdigest?: any;
  watchevents: boolean;
  watchatstart: boolean;
  maintenancewindow?: string;
  maintenancewindowtz: string;
  imgset?: Record<string, any>;
}

/**
 * Get a label value, preferring the dd.* key over the wud.* fallback.
 */
function getLabel(labels: Record<string, string>, ddKey: string, wudKey?: string) {
  return labels[ddKey] ?? (wudKey ? labels[wudKey] : undefined);
}

/**
 * Safely compile a user-supplied regex pattern.
 * Returns null (and logs a warning) when the pattern is invalid.
 * Uses RE2, which is inherently immune to ReDoS backtracking attacks.
 */
function safeRegExp(pattern: string, logger: any): RE2 | null {
  const MAX_PATTERN_LENGTH = 1024;
  if (pattern.length > MAX_PATTERN_LENGTH) {
    logger.warn(`Regex pattern exceeds maximum length of ${MAX_PATTERN_LENGTH} characters`);
    return null;
  }
  try {
    return new RE2(pattern);
  } catch (e: any) {
    logger.warn(`Invalid regex pattern "${pattern}": ${e.message}`);
    return null;
  }
}

// The delay before starting the watcher when the app is started
const START_WATCHER_DELAY_MS = 1000;

// Debounce delay used when performing a watch after a docker event has been received
const DEBOUNCED_WATCH_CRON_MS = 5000;
const MAINTENANCE_WINDOW_QUEUE_POLL_MS = 60 * 1000;
const SWARM_SERVICE_ID_LABEL = 'com.docker.swarm.service.id';
const OIDC_ACCESS_TOKEN_REFRESH_WINDOW_MS = 30 * 1000;
const OIDC_DEFAULT_ACCESS_TOKEN_TTL_MS = 5 * 60 * 1000;
const OIDC_DEFAULT_TIMEOUT_MS = 5000;
const OIDC_TOKEN_ENDPOINT_PATHS = [
  'tokenurl',
  'tokenendpoint',
  'token_url',
  'token_endpoint',
  'token.url',
  'token.endpoint',
];
const OIDC_CLIENT_ID_PATHS = ['clientid', 'client_id', 'client.id'];
const OIDC_CLIENT_SECRET_PATHS = ['clientsecret', 'client_secret', 'client.secret'];
const OIDC_SCOPE_PATHS = ['scope'];
const OIDC_RESOURCE_PATHS = ['resource'];
const OIDC_AUDIENCE_PATHS = ['audience'];
const OIDC_GRANT_TYPE_PATHS = ['granttype', 'grant_type'];
const OIDC_ACCESS_TOKEN_PATHS = ['accesstoken', 'access_token'];
const OIDC_REFRESH_TOKEN_PATHS = ['refreshtoken', 'refresh_token'];
const OIDC_EXPIRES_IN_PATHS = ['expiresin', 'expires_in'];
const OIDC_TIMEOUT_PATHS = ['timeout'];
const OIDC_DEVICE_URL_PATHS = [
  'deviceurl',
  'deviceendpoint',
  'device_url',
  'device_endpoint',
  'device.url',
  'device.endpoint',
  'device_authorization_endpoint',
];
const OIDC_DEVICE_POLL_INTERVAL_MS = 5000;
const OIDC_DEVICE_POLL_TIMEOUT_MS = 5 * 60 * 1000;

interface ResolvedImgset {
  name: string;
  includeTags?: string;
  excludeTags?: string;
  transformTags?: string;
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

interface ContainerLabelOverrides {
  includeTags?: string;
  excludeTags?: string;
  transformTags?: string;
  linkTemplate?: string;
  displayName?: string;
  displayIcon?: string;
  triggerInclude?: string;
  triggerExclude?: string;
  registryLookupImage?: string;
  registryLookupUrl?: string;
}

type ContainerLabelOverrideKey = Exclude<
  keyof ContainerLabelOverrides,
  'registryLookupImage' | 'registryLookupUrl'
>;

interface ResolvedContainerLabelOverrides {
  includeTags?: string;
  excludeTags?: string;
  transformTags?: string;
  linkTemplate?: string;
  displayName?: string;
  displayIcon?: string;
  triggerInclude?: string;
  triggerExclude?: string;
  lookupImage?: string;
}

const containerLabelOverrideMappings = [
  { key: 'includeTags', ddKey: ddTagInclude, wudKey: wudTagInclude },
  { key: 'excludeTags', ddKey: ddTagExclude, wudKey: wudTagExclude },
  { key: 'transformTags', ddKey: ddTagTransform, wudKey: wudTagTransform },
  { key: 'linkTemplate', ddKey: ddLinkTemplate, wudKey: wudLinkTemplate },
  { key: 'displayName', ddKey: ddDisplayName, wudKey: wudDisplayName },
  { key: 'displayIcon', ddKey: ddDisplayIcon, wudKey: wudDisplayIcon },
  { key: 'triggerInclude', ddKey: ddTriggerInclude, wudKey: wudTriggerInclude },
  { key: 'triggerExclude', ddKey: ddTriggerExclude, wudKey: wudTriggerExclude },
] as const satisfies ReadonlyArray<{
  key: ContainerLabelOverrideKey;
  ddKey: string;
  wudKey: string;
}>;

interface DeviceCodeFlowOptions {
  tokenEndpoint: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  audience?: string;
  resource?: string;
  timeout?: number;
}

interface OidcRequestParameters {
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  audience?: string;
  resource?: string;
}

interface DeviceCodeTokenPollOptions {
  tokenEndpoint: string;
  deviceCode: string;
  clientId?: string;
  clientSecret?: string;
  timeout?: number;
  pollIntervalMs: number;
  pollTimeoutMs: number;
}

interface ImgsetMatchCandidate {
  specificity: number;
  imgset: ResolvedImgset;
}

/**
 * Return all supported registries
 * @returns {*}
 */
function getRegistries() {
  return registry.getState().registry;
}

/**
 * Apply include/exclude regex filters to tags.
 * Returns the filtered tags and whether include-filter recovery mode is active.
 */
function applyIncludeExcludeFilters(
  container: Container,
  tags: string[],
  logContainer: any,
): { filteredTags: string[]; allowIncludeFilterRecovery: boolean } {
  let filteredTags = tags;
  let allowIncludeFilterRecovery = false;

  if (container.includeTags) {
    const includeTagsRegex = safeRegExp(container.includeTags, logContainer);
    if (includeTagsRegex) {
      filteredTags = filteredTags.filter((tag) => includeTagsRegex.test(tag));
      if (container.image.tag.semver && !includeTagsRegex.test(container.image.tag.value)) {
        logContainer.warn(
          `Current tag "${container.image.tag.value}" does not match includeTags regex "${container.includeTags}". Trying best-effort semver upgrade within filtered tags.`,
        );
        allowIncludeFilterRecovery = true;
      }
    }
  } else {
    filteredTags = filteredTags.filter((tag) => !tag.startsWith('sha'));
  }

  if (container.excludeTags) {
    const excludeTagsRegex = safeRegExp(container.excludeTags, logContainer);
    if (excludeTagsRegex) {
      filteredTags = filteredTags.filter((tag) => !excludeTagsRegex.test(tag));
    }
  }

  filteredTags = filteredTags.filter((tag) => !tag.endsWith('.sig'));
  return { filteredTags, allowIncludeFilterRecovery };
}

/**
 * Filter tags by prefix to match the current tag's prefix convention.
 */
function isDigitCode(charCode: number | undefined): boolean {
  return charCode !== undefined && charCode >= 48 && charCode <= 57;
}

function getFirstDigitIndex(value: string): number {
  for (let i = 0; i < value.length; i += 1) {
    if (isDigitCode(value.codePointAt(i))) {
      return i;
    }
  }
  return -1;
}

function getCurrentPrefix(value: string): string {
  const firstDigitIndex = getFirstDigitIndex(value);
  return firstDigitIndex >= 0 ? value.slice(0, firstDigitIndex) : '';
}

function startsWithDigit(value: string): boolean {
  return isDigitCode(value.codePointAt(0));
}

function getPrefixFilterWarning(currentPrefix: string): string {
  if (currentPrefix) {
    return `No tags found with existing prefix: '${currentPrefix}'; check your regex filters`;
  }
  return 'No tags found starting with a number (no prefix); check your regex filters';
}

function filterByCurrentPrefix(tags: string[], container: Container, logContainer: any): string[] {
  const currentTag = container.image.tag.value;
  const currentPrefix = getCurrentPrefix(currentTag);
  const filtered = tags.filter((tag) =>
    currentPrefix ? tag.startsWith(currentPrefix) : startsWithDigit(tag),
  );

  if (filtered.length === 0) {
    logContainer.warn(getPrefixFilterWarning(currentPrefix));
  }

  return filtered;
}

/**
 * Filter tags to only those with the same number of numeric segments as the current tag.
 */
function filterBySegmentCount(tags: string[], container: Container): string[] {
  const numericPart = /(\d+(\.\d+)*)/.exec(
    transformTag(container.transformTags, container.image.tag.value),
  );

  if (!numericPart) {
    return tags;
  }

  const referenceGroups = numericPart[0].split('.').length;
  return tags.filter((tag) => {
    const tagNumericPart = /(\d+(\.\d+)*)/.exec(transformTag(container.transformTags, tag));
    if (!tagNumericPart) return false;
    return tagNumericPart[0].split('.').length === referenceGroups;
  });
}

/**
 * Sort tags by semver in descending order (mutates the array).
 */
function sortSemverDescending(tags: string[], transformTags: string | undefined): void {
  tags.sort((t1, t2) => {
    const greater = isGreaterSemver(
      transformTag(transformTags, t2),
      transformTag(transformTags, t1),
    );
    return greater ? 1 : -1;
  });
}

/**
 * Keep only tags that are valid semver.
 */
function filterSemverOnly(tags: string[], transformTags: string | undefined): string[] {
  return tags.filter((tag) => parseSemver(transformTag(transformTags, tag)) !== null);
}

/**
 * Filter candidate tags (based on tag name).
 * @param container
 * @param tags
 * @returns {*}
 */
function getTagCandidates(container: Container, tags: string[], logContainer: any) {
  const { filteredTags: baseTags, allowIncludeFilterRecovery } = applyIncludeExcludeFilters(
    container,
    tags,
    logContainer,
  );

  if (!container.image.tag.semver && !container.includeTags) {
    return [];
  }

  if (!container.image.tag.semver) {
    // Non-semver tag with includeTags filter: advise best semver tag
    logContainer.warn(
      `Current tag "${container.image.tag.value}" is not semver but includeTags filter "${container.includeTags}" is set. Advising best semver tag from filtered candidates.`,
    );
    const semverTags = filterSemverOnly(baseTags, container.transformTags);
    sortSemverDescending(semverTags, container.transformTags);
    return semverTags;
  }

  // Semver image -> find higher semver tag
  let filteredTags = baseTags;

  if (filteredTags.length === 0) {
    logContainer.warn('No tags found after filtering; check you regex filters');
  }

  if (!container.includeTags) {
    filteredTags = filterByCurrentPrefix(filteredTags, container, logContainer);
  }

  filteredTags = filterSemverOnly(filteredTags, container.transformTags);
  filteredTags = filterBySegmentCount(filteredTags, container);

  if (!allowIncludeFilterRecovery) {
    filteredTags = filteredTags.filter((tag) =>
      isGreaterSemver(
        transformTag(container.transformTags, tag),
        transformTag(container.transformTags, container.image.tag.value),
      ),
    );
  }

  sortSemverDescending(filteredTags, container.transformTags);
  return filteredTags;
}

function normalizeContainer(container: Container) {
  const containerWithNormalizedImage = container;
  const imageForMatching = getImageForRegistryLookup(container.image);
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

/**
 * Build an image candidate used for registry matching and tag lookups.
 * The lookup value can be:
 * - an image reference (preferred): ghcr.io/user/image or library/nginx
 * - a legacy registry url: https://registry-1.docker.io
 */
function getImageForRegistryLookup(image: ContainerImage) {
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
    } catch (e) {
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

/**
 * Get the Docker Registry by name.
 * @param registryName
 */
function getRegistry(registryName: string) {
  const registryToReturn = getRegistries()[registryName];
  if (!registryToReturn) {
    throw new Error(`Unsupported Registry ${registryName}`);
  }
  return registryToReturn;
}

/**
 * Get old containers to prune.
 * @param newContainers
 * @param containersFromTheStore
 * @returns {*[]|*}
 */
function getOldContainers(newContainers: Container[], containersFromTheStore: Container[]) {
  if (!containersFromTheStore || !newContainers) {
    return [];
  }
  return containersFromTheStore.filter((containerFromStore) => {
    return !newContainers.some((newContainer) => newContainer.id === containerFromStore.id);
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
async function pruneOldContainers(
  newContainers: Container[],
  containersFromTheStore: Container[],
  dockerApi: any,
) {
  const containersToRemove = getOldContainers(newContainers, containersFromTheStore);
  for (const containerToRemove of containersToRemove) {
    try {
      const inspectResult = await dockerApi.getContainer(containerToRemove.id).inspect();
      const newStatus = inspectResult?.State?.Status;
      if (newStatus) {
        storeContainer.updateContainer({ ...containerToRemove, status: newStatus });
      }
    } catch {
      // Container no longer exists in Docker — remove from store
      storeContainer.deleteContainer(containerToRemove.id);
    }
  }
}

function getContainerName(container: any) {
  let containerName = '';
  const names = container.Names;
  if (names && names.length > 0) {
    [containerName] = names;
  }
  // Strip ugly forward slash
  containerName = containerName.replace(/\//, '');
  return containerName;
}

function getContainerDisplayName(
  containerName: string,
  parsedImagePath: string,
  displayName?: string,
) {
  if (displayName && displayName.trim() !== '') {
    return displayName;
  }

  const normalizedImagePath = (parsedImagePath || '').toLowerCase();
  if (normalizedImagePath === 'drydock' || normalizedImagePath.endsWith('/drydock')) {
    return 'drydock';
  }

  return containerName;
}

function normalizeConfigStringValue(value: any) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const valueTrimmed = value.trim();
  return valueTrimmed === '' ? undefined : valueTrimmed;
}

function getNestedValue(value: any, path: string) {
  return path
    .split('.')
    .filter((item) => item !== '')
    .reduce((nestedValue, item) => {
      if (nestedValue === undefined || nestedValue === null || typeof nestedValue !== 'object') {
        return undefined;
      }
      return nestedValue[item];
    }, value);
}

function getFirstConfigString(value: any, paths: string[]) {
  for (const path of paths) {
    const pathValue = normalizeConfigStringValue(getNestedValue(value, path));
    if (pathValue !== undefined) {
      return pathValue;
    }
  }
  return undefined;
}

function getImageReferenceCandidates(path: string, domain?: string) {
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

function getImageReferenceCandidatesFromPattern(pattern: string) {
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
  } catch (e) {
    log.debug(`Invalid imgset image pattern "${patternNormalized}" - using normalized value`);
    return [patternNormalized.toLowerCase()];
  }
}

function getImageReferenceCandidatesFromParsedImage(parsedImage: any) {
  return getImageReferenceCandidates(parsedImage?.path, parsedImage?.domain);
}

function getImgsetSpecificity(imagePattern: string, parsedImage: any) {
  const patternCandidates = getImageReferenceCandidatesFromPattern(imagePattern);
  if (patternCandidates.length === 0) {
    return -1;
  }
  const imageCandidates = getImageReferenceCandidatesFromParsedImage(parsedImage);
  if (imageCandidates.length === 0) {
    return -1;
  }

  const hasMatch = patternCandidates.some((patternCandidate) =>
    imageCandidates.includes(patternCandidate),
  );
  if (!hasMatch) {
    return -1;
  }
  return patternCandidates.reduce(
    (maxSpecificity, patternCandidate) => Math.max(maxSpecificity, patternCandidate.length),
    0,
  );
}

function getResolvedImgsetConfiguration(name: string, imgsetConfiguration: any) {
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
  } as ResolvedImgset;
}

function getContainerConfigValue(labelValue: string | undefined, imgsetValue: string | undefined) {
  return normalizeConfigStringValue(labelValue) || normalizeConfigStringValue(imgsetValue);
}

function normalizeConfigNumberValue(value: any) {
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

function getFirstConfigNumber(value: any, paths: string[]) {
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
function getRepoDigest(containerImage: any) {
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
function getInspectValueByPath(containerInspect: any, path: string) {
  if (!path) {
    return undefined;
  }
  const pathSegments = path.split('/').filter((segment) => segment !== '');
  return pathSegments.reduce((value, key) => {
    if (value === undefined || value === null) {
      return undefined;
    }
    return value[key];
  }, containerInspect);
}

/**
 * Try to derive a semver tag from a Docker inspect path.
 */
function getSemverTagFromInspectPath(
  containerInspect: any,
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
function isContainerToWatch(watchLabelValue: string, watchByDefault: boolean) {
  return watchLabelValue !== undefined && watchLabelValue !== ''
    ? watchLabelValue.toLowerCase() === 'true'
    : watchByDefault;
}

/**
 * Return true if container digest must be watched.
 * @param {string} watchDigestLabelValue - the value of dd.watch.digest label
 * @param {object} parsedImage - object containing at least `domain` property
 * @param {boolean} isSemver - true if the current image tag is a semver tag
 * @returns {boolean}
 */
function isDigestToWatch(watchDigestLabelValue: string, parsedImage: any, isSemver: boolean) {
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

  if (isSemver) {
    return false;
  }

  return !isDockerHub;
}

function resolveLabelsFromContainer(
  containerLabels: Record<string, string>,
  overrides: ContainerLabelOverrides = {},
) {
  const resolvedOverrides: ResolvedContainerLabelOverrides = {
    lookupImage: resolveLookupImageFromContainerLabels(containerLabels, overrides),
  };

  for (const { key, ddKey, wudKey } of containerLabelOverrideMappings) {
    resolvedOverrides[key] = overrides[key] || getLabel(containerLabels, ddKey, wudKey);
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

function mergeConfigWithImgset(
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
      getLabel(containerLabels, ddInspectTagPath, wudInspectTagPath),
      matchingImgset?.inspectTagPath,
    ),
    watchDigest: getContainerConfigValue(
      getLabel(containerLabels, ddWatchDigest, wudWatchDigest),
      matchingImgset?.watchDigest,
    ),
  };
}

function shouldUpdateDisplayNameFromContainerName(
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
 * Docker Watcher Component.
 */
class Docker extends Watcher {
  public configuration: DockerWatcherConfiguration = {} as DockerWatcherConfiguration;
  public dockerApi: Dockerode;
  public watchCron: any;
  public watchCronTimeout: any;
  public watchCronDebounced: any;
  public listenDockerEventsTimeout: any;
  public maintenanceWindowQueueTimeout: any;
  public maintenanceWindowWatchQueued: boolean = false;
  public dockerEventsBuffer = '';
  public remoteOidcAccessToken?: string;
  public remoteOidcRefreshToken?: string;
  public remoteOidcAccessTokenExpiresAt?: number;
  public remoteOidcDeviceCodeCompleted?: boolean;

  ensureLogger() {
    if (!this.log) {
      try {
        this.log = log.child({
          component: `watcher.docker.${this.name || 'default'}`,
        });
      } catch (error) {
        console.warn('Failed to initialize watcher logger, using no-op logger fallback');
        // Fallback to silent logger if log module fails
        this.log = {
          info: () => {},
          warn: () => {},
          error: () => {},
          debug: () => {},
          child: () => this.log,
        } as unknown as typeof log;
      }
    }
  }

  getConfigurationSchema() {
    return joi.object().keys({
      socket: this.joi.string().default('/var/run/docker.sock'),
      host: this.joi.string(),
      protocol: this.joi.string().valid('http', 'https'),
      port: this.joi.number().port().default(2375),
      auth: this.joi.object({
        type: this.joi.string().valid('basic', 'bearer', 'oidc').insensitive(),
        user: this.joi.string(),
        password: this.joi.string(),
        bearer: this.joi.string(),
        oidc: this.joi.object().unknown(true),
      }),
      cafile: this.joi.string(),
      certfile: this.joi.string(),
      keyfile: this.joi.string(),
      cron: joi.string().cron().default('0 * * * *'),
      jitter: this.joi.number().integer().min(0).default(60000),
      watchbydefault: this.joi.boolean().default(true),
      watchall: this.joi.boolean().default(false),
      watchdigest: this.joi.any(),
      watchevents: this.joi.boolean().default(true),
      watchatstart: this.joi.boolean().default(true),
      maintenancewindow: joi.string().cron().optional(),
      maintenancewindowtz: this.joi.string().default('UTC'),
      imgset: this.joi
        .object()
        .pattern(
          this.joi.string(),
          this.joi.object({
            image: this.joi.string().required(),
            include: this.joi.string(),
            exclude: this.joi.string(),
            transform: this.joi.string(),
            tag: this.joi.object({
              include: this.joi.string(),
              exclude: this.joi.string(),
              transform: this.joi.string(),
            }),
            link: this.joi.object({
              template: this.joi.string(),
            }),
            display: this.joi.object({
              name: this.joi.string(),
              icon: this.joi.string(),
            }),
            trigger: this.joi.object({
              include: this.joi.string(),
              exclude: this.joi.string(),
            }),
            registry: this.joi.object({
              lookup: this.joi.object({
                image: this.joi.string(),
                url: this.joi.string(),
              }),
            }),
            watch: this.joi.object({
              digest: this.joi.string().valid('true', 'false'),
            }),
            inspect: this.joi.object({
              tag: this.joi.object({
                path: this.joi.string(),
              }),
            }),
          }),
        )
        .default({}),
    });
  }

  maskConfiguration() {
    const hasMaintenanceWindow = !!this.configuration.maintenancewindow;
    const nextMaintenanceWindow = hasMaintenanceWindow
      ? this.getNextMaintenanceWindowDate()?.toISOString()
      : undefined;

    return {
      ...this.configuration,
      maintenancewindowopen: hasMaintenanceWindow ? this.isMaintenanceWindowOpen() : undefined,
      maintenancewindowqueued: hasMaintenanceWindow ? this.maintenanceWindowWatchQueued : false,
      maintenancenextwindow: nextMaintenanceWindow,
      auth: this.configuration.auth
        ? {
            type: this.configuration.auth.type,
            user: Docker.mask(this.configuration.auth.user),
            password: Docker.mask(this.configuration.auth.password),
            bearer: Docker.mask(this.configuration.auth.bearer),
            oidc: this.configuration.auth.oidc
              ? {
                  ...this.configuration.auth.oidc,
                  clientsecret: Docker.mask(
                    getFirstConfigString(this.configuration.auth.oidc, ['clientsecret']),
                  ),
                  accesstoken: Docker.mask(
                    getFirstConfigString(this.configuration.auth.oidc, ['accesstoken']),
                  ),
                  refreshtoken: Docker.mask(
                    getFirstConfigString(this.configuration.auth.oidc, ['refreshtoken']),
                  ),
                }
              : undefined,
          }
        : undefined,
    };
  }

  isMaintenanceWindowOpen() {
    if (!this.configuration.maintenancewindow) {
      return true;
    }
    return isInMaintenanceWindow(
      this.configuration.maintenancewindow,
      this.configuration.maintenancewindowtz,
    );
  }

  getNextMaintenanceWindowDate(fromDate: Date = new Date()) {
    if (!this.configuration.maintenancewindow) {
      return undefined;
    }
    return getNextMaintenanceWindow(
      this.configuration.maintenancewindow,
      this.configuration.maintenancewindowtz,
      fromDate,
    );
  }

  clearMaintenanceWindowQueue() {
    if (this.maintenanceWindowQueueTimeout) {
      clearTimeout(this.maintenanceWindowQueueTimeout);
      this.maintenanceWindowQueueTimeout = undefined;
    }
    this.maintenanceWindowWatchQueued = false;
  }

  queueMaintenanceWindowWatch() {
    this.maintenanceWindowWatchQueued = true;
    if (this.maintenanceWindowQueueTimeout) {
      return;
    }
    this.maintenanceWindowQueueTimeout = setTimeout(
      () => this.checkQueuedMaintenanceWindowWatch(),
      MAINTENANCE_WINDOW_QUEUE_POLL_MS,
    );
  }

  async checkQueuedMaintenanceWindowWatch() {
    this.maintenanceWindowQueueTimeout = undefined;
    if (!this.configuration.maintenancewindow || !this.maintenanceWindowWatchQueued) {
      this.clearMaintenanceWindowQueue();
      return;
    }

    if (!this.isMaintenanceWindowOpen()) {
      this.queueMaintenanceWindowWatch();
      return;
    }

    try {
      this.ensureLogger();
      if (this.log && typeof this.log.info === 'function') {
        this.log.info('Maintenance window opened - running queued update check');
      }
      await this.watchFromCron({
        ignoreMaintenanceWindow: true,
      });
    } catch (e: any) {
      this.ensureLogger();
      if (this.log && typeof this.log.warn === 'function') {
        this.log.warn(`Unable to run queued maintenance watch (${e.message})`);
      }
    }
  }

  /**
   * Init the Watcher.
   */
  async init() {
    this.ensureLogger();
    this.initWatcher();
    if (this.configuration.watchdigest !== undefined) {
      this.log.warn(
        "DD_WATCHER_{watcher_name}_WATCHDIGEST environment variable is deprecated and won't be supported in upcoming versions",
      );
    }
    this.log.info(`Cron scheduled (${this.configuration.cron})`);
    this.watchCron = cron.schedule(this.configuration.cron, () => this.watchFromCron(), {
      maxRandomDelay: this.configuration.jitter,
    });

    // Resolve watchatstart based on this watcher persisted state.
    // Keep explicit "false" untouched; default "true" is disabled only when
    // this watcher already has containers in store.
    const isWatcherStoreEmpty =
      storeContainer.getContainers({
        watcher: this.name,
      }).length === 0;
    this.configuration.watchatstart = this.configuration.watchatstart && isWatcherStoreEmpty;

    // watch at startup if enabled (after all components have been registered)
    if (this.configuration.watchatstart) {
      this.watchCronTimeout = setTimeout(this.watchFromCron.bind(this), START_WATCHER_DELAY_MS);
    }

    // listen to docker events
    if (this.configuration.watchevents) {
      this.watchCronDebounced = debounce(this.watchFromCron.bind(this), DEBOUNCED_WATCH_CRON_MS);
      this.listenDockerEventsTimeout = setTimeout(
        this.listenDockerEvents.bind(this),
        START_WATCHER_DELAY_MS,
      );
    }
  }

  initWatcher() {
    const options: Dockerode.DockerOptions = {};
    if (this.configuration.host) {
      options.host = this.configuration.host;
      options.port = this.configuration.port;
      if (this.configuration.protocol) {
        options.protocol = this.configuration.protocol;
      }
      if (this.configuration.cafile) {
        options.ca = fs.readFileSync(
          resolveConfiguredPath(this.configuration.cafile, {
            label: `watcher ${this.name} CA file path`,
          }),
        );
      }
      if (this.configuration.certfile) {
        options.cert = fs.readFileSync(
          resolveConfiguredPath(this.configuration.certfile, {
            label: `watcher ${this.name} certificate file path`,
          }),
        );
      }
      if (this.configuration.keyfile) {
        options.key = fs.readFileSync(
          resolveConfiguredPath(this.configuration.keyfile, {
            label: `watcher ${this.name} key file path`,
          }),
        );
      }
      this.applyRemoteAuthHeaders(options);
    } else {
      options.socketPath = this.configuration.socket;
    }
    this.dockerApi = new Dockerode(options);
  }

  isHttpsRemoteWatcher(options: Dockerode.DockerOptions) {
    if (options.protocol === 'https') {
      return true;
    }
    return Boolean(options.ca || options.cert || options.key);
  }

  getOidcAuthConfiguration() {
    return this.configuration.auth?.oidc || {};
  }

  getOidcAuthString(paths: string[]) {
    return getFirstConfigString(this.getOidcAuthConfiguration(), paths);
  }

  getOidcAuthNumber(paths: string[]) {
    return getFirstConfigNumber(this.getOidcAuthConfiguration(), paths);
  }

  getRemoteAuthResolution(auth: any) {
    const hasBearer = Boolean(auth?.bearer);
    const hasBasic = Boolean(auth?.user && auth?.password);
    const hasOidcConfig = Boolean(
      getFirstConfigString(auth?.oidc, OIDC_TOKEN_ENDPOINT_PATHS) ||
        getFirstConfigString(auth?.oidc, OIDC_ACCESS_TOKEN_PATHS) ||
        getFirstConfigString(auth?.oidc, OIDC_REFRESH_TOKEN_PATHS),
    );
    let authType = `${auth?.type || ''}`.toLowerCase();
    if (!authType) {
      if (hasBearer) {
        authType = 'bearer';
      } else if (hasBasic) {
        authType = 'basic';
      } else if (hasOidcConfig) {
        authType = 'oidc';
      }
    }
    return { authType, hasBearer, hasBasic, hasOidcConfig };
  }

  setRemoteAuthorizationHeader(authorizationValue: string) {
    if (!authorizationValue) {
      return;
    }
    const dockerApiAny = this.dockerApi as any;
    if (!dockerApiAny.modem) {
      dockerApiAny.modem = {};
    }
    dockerApiAny.modem.headers = {
      ...(dockerApiAny.modem.headers || {}),
      Authorization: authorizationValue,
    };
  }

  initializeRemoteOidcStateFromConfiguration() {
    const configuredAccessToken = this.getOidcAuthString(OIDC_ACCESS_TOKEN_PATHS);
    const configuredRefreshToken = this.getOidcAuthString(OIDC_REFRESH_TOKEN_PATHS);
    const configuredExpiresInSeconds = this.getOidcAuthNumber(OIDC_EXPIRES_IN_PATHS);

    if (configuredAccessToken && !this.remoteOidcAccessToken) {
      this.remoteOidcAccessToken = configuredAccessToken;
    }
    if (configuredRefreshToken && !this.remoteOidcRefreshToken) {
      this.remoteOidcRefreshToken = configuredRefreshToken;
    }
    if (
      configuredAccessToken &&
      configuredExpiresInSeconds !== undefined &&
      this.remoteOidcAccessTokenExpiresAt === undefined
    ) {
      this.remoteOidcAccessTokenExpiresAt = Date.now() + configuredExpiresInSeconds * 1000;
    }
  }

  getOidcGrantType() {
    const configuredGrantType = `${this.getOidcAuthString(OIDC_GRANT_TYPE_PATHS) || ''}`
      .trim()
      .toLowerCase();
    if (configuredGrantType) {
      return configuredGrantType;
    }
    if (this.remoteOidcRefreshToken) {
      return 'refresh_token';
    }
    const deviceUrl = this.getOidcAuthString(OIDC_DEVICE_URL_PATHS);
    if (deviceUrl) {
      return 'urn:ietf:params:oauth:grant-type:device_code';
    }
    return 'client_credentials';
  }

  isRemoteOidcTokenRefreshRequired() {
    if (!this.remoteOidcAccessToken) {
      return true;
    }
    if (this.remoteOidcAccessTokenExpiresAt === undefined) {
      return false;
    }
    return this.remoteOidcAccessTokenExpiresAt <= Date.now() + OIDC_ACCESS_TOKEN_REFRESH_WINDOW_MS;
  }

  /**
   * Determine the effective OIDC grant type, applying fallbacks for
   * missing refresh tokens, unsupported types, and device-code flow.
   * Returns the resolved grant type and, when applicable, the device URL.
   */
  private determineGrantType(): { grantType: string; deviceUrl?: string } {
    let grantType = this.getOidcGrantType();

    if (grantType === 'refresh_token' && !this.remoteOidcRefreshToken) {
      this.log.warn(
        `OIDC refresh token is missing for ${this.name}; fallback to client_credentials grant`,
      );
      grantType = 'client_credentials';
    }

    if (grantType === 'urn:ietf:params:oauth:grant-type:device_code') {
      const deviceUrl = this.getOidcAuthString(OIDC_DEVICE_URL_PATHS);
      if (!deviceUrl) {
        this.log.warn(
          `OIDC device authorization URL is missing for ${this.name}; fallback to client_credentials`,
        );
        grantType = 'client_credentials';
      } else {
        return { grantType, deviceUrl };
      }
    }

    if (grantType !== 'client_credentials' && grantType !== 'refresh_token') {
      this.log.warn(
        `OIDC grant type "${grantType}" is unsupported for ${this.name}; fallback to client_credentials`,
      );
      grantType = 'client_credentials';
    }

    return { grantType };
  }

  /**
   * Build the URLSearchParams body for a standard OIDC token request
   * (client_credentials or refresh_token grant).
   */
  private appendOidcRequestBodyFields(
    body: URLSearchParams,
    params: OidcRequestParameters,
    includeClientSecret = true,
  ) {
    if (params.clientId) {
      body.set('client_id', params.clientId);
    }
    if (includeClientSecret && params.clientSecret) {
      body.set('client_secret', params.clientSecret);
    }
    if (params.scope) {
      body.set('scope', params.scope);
    }
    if (params.audience) {
      body.set('audience', params.audience);
    }
    if (params.resource) {
      body.set('resource', params.resource);
    }
  }

  private buildTokenRequestBody(grantType: string, params: OidcRequestParameters): URLSearchParams {
    const body = new URLSearchParams();
    body.set('grant_type', grantType);
    if (grantType === 'refresh_token' && this.remoteOidcRefreshToken) {
      body.set('refresh_token', this.remoteOidcRefreshToken);
    }
    this.appendOidcRequestBodyFields(body, params);
    return body;
  }

  private applyRemoteOidcTokenPayload(
    tokenPayload: any,
    options: { markDeviceCodeCompleted?: boolean; allowMissingAccessToken?: boolean } = {},
  ): boolean {
    const accessToken = tokenPayload?.access_token;
    if (!accessToken) {
      if (options.allowMissingAccessToken) {
        return false;
      }
      throw new Error(
        `Unable to refresh OIDC token for ${this.name}: token endpoint response does not contain access_token`,
      );
    }

    this.remoteOidcAccessToken = accessToken;
    if (tokenPayload.refresh_token) {
      this.remoteOidcRefreshToken = tokenPayload.refresh_token;
    }
    const expiresIn = normalizeConfigNumberValue(tokenPayload.expires_in);
    const tokenTtlMs = (expiresIn ?? OIDC_DEFAULT_ACCESS_TOKEN_TTL_MS / 1000) * 1000;
    this.remoteOidcAccessTokenExpiresAt = Date.now() + tokenTtlMs;
    if (options.markDeviceCodeCompleted) {
      this.remoteOidcDeviceCodeCompleted = true;
    }
    return true;
  }

  async refreshRemoteOidcAccessToken() {
    const tokenEndpoint = this.getOidcAuthString(OIDC_TOKEN_ENDPOINT_PATHS);
    if (!tokenEndpoint) {
      throw new Error(
        `Unable to refresh OIDC token for ${this.name}: missing auth.oidc token endpoint`,
      );
    }

    const oidcClientId = this.getOidcAuthString(OIDC_CLIENT_ID_PATHS);
    const oidcClientSecret = this.getOidcAuthString(OIDC_CLIENT_SECRET_PATHS);
    const oidcScope = this.getOidcAuthString(OIDC_SCOPE_PATHS);
    const oidcAudience = this.getOidcAuthString(OIDC_AUDIENCE_PATHS);
    const oidcResource = this.getOidcAuthString(OIDC_RESOURCE_PATHS);
    const oidcTimeout = this.getOidcAuthNumber(OIDC_TIMEOUT_PATHS);

    const { grantType, deviceUrl } = this.determineGrantType();

    // Device code flow: delegate to the dedicated method
    if (grantType === 'urn:ietf:params:oauth:grant-type:device_code' && deviceUrl) {
      await this.performDeviceCodeFlow(deviceUrl, {
        tokenEndpoint,
        clientId: oidcClientId,
        clientSecret: oidcClientSecret,
        scope: oidcScope,
        audience: oidcAudience,
        resource: oidcResource,
        timeout: oidcTimeout,
      });
      return;
    }

    const tokenRequestBody = this.buildTokenRequestBody(grantType, {
      clientId: oidcClientId,
      clientSecret: oidcClientSecret,
      scope: oidcScope,
      audience: oidcAudience,
      resource: oidcResource,
    });

    const tokenResponse = await axios.post(tokenEndpoint, tokenRequestBody.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: oidcTimeout || OIDC_DEFAULT_TIMEOUT_MS,
    });
    this.applyRemoteOidcTokenPayload(tokenResponse?.data || {});
  }

  /**
   * Perform the OAuth 2.0 Device Authorization Grant (RFC 8628).
   *
   * Step 1: POST to the device authorization endpoint to obtain a device_code,
   *         user_code, and verification_uri.
   * Step 2: Log the user code and verification URI so the operator can authorize
   *         the device in a browser.
   * Step 3: Poll the token endpoint with the device_code until the user completes
   *         authorization, the code expires, or polling times out.
   */
  async performDeviceCodeFlow(deviceUrl: string, options: DeviceCodeFlowOptions) {
    const { tokenEndpoint, clientId, clientSecret, scope, audience, resource, timeout } = options;

    // Step 1: Request device authorization
    const deviceRequestBody = new URLSearchParams();
    this.appendOidcRequestBodyFields(
      deviceRequestBody,
      { clientId, clientSecret, scope, audience, resource },
      false,
    );

    const deviceResponse = await axios.post(deviceUrl, deviceRequestBody.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: timeout || OIDC_DEFAULT_TIMEOUT_MS,
    });

    const devicePayload = deviceResponse?.data || {};
    const deviceCode = devicePayload.device_code;
    const userCode = devicePayload.user_code;
    const verificationUri = devicePayload.verification_uri || devicePayload.verification_url;
    const verificationUriComplete =
      devicePayload.verification_uri_complete || devicePayload.verification_url_complete;
    const serverInterval = normalizeConfigNumberValue(devicePayload.interval);
    const deviceExpiresIn = normalizeConfigNumberValue(devicePayload.expires_in);

    if (!deviceCode) {
      throw new Error(
        `OIDC device authorization for ${this.name} failed: response does not contain device_code`,
      );
    }

    // Step 2: Log the user code for the operator
    const pollIntervalMs = serverInterval ? serverInterval * 1000 : OIDC_DEVICE_POLL_INTERVAL_MS;
    const pollTimeoutMs = deviceExpiresIn ? deviceExpiresIn * 1000 : OIDC_DEVICE_POLL_TIMEOUT_MS;

    if (verificationUriComplete) {
      this.log.info(
        `OIDC device authorization for ${this.name}: visit ${verificationUriComplete} to authorize this device`,
      );
    } else if (verificationUri && userCode) {
      this.log.info(
        `OIDC device authorization for ${this.name}: visit ${verificationUri} and enter code ${userCode}`,
      );
    } else {
      this.log.info(
        `OIDC device authorization for ${this.name}: user_code=${userCode || 'N/A'}, verification_uri=${verificationUri || 'N/A'}`,
      );
    }

    // Step 3: Poll the token endpoint
    await this.pollDeviceCodeToken({
      tokenEndpoint,
      deviceCode,
      clientId,
      clientSecret,
      timeout,
      pollIntervalMs,
      pollTimeoutMs,
    });
  }

  /**
   * Build the URLSearchParams body for a device-code token poll request.
   */
  private buildDeviceCodeTokenRequest(
    deviceCode: string,
    clientId: string | undefined,
    clientSecret: string | undefined,
  ): URLSearchParams {
    const body = new URLSearchParams();
    body.set('grant_type', 'urn:ietf:params:oauth:grant-type:device_code');
    body.set('device_code', deviceCode);
    this.appendOidcRequestBodyFields(body, { clientId, clientSecret });
    return body;
  }

  /**
   * Handle an error response during device-code token polling.
   * Returns an object indicating whether to continue polling and any
   * adjustment to the poll interval, or throws on fatal errors.
   */
  private handleTokenErrorResponse(
    e: any,
    currentIntervalMs: number,
  ): { continuePolling: boolean; newIntervalMs: number } {
    const errorResponse = e?.response?.data;
    const errorCode = errorResponse?.error || '';

    if (errorCode === 'authorization_pending') {
      this.log.debug(
        `OIDC device authorization for ${this.name}: waiting for user authorization...`,
      );
      return { continuePolling: true, newIntervalMs: currentIntervalMs };
    }

    if (errorCode === 'slow_down') {
      const newIntervalMs = currentIntervalMs + 5000;
      this.log.debug(
        `OIDC device authorization for ${this.name}: slowing down, new interval=${newIntervalMs}ms`,
      );
      return { continuePolling: true, newIntervalMs };
    }

    if (errorCode === 'expired_token') {
      throw new Error(
        `OIDC device authorization for ${this.name} failed: device code expired before user authorization`,
      );
    }

    if (errorCode === 'access_denied') {
      throw new Error(
        `OIDC device authorization for ${this.name} failed: user denied the authorization request`,
      );
    }

    const errorDescription = errorResponse?.error_description || e.message;
    throw new Error(`OIDC device authorization for ${this.name} failed: ${errorDescription}`);
  }

  /**
   * Poll the token endpoint with the device_code until the user authorizes,
   * the code expires, or the maximum timeout is reached.
   */
  async pollDeviceCodeToken(options: DeviceCodeTokenPollOptions) {
    const {
      tokenEndpoint,
      deviceCode,
      clientId,
      clientSecret,
      timeout,
      pollIntervalMs,
      pollTimeoutMs,
    } = options;
    const startTime = Date.now();
    let currentIntervalMs = pollIntervalMs;

    while (Date.now() - startTime < pollTimeoutMs) {
      await this.sleep(currentIntervalMs);

      const tokenRequestBody = this.buildDeviceCodeTokenRequest(deviceCode, clientId, clientSecret);

      try {
        const tokenResponse = await axios.post(tokenEndpoint, tokenRequestBody.toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: timeout || OIDC_DEFAULT_TIMEOUT_MS,
        });

        const applied = this.applyRemoteOidcTokenPayload(tokenResponse?.data || {}, {
          markDeviceCodeCompleted: true,
          allowMissingAccessToken: true,
        });
        if (!applied) {
          continue;
        }
        this.log.info(`OIDC device authorization for ${this.name} completed successfully`);
        return;
      } catch (e: any) {
        const result = this.handleTokenErrorResponse(e, currentIntervalMs);
        if (result.continuePolling) {
          currentIntervalMs = result.newIntervalMs;
        }
      }
    }

    throw new Error(
      `OIDC device authorization for ${this.name} failed: polling timed out after ${pollTimeoutMs}ms`,
    );
  }

  /**
   * Sleep utility for polling loops. Extracted as a method for testability.
   */
  async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async ensureRemoteAuthHeaders() {
    if (!this.configuration.host || !this.configuration.auth) {
      return;
    }

    const auth = this.configuration.auth;
    const { authType } = this.getRemoteAuthResolution(auth);
    if (authType !== 'oidc') {
      return;
    }
    if (
      !this.isHttpsRemoteWatcher({
        protocol: this.configuration.protocol,
        ca: this.configuration.cafile,
        cert: this.configuration.certfile,
        key: this.configuration.keyfile,
      } as Dockerode.DockerOptions)
    ) {
      return;
    }

    this.initializeRemoteOidcStateFromConfiguration();

    if (this.isRemoteOidcTokenRefreshRequired()) {
      await this.refreshRemoteOidcAccessToken();
    }
    if (!this.remoteOidcAccessToken) {
      throw new Error(
        `Unable to authenticate remote watcher ${this.name}: no OIDC access token available`,
      );
    }
    this.setRemoteAuthorizationHeader(`Bearer ${this.remoteOidcAccessToken}`);
  }

  applyRemoteAuthHeaders(options: Dockerode.DockerOptions) {
    const auth = this.configuration.auth;
    if (!auth) {
      return;
    }

    const { authType, hasBearer, hasBasic, hasOidcConfig } = this.getRemoteAuthResolution(auth);
    if (!hasBearer && !hasBasic && !hasOidcConfig && authType !== 'oidc') {
      this.log.warn(`Skip remote watcher auth for ${this.name} because credentials are incomplete`);
      return;
    }

    if (!this.isHttpsRemoteWatcher(options)) {
      this.log.warn(
        `Skip remote watcher auth for ${this.name} because HTTPS is required (set protocol=https or TLS certificates)`,
      );
      return;
    }

    if (authType === 'basic') {
      if (!hasBasic) {
        this.log.warn(
          `Skip remote watcher auth for ${this.name} because basic credentials are incomplete`,
        );
        return;
      }
      const token = Buffer.from(`${auth.user}:${auth.password}`).toString('base64');
      options.headers = {
        ...options.headers,
        Authorization: `Basic ${token}`,
      };
      return;
    }

    if (authType === 'bearer') {
      if (!hasBearer) {
        this.log.warn(`Skip remote watcher auth for ${this.name} because bearer token is missing`);
        return;
      }
      options.headers = {
        ...options.headers,
        Authorization: `Bearer ${auth.bearer}`,
      };
      return;
    }

    if (authType === 'oidc') {
      this.initializeRemoteOidcStateFromConfiguration();
      if (this.remoteOidcAccessToken) {
        options.headers = {
          ...options.headers,
          Authorization: `Bearer ${this.remoteOidcAccessToken}`,
        };
      }
      return;
    }

    this.log.warn(
      `Skip remote watcher auth for ${this.name} because auth type "${auth.type}" is unsupported`,
    );
  }

  /**
   * Deregister the component.
   * @returns {Promise<void>}
   */
  async deregisterComponent() {
    if (this.watchCron) {
      this.watchCron.stop();
      delete this.watchCron;
    }
    if (this.watchCronTimeout) {
      clearTimeout(this.watchCronTimeout);
    }
    if (this.listenDockerEventsTimeout) {
      clearTimeout(this.listenDockerEventsTimeout);
      delete this.watchCronDebounced;
    }
    this.clearMaintenanceWindowQueue();
  }

  /**
   * Listen and react to docker events.
   * @return {Promise<void>}
   */
  async listenDockerEvents() {
    this.ensureLogger();
    if (!this.log || typeof this.log.info !== 'function') {
      return;
    }
    try {
      await this.ensureRemoteAuthHeaders();
    } catch (e: any) {
      this.log.warn(`Unable to initialize remote watcher auth for docker events (${e.message})`);
      return;
    }
    this.dockerEventsBuffer = '';
    this.log.info('Listening to docker events');
    const options: Dockerode.GetEventsOptions = {
      filters: {
        type: ['container'],
        event: [
          'create',
          'destroy',
          'start',
          'stop',
          'pause',
          'unpause',
          'die',
          'update',
          'rename',
        ],
      },
    };
    this.dockerApi.getEvents(options, (err, stream) => {
      if (err) {
        if (this.log && typeof this.log.warn === 'function') {
          this.log.warn(`Unable to listen to Docker events [${err.message}]`);
          this.log.debug(err);
        }
      } else {
        stream.on('data', (chunk: any) => this.onDockerEvent(chunk));
      }
    });
  }

  isRecoverableDockerEventParseError(error: any) {
    const message = `${error?.message || ''}`.toLowerCase();
    return (
      message.includes('unexpected end of json input') ||
      message.includes('unterminated string in json')
    );
  }

  async processDockerEventPayload(
    dockerEventPayload: string,
    shouldTreatRecoverableErrorsAsPartial = false,
  ) {
    const payloadTrimmed = dockerEventPayload.trim();
    if (payloadTrimmed === '') {
      return true;
    }
    try {
      const dockerEvent = JSON.parse(payloadTrimmed);
      await this.processDockerEvent(dockerEvent);
      return true;
    } catch (e: any) {
      if (shouldTreatRecoverableErrorsAsPartial && this.isRecoverableDockerEventParseError(e)) {
        return false;
      }
      this.log.debug(`Unable to process Docker event (${e.message})`);
      return true;
    }
  }

  async processDockerEvent(dockerEvent: any) {
    const action = dockerEvent.Action;
    const containerId = dockerEvent.id;

    if (action === 'destroy' || action === 'create') {
      await this.watchCronDebounced();
      return;
    }

    try {
      await this.ensureRemoteAuthHeaders();
      const container = await this.dockerApi.getContainer(containerId);
      const containerInspect = await container.inspect();
      const containerFound = storeContainer.getContainer(containerId);

      if (containerFound) {
        this.updateContainerFromInspect(containerFound, containerInspect);
      }
    } catch (e: any) {
      this.log.debug(
        `Unable to get container details for container id=[${containerId}] (${e.message})`,
      );
    }
  }

  private updateContainerFromInspect(containerFound: Container, containerInspect: any) {
    const logContainer = this.log.child({
      container: fullName(containerFound),
    });

    const newStatus = containerInspect.State.Status;
    const newName = (containerInspect.Name || '').replace(/^\//, '');
    const oldStatus = containerFound.status;
    const oldName = containerFound.name;
    const oldDisplayName = containerFound.displayName;

    const labelsFromInspect = containerInspect.Config?.Labels;
    const labelsCurrent = containerFound.labels || {};
    const labelsToApply = labelsFromInspect || labelsCurrent;
    const labelsChanged = JSON.stringify(labelsCurrent) !== JSON.stringify(labelsToApply);

    const customDisplayNameFromLabel = getLabel(labelsToApply, ddDisplayName, wudDisplayName);
    const hasCustomDisplayName =
      customDisplayNameFromLabel && customDisplayNameFromLabel.trim() !== '';

    let changed = false;

    if (oldStatus !== newStatus) {
      containerFound.status = newStatus;
      changed = true;
      logContainer.info(`Status changed from ${oldStatus} to ${newStatus}`);
    }

    if (newName !== '' && oldName !== newName) {
      containerFound.name = newName;
      changed = true;
      logContainer.info(`Name changed from ${oldName} to ${newName}`);
    }

    if (labelsChanged) {
      containerFound.labels = labelsToApply;
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
      storeContainer.updateContainer(containerFound);
    }
  }

  /**
   * Process a docker event.
   * @param dockerEventChunk
   * @return {Promise<void>}
   */
  async onDockerEvent(dockerEventChunk: any) {
    this.ensureLogger();
    this.dockerEventsBuffer += dockerEventChunk.toString();
    const dockerEventPayloads = this.dockerEventsBuffer.split('\n');
    const lastPayload = dockerEventPayloads.pop();
    this.dockerEventsBuffer = lastPayload || '';

    for (const dockerEventPayload of dockerEventPayloads) {
      await this.processDockerEventPayload(dockerEventPayload);
    }

    const bufferedPayload = this.dockerEventsBuffer.trim();
    if (
      bufferedPayload !== '' &&
      bufferedPayload.startsWith('{') &&
      bufferedPayload.endsWith('}')
    ) {
      const processed = await this.processDockerEventPayload(bufferedPayload, true);
      if (processed) {
        this.dockerEventsBuffer = '';
      }
    }
  }

  /**
   * Watch containers (called by cron scheduled tasks).
   * @returns {Promise<*[]>}
   */
  async watchFromCron(options: { ignoreMaintenanceWindow?: boolean } = {}) {
    const { ignoreMaintenanceWindow = false } = options;
    this.ensureLogger();
    if (!this.log || typeof this.log.info !== 'function') {
      return [];
    }

    // Check maintenance window before proceeding
    if (
      !ignoreMaintenanceWindow &&
      this.configuration.maintenancewindow &&
      !this.isMaintenanceWindowOpen()
    ) {
      this.queueMaintenanceWindowWatch();
      this.log.info('Skipping update check - outside maintenance window');
      const counter = getMaintenanceSkipCounter();
      if (counter) {
        counter.labels({ type: this.type, name: this.name }).inc();
      }
      return [];
    }
    this.clearMaintenanceWindowQueue();

    this.log.info(`Cron started (${this.configuration.cron})`);

    // Get container reports
    const containerReports = await this.watch();

    // Count container reports
    const containerReportsCount = containerReports.length;

    // Count container available updates
    const containerUpdatesCount = containerReports.filter(
      (containerReport) => containerReport.container.updateAvailable,
    ).length;

    // Count container errors
    const containerErrorsCount = containerReports.filter(
      (containerReport) => containerReport.container.error !== undefined,
    ).length;

    const stats = `${containerReportsCount} containers watched, ${containerErrorsCount} errors, ${containerUpdatesCount} available updates`;
    this.ensureLogger();
    if (this.log && typeof this.log.info === 'function') {
      this.log.info(`Cron finished (${stats})`);
    }
    return containerReports;
  }

  /**
   * Watch main method.
   * @returns {Promise<*[]>}
   */
  async watch() {
    this.ensureLogger();
    let containers: Container[] = [];

    // Dispatch event to notify start watching
    event.emitWatcherStart(this);

    // List images to watch
    try {
      containers = await this.getContainers();
    } catch (e: any) {
      this.log.warn(`Error when trying to get the list of the containers to watch (${e.message})`);
    }
    try {
      const containerReports = await Promise.all(
        containers.map((container) => this.watchContainer(container)),
      );
      event.emitContainerReports(containerReports);
      return containerReports;
    } catch (e: any) {
      this.log.warn(`Error when processing some containers (${e.message})`);
      return [];
    } finally {
      // Dispatch event to notify stop watching
      event.emitWatcherStop(this);
    }
  }

  /**
   * Watch a Container.
   * @param container
   * @returns {Promise<*>}
   */
  async watchContainer(container: Container) {
    this.ensureLogger();
    // Child logger for the container to process
    const logContainer = this.log.child({ container: fullName(container) });
    const containerWithResult = container;

    // Reset previous results if so
    delete containerWithResult.result;
    delete containerWithResult.error;
    logContainer.debug('Start watching');

    try {
      containerWithResult.result = await this.findNewVersion(container, logContainer);
    } catch (e: any) {
      logContainer.warn(`Error when processing (${e.message})`);
      logContainer.debug(e);
      containerWithResult.error = {
        message: e.message,
      };
    }

    const containerReport = this.mapContainerToContainerReport(containerWithResult);
    event.emitContainerReport(containerReport);
    return containerReport;
  }

  /**
   * Get all containers to watch.
   * @returns {Promise<unknown[]>}
   */
  async getContainers(): Promise<Container[]> {
    this.ensureLogger();
    await this.ensureRemoteAuthHeaders();
    const listContainersOptions: Dockerode.ContainerListOptions = {};
    if (this.configuration.watchall) {
      listContainersOptions.all = true;
    }
    const containers = await this.dockerApi.listContainers(listContainersOptions);

    const swarmServiceLabelsCache = new Map<string, Promise<Record<string, string>>>();
    const containersWithResolvedLabels = await Promise.all(
      containers.map(async (container: any) => ({
        ...container,
        Labels: await this.getEffectiveContainerLabels(container, swarmServiceLabelsCache),
      })),
    );

    // Filter on containers to watch
    const filteredContainers = containersWithResolvedLabels.filter((container: any) =>
      isContainerToWatch(
        getLabel(container.Labels, ddWatch, wudWatch),
        this.configuration.watchbydefault,
      ),
    );
    const containerPromises = filteredContainers.map((container: any) =>
      this.addImageDetailsToContainer(container, {
        includeTags: getLabel(container.Labels, ddTagInclude, wudTagInclude),
        excludeTags: getLabel(container.Labels, ddTagExclude, wudTagExclude),
        transformTags: getLabel(container.Labels, ddTagTransform, wudTagTransform),
        linkTemplate: getLabel(container.Labels, ddLinkTemplate, wudLinkTemplate),
        displayName: getLabel(container.Labels, ddDisplayName, wudDisplayName),
        displayIcon: getLabel(container.Labels, ddDisplayIcon, wudDisplayIcon),
        triggerInclude: getLabel(container.Labels, ddTriggerInclude, wudTriggerInclude),
        triggerExclude: getLabel(container.Labels, ddTriggerExclude, wudTriggerExclude),
        registryLookupImage: getLabel(
          container.Labels,
          ddRegistryLookupImage,
          wudRegistryLookupImage,
        ),
        registryLookupUrl: getLabel(container.Labels, ddRegistryLookupUrl, wudRegistryLookupUrl),
      }).catch((e) => {
        this.log.warn(`Failed to fetch image detail for container ${container.Id}: ${e.message}`);
        return e;
      }),
    );
    const containersToReturn = (await Promise.all(containerPromises)).filter(
      (result): result is Container => !(result instanceof Error) && result != null,
    );

    // Prune old containers from the store
    try {
      const containersFromTheStore = storeContainer.getContainers({
        watcher: this.name,
      });
      await pruneOldContainers(containersToReturn, containersFromTheStore, this.dockerApi);
    } catch (e: any) {
      this.log.warn(`Error when trying to prune the old containers (${e.message})`);
    }
    getWatchContainerGauge()?.set(
      {
        type: this.type,
        name: this.name,
      },
      containersToReturn.length,
    );

    return containersToReturn;
  }

  async getSwarmServiceLabels(
    serviceId: string,
    containerId: string,
  ): Promise<Record<string, string>> {
    this.ensureLogger();
    if (typeof this.dockerApi.getService !== 'function') {
      this.log.debug(
        `Docker API does not support getService; skipping swarm label lookup for container ${containerId}`,
      );
      return {};
    }

    try {
      const swarmService = await this.dockerApi.getService(serviceId).inspect();
      const serviceLabels = swarmService?.Spec?.Labels || {};
      const taskContainerLabels = swarmService?.Spec?.TaskTemplate?.ContainerSpec?.Labels || {};

      const hasDeployLabels = Object.keys(serviceLabels).length > 0;
      const hasTaskLabels = Object.keys(taskContainerLabels).length > 0;
      if (!hasDeployLabels && !hasTaskLabels) {
        this.log.debug(
          `Swarm service ${serviceId} (container ${containerId}) has no labels in Spec.Labels or TaskTemplate.ContainerSpec.Labels`,
        );
      } else {
        this.log.debug(
          `Swarm service ${serviceId} (container ${containerId}): deploy labels=${
            Object.keys(serviceLabels)
              .filter((k) => k.startsWith('dd.') || k.startsWith('wud.'))
              .join(',') || 'none'
          }, task labels=${
            Object.keys(taskContainerLabels)
              .filter((k) => k.startsWith('dd.') || k.startsWith('wud.'))
              .join(',') || 'none'
          }`,
        );
      }

      return {
        ...serviceLabels,
        ...taskContainerLabels,
      };
    } catch (e: any) {
      this.log.warn(
        `Unable to inspect swarm service ${serviceId} for container ${containerId} (${e.message}); deploy-level labels will not be available`,
      );
      return {};
    }
  }

  async getEffectiveContainerLabels(
    container: any,
    serviceLabelsCache: Map<string, Promise<Record<string, string>>>,
  ): Promise<Record<string, string>> {
    const containerLabels = container.Labels || {};
    const serviceId = containerLabels[SWARM_SERVICE_ID_LABEL];

    if (!serviceId) {
      return containerLabels;
    }

    if (!serviceLabelsCache.has(serviceId)) {
      serviceLabelsCache.set(serviceId, this.getSwarmServiceLabels(serviceId, container.Id));
    }
    const swarmServiceLabels = await serviceLabelsCache.get(serviceId);

    // Keep container labels as highest-priority override.
    return {
      ...(swarmServiceLabels || {}),
      ...containerLabels,
    };
  }

  private getImgsetMatchCandidate(
    imgsetName: string,
    imgsetConfiguration: any,
    parsedImage: any,
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

  private isBetterImgsetMatch(
    candidate: ImgsetMatchCandidate,
    currentBest: ImgsetMatchCandidate,
  ): boolean {
    if (candidate.specificity !== currentBest.specificity) {
      return candidate.specificity > currentBest.specificity;
    }

    return candidate.imgset.name.localeCompare(currentBest.imgset.name) < 0;
  }

  getMatchingImgsetConfiguration(parsedImage: any): ResolvedImgset | undefined {
    const configuredImgsets = this.configuration.imgset;
    if (!configuredImgsets || typeof configuredImgsets !== 'object') {
      return undefined;
    }

    let bestMatch: ImgsetMatchCandidate | undefined;
    for (const [imgsetName, imgsetConfiguration] of Object.entries(configuredImgsets)) {
      const candidate = this.getImgsetMatchCandidate(imgsetName, imgsetConfiguration, parsedImage);
      if (!candidate) {
        continue;
      }

      if (!bestMatch || this.isBetterImgsetMatch(candidate, bestMatch)) {
        bestMatch = candidate;
      }
    }

    return bestMatch?.imgset;
  }

  /**
   * Find new version for a Container.
   */

  /**
   * Resolve remote digest information when digest watching is enabled.
   * Updates `container.image.digest.value` and populates digest/created on `result`.
   */
  private async handleDigestWatch(
    container: Container,
    registryProvider: any,
    tagsCandidates: string[],
    result: any,
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
      await this.ensureRemoteAuthHeaders();
      const image = await this.dockerApi.getImage(container.image.id).inspect();
      container.image.digest.value = image.Config.Image === '' ? undefined : image.Config.Image;
    }
  }

  async findNewVersion(container: Container, logContainer: any) {
    let registryProvider;
    try {
      registryProvider = getRegistry(container.image.registry.name);
    } catch {
      logContainer.error(`Unsupported registry (${container.image.registry.name})`);
      return { tag: container.image.tag.value };
    }

    const result: any = { tag: container.image.tag.value };

    // Get all available tags
    const tags = await registryProvider.getTags(container.image);

    // Get candidate tags (based on tag name)
    const tagsCandidates = getTagCandidates(container, tags, logContainer);

    // Must watch digest? => Find local/remote digests on registry
    if (container.image.digest.watch && container.image.digest.repo) {
      await this.handleDigestWatch(container, registryProvider, tagsCandidates, result);
    }

    // The first one in the array is the highest
    if (tagsCandidates && tagsCandidates.length > 0) {
      [result.tag] = tagsCandidates;
    }
    return result;
  }

  /**
   * Add image detail to Container.
   */
  async addImageDetailsToContainer(container: any, labelOverrides: ContainerLabelOverrides = {}) {
    const containerId = container.Id;
    const containerLabels = container.Labels || {};

    // Is container already in store? just return it :)
    const containerInStore = storeContainer.getContainer(containerId);
    if (containerInStore !== undefined && containerInStore.error === undefined) {
      this.ensureLogger();
      this.log.debug(`Container ${containerInStore.id} already in store`);
      return containerInStore;
    }

    // Get container image details
    let image;
    try {
      await this.ensureRemoteAuthHeaders();
      image = await this.dockerApi.getImage(container.Image).inspect();
    } catch (e: any) {
      throw new Error(`Unable to inspect image for container ${containerId}: ${e.message}`);
    }

    const parsedImage = this.resolveImageName(container.Image, image);
    if (!parsedImage) {
      return undefined;
    }

    const resolvedLabelOverrides = resolveLabelsFromContainer(containerLabels, labelOverrides);

    const matchingImgset = this.getMatchingImgsetConfiguration(parsedImage);
    if (matchingImgset) {
      this.ensureLogger();
      this.log.debug(`Apply imgset "${matchingImgset.name}" to container ${containerId}`);
    }

    const resolvedConfig = mergeConfigWithImgset(
      resolvedLabelOverrides,
      matchingImgset,
      containerLabels,
    );

    const tagName = this.resolveTagName(
      parsedImage,
      image,
      resolvedConfig.inspectTagPath,
      resolvedLabelOverrides.transformTags,
      containerId,
    );

    const isSemver = parseSemver(transformTag(resolvedConfig.transformTags, tagName)) != null;
    const watchDigest = isDigestToWatch(resolvedConfig.watchDigest, parsedImage, isSemver);
    if (!isSemver && !watchDigest) {
      this.ensureLogger();
      this.log.warn(
        "Image is not a semver and digest watching is disabled so drydock won't report any update. Please review the configuration to enable digest watching for this container or exclude this container from being watched",
      );
    }
    const containerName = getContainerName(container);
    return normalizeContainer({
      id: containerId,
      name: containerName,
      status: container.State,
      watcher: this.name,
      includeTags: resolvedConfig.includeTags,
      excludeTags: resolvedConfig.excludeTags,
      transformTags: resolvedConfig.transformTags,
      linkTemplate: resolvedConfig.linkTemplate,
      displayName: getContainerDisplayName(
        containerName,
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
          repo: getRepoDigest(image),
        },
        architecture: image.Architecture,
        os: image.Os,
        variant: image.Variant,
        created: image.Created,
      },
      labels: containerLabels,
      result: {
        tag: tagName,
      },
      updateAvailable: false,
      updateKind: { kind: 'unknown' },
    } as Container);
  }

  private resolveImageName(imageName: string, image: any) {
    let imageNameToParse = imageName;
    if (imageNameToParse.includes('sha256:')) {
      if (!image.RepoTags || image.RepoTags.length === 0) {
        this.ensureLogger();
        this.log.warn(`Cannot get a reliable tag for this image [${imageNameToParse}]`);
        return undefined;
      }
      [imageNameToParse] = image.RepoTags;
    }
    return parse(imageNameToParse);
  }

  private resolveTagName(
    parsedImage: any,
    image: any,
    inspectTagPath: string | undefined,
    transformTagsFromLabel: string | undefined,
    containerId: string,
  ) {
    let tagName = parsedImage.tag || 'latest';
    if (inspectTagPath) {
      const semverTagFromInspect = getSemverTagFromInspectPath(
        image,
        inspectTagPath,
        transformTagsFromLabel,
      );
      if (semverTagFromInspect) {
        tagName = semverTagFromInspect;
      } else {
        this.ensureLogger();
        this.log.debug(
          `No semver value found at inspect path ${inspectTagPath} for container ${containerId}; falling back to parsed image tag`,
        );
      }
    }
    return tagName;
  }

  /**
   * Process a Container with result and map to a containerReport.
   * @param containerWithResult
   * @return {*}
   */
  mapContainerToContainerReport(containerWithResult: Container) {
    this.ensureLogger();
    const logContainer = this.log.child({
      container: fullName(containerWithResult),
    });

    // Find container in db & compare
    const containerInDb = storeContainer.getContainer(containerWithResult.id);

    if (containerInDb) {
      // Found in DB? => update it
      const updatedContainer = storeContainer.updateContainer(containerWithResult);
      return {
        container: updatedContainer,
        changed:
          containerInDb.resultChanged(updatedContainer) && containerWithResult.updateAvailable,
      };
    }
    // Not found in DB? => Save it
    logContainer.debug('Container watched for the first time');
    return {
      container: storeContainer.insertContainer(containerWithResult),
      changed: true,
    };
  }
}

export default Docker;

export {
  getLabel as testable_getLabel,
  getCurrentPrefix as testable_getCurrentPrefix,
  filterBySegmentCount as testable_filterBySegmentCount,
  getContainerName as testable_getContainerName,
  getContainerDisplayName as testable_getContainerDisplayName,
  normalizeConfigNumberValue as testable_normalizeConfigNumberValue,
  shouldUpdateDisplayNameFromContainerName as testable_shouldUpdateDisplayNameFromContainerName,
  getFirstDigitIndex as testable_getFirstDigitIndex,
  getImageForRegistryLookup as testable_getImageForRegistryLookup,
  getOldContainers as testable_getOldContainers,
  pruneOldContainers as testable_pruneOldContainers,
  getImageReferenceCandidatesFromPattern as testable_getImageReferenceCandidatesFromPattern,
  getImgsetSpecificity as testable_getImgsetSpecificity,
  getInspectValueByPath as testable_getInspectValueByPath,
};
