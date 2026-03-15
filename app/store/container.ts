/**
 * Container store.
 */
import { byString, byValues } from 'sort-es';
import { redactContainerRuntimeEnv, redactContainersRuntimeEnv } from '../api/container/shared.js';
import { getDefaultCacheMaxEntries } from '../configuration/runtime-defaults.js';
import type { ContainerLifecycleEventPayload } from '../event/index.js';
import * as container from '../model/container.js';
import { toPositiveInteger } from '../util/parse.js';

const { validate: validateContainer } = container;

import { emitContainerAdded, emitContainerRemoved, emitContainerUpdated } from '../event/index.js';
import { initCollection } from './util.js';

let containers: ReturnType<typeof initCollection> | undefined;
const containersQueryCache = new Map<string, container.Container[]>();
const containersQueryCacheReverseIndex = new Map<string, Map<string, Set<string>>>();
const containersQueryCacheAlwaysInvalidateKeys = new Set<string>();
const containersQueryCacheMalformedKeys = new Set<string>();
const containersQueryCacheParsedEntries = new Map<string, Array<readonly [string, unknown]>>();
const DEFAULT_CACHE_MAX_ENTRIES = getDefaultCacheMaxEntries();

// Security state cache: keyed by "{watcher}_{name}" to survive container recreation
const securityStateCache = new Map();
const DEFAULT_CONTAINERS_QUERY_CACHE_MAX_ENTRIES = DEFAULT_CACHE_MAX_ENTRIES;
const DEFAULT_SECURITY_STATE_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_SECURITY_STATE_CACHE_MAX_ENTRIES = DEFAULT_CACHE_MAX_ENTRIES;
const SECURITY_STATE_CACHE_PRUNE_SCAN_BUDGET = 10;
const CONTAINER_COLLECTION_INDICES = ['data.watcher', 'data.status', 'data.updateAvailable'];
const UNSAFE_QUERY_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
let securityStateCachePruneIterator: IterableIterator<[string, any]> | undefined;

interface ContainerListPaginationOptions {
  limit?: number;
  offset?: number;
}

