import type { Request, Response } from 'express';
import type { Container, ContainerUpdateOperationState } from '../../../model/container.js';
import {
  isActiveContainerUpdateOperationPhaseForStatus,
  isActiveContainerUpdateOperationStatus,
  isContainerUpdateOperationKind,
} from '../../../model/container-update-operation.js';
import { sendErrorResponse } from '../../error-response.js';
import { buildPaginationLinks } from '../../pagination-links.js';
import type { ContainerListResponse, CrudHandlerContext } from '../crud-context.js';
import {
  applyContainerMaturityFilter,
  applyContainerWatchedKindFilter,
  type ContainerWatchedKind,
  getFirstNonEmptyQueryValue,
  isContainerWatchedKind,
  mapContainerListKindFilter,
  mapContainerListStatusFilter,
  normalizeContainerListPagination,
  paginateCollection,
  parseContainerMaturityFilter,
  removeContainerListControlParams,
  sortContainers,
  validateContainerListQuery,
} from '../filters.js';
import { parseBooleanQueryParam } from '../request-helpers.js';

export type ContainerListBasePath = '/api/containers' | '/api/containers/watch';

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function createProjectionView<T extends object>(
  target: T,
  overrides: ReadonlyArray<readonly [string | symbol, unknown]>,
): T {
  const overrideMap = new Map<string | symbol, unknown>(overrides);

  return new Proxy(target, {
    get(viewTarget, property, receiver) {
      if (overrideMap.has(property)) {
        return overrideMap.get(property);
      }

      return Reflect.get(viewTarget, property, receiver);
    },
    has(viewTarget, property) {
      return overrideMap.has(property) || Reflect.has(viewTarget, property);
    },
    ownKeys(viewTarget) {
      const keys = new Set(Reflect.ownKeys(viewTarget));
      for (const key of overrideMap.keys()) {
        keys.add(key);
      }

      return Array.from(keys);
    },
    getOwnPropertyDescriptor(viewTarget, property) {
      if (!overrideMap.has(property)) {
        return Reflect.getOwnPropertyDescriptor(viewTarget, property);
      }

      const descriptor = Reflect.getOwnPropertyDescriptor(viewTarget, property);
      const overrideValue = overrideMap.get(property);
      const writable =
        descriptor &&
        'writable' in descriptor &&
        (!descriptor.configurable || descriptor.writable || descriptor.value === overrideValue)
          ? descriptor.writable
          : true;
      return {
        configurable: descriptor?.configurable ?? true,
        enumerable: descriptor?.enumerable ?? true,
        writable,
        value: overrideValue,
      };
    },
  });
}

function stripScanVulnerabilityArray<T extends object>(scan: T): T {
  return createProjectionView(scan, [['vulnerabilities', []]]);
}

// Fields in security that are detail-only (not used by the list view).
// - sbom / updateSbom: SBOM documents (potentially MB-scale); fetched via GET /:id/sbom
// - signature / updateSignature: cosign verification data; not rendered in the list
const SECURITY_LIST_STRIPPED_FIELDS = [
  'sbom',
  'updateSbom',
  'signature',
  'updateSignature',
] as const;

function stripContainerDetailOnlySecurityFields(
  container: Container,
  stripVulnerabilities = true,
): Container {
  if (!container.security) {
    return container;
  }

  const scanOverride = stripVulnerabilities
    ? container.security.scan
      ? stripScanVulnerabilityArray(container.security.scan)
      : undefined
    : container.security.scan;

  const updateScanOverride = stripVulnerabilities
    ? container.security.updateScan
      ? stripScanVulnerabilityArray(container.security.updateScan)
      : undefined
    : container.security.updateScan;

  const projectedSecurity = createProjectionView(container.security, [
    ['scan', scanOverride],
    ['updateScan', updateScanOverride],
    ...SECURITY_LIST_STRIPPED_FIELDS.map((field) => [field, undefined] as const),
  ]);

  return createProjectionView(container, [['security', projectedSecurity]]);
}

