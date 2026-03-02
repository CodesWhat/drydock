// @ts-nocheck
/**
 * Container store.
 */
import { byString, byValues } from 'sort-es';
import * as container from '../model/container.js';

const { validate: validateContainer } = container;

import { emitContainerAdded, emitContainerRemoved, emitContainerUpdated } from '../event/index.js';
import { initCollection } from './util.js';

let containers;
const containersQueryCache = new Map();
const REDACTED_RUNTIME_ENV_VALUE = '[REDACTED]';

// Security state cache: keyed by "{watcher}_{name}" to survive container recreation
const securityStateCache = new Map();
const DEFAULT_CONTAINERS_QUERY_CACHE_MAX_ENTRIES = 500;
const DEFAULT_SECURITY_STATE_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_SECURITY_STATE_CACHE_MAX_ENTRIES = 500;

function toCacheKey(watcher, name) {
  return `${watcher}_${name}`;
}

function toPositiveInteger(rawValue, fallbackValue) {
  const parsedValue = Number.parseInt(String(rawValue ?? ''), 10);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return fallbackValue;
  }
  return parsedValue;
}

export const SECURITY_STATE_CACHE_TTL_MS = toPositiveInteger(
  process.env.DD_SECURITY_STATE_CACHE_TTL_MS,
  DEFAULT_SECURITY_STATE_CACHE_TTL_MS,
);
export const CONTAINERS_QUERY_CACHE_MAX_ENTRIES = toPositiveInteger(
  process.env.DD_CONTAINERS_QUERY_CACHE_MAX_ENTRIES,
  DEFAULT_CONTAINERS_QUERY_CACHE_MAX_ENTRIES,
);
export const SECURITY_STATE_CACHE_MAX_ENTRIES = toPositiveInteger(
  process.env.DD_SECURITY_STATE_CACHE_MAX_ENTRIES,
  DEFAULT_SECURITY_STATE_CACHE_MAX_ENTRIES,
);

function pruneSecurityStateCache(nowMs = Date.now()) {
  const activeKeys = [];
  let activeStartIndex = 0;

  for (const [cacheKey, cacheEntry] of securityStateCache.entries()) {
    if (cacheEntry.expiresAt <= nowMs) {
      securityStateCache.delete(cacheKey);
      continue;
    }

    activeKeys.push(cacheKey);
    if (activeKeys.length - activeStartIndex > SECURITY_STATE_CACHE_MAX_ENTRIES) {
      const oldestActiveCacheKey = activeKeys[activeStartIndex];
      activeStartIndex += 1;
      securityStateCache.delete(oldestActiveCacheKey);
    }
  }
}

function getContainerQueryCacheKey(query = {}) {
  const queryEntries = Object.keys(query)
    .sort(byString())
    .map((key) => [key, query[key]]);
  return JSON.stringify(queryEntries);
}

function cloneContainers(containersToClone) {
  return containersToClone.map((container) => ({
    ...container,
  }));
}

function shouldIncludeRuntimeEnvValues(options = {}) {
  return options.includeRuntimeEnvValues === true;
}

function redactContainerRuntimeDetails(details) {
  if (!details || typeof details !== 'object' || !Array.isArray(details.env)) {
    return details;
  }

  return {
    ...details,
    env: details.env
      .filter((entry) => entry && typeof entry === 'object' && typeof entry.key === 'string')
      .map((entry) => ({
        key: entry.key,
        value: REDACTED_RUNTIME_ENV_VALUE,
      })),
  };
}

function redactContainerRuntimeEnv(container) {
  if (!container || typeof container !== 'object' || !container.details) {
    return container;
  }

  return {
    ...container,
    details: redactContainerRuntimeDetails(container.details),
  };
}

function redactContainersRuntimeEnv(containerList = []) {
  if (!Array.isArray(containerList)) {
    return containerList;
  }

  return containerList.map((container) => redactContainerRuntimeEnv(container));
}

function hasRedactedRuntimeEnvValues(details) {
  if (!details || typeof details !== 'object' || !Array.isArray(details.env)) {
    return false;
  }

  if (details.env.length === 0) {
    return false;
  }

  return details.env.every(
    (entry) =>
      entry &&
      typeof entry === 'object' &&
      typeof entry.key === 'string' &&
      entry.value === REDACTED_RUNTIME_ENV_VALUE,
  );
}

function invalidateContainersCache() {
  containersQueryCache.clear();
}

function setContainersQueryCache(cacheKey, cacheValue) {
  if (containersQueryCache.has(cacheKey)) {
    containersQueryCache.delete(cacheKey);
  }
  containersQueryCache.set(cacheKey, cacheValue);

  while (containersQueryCache.size > CONTAINERS_QUERY_CACHE_MAX_ENTRIES) {
    const oldestCacheKey = containersQueryCache.keys().next().value;
    if (!oldestCacheKey) {
      break;
    }
    containersQueryCache.delete(oldestCacheKey);
  }
}

export function cacheSecurityState(watcher, name, security) {
  const cacheKey = toCacheKey(watcher, name);
  const nowMs = Date.now();
  if (securityStateCache.has(cacheKey)) {
    securityStateCache.delete(cacheKey);
  }
  securityStateCache.set(cacheKey, {
    security,
    expiresAt: nowMs + SECURITY_STATE_CACHE_TTL_MS,
  });
  pruneSecurityStateCache(nowMs);
}

export function getCachedSecurityState(watcher, name) {
  const cacheKey = toCacheKey(watcher, name);
  const cacheEntry = securityStateCache.get(cacheKey);
  if (!cacheEntry) {
    return undefined;
  }
  if (cacheEntry.expiresAt <= Date.now()) {
    securityStateCache.delete(cacheKey);
    return undefined;
  }
  return cacheEntry.security;
}

