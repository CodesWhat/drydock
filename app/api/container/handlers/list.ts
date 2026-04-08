import type { Request, Response } from 'express';
import type { Container, ContainerUpdateOperationState } from '../../../model/container.js';
import {
  isContainerUpdateOperationPhase,
  isContainerUpdateOperationStatus,
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

function stripContainerVulnerabilityArrays(container: Container): Container {
  if (!container.security) {
    return container;
  }
  return {
    ...container,
    security: {
      ...container.security,
      scan: container.security.scan
        ? {
            ...container.security.scan,
            vulnerabilities: [],
          }
        : container.security.scan,
      updateScan: container.security.updateScan
        ? {
            ...container.security.updateScan,
            vulnerabilities: [],
          }
        : container.security.updateScan,
    },
  };
}

function sanitizeInProgressUpdateOperation(
  operation: unknown,
): ContainerUpdateOperationState | undefined {
  if (!operation || typeof operation !== 'object') {
    return undefined;
  }

  const candidate = operation as Record<string, unknown>;

  const id = typeof candidate.id === 'string' ? candidate.id : undefined;
  const status = isContainerUpdateOperationStatus(candidate.status) ? candidate.status : undefined;
  const phase = isContainerUpdateOperationPhase(candidate.phase) ? candidate.phase : undefined;
  const updatedAt = typeof candidate.updatedAt === 'string' ? candidate.updatedAt : undefined;

  if (!id || !status || !phase || !updatedAt) {
    return undefined;
  }

  return {
    id,
    status,
    phase,
    updatedAt,
    ...(typeof candidate.fromVersion === 'string' ? { fromVersion: candidate.fromVersion } : {}),
    ...(typeof candidate.toVersion === 'string' ? { toVersion: candidate.toVersion } : {}),
    ...(typeof candidate.targetImage === 'string' ? { targetImage: candidate.targetImage } : {}),
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
  const operation = sanitizeInProgressUpdateOperation(matched);

  if (!operation) {
    return container;
  }

  return {
    ...container,
    updateOperation: operation,
  };
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
  const strippedContainers = includeVulnerabilities
    ? redactedContainers
    : redactedContainers.map((container) => stripContainerVulnerabilityArrays(container));
  const data = strippedContainers.map((container) =>
    attachInProgressUpdateOperation(context, container),
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
