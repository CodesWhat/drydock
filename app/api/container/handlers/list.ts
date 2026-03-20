import type { Request, Response } from 'express';
import type { Container } from '../../../model/container.js';
import { sendErrorResponse } from '../../error-response.js';
import { buildPaginationLinks } from '../../pagination-links.js';
import type { ContainerListResponse, CrudHandlerContext } from '../crud-context.js';
import {
  applyContainerMaturityFilter,
  getFirstNonEmptyQueryValue,
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

  const includeVulnerabilities = parseBooleanQueryParam(query.includeVulnerabilities, false);
  const filteredQuery = {
    ...(removeContainerListControlParams(query) as Record<string, unknown>),
    ...(kindFilter || {}),
    ...(statusFilter === undefined ? {} : { updateAvailable: statusFilter }),
    ...(validatedQuery.watcher ? { watcher: validatedQuery.watcher } : {}),
  } as Request['query'];
  const pagination = normalizeContainerListPagination(query);

  // Only sort and maturity require loading the full collection before pagination.
  // status and kind are already pushed down to filteredQuery as store-level
  // filters (updateAvailable, updateKind.*), so the store handles those
  // efficiently without loading everything into memory first.
  const needsFullCollection =
    getFirstNonEmptyQueryValue(query.sort) !== undefined || maturityFilter !== undefined;
  let pagedContainers: Container[];
  let total: number;

  if (needsFullCollection) {
    const containersToSort = context.getContainersFromStore(filteredQuery, {
      limit: 0,
      offset: 0,
    });
    const maturityFilteredContainers = applyContainerMaturityFilter(
      containersToSort,
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
  const data = includeVulnerabilities
    ? redactedContainers
    : redactedContainers.map((container) => stripContainerVulnerabilityArrays(container));
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