export function clearCachedSecurityState(watcher, name) {
  securityStateCache.delete(toCacheKey(watcher, name));
}

export function clearAllCachedSecurityState() {
  securityStateCache.clear();
}

function getUpdateDetectedAt(containerCurrent, containerNext) {
  if (!containerNext.updateAvailable) {
    return undefined;
  }

  if (
    typeof containerNext.updateDetectedAt === 'string' &&
    containerNext.updateDetectedAt.length > 0
  ) {
    return containerNext.updateDetectedAt;
  }

  if (!containerCurrent) {
    return new Date().toISOString();
  }

  const updateChanged =
    typeof containerCurrent.resultChanged === 'function' &&
    containerCurrent.resultChanged(containerNext);

  if (!containerCurrent.updateAvailable || updateChanged) {
    return new Date().toISOString();
  }

  if (
    typeof containerCurrent.updateDetectedAt === 'string' &&
    containerCurrent.updateDetectedAt.length > 0
  ) {
    return containerCurrent.updateDetectedAt;
  }

  return new Date().toISOString();
}

/**
 * Create container collections.
 * @param db
 */
export function createCollections(db) {
  containers = initCollection(db, 'containers');
  invalidateContainersCache();
}

/**
 * Insert new Container.
 * @param container
 */
export function insertContainer(container) {
  const cachedSecurity = getCachedSecurityState(container.watcher, container.name);
  if (cachedSecurity && !container.security) {
    container.security = cachedSecurity;
    clearCachedSecurityState(container.watcher, container.name);
  }
  const containerToSave = validateContainer(container);
  containerToSave.updateDetectedAt = getUpdateDetectedAt(undefined, containerToSave);
  containers.insert({
    data: containerToSave,
  });
  invalidateContainersCache();
  emitContainerAdded(containerToSave);
  return containerToSave;
}

/**
 * Update existing container.
 * @param container
 */
export function updateContainer(container) {
  const hasUpdatePolicy = Object.hasOwn(container, 'updatePolicy');
  const hasSecurity = Object.hasOwn(container, 'security');
  const hasDetails = Object.hasOwn(container, 'details');
  const containerCurrentDoc =
    typeof containers?.findOne === 'function'
      ? containers.findOne({ 'data.id': container.id })
      : undefined;
  const containerCurrent = containerCurrentDoc
    ? validateContainer(containerCurrentDoc.data)
    : undefined;
  const shouldRestoreCurrentDetails =
    hasDetails && hasRedactedRuntimeEnvValues(container.details) && containerCurrent?.details;
  const containerMerged = {
    ...container,
    updatePolicy: hasUpdatePolicy ? container.updatePolicy : containerCurrent?.updatePolicy,
    security: hasSecurity ? container.security : containerCurrent?.security,
    details: shouldRestoreCurrentDetails
      ? containerCurrent.details
      : hasDetails
        ? container.details
        : containerCurrent?.details,
  };
  const containerToReturn = validateContainer(containerMerged);
  containerToReturn.updateDetectedAt = getUpdateDetectedAt(containerCurrent, containerToReturn);

  // Remove existing container
  containers
    .chain()
    .find({
      'data.id': container.id,
    })
    .remove();

  // Insert new one
  containers.insert({
    data: containerToReturn,
  });
  invalidateContainersCache();
  emitContainerUpdated(containerToReturn);
  return containerToReturn;
}

/**
 * Get all (filtered) containers.
 * @param query
 * @returns {*}
 */
export function getContainers(query = {}, options = {}) {
  if (!containers) {
    return [];
  }
  const includeRuntimeEnvValues = shouldIncludeRuntimeEnvValues(options);

  const queryKey = getContainerQueryCacheKey(query);
  const cachedContainers = containersQueryCache.get(queryKey);
  if (cachedContainers) {
    setContainersQueryCache(queryKey, cachedContainers);
    const containersCloned = cloneContainers(cachedContainers);
    return includeRuntimeEnvValues ? containersCloned : redactContainersRuntimeEnv(containersCloned);
  }

  const filter = {};
  Object.keys(query).forEach((key) => {
    filter[`data.${key}`] = query[key];
  });
  const containerList = containers.find(filter).map((item) => validateContainer(item.data));
  const containerListSorted = containerList.sort(
    byValues([
      [(container) => container.watcher, byString()],
      [(container) => container.name, byString()],
      [(container) => container.image.tag.value, byString()],
    ]),
  );
  setContainersQueryCache(queryKey, containerListSorted);
  const containersCloned = cloneContainers(containerListSorted);
  return includeRuntimeEnvValues ? containersCloned : redactContainersRuntimeEnv(containersCloned);
}

/**
 * Get container by id.
 * @param id
 * @returns {null|Image}
 */
export function getContainer(id, options = {}) {
  const includeRuntimeEnvValues = shouldIncludeRuntimeEnvValues(options);
  const container = containers.findOne({
    'data.id': id,
  });

  if (container !== null) {
    const containerValidated = validateContainer(container.data);
    return includeRuntimeEnvValues
      ? containerValidated
      : redactContainerRuntimeEnv(containerValidated);
  }
  return undefined;
}

/**
 * Delete container by id.
 * @param id
 */
export function deleteContainer(id) {
  const container = getContainer(id);
  if (container) {
    containers
      .chain()
      .find({
        'data.id': id,
      })
      .remove();
    invalidateContainersCache();
    emitContainerRemoved(container);
  }
}