function toCacheKey(watcher, name) {
  return `${watcher}_${name}`;
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
  securityStateCachePruneIterator = undefined;
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

function pruneSecurityStateCacheIncrementally(nowMs = Date.now()) {
  if (securityStateCache.size === 0) {
    securityStateCachePruneIterator = undefined;
    return;
  }

  if (!securityStateCachePruneIterator) {
    // Reuse a persistent iterator so prune work is amortized across writes.
    securityStateCachePruneIterator = securityStateCache.entries();
  }

  let scannedEntryCount = 0;
  while (scannedEntryCount < SECURITY_STATE_CACHE_PRUNE_SCAN_BUDGET) {
    const nextEntry = securityStateCachePruneIterator.next();
    if (nextEntry.done) {
      securityStateCachePruneIterator = undefined;
      break;
    }

    const [cacheKey, cacheEntry] = nextEntry.value;
    if (cacheEntry.expiresAt <= nowMs) {
      securityStateCache.delete(cacheKey);
    }
    scannedEntryCount += 1;
  }
}

function enforceSecurityStateCacheSizeLimit() {
  while (securityStateCache.size > SECURITY_STATE_CACHE_MAX_ENTRIES) {
    const oldestCacheKey = securityStateCache.keys().next().value;
    if (oldestCacheKey === undefined) {
      break;
    }
    securityStateCache.delete(oldestCacheKey);
  }
}

function hasUnsafeQueryPathSegment(queryPath: string) {
  return queryPath
    .split('.')
    .some((pathSegment) => pathSegment.length > 0 && UNSAFE_QUERY_PATH_SEGMENTS.has(pathSegment));
}

function getSafeContainerQueryEntries(query: Record<string, unknown> = {}) {
  return Object.keys(query)
    .filter((queryKey) => !hasUnsafeQueryPathSegment(queryKey))
    .sort()
    .map((queryKey) => [queryKey, query[queryKey]] as [string, unknown]);
}

function getContainerQueryCacheKey(query: Record<string, unknown> = {}) {
  const queryEntries = getSafeContainerQueryEntries(query);
  return JSON.stringify(queryEntries);
}

function cloneContainers(containersToClone) {
  return containersToClone.map((container) => cloneContainer(container));
}

function cloneContainer(containerToClone) {
  if (
    !containerToClone ||
    typeof containerToClone !== 'object' ||
    typeof containerToClone.resultChanged !== 'function'
  ) {
    return structuredClone(containerToClone);
  }

  const resultChanged = containerToClone.resultChanged;
  const containerWithoutResultChanged = {
    ...containerToClone,
    resultChanged: undefined,
  };
  const clonedContainer = structuredClone(containerWithoutResultChanged);
  clonedContainer.resultChanged = resultChanged;
  return clonedContainer;
}

function normalizeContainerListPaginationOptions(
  pagination: ContainerListPaginationOptions = {},
): Required<ContainerListPaginationOptions> {
  const rawLimit = pagination.limit;
  const rawOffset = pagination.offset;
  const limit =
    typeof rawLimit === 'number' && Number.isFinite(rawLimit)
      ? Math.max(0, Math.trunc(rawLimit))
      : 0;
  const offset =
    typeof rawOffset === 'number' && Number.isFinite(rawOffset)
      ? Math.max(0, Math.trunc(rawOffset))
      : 0;

  return { limit, offset };
}

function applyContainerListPagination(
  containersToPaginate: container.Container[],
  pagination: ContainerListPaginationOptions = {},
): container.Container[] {
  const { limit, offset } = normalizeContainerListPaginationOptions(pagination);

  if (limit === 0 && offset === 0) {
    return containersToPaginate;
  }
  if (limit === 0) {
    return containersToPaginate.slice(offset);
  }
  return containersToPaginate.slice(offset, offset + limit);
}

function getValueByPath(source, path) {
  if (hasUnsafeQueryPathSegment(path)) {
    return undefined;
  }
  const pathSegments = path.split('.');
  let currentValue: Record<string, unknown> | unknown = source;

  for (const pathSegment of pathSegments) {
    if (!currentValue || typeof currentValue !== 'object') {
      return undefined;
    }
    currentValue = (currentValue as Record<string, unknown>)[pathSegment];
  }

  return currentValue;
}

function parseContainerQueryCacheKey(cacheKey) {
  try {
    const parsedCacheKey = JSON.parse(cacheKey);
    if (!Array.isArray(parsedCacheKey)) {
      return undefined;
    }

    const queryEntries = [];
    for (const parsedEntry of parsedCacheKey) {
      if (
        !Array.isArray(parsedEntry) ||
        parsedEntry.length !== 2 ||
        typeof parsedEntry[0] !== 'string' ||
        hasUnsafeQueryPathSegment(parsedEntry[0])
      ) {
        return undefined;
      }
      queryEntries.push([parsedEntry[0], parsedEntry[1]]);
    }
    return queryEntries;
  } catch {
    return undefined;
  }
}

function getContainersQueryIndexValueKey(value) {
  try {
    const serializedValue = JSON.stringify(value);
    return serializedValue === undefined ? '__undefined__' : serializedValue;
  } catch {
    return `__nonjson__:${String(value)}`;
  }
}

function indexContainerQueryCacheKey(cacheKey) {
  const queryEntries = parseContainerQueryCacheKey(cacheKey);
  containersQueryCacheParsedEntries.set(cacheKey, queryEntries ?? null);

  if (!queryEntries) {
    containersQueryCacheMalformedKeys.add(cacheKey);
    return;
  }

  if (queryEntries.length === 0) {
    containersQueryCacheAlwaysInvalidateKeys.add(cacheKey);
    return;
  }

  for (const [queryPath, queryValue] of queryEntries) {
    const valueKey = getContainersQueryIndexValueKey(queryValue);
    let pathValueMap = containersQueryCacheReverseIndex.get(queryPath);
    if (!pathValueMap) {
      pathValueMap = new Map();
      containersQueryCacheReverseIndex.set(queryPath, pathValueMap);
    }
    let indexedCacheKeys = pathValueMap.get(valueKey);
    if (!indexedCacheKeys) {
      indexedCacheKeys = new Set();
      pathValueMap.set(valueKey, indexedCacheKeys);
    }
    indexedCacheKeys.add(cacheKey);
  }
}

function unindexContainerQueryCacheKey(cacheKey) {
  if (!containersQueryCacheParsedEntries.has(cacheKey)) {
    return;
  }
  const queryEntries = containersQueryCacheParsedEntries.get(cacheKey);
  containersQueryCacheParsedEntries.delete(cacheKey);
  containersQueryCacheMalformedKeys.delete(cacheKey);
  containersQueryCacheAlwaysInvalidateKeys.delete(cacheKey);

  if (!queryEntries || queryEntries.length === 0) {
    return;
  }

  for (const [queryPath, queryValue] of queryEntries) {
    const valueKey = getContainersQueryIndexValueKey(queryValue);
    const pathValueMap = containersQueryCacheReverseIndex.get(queryPath);
    if (!pathValueMap) {
      continue;
    }
    const indexedCacheKeys = pathValueMap.get(valueKey);
    if (!indexedCacheKeys) {
      continue;
    }
    indexedCacheKeys.delete(cacheKey);
    if (indexedCacheKeys.size === 0) {
      pathValueMap.delete(valueKey);
    }
    if (pathValueMap.size === 0) {
      containersQueryCacheReverseIndex.delete(queryPath);
    }
  }
}

function deleteContainersQueryCacheEntry(cacheKey) {
  containersQueryCache.delete(cacheKey);
  unindexContainerQueryCacheKey(cacheKey);
}

function clearContainersQueryCacheState() {
  containersQueryCache.clear();
  containersQueryCacheReverseIndex.clear();
  containersQueryCacheAlwaysInvalidateKeys.clear();
  containersQueryCacheMalformedKeys.clear();
  containersQueryCacheParsedEntries.clear();
}

function collectIndexedContainersCacheKeysForContainer(
  containerToMatch,
  keysToCollect: Set<string>,
) {
  if (!containerToMatch || typeof containerToMatch !== 'object') {
    return;
  }

  for (const [queryPath, pathValueMap] of containersQueryCacheReverseIndex.entries()) {
    const valueKey = getContainersQueryIndexValueKey(getValueByPath(containerToMatch, queryPath));
    const indexedCacheKeys = pathValueMap.get(valueKey);
    if (!indexedCacheKeys) {
      continue;
    }
    for (const cacheKey of indexedCacheKeys) {
      keysToCollect.add(cacheKey);
    }
  }
}

function containerMatchesQuery(containerToMatch, queryEntries) {
  if (!containerToMatch || typeof containerToMatch !== 'object') {
    return false;
  }

  return queryEntries.every(
    ([queryKey, queryValue]) => getValueByPath(containerToMatch, queryKey) === queryValue,
  );
}

function hasClassifiedRuntimeEnvValues(details) {
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
      typeof entry.sensitive === 'boolean',
  );
}

