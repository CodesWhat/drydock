/**
 * Container store.
 */
import { createHash } from 'node:crypto';
import { byString, byValues } from 'sort-es';
import { redactContainerRuntimeEnv, redactContainersRuntimeEnv } from '../api/container/shared.js';
import { getDefaultCacheMaxEntries } from '../configuration/runtime-defaults.js';
import type { ContainerLifecycleEventPayload } from '../event/index.js';
import * as container from '../model/container.js';
import { toPositiveInteger } from '../util/parse.js';

const { validate: validateContainer } = container;

import {
  emitContainerAdded,
  emitContainerHealthTransition,
  emitContainerRemoved,
  emitContainerUpdated,
} from '../event/index.js';
import {
  deriveContainerIdentityKey,
  hasRawUpdate,
  isRollbackContainerName,
} from '../model/container.js';
import {
  applyDeclarativeUpdatePolicy,
  applyUpdatePolicyOverrides,
  getUpdatePolicyOverrides,
} from '../model/update-policy.js';
import { resolveTriggerLabelValuesPure } from '../watchers/providers/docker/trigger-label-resolution.js';
import { initCollection } from './util.js';

let containers: ReturnType<typeof initCollection> | undefined;
const containersQueryCache = new Map<string, container.Container[]>();
const containersQueryCacheReverseIndex = new Map<string, Map<string, Set<string>>>();
const containersQueryCacheAlwaysInvalidateKeys = new Set<string>();
const containersQueryCacheMalformedKeys = new Set<string>();
const containersQueryCacheParsedEntries = new Map<string, Array<readonly [string, unknown]>>();
const DEFAULT_CACHE_MAX_ENTRIES = getDefaultCacheMaxEntries();

// Security state cache: keyed by "{watcher}::{name}" to survive container recreation
const DEFAULT_CONTAINERS_QUERY_CACHE_MAX_ENTRIES = DEFAULT_CACHE_MAX_ENTRIES;
const DEFAULT_SECURITY_STATE_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_UPDATE_LIFECYCLE_CACHE_TTL_MS = 30 * 60 * 1000;
// Deliberately far longer than the lifecycle cache's 30 min: a maturity soak encodes
// days-long user intent, and a replacement container can lag its predecessor by a long
// image pull. A short TTL here would only narrow the #496 repro window, not close it.
const DEFAULT_UPDATE_POLICY_RETENTION_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_SECURITY_STATE_CACHE_MAX_ENTRIES = DEFAULT_CACHE_MAX_ENTRIES;
const SECURITY_STATE_CACHE_PRUNE_SCAN_BUDGET = 10;
const CONTAINER_COLLECTION_INDICES = ['data.watcher', 'data.status', 'data.updateAvailable'];
const UNSAFE_QUERY_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const CONTAINER_QUERY_CONTROL_KEYS = new Set(['excludeRollbackContainers']);
const STABLE_UNDEFINED_SENTINEL = '__undefined__';
const toContainerFreshStateKey = container.getContainerIdentityKey;

type SecurityStateCacheEntry = {
  security: unknown;
  expiresAt: number;
};

const securityStateCache = new Map<string, SecurityStateCacheEntry>();
const pendingFreshStateAfterManualUpdate = new Map<string, number>();
const containerSecurityStateHashCache = new Map<string, string>();
let securityStateObjectHashCache = new WeakMap<object, string>();
let securityStateCachePruneIterator:
  | IterableIterator<[string, SecurityStateCacheEntry]>
  | undefined;

type UpdateLifecycleCacheEntry = {
  updateDetectedAt: string;
  firstSeenAt?: string;
  resultSignature: string;
  expiresAt: number;
};

const updateLifecycleCache = new Map<string, UpdateLifecycleCacheEntry>();

// #496: updatePolicy is durable, user-set configuration (maturity gate, skips, snooze) that
// lives on the container document, which is keyed by Docker's ephemeral container id. A
// recreate mints a new id, so ingestion takes insertContainer (which cannot merge from a
// predecessor) rather than updateContainer (which can). Without this cache the policy is
// dropped, and isUpdateSuppressed() reads an absent policy as "no gating" rather than
// "default gating", so the very next update fires with no soak at all.
//
// Unlike the security-state and lifecycle caches this is deliberately NOT gated behind
// isLocalContainer: the #386 exclusion exists because runtime state is meaningless across
// agents, whereas updatePolicy is set on the controller and must survive for agent-owned
// containers too — that is precisely the topology #496 was reported against.
//
// Because it does hold agent-owned containers it must key on deriveContainerIdentityKey
// (`${agent}::${watcher}::${name}`, or the compose project/service form), not on the
// `watcher::name` toCacheKey the other two caches use. Those can get away with the shorter
// key precisely because they only ever hold local containers; here, two agents each running
// a `local` watcher with a container named `myapp` would otherwise share one slot and leak
// one deployment's update policy into another's.
type UpdatePolicyRetentionCacheEntry = {
  updatePolicyOverrides: container.ContainerUpdatePolicy;
  expiresAt: number;
};