function sanitizeActiveUpdateOperation(
  operation: unknown,
): ContainerUpdateOperationState | undefined {
  if (!operation || typeof operation !== 'object') {
    return undefined;
  }

  const candidate = operation as Record<string, unknown>;

  const id = typeof candidate.id === 'string' ? candidate.id : undefined;
  const kind = isContainerUpdateOperationKind(candidate.kind) ? candidate.kind : undefined;
  const status = isActiveContainerUpdateOperationStatus(candidate.status)
    ? candidate.status
    : undefined;
  const updatedAt = typeof candidate.updatedAt === 'string' ? candidate.updatedAt : undefined;
  const batchId = typeof candidate.batchId === 'string' ? candidate.batchId : undefined;
  const queuePosition = parsePositiveInteger(candidate.queuePosition);
  const queueTotal = parsePositiveInteger(candidate.queueTotal);
  const phase =
    status && isActiveContainerUpdateOperationPhaseForStatus(status, candidate.phase)
      ? candidate.phase
      : undefined;

  if (!id || !status || !phase || !updatedAt) {
    return undefined;
  }

  return {
    id,
    ...(kind ? { kind } : {}),
    status,
    phase,
    updatedAt,
    ...(typeof candidate.fromVersion === 'string' ? { fromVersion: candidate.fromVersion } : {}),
    ...(typeof candidate.toVersion === 'string' ? { toVersion: candidate.toVersion } : {}),
    ...(typeof candidate.targetImage === 'string' ? { targetImage: candidate.targetImage } : {}),
    ...(batchId && queuePosition && queueTotal && queuePosition <= queueTotal
      ? {
          batchId,
          queuePosition,
          queueTotal,
        }
      : {}),
  };
}

export function attachInProgressUpdateOperation(
  context: CrudHandlerContext,
  container: Container,
): Container {
  const byId = context.updateOperationStore.getActiveOperationByContainerId(container.id);
  // Name-based fallback only for legacy operations that predate the containerId field.
  const byName = byId
    ? undefined
    : context.updateOperationStore.getActiveOperationByContainerName(container.name);
  const isLegacyOperation =
    byName && typeof byName === 'object' && !('containerId' in (byName as Record<string, unknown>));
  const matched = byId ?? (isLegacyOperation ? byName : undefined);
  const operation = sanitizeActiveUpdateOperation(matched);

  if (!operation) {
    return container;
  }

  return createProjectionView(container, [['updateOperation', operation]]);
}

interface PreloadedActiveOperationLookup {
  byContainerId: Map<string, ContainerUpdateOperationState>;
  byLegacyContainerName: Map<string, ContainerUpdateOperationState>;
}