function invalidateContainersCache() {
  clearContainersQueryCacheState();
}

function invalidateContainersCacheForMutation(containerBefore, containerAfter) {
  if (containersQueryCache.size === 0) {
    return;
  }

  const candidateCacheKeys = new Set<string>();
  collectIndexedContainersCacheKeysForContainer(containerBefore, candidateCacheKeys);
  collectIndexedContainersCacheKeysForContainer(containerAfter, candidateCacheKeys);

  const cacheKeysToInvalidate = new Set<string>();
  for (const cacheKey of containersQueryCacheMalformedKeys.values()) {
    cacheKeysToInvalidate.add(cacheKey);
  }
  for (const cacheKey of containersQueryCacheAlwaysInvalidateKeys.values()) {
    cacheKeysToInvalidate.add(cacheKey);
  }

  for (const cacheKey of candidateCacheKeys.values()) {
    const queryEntries = containersQueryCacheParsedEntries.get(cacheKey);
    if (!queryEntries || queryEntries.length === 0) {
      cacheKeysToInvalidate.add(cacheKey);
      continue;
    }
    if (
      containerMatchesQuery(containerBefore, queryEntries) ||
      containerMatchesQuery(containerAfter, queryEntries)
    ) {
      cacheKeysToInvalidate.add(cacheKey);
    }
  }

  for (const cacheKey of cacheKeysToInvalidate.values()) {
    deleteContainersQueryCacheEntry(cacheKey);
  }
}