const updatePolicyRetentionCache = new Map<string, UpdatePolicyRetentionCacheEntry>();

interface ContainerListPaginationOptions {
  limit?: number;
  offset?: number;
  sort?: (containers: container.Container[]) => container.Container[];
}

function toCacheKey(watcher, name) {
  return `${watcher}::${name}`;
}

function getResultSignature(
  c: { result?: { tag?: unknown; digest?: unknown; created?: unknown } } | undefined,
): string {
  return JSON.stringify({
    tag: c?.result?.tag ?? null,
    digest: c?.result?.digest ?? null,
    created: c?.result?.created ?? null,
  });
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
export const UPDATE_LIFECYCLE_CACHE_TTL_MS = toPositiveInteger(
  process.env.DD_UPDATE_LIFECYCLE_CACHE_TTL_MS,
  DEFAULT_UPDATE_LIFECYCLE_CACHE_TTL_MS,
);
export const UPDATE_LIFECYCLE_CACHE_MAX_ENTRIES = toPositiveInteger(
  process.env.DD_UPDATE_LIFECYCLE_CACHE_MAX_ENTRIES,
  DEFAULT_CACHE_MAX_ENTRIES,
);
export const UPDATE_POLICY_RETENTION_CACHE_TTL_MS = toPositiveInteger(
  process.env.DD_UPDATE_POLICY_RETENTION_CACHE_TTL_MS,
  DEFAULT_UPDATE_POLICY_RETENTION_CACHE_TTL_MS,
);
export const UPDATE_POLICY_RETENTION_CACHE_MAX_ENTRIES = toPositiveInteger(
  process.env.DD_UPDATE_POLICY_RETENTION_CACHE_MAX_ENTRIES,
  DEFAULT_CACHE_MAX_ENTRIES,
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

/**
 * Returns true if the value is a safe primitive for exact-match store filters.
 * Rejects non-null objects and arrays, which is how LokiJS operator objects
 * (e.g. `{$regex: '...'}`, `{$ne: null}`) arrive from untrusted query params.
 * null and undefined are allowed because they represent explicit absence/equality
 * comparisons that LokiJS handles as literal value matches.
 */
function isSafeContainerQueryValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  const type = typeof value;
  return type === 'string' || type === 'number' || type === 'boolean';
}

function getSafeContainerQueryEntries(query: Record<string, unknown> = {}) {
  return Object.keys(query)
    .filter(
      (queryKey) =>
        !hasUnsafeQueryPathSegment(queryKey) && isSafeContainerQueryValue(query[queryKey]),
    )
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

export function cloneContainer(containerToClone) {
  const clonedContainer = structuredClone(containerToClone);
  if (
    clonedContainer &&
    typeof clonedContainer === 'object' &&
    typeof containerToClone?.resultChanged === 'function'
  ) {
    // resultChanged lives as a non-enumerable function on validated containers, so
    // structuredClone skips it. Re-attach (non-enumerable) so consumers that call
    // existing.resultChanged(other) keep working on the clone.
    Object.defineProperty(clonedContainer, 'resultChanged', {
      value: containerToClone.resultChanged,
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }
  return clonedContainer;
}

function normalizeContainerListPaginationOptions(pagination: ContainerListPaginationOptions = {}): {
  limit: number;
  offset: number;
} {
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
  const orderedContainers = pagination.sort
    ? pagination.sort([...containersToPaginate])
    : containersToPaginate;

  if (limit === 0 && offset === 0) {
    return orderedContainers;
  }
  if (limit === 0) {
    return orderedContainers.slice(offset);
  }
  return orderedContainers.slice(offset, offset + limit);
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

function isContainerQueryControlKey(queryPath: string) {
  return CONTAINER_QUERY_CONTROL_KEYS.has(queryPath);
}

function indexContainerQueryCacheKey(cacheKey) {
  const queryEntries = parseContainerQueryCacheKey(cacheKey);
  containersQueryCacheParsedEntries.set(cacheKey, queryEntries ?? null);

  if (!queryEntries) {
    containersQueryCacheMalformedKeys.add(cacheKey);
    return;
  }

  if (
    queryEntries.length === 0 ||
    queryEntries.some(([queryPath]) => isContainerQueryControlKey(queryPath))
  ) {
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

export function markPendingFreshStateAfterManualUpdate(
  containerIdentity: Partial<Pick<container.Container, 'agent' | 'watcher' | 'name'>>,
  clearedAtMs = Date.now(),
) {
  const cacheKey = toContainerFreshStateKey(containerIdentity);
  if (!cacheKey) {
    return;
  }
  pendingFreshStateAfterManualUpdate.set(cacheKey, clearedAtMs);
}

export function getPendingFreshStateAfterManualUpdateAt(
  containerIdentity: Partial<Pick<container.Container, 'agent' | 'watcher' | 'name'>>,
) {
  const cacheKey = toContainerFreshStateKey(containerIdentity);
  if (!cacheKey) {
    return undefined;
  }
  return pendingFreshStateAfterManualUpdate.get(cacheKey);
}

export function clearPendingFreshStateAfterManualUpdate(
  containerIdentity: Partial<Pick<container.Container, 'agent' | 'watcher' | 'name'>>,
) {
  const cacheKey = toContainerFreshStateKey(containerIdentity);
  if (!cacheKey) {
    return;
  }
  pendingFreshStateAfterManualUpdate.delete(cacheKey);
}

function normalizeValue(current: unknown): unknown {
  if (Array.isArray(current)) {
    return current.map(normalizeValue);
  }

  if (current && typeof current === 'object') {
    return Object.keys(current)
      .sort()
      .reduce<Record<string, unknown>>((normalized, key) => {
        normalized[key] = normalizeValue(current[key]);
        return normalized;
      }, {});
  }

  return current;
}

function stableSerialize(value: unknown): string {
  const normalizedValue = normalizeValue(value);
  return normalizedValue === undefined
    ? STABLE_UNDEFINED_SENTINEL
    : JSON.stringify(normalizedValue);
}

function hashSecurityState(value: unknown): string {
  return createHash('sha256').update(stableSerialize(value)).digest('hex');
}

const EMPTY_SECURITY_STATE_HASH = hashSecurityState(undefined);

function getSecurityStateHash(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return value === undefined ? EMPTY_SECURITY_STATE_HASH : hashSecurityState(value);
  }

  const cachedHash = securityStateObjectHashCache.get(value);
  if (cachedHash) {
    return cachedHash;
  }

  const computedHash = hashSecurityState(value);
  securityStateObjectHashCache.set(value, computedHash);
  return computedHash;
}

function getStoredContainerSecurityStateHash(
  containerToHash: Pick<container.Container, 'id' | 'security'> | undefined,
): string {
  if (!containerToHash) {
    return EMPTY_SECURITY_STATE_HASH;
  }

  const cachedHash = containerSecurityStateHashCache.get(containerToHash.id);
  if (cachedHash) {
    return cachedHash;
  }

  const computedHash = getSecurityStateHash(containerToHash.security);
  containerSecurityStateHashCache.set(containerToHash.id, computedHash);
  return computedHash;
}

function storeContainerSecurityStateHash(
  containerToHash: Pick<container.Container, 'id' | 'security'>,
): string {
  const computedHash = getSecurityStateHash(containerToHash.security);
  containerSecurityStateHashCache.set(containerToHash.id, computedHash);
  return computedHash;
}

function hasContainerChangedWithSecurityHashes(
  existing: container.Container,
  incoming: container.Container,
  existingSecurityHash: string,
  incomingSecurityHash: string,
): boolean {
  if (existing.updateAvailable !== incoming.updateAvailable) {
    return true;
  }
  if (existing.result?.tag !== incoming.result?.tag) {
    return true;
  }
  if (existing.result?.digest !== incoming.result?.digest) {
    return true;
  }
  if (existing.status !== incoming.status) {
    return true;
  }
  if (existing.health !== incoming.health) {
    return true;
  }
  if (existing.error?.message !== incoming.error?.message) {
    return true;
  }
  if (existing.image?.tag?.value !== incoming.image?.tag?.value) {
    return true;
  }
  if (getUpdatePolicyComparisonKey(existing) !== getUpdatePolicyComparisonKey(incoming)) {
    return true;
  }
  if (existingSecurityHash !== incomingSecurityHash) {
    return true;
  }
  return false;
}

function getUpdatePolicyComparisonKey(containerToCompare: container.Container): string {
  const normalizePolicy = (policy: container.ContainerUpdatePolicy | undefined) => ({
    maturityMode: policy?.maturityMode ?? null,
    maturityMinAgeDays: policy?.maturityMinAgeDays ?? null,
    skipTags: policy?.skipTags ? [...policy.skipTags].sort() : null,
    skipDigests: policy?.skipDigests ? [...policy.skipDigests].sort() : null,
    snoozeUntil: policy?.snoozeUntil ?? null,
  });
  const normalizeDeclarative = (
    policy: container.ContainerDeclarativeUpdatePolicy | undefined,
  ) => ({
    maturityMode: policy?.maturityMode ?? null,
    maturityMinAgeDays: policy?.maturityMinAgeDays ?? null,
    skipTags: policy?.skipTags ? [...policy.skipTags].sort() : null,
    skipDigests: policy?.skipDigests ? [...policy.skipDigests].sort() : null,
  });
  return JSON.stringify({
    effective: normalizePolicy(containerToCompare.updatePolicy),
    hasDeclarative: containerToCompare.updatePolicyDeclarative !== undefined,
    declarative: {
      env: normalizeDeclarative(containerToCompare.updatePolicyDeclarative?.env),
      label: normalizeDeclarative(containerToCompare.updatePolicyDeclarative?.label),
    },
    hasOverrides: containerToCompare.updatePolicyOverrides !== undefined,
    overrides: normalizePolicy(containerToCompare.updatePolicyOverrides),
    sources: containerToCompare.updatePolicySources ?? {},
  });
}

/**
 * Determine whether an incoming container health read represents a fresh
 * "entered unhealthy" transition worth notifying about. Edge-triggered: once
 * a container's stored health is 'unhealthy', later polls/events that still
 * read 'unhealthy' do not re-fire. A container with no prior baseline (first
 * observation, e.g. a fresh `insertContainer`) never fires, and neither does
 * one whose existing health was never observed (`undefined` — a record
 * predating health tracking) — "entered unhealthy" implies a transition that
 * was actually observed, so a record with no observed baseline has none to
 * transition from. This baseline check runs before the restart exception
 * below: a restart can only re-fire a NEW episode of an OBSERVED unhealthy
 * baseline, so it must not fire on the first-ever observed unhealthy either.
 * Once a baseline exists, a restart is only inferable when BOTH the existing
 * and incoming records carry `details.startedAt` — a `startedAt` appearing
 * for the first time on a pre-existing record (e.g. a store written by an
 * older version that never inspected on the cron leg) is first-capture, not
 * a restart. When both sides do carry it and it differs, the restart is
 * always eligible to fire its own transition, even if the previous
 * observation was also 'unhealthy' (fast-crash-loop, two distinct episodes).
 */
function getHealthTransition(
  existing: container.Container | undefined,
  incoming: container.Container,
): 'entered-unhealthy' | undefined {
  if (incoming.health !== 'unhealthy') {
    return undefined;
  }
  if (!existing) {
    return undefined;
  }
  if (existing.health === undefined) {
    return undefined;
  }
  const restarted =
    Boolean(incoming.details?.startedAt) &&
    Boolean(existing.details?.startedAt) &&
    existing.details?.startedAt !== incoming.details?.startedAt;
  if (restarted) {
    return 'entered-unhealthy';
  }
  return existing.health !== 'unhealthy' ? 'entered-unhealthy' : undefined;
}

/**
 * Check whether meaningful container state changed between the existing record
 * and the incoming update.  Returns false when nothing actionable changed
 * (e.g. same data re-polled with only LokiJS timestamp metadata differing).
 */
export function hasContainerChanged(
  existing: container.Container,
  incoming: container.Container,
): boolean {
  return hasContainerChangedWithSecurityHashes(
    existing,
    incoming,
    getSecurityStateHash(existing.security),
    getSecurityStateHash(incoming.security),
  );
}

function getUpdateDetectedAt(containerCurrent, containerNext) {
  return getUpdateLifecycleTimestamp(containerCurrent, containerNext, 'updateDetectedAt');
}

function getFirstSeenAt(containerCurrent, containerNext) {
  return getUpdateLifecycleTimestamp(containerCurrent, containerNext, 'firstSeenAt');
}

function getUpdateLifecycleTimestamp(containerCurrent, containerNext, timestampField) {
  // Gate on raw-update presence, not the suppression-aware updateAvailable getter.
  // In mature mode updateAvailable is false (suppressed) until the window passes,
  // but we still need to stamp the timestamp so the maturity clock can start.
  if (!hasRawUpdate(containerNext)) {
    return undefined;
  }

  // Restart the clock when the candidate update itself changed (new digest/tag)
  // versus the stored record, so a fresh image soaks for the full maturity window
  // instead of inheriting the previous candidate's elapsed time. This must run
  // before the timestamp-preserve below: in the local watch path containerNext
  // carries the prior updateDetectedAt, which would otherwise short-circuit here.
  if (
    containerCurrent &&
    hasRawUpdate(containerCurrent) &&
    typeof containerCurrent.resultChanged === 'function' &&
    containerCurrent.resultChanged(containerNext)
  ) {
    return new Date().toISOString();
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

  if (!hasRawUpdate(containerCurrent)) {
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
 * Normalize the four category-scoped trigger label fields (#494). Applied on
 * every insert/update so incoming agent snapshots are repaired too, not only
 * rows touched by store/migrate.ts's startup migration. Never overwrites an
 * already-populated scoped field, and never touches the mirror itself.
 *
 * Resolved per direction. When the labels carry any trigger label for that
 * direction, the scoped values win and the deprecated
 * triggerInclude/triggerExclude mirror is NOT consulted — falling back to it
 * would re-collapse a lone `dd.action.include` onto the notification field and
 * undo the category scoping. The mirror is only a fallback for a container
 * whose labels say nothing about that direction: a pre-1.6 stored row, or an
 * old-agent snapshot carrying the mirror but no labels.
 */
function normalizeContainerTriggerLabelFields<T extends Partial<container.Container>>(
  containerToNormalize: T,
): T {
  const { labels } = containerToNormalize;
  const include = labels ? resolveTriggerLabelValuesPure(labels, 'include') : {};
  const exclude = labels ? resolveTriggerLabelValuesPure(labels, 'exclude') : {};

  if (include.mirror !== undefined) {
    containerToNormalize.actionTriggerInclude ??= include.action;
    containerToNormalize.notificationTriggerInclude ??= include.notification;
  } else {
    containerToNormalize.actionTriggerInclude ??= containerToNormalize.triggerInclude;
    containerToNormalize.notificationTriggerInclude ??= containerToNormalize.triggerInclude;
  }

  if (exclude.mirror !== undefined) {
    containerToNormalize.actionTriggerExclude ??= exclude.action;
    containerToNormalize.notificationTriggerExclude ??= exclude.notification;
  } else {
    containerToNormalize.actionTriggerExclude ??= containerToNormalize.triggerExclude;
    containerToNormalize.notificationTriggerExclude ??= containerToNormalize.triggerExclude;
  }

  return containerToNormalize;
}

/**
 * #496: stash a soon-to-be-replaced container's updatePolicy so the replacement (which
 * arrives under a fresh Docker id, hence via insertContainer) can inherit it.
 */
function stashUpdatePolicyForReplacement(containerRaw) {
  const updatePolicyOverrides = getUpdatePolicyOverrides(containerRaw);
  if (Object.keys(updatePolicyOverrides).length === 0) {
    return;
  }
  if (isRollbackContainerName(containerRaw?.name)) {
    return;
  }
  const cacheKey = deriveContainerIdentityKey(containerRaw);
  /* istanbul ignore next -- unreachable: deleteContainer validates the stored document before
     calling this, and the schema rejects an empty watcher or name, so a key always derives. */
  if (cacheKey === undefined) {
    return;
  }
  updatePolicyRetentionCache.delete(cacheKey);
  updatePolicyRetentionCache.set(cacheKey, {
    updatePolicyOverrides,
    expiresAt: Date.now() + UPDATE_POLICY_RETENTION_CACHE_TTL_MS,
  });
  if (updatePolicyRetentionCache.size > UPDATE_POLICY_RETENTION_CACHE_MAX_ENTRIES) {
    const nowMs = Date.now();
    for (const [expiredKey, expiredEntry] of updatePolicyRetentionCache.entries()) {
      if (expiredEntry.expiresAt <= nowMs) {
        updatePolicyRetentionCache.delete(expiredKey);
      }
    }
  }
  while (updatePolicyRetentionCache.size > UPDATE_POLICY_RETENTION_CACHE_MAX_ENTRIES) {
    const oldestKey = updatePolicyRetentionCache.keys().next().value;
    /* istanbul ignore next */
    if (oldestKey === undefined) {
      break;
    }
    updatePolicyRetentionCache.delete(oldestKey);
  }
}

/**
 * #496: restore a retained updatePolicy onto a replacement container. The entry is consumed
 * either way, so a stale policy can never attach to a later, unrelated container.
 */
function restoreRetainedUpdatePolicy(container) {
  const cacheKey = deriveContainerIdentityKey(container);
  if (cacheKey === undefined) {
    return;
  }
  const entry = updatePolicyRetentionCache.get(cacheKey);
  if (!entry) {
    return;
  }
  updatePolicyRetentionCache.delete(cacheKey);
  if (entry.expiresAt <= Date.now()) {
    return;
  }
  // A non-empty incoming controller layer is authoritative. Watcher normalization also stamps
  // updatePolicyOverrides={} on fresh declarative data; that empty layer carries no controller
  // intent and must not discard the retained overrides from the container being replaced.
  if (
    container.updatePolicyOverrides !== undefined &&
    Object.keys(container.updatePolicyOverrides).length > 0
  ) {
    return;
  }
  if (container.updatePolicyDeclarative !== undefined) {
    applyUpdatePolicyOverrides(container, entry.updatePolicyOverrides);
  } else if (!Object.hasOwn(container, 'updatePolicy')) {
    container.updatePolicy = structuredClone(entry.updatePolicyOverrides);
  }
}

/**
 * Insert new Container.
 * @param container
 */
export function insertContainer(container) {
  restoreRetainedUpdatePolicy(container);
  // #386: skip the security-state cache entirely for remote-agent containers;
  // the cache is only written by the controller's local Docker trigger and is
  // meaningless (and cross-contaminating) for containers owned by an agent.
  const isLocalContainer = !(typeof container.agent === 'string' && container.agent !== '');
  if (isLocalContainer) {
    const cachedSecurity = getCachedSecurityState(container.watcher, container.name);
    if (cachedSecurity && !container.security) {
      container.security = cachedSecurity;
      clearCachedSecurityState(container.watcher, container.name);
    }
    const lifecycleCacheKey = toCacheKey(container.watcher, container.name);
    const lifecycleEntry = updateLifecycleCache.get(lifecycleCacheKey);
    if (lifecycleEntry) {
      if (lifecycleEntry.expiresAt <= Date.now()) {
        updateLifecycleCache.delete(lifecycleCacheKey);
      } else if (getResultSignature(container) === lifecycleEntry.resultSignature) {
        if (hasRawUpdate(container)) {
          if (
            !(
              typeof container.updateDetectedAt === 'string' &&
              container.updateDetectedAt.length > 0
            )
          ) {
            container.updateDetectedAt = lifecycleEntry.updateDetectedAt;
          }
          if (
            lifecycleEntry.firstSeenAt !== undefined &&
            !(typeof container.firstSeenAt === 'string' && container.firstSeenAt.length > 0)
          ) {
            container.firstSeenAt = lifecycleEntry.firstSeenAt;
          }
        }
        updateLifecycleCache.delete(lifecycleCacheKey);
      } else {
        updateLifecycleCache.delete(lifecycleCacheKey);
      }
    }
  }
  const containerToSave = validateContainer(container);
  normalizeContainerTriggerLabelFields(containerToSave);
  containerToSave.updateDetectedAt = getUpdateDetectedAt(undefined, containerToSave);
  containerToSave.firstSeenAt = getFirstSeenAt(undefined, containerToSave);
  storeContainerSecurityStateHash(containerToSave);
  containers.insert({
    data: containerToSave,
  });
  invalidateContainersCacheForMutation(undefined, containerToSave);
  if (!isRollbackContainerName(containerToSave.name)) {
    const containerAddedEventPayload: ContainerLifecycleEventPayload = redactContainerRuntimeEnv({
      ...containerToSave,
    });
    emitContainerAdded(containerAddedEventPayload);
  }
  return containerToSave;
}

/**
 * Update existing container.
 * @param container
 */
export function updateContainer(container) {
  const hasUpdatePolicy = Object.hasOwn(container, 'updatePolicy');
  const hasUpdatePolicyDeclarative = Object.hasOwn(container, 'updatePolicyDeclarative');
  const hasUpdatePolicyOverrides = Object.hasOwn(container, 'updatePolicyOverrides');
  const hasUpdateRollback = Object.hasOwn(container, 'updateRollback');
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
    updatePolicyDeclarative: hasUpdatePolicyDeclarative
      ? container.updatePolicyDeclarative
      : containerCurrent?.updatePolicyDeclarative,
    updatePolicyOverrides: hasUpdatePolicyOverrides
      ? container.updatePolicyOverrides
      : containerCurrent?.updatePolicyOverrides,
    updatePolicySources:
      hasUpdatePolicy || hasUpdatePolicyDeclarative || hasUpdatePolicyOverrides
        ? container.updatePolicySources
        : containerCurrent?.updatePolicySources,
    updateRollback: hasUpdateRollback ? container.updateRollback : containerCurrent?.updateRollback,
    security: hasSecurity ? container.security : containerCurrent?.security,
    details: shouldRestoreCurrentDetails
      ? containerCurrent.details
      : hasDetails
        ? container.details
        : containerCurrent?.details,
  };
  if (hasUpdatePolicyDeclarative && containerMerged.updatePolicyDeclarative) {
    const overrides = hasUpdatePolicyOverrides
      ? (containerMerged.updatePolicyOverrides ?? {})
      : containerCurrent
        ? getUpdatePolicyOverrides(containerCurrent)
        : {};
    applyDeclarativeUpdatePolicy(containerMerged, containerMerged.updatePolicyDeclarative);
    applyUpdatePolicyOverrides(containerMerged, overrides);
  } else if (hasUpdatePolicy && container.updatePolicy === undefined) {
    containerMerged.updatePolicyDeclarative = undefined;
    containerMerged.updatePolicyOverrides = undefined;
    containerMerged.updatePolicySources = undefined;
  }
  const containerToReturn = validateContainer(containerMerged);
  normalizeContainerTriggerLabelFields(containerToReturn);
  containerToReturn.updateDetectedAt = getUpdateDetectedAt(containerCurrent, containerToReturn);
  containerToReturn.firstSeenAt = getFirstSeenAt(containerCurrent, containerToReturn);
  const containerCurrentSecurityHash = getStoredContainerSecurityStateHash(containerCurrent);
  const containerNextSecurityHash =
    !hasSecurity && containerCurrent
      ? containerCurrentSecurityHash
      : storeContainerSecurityStateHash(containerToReturn);

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
  const wasRollback = isRollbackContainerName(containerCurrent?.name);
  const isRollback = isRollbackContainerName(containerToReturn.name);
  const healthTransition = getHealthTransition(containerCurrent, containerToReturn);
  if (healthTransition && !isRollback) {
    // Independent of hasContainerChangedWithSecurityHashes below — a
    // health-only transition (status/name/labels/details all unchanged) may
    // be the only thing that changed, and must still notify.
    void emitContainerHealthTransition({
      containerName: containerToReturn.name,
      container: redactContainerRuntimeEnv({ ...containerToReturn }),
      previousHealth: containerCurrent?.health,
      health: 'unhealthy',
    });
  }
  if (isRollback && containerCurrent && !wasRollback) {
    // Container just transitioned into a rollback — it disappears from the
    // user-visible list, so let subscribers prune the row instead of leaving
    // it as a phantom entry next to the freshly-recreated container. Carry
    // the pre-rename payload so subscribers can match the row by its old name.
    emitContainerRemoved(redactContainerRuntimeEnv({ ...containerCurrent }));
  } else if (
    !isRollback &&
    (!containerCurrent ||
      wasRollback ||
      hasContainerChangedWithSecurityHashes(
        containerCurrent,
        containerToReturn,
        containerCurrentSecurityHash,
        containerNextSecurityHash,
      ))
  ) {
    const containerUpdatedEventPayload: ContainerLifecycleEventPayload = redactContainerRuntimeEnv({
      ...containerToReturn,
    });
    emitContainerUpdated(containerUpdatedEventPayload);
  }
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

  const excludeRollbackContainers = queryEntries.some(
    ([queryPath, queryValue]) => queryPath === 'excludeRollbackContainers' && queryValue === true,
  );
  const exactMatchEntries = queryEntries.filter(
    ([queryPath]) => !isContainerQueryControlKey(queryPath),
  );
  const filter = {};
  exactMatchEntries.forEach(([queryKeyEntry, queryValue]) => {
    filter[`data.${queryKeyEntry}`] = queryValue;
  });
  let containerList = containers.find(filter).map((item) => validateContainer(item.data));
  if (excludeRollbackContainers) {
    containerList = containerList.filter(
      (containerItem) => !container.isRollbackContainer(containerItem),
    );
  }
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
 *
 * WARNING: this returns live validated container objects backed by LokiJS and
 * the query cache. Treat the returned containers as read-only. Call
 * `cloneContainer()` before mutating a container or passing it to code that may
 * mutate it.
 *
 * @param query
 * @param pagination
 * @returns {*}
 */
export function getContainersRaw(
  query: Record<string, unknown> = {},
  pagination: ContainerListPaginationOptions = {},
) {
  const containerListSorted = getCachedOrComputedContainersByQuery(query);
  return applyContainerListPagination(containerListSorted, pagination);
}

/**
 * Lightweight projection of a container for stats/summary callers.
 * Contains only scalar fields and a simple image sub-object with no shared
 * references to stored data. Callers that mutate these objects cannot affect
 * the store.
 */
export interface ContainerStatProjection {
  id: string;
  watcher: string;
  agent: string | undefined;
  status: string;
  updateAvailable: boolean;
  updateMaturityLevel: container.Container['updateMaturityLevel'];
  image: {
    id: string;
    name: string;
  };
  security: {
    scan: {
      summary: {
        critical: number;
        high: number;
      };
    };
  };
}

function projectContainerForStats(c: container.Container): ContainerStatProjection {
  return {
    id: c.id,
    watcher: c.watcher,
    agent: c.agent,
    status: c.status,
    updateAvailable: c.updateAvailable,
    updateMaturityLevel: c.updateMaturityLevel,
    image: {
      id: c.image.id,
      name: c.image.name,
    },
    security: {
      scan: {
        summary: {
          critical: Number(c.security?.scan?.summary?.critical ?? 0),
          high: Number(c.security?.scan?.summary?.high ?? 0),
        },
      },
    },
  };
}

/**
 * Get lightweight stat projections for all (filtered) containers.
 * Returns newly-constructed objects containing only the scalar fields needed
 * by summary/stats callers (watchers, agents). Avoids structuredClone overhead
 * entirely — each projection is mutation-safe by construction (no shared
 * references to stored sub-objects).
 * @param query
 */
export function getContainersForStats(
  query: Record<string, unknown> = {},
): ContainerStatProjection[] {
  const containerListSorted = getCachedOrComputedContainersByQuery(query);
  return containerListSorted.map(projectContainerForStats);
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
  return redactContainersRuntimeEnv(cloneContainers(getContainersRaw(query, pagination)));
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

interface DeleteContainerOptions {
  replacementExpected?: boolean;
}

/**
 * Delete container by id.
 * @param id
 */
export function deleteContainer(id, options: DeleteContainerOptions = {}) {
  const container = getContainer(id);
  const containerRaw = getContainerRaw(id);
  if (container) {
    clearPendingFreshStateAfterManualUpdate(containerRaw);
    containers
      .chain()
      .find({
        'data.id': id,
      })
      .remove();
    invalidateContainersCacheForMutation(containerRaw, undefined);
    containerSecurityStateHashCache.delete(id);
    if (options.replacementExpected === true) {
      stashUpdatePolicyForReplacement(containerRaw);
    }
    if (
      options.replacementExpected === true &&
      !(typeof containerRaw?.agent === 'string' && containerRaw.agent !== '') &&
      !isRollbackContainerName(containerRaw?.name) &&
      typeof containerRaw?.updateDetectedAt === 'string' &&
      containerRaw.updateDetectedAt.length > 0
    ) {
      const lifecycleCacheKey = toCacheKey(containerRaw.watcher, containerRaw.name);
      updateLifecycleCache.delete(lifecycleCacheKey);
      updateLifecycleCache.set(lifecycleCacheKey, {
        updateDetectedAt: containerRaw.updateDetectedAt,
        firstSeenAt:
          typeof containerRaw.firstSeenAt === 'string' && containerRaw.firstSeenAt.length > 0
            ? containerRaw.firstSeenAt
            : undefined,
        resultSignature: getResultSignature(containerRaw),
        expiresAt: Date.now() + UPDATE_LIFECYCLE_CACHE_TTL_MS,
      });
      if (updateLifecycleCache.size > UPDATE_LIFECYCLE_CACHE_MAX_ENTRIES) {
        const nowMs = Date.now();
        for (const [expiredKey, expiredEntry] of updateLifecycleCache.entries()) {
          if (expiredEntry.expiresAt <= nowMs) {
            updateLifecycleCache.delete(expiredKey);
          }
        }
      }
      while (updateLifecycleCache.size > UPDATE_LIFECYCLE_CACHE_MAX_ENTRIES) {
        const oldestLifecycleKey = updateLifecycleCache.keys().next().value;
        /* istanbul ignore next */
        if (oldestLifecycleKey === undefined) {
          break;
        }
        updateLifecycleCache.delete(oldestLifecycleKey);
      }
    }
    if (!isRollbackContainerName(container.name)) {
      emitContainerRemoved({
        ...container,
        replacementExpected: options.replacementExpected,
      });
    }
  }
}

export function _resetContainerStoreStateForTests() {
  clearContainersQueryCacheState();
  securityStateCache.clear();
  updateLifecycleCache.clear();
  updatePolicyRetentionCache.clear();
  pendingFreshStateAfterManualUpdate.clear();
  containerSecurityStateHashCache.clear();
  securityStateObjectHashCache = new WeakMap<object, string>();
  securityStateCachePruneIterator = undefined;
}

export function _setSecurityStateCacheEntryForTests(
  cacheKey: string,
  entry: SecurityStateCacheEntry,
) {
  securityStateCache.set(cacheKey, entry);
}

export function _getSecurityStateCacheForTests() {
  return securityStateCache;
}

export function _getPendingFreshStateAfterManualUpdateForTests() {
  return pendingFreshStateAfterManualUpdate;
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

export function _getUpdatePolicyRetentionCacheForTests() {
  return updatePolicyRetentionCache;
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

export function _getUpdateLifecycleCacheForTests() {
  return updateLifecycleCache;
}

export function _setUpdateLifecycleCacheEntryForTests(
  cacheKey: string,
  entry: UpdateLifecycleCacheEntry,
) {
  updateLifecycleCache.set(cacheKey, entry);
}