function getOperationUpdatedAtTimestamp(operation: ContainerUpdateOperationState): number {
  const timestamp = Date.parse(operation.updatedAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function setLatestOperationLookupEntry(
  map: Map<string, ContainerUpdateOperationState>,
  key: string,
  operation: ContainerUpdateOperationState,
): void {
  const existing = map.get(key);
  if (
    !existing ||
    getOperationUpdatedAtTimestamp(operation) >= getOperationUpdatedAtTimestamp(existing)
  ) {
    map.set(key, operation);
  }
}

// Returns undefined when there is nothing to preload. The caller treats that
// as a signal to use the per-row attachInProgressUpdateOperation path — which
// performs its own empty-store check and returns the container unmodified. The
// preload-vs-per-row branch is a perf optimisation for the common case where
// active operations exist; undefined keeps the rare empty-store path on the
// known-good fallback instead of adding another empty-map short-circuit.
function buildPreloadedActiveOperationLookup(
  operations: unknown[],
): PreloadedActiveOperationLookup | undefined {
  if (!Array.isArray(operations) || operations.length === 0) {
    return undefined;
  }

  const byContainerId = new Map<string, ContainerUpdateOperationState>();
  const byLegacyContainerName = new Map<string, ContainerUpdateOperationState>();

  for (const candidate of operations) {
    const operation = sanitizeActiveUpdateOperation(candidate);
    if (!operation || !candidate || typeof candidate !== 'object') {
      continue;
    }

    const record = candidate as Record<string, unknown>;
    const containerId = typeof record.containerId === 'string' ? record.containerId.trim() : '';
    const newContainerId =
      typeof record.newContainerId === 'string' ? record.newContainerId.trim() : '';
    const containerName =
      typeof record.containerName === 'string' ? record.containerName.trim() : '';

    if (containerId) {
      setLatestOperationLookupEntry(byContainerId, containerId, operation);
    }
    if (newContainerId) {
      setLatestOperationLookupEntry(byContainerId, newContainerId, operation);
    }
    if (!containerId && !newContainerId && containerName) {
      setLatestOperationLookupEntry(byLegacyContainerName, containerName, operation);
    }
  }

  if (byContainerId.size === 0 && byLegacyContainerName.size === 0) {
    return undefined;
  }

  return {
    byContainerId,
    byLegacyContainerName,
  };
}

function attachPreloadedActiveUpdateOperation(
  lookup: PreloadedActiveOperationLookup,
  container: Container,
): Container {
  const operation =
    lookup.byContainerId.get(container.id) ?? lookup.byLegacyContainerName.get(container.name);
  if (!operation) {
    return container;
  }

  return createProjectionView(container, [['updateOperation', operation]]);
}

export function buildContainerListResponse(
  context: CrudHandlerContext,
  query: Request['query'],
  basePath: ContainerListBasePath,
): ContainerListResponse {
  const validatedQuery = validateContainerListQuery(query);
  const sortMode = validatedQuery.sortMode;
  const statusFilter = mapContainerListStatusFilter(validatedQuery.status);
  const kindFilter = mapContainerListKindFilter(validatedQuery.kind);
  const maturityFilter = parseContainerMaturityFilter(validatedQuery.maturity);
  const watchedKindFilter: ContainerWatchedKind | undefined = isContainerWatchedKind(
    validatedQuery.kind,
  )
    ? validatedQuery.kind
    : undefined;

  const includeVulnerabilities = parseBooleanQueryParam(query.includeVulnerabilities, false);
  const filteredQuery: Record<string, unknown> = {
    ...(removeContainerListControlParams(query) as Record<string, unknown>),
    excludeRollbackContainers: true,
    ...(kindFilter || {}),
    ...(statusFilter?.updateAvailable !== undefined
      ? { updateAvailable: statusFilter.updateAvailable }
      : {}),
    ...(statusFilter?.runtimeStatus ? { status: statusFilter.runtimeStatus } : {}),
    ...(validatedQuery.watcher ? { watcher: validatedQuery.watcher } : {}),
  };
  const pagination = normalizeContainerListPagination(query);

  // Sort/order, maturity, and watched-kind filters require loading the full
  // collection before pagination because they inspect in-memory properties
  // (container labels, update age) that cannot be pushed down to the store.
  // status and update-kind are already pushed down to filteredQuery as
  // store-level filters (updateAvailable, updateKind.*), so the store handles
  // those efficiently without loading everything into memory first.
  const needsFullCollection =
    getFirstNonEmptyQueryValue(query.sort) !== undefined ||
    getFirstNonEmptyQueryValue(query.order) !== undefined ||
    maturityFilter !== undefined ||
    (watchedKindFilter !== undefined && watchedKindFilter !== 'all');
  let pagedContainers: Container[];
  let total: number;

  if (needsFullCollection) {
    const containersToSort = context.getContainersFromStore(filteredQuery, {
      limit: 0,
      offset: 0,
    });
    const watchedKindFilteredContainers = applyContainerWatchedKindFilter(
      containersToSort,
      watchedKindFilter,
    );
    const maturityFilteredContainers = applyContainerMaturityFilter(
      watchedKindFilteredContainers,
      maturityFilter,
    );
    const sortedContainers = sortContainers(maturityFilteredContainers, sortMode);
    total = sortedContainers.length;
    pagedContainers = paginateCollection(sortedContainers, pagination);
  } else {
    pagedContainers = context.getContainersFromStore(filteredQuery, pagination);
    const sortedPagedContainers = sortContainers(pagedContainers, sortMode);
    total =
      pagination.limit === 0 && pagination.offset === 0
        ? sortedPagedContainers.length
        : context.getContainerCountFromStore(filteredQuery);
    pagedContainers = sortedPagedContainers;
  }

  const redactedContainers = context.redactContainersRuntimeEnv(pagedContainers);
  // Always strip detail-only security fields (sbom, signature, etc.) from list responses.
  // Vulnerability arrays are additionally stripped unless the caller explicitly opts in.
  const strippedContainers = redactedContainers.map((container) =>
    stripContainerDetailOnlySecurityFields(container, !includeVulnerabilities),
  );
  const preloadedActiveOperationLookup = buildPreloadedActiveOperationLookup(
    context.updateOperationStore.listActiveOperations?.() ?? [],
  );
  const data = strippedContainers.map((container) =>
    preloadedActiveOperationLookup
      ? attachPreloadedActiveUpdateOperation(preloadedActiveOperationLookup, container)
      : attachInProgressUpdateOperation(context, container),
  );
  const hasMore = pagination.limit > 0 && pagination.offset + data.length < total;
  const links = buildPaginationLinks({
    basePath,
    query,
    limit: pagination.limit,
    offset: pagination.offset,
    total,
    returnedCount: data.length,
  });
  return {
    data,
    total,
    limit: pagination.limit,
    offset: pagination.offset,
    hasMore,
    ...(links ? { _links: links } : {}),
  };
}

export function createGetContainersHandler(context: CrudHandlerContext) {
  return function getContainers(req: Request, res: Response) {
    try {
      res.status(200).json(buildContainerListResponse(context, req.query, '/api/containers'));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Invalid request';
      sendErrorResponse(res, 400, message);
    }
  };
}