function setContainersQueryCache(cacheKey, cacheValue) {
  const cacheEntryExists = containersQueryCache.has(cacheKey);
  if (cacheEntryExists) {
    deleteContainersQueryCacheEntry(cacheKey);
  } else {
    while (containersQueryCache.size >= CONTAINERS_QUERY_CACHE_MAX_ENTRIES) {
      const oldestCacheKey = containersQueryCache.keys().next().value;
      if (oldestCacheKey === undefined) {
        break;
      }
      deleteContainersQueryCacheEntry(oldestCacheKey);
    }
  }
  containersQueryCache.set(cacheKey, cacheValue);
  indexContainerQueryCacheKey(cacheKey);

  // Defensive cap enforcement in case iterator anomalies prevent pre-insert eviction.
  while (containersQueryCache.size > CONTAINERS_QUERY_CACHE_MAX_ENTRIES) {
    const oldestCacheKey = containersQueryCache.keys().next().value;
    if (oldestCacheKey === undefined) {
      break;
    }
    deleteContainersQueryCacheEntry(oldestCacheKey);
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
  enforceSecurityStateCacheSizeLimit();
  pruneSecurityStateCacheIncrementally(nowMs);
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
  securityStateCachePruneIterator = undefined;
}

function getUpdateDetectedAt(containerCurrent, containerNext) {
  return getUpdateLifecycleTimestamp(containerCurrent, containerNext, 'updateDetectedAt');
}

function getFirstSeenAt(containerCurrent, containerNext) {
  return getUpdateLifecycleTimestamp(containerCurrent, containerNext, 'firstSeenAt');
}

function getUpdateLifecycleTimestamp(containerCurrent, containerNext, timestampField) {
  if (!containerNext.updateAvailable) {
    return undefined;
  }

  if (
    typeof containerNext[timestampField] === 'string' &&
    containerNext[timestampField].length > 0
  ) {
    return containerNext[timestampField];
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
    typeof containerCurrent[timestampField] === 'string' &&
    containerCurrent[timestampField].length > 0
  ) {
    return containerCurrent[timestampField];
  }

  return new Date().toISOString();
}

/**
 * Create container collections.
 * @param db
 */
export function createCollections(db) {
  containers = initCollection(db, 'containers', {
    indices: CONTAINER_COLLECTION_INDICES,
  });
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
  containerToSave.firstSeenAt = getFirstSeenAt(undefined, containerToSave);
  containers.insert({
    data: containerToSave,
  });
  invalidateContainersCacheForMutation(undefined, containerToSave);
  const containerAddedEventPayload: ContainerLifecycleEventPayload = redactContainerRuntimeEnv({
    ...containerToSave,
  });
  emitContainerAdded(containerAddedEventPayload);
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
    hasDetails && hasClassifiedRuntimeEnvValues(container.details) && containerCurrent?.details;
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
  containerToReturn.firstSeenAt = getFirstSeenAt(containerCurrent, containerToReturn);

  if (containerCurrentDoc && typeof containers?.update === 'function') {
    containerCurrentDoc.data = containerToReturn;
    containers.update(containerCurrentDoc);
  } else {
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
  }
  invalidateContainersCacheForMutation(containerCurrent, containerToReturn);
  const containerUpdatedEventPayload: ContainerLifecycleEventPayload = redactContainerRuntimeEnv({
    ...containerToReturn,
  });
  emitContainerUpdated(containerUpdatedEventPayload);
  return containerToReturn;
}

function getCachedOrComputedContainersByQuery(query: Record<string, unknown> = {}) {
  if (!containers) {
    return [];
  }

  const queryEntries = getSafeContainerQueryEntries(query);
  const queryKey = getContainerQueryCacheKey(query);
  const cachedContainers = containersQueryCache.get(queryKey);
  if (cachedContainers) {
    setContainersQueryCache(queryKey, cachedContainers);
    return cachedContainers;
  }

  const filter = {};
  queryEntries.forEach(([queryKeyEntry, queryValue]) => {
    filter[`data.${queryKeyEntry}`] = queryValue;
  });
  const containerList = containers.find(filter).map((item) => validateContainer(item.data));
  const containerListSorted = containerList.sort(
    byValues([
      [(containerItem: container.Container) => containerItem.watcher, byString()],
      [(containerItem: container.Container) => containerItem.name, byString()],
      [(containerItem: container.Container) => containerItem.image.tag.value, byString()],
    ]),
  );
  setContainersQueryCache(queryKey, containerListSorted);
  return containerListSorted;
}

/**
 * Get all (filtered) containers without redacting sensitive env values.
 * Intended for internal callers that do not return container data to users.
 * @param query
 * @param pagination
 * @returns {*}
 */
export function getContainersRaw(
  query: Record<string, unknown> = {},
  pagination: ContainerListPaginationOptions = {},
) {
  const containerListSorted = getCachedOrComputedContainersByQuery(query);
  const containerListSortedPaged = applyContainerListPagination(containerListSorted, pagination);
  return cloneContainers(containerListSortedPaged);
}

/**
 * Get the total number of (filtered) containers.
 * Uses cached query results when available and avoids cloning.
 * @param query
 */
export function getContainerCount(query: Record<string, unknown> = {}) {
  return getCachedOrComputedContainersByQuery(query).length;
}

/**
 * Get all (filtered) containers with sensitive env values redacted.
 * Use this API for all user-facing responses.
 * @param query
 * @param pagination
 * @returns {*}
 */
export function getContainers(
  query: Record<string, unknown> = {},
  pagination: ContainerListPaginationOptions = {},
) {
  return redactContainersRuntimeEnv(getContainersRaw(query, pagination));
}

/**
 * Get container by id.
 * @param id
 * @returns {null|Image}
 */
export function getContainer(id: string) {
  const container = containers.findOne({
    'data.id': id,
  });

  if (container !== null) {
    return redactContainerRuntimeEnv(validateContainer(container.data));
  }
  return undefined;
}

/**
 * Get container by id without redacting sensitive env values.
 * Only used by the env reveal endpoint.
 * @param id
 */
export function getContainerRaw(id: string) {
  const container = containers.findOne({
    'data.id': id,
  });

  if (container !== null) {
    return validateContainer(container.data);
  }
  return undefined;
}

/**
 * Delete container by id.
 * @param id
 */
export function deleteContainer(id) {
  const container = getContainer(id);
  const containerRaw = getContainerRaw(id);
  if (container) {
    containers
      .chain()
      .find({
        'data.id': id,
      })
      .remove();
    invalidateContainersCacheForMutation(containerRaw, undefined);
    emitContainerRemoved(container);
  }
}

export function _resetContainerStoreStateForTests() {
  clearContainersQueryCacheState();
  securityStateCache.clear();
  securityStateCachePruneIterator = undefined;
}

export function _setSecurityStateCacheEntryForTests(cacheKey: string, entry: any) {
  securityStateCache.set(cacheKey, entry);
}

export function _getSecurityStateCacheForTests() {
  return securityStateCache;
}

export function _pruneSecurityStateCacheForTests(nowMs = Date.now()) {
  pruneSecurityStateCache(nowMs);
}

export function _enforceSecurityStateCacheSizeLimitForTests() {
  enforceSecurityStateCacheSizeLimit();
}

export function _setContainersQueryCacheEntriesForTests(
  entries: Array<[string, container.Container[]]>,
) {
  clearContainersQueryCacheState();
  entries.forEach(([cacheKey, cacheValue]) => {
    containersQueryCache.set(cacheKey, cacheValue);
    indexContainerQueryCacheKey(cacheKey);
  });
}

export function _getContainersQueryCacheForTests() {
  return containersQueryCache;
}

export function _invalidateContainersCacheForMutationForTests(containerBefore, containerAfter) {
  invalidateContainersCacheForMutation(containerBefore, containerAfter);
}

export function _getContainersQueryCacheReverseIndexForTests() {
  return containersQueryCacheReverseIndex;
}

export function _getContainersQueryCacheParsedEntriesForTests() {
  return containersQueryCacheParsedEntries;
}

export function _deleteContainersQueryCacheEntryForTests(cacheKey: string) {
  deleteContainersQueryCacheEntry(cacheKey);
}

export function _pruneSecurityStateCacheIncrementallyForTests(nowMs = Date.now()) {
  pruneSecurityStateCacheIncrementally(nowMs);
}

export function _getValueByPathForTests(source, path) {
  return getValueByPath(source, path);
}
