import type { Request, Response } from 'express';
import type { AgentClient } from '../../agent/AgentClient.js';
import type { Container, ContainerReport } from '../../model/container.js';
import { getContainerStatusSummary } from '../../util/container-summary.js';
import { sendErrorResponse } from '../error-response.js';
import { buildPaginationLinks, type PaginationLinks } from '../pagination-links.js';
import {
  getPathParamValue,
  normalizeLimitOffsetPagination,
  parseBooleanQueryParam,
} from './request-helpers.js';
import {
  buildSecurityVulnerabilityOverviewResponse,
  getSecurityIssueCount,
  type SecurityVulnerabilityOverviewResponse,
} from './security-overview.js';
import { isSensitiveKey } from './shared.js';

interface CrudStoreContainerApi {
  getContainer: (id: string) => Container | undefined;
  deleteContainer: (id: string) => void;
}

interface ContainerListPagination {
  limit: number;
  offset: number;
}

interface ContainerListResponse {
  data: Container[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  _links?: PaginationLinks;
}

interface WatchContainersBody {
  containerIds?: string[];
}

interface UpdateOperationStoreApi {
  getOperationsByContainerName: (containerName: string) => unknown[];
}

interface ServerConfiguration {
  feature: {
    delete: boolean;
  };
}

interface LocalContainerWatcher {
  watch: () => Promise<unknown>;
  getContainers?: () => Promise<Container[]>;
  watchContainer: (container: Container) => Promise<ContainerReport>;
}

interface AuditStoreApi {
  insertAudit: (entry: {
    action: string;
    containerName: string;
    containerImage?: string;
    status: string;
    details?: string;
  }) => unknown;
}

export interface CrudHandlerDependencies {
  storeApi: {
    getContainersFromStore: (
      query: Request['query'],
      pagination?: ContainerListPagination,
    ) => Container[];
    getContainerCountFromStore: (query: Request['query']) => number;
    storeContainer: CrudStoreContainerApi;
    updateOperationStore: UpdateOperationStoreApi;
    getContainerRaw?: (id: string) => Container | undefined;
  };
  agentApi: {
    getServerConfiguration: () => ServerConfiguration;
    getAgent: (name: string) => AgentClient | undefined;
    getWatchers: () => Record<string, LocalContainerWatcher>;
  };
  errorApi: {
    getErrorMessage: (error: unknown) => string;
    getErrorStatusCode: (error: unknown) => number | undefined;
  };
  securityApi: {
    redactContainerRuntimeEnv: (container: Container) => Container;
    redactContainersRuntimeEnv: (containers: Container[]) => Container[];
    auditStore?: AuditStoreApi;
  };
}

const CONTAINER_LIST_MAX_LIMIT = 200;
const WATCH_CONTAINERS_MAX_IDS = 200;

function removeContainerListControlParams(query: Request['query']): Request['query'] {
  const filteredQuery: Record<string, unknown> = {};
  Object.entries(query || {}).forEach(([key, value]) => {
    if (key === 'includeVulnerabilities' || key === 'limit' || key === 'offset') {
      return;
    }
    filteredQuery[key] = value;
  });
  return filteredQuery as Request['query'];
}

function normalizeContainerListPagination(query: Request['query']) {
  return normalizeLimitOffsetPagination(query, { maxLimit: CONTAINER_LIST_MAX_LIMIT });
}

function paginateCollection<T>(collection: T[], pagination: ContainerListPagination): T[] {
  if (pagination.limit === 0 && pagination.offset === 0) {
    return collection;
  }
  if (pagination.limit === 0) {
    return collection.slice(pagination.offset);
  }
  return collection.slice(pagination.offset, pagination.offset + pagination.limit);
}

function parseWatchContainersBody(body: unknown): { body?: WatchContainersBody; error?: string } {
  if (body === undefined || body === null) {
    return { body: {} };
  }

  if (typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be an object' };
  }

  const requestBody = body as Record<string, unknown>;
  const unknownKeys = Object.keys(requestBody).filter((key) => key !== 'containerIds');
  if (unknownKeys.length > 0) {
    return { error: `Unknown request properties: ${unknownKeys.join(', ')}` };
  }

  const { containerIds } = requestBody;
  if (containerIds === undefined) {
    return { body: {} };
  }
  if (!Array.isArray(containerIds)) {
    return { error: 'containerIds must be an array of non-empty strings' };
  }
  if (containerIds.length === 0) {
    return { error: 'containerIds must not be empty' };
  }
  if (containerIds.length > WATCH_CONTAINERS_MAX_IDS) {
    return { error: `containerIds must contain at most ${WATCH_CONTAINERS_MAX_IDS} entries` };
  }

  const normalizedIds: string[] = [];
  const seenIds = new Set<string>();
  for (const containerId of containerIds) {
    if (typeof containerId !== 'string' || containerId.trim() === '') {
      return { error: 'containerIds must be an array of non-empty strings' };
    }
    const normalizedId = containerId.trim();
    if (seenIds.has(normalizedId)) {
      continue;
    }
    seenIds.add(normalizedId);
    normalizedIds.push(normalizedId);
  }

  return {
    body: {
      containerIds: normalizedIds,
    },
  };
}

function resolveWatcherIdForContainer(container: Container): string {
  let watcherId = `docker.${container.watcher}`;
  if (container.agent) {
    watcherId = `${container.agent}.${watcherId}`;
  }
  return watcherId;
}

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

interface CrudHandlerContext {
  getContainersFromStore: CrudHandlerDependencies['storeApi']['getContainersFromStore'];
  getContainerCountFromStore: CrudHandlerDependencies['storeApi']['getContainerCountFromStore'];
  storeContainer: CrudStoreContainerApi;
  updateOperationStore: UpdateOperationStoreApi;
  getContainerRaw?: CrudHandlerDependencies['storeApi']['getContainerRaw'];
  getServerConfiguration: CrudHandlerDependencies['agentApi']['getServerConfiguration'];
  getAgent: CrudHandlerDependencies['agentApi']['getAgent'];
  getWatchers: CrudHandlerDependencies['agentApi']['getWatchers'];
  getErrorMessage: CrudHandlerDependencies['errorApi']['getErrorMessage'];
  getErrorStatusCode: CrudHandlerDependencies['errorApi']['getErrorStatusCode'];
  redactContainerRuntimeEnv: CrudHandlerDependencies['securityApi']['redactContainerRuntimeEnv'];
  redactContainersRuntimeEnv: CrudHandlerDependencies['securityApi']['redactContainersRuntimeEnv'];
  auditStore?: AuditStoreApi;
}

interface WatchTarget {
  container: Container;
  watcher: LocalContainerWatcher;
}

function buildCrudHandlerContext({
  storeApi: {
    getContainersFromStore,
    getContainerCountFromStore,
    storeContainer,
    updateOperationStore,
    getContainerRaw,
  },
  agentApi: { getServerConfiguration, getAgent, getWatchers },
  errorApi: { getErrorMessage, getErrorStatusCode },
  securityApi: { redactContainerRuntimeEnv, redactContainersRuntimeEnv, auditStore },
}: CrudHandlerDependencies): CrudHandlerContext {
  return {
    getContainersFromStore,
    getContainerCountFromStore,
    storeContainer,
    updateOperationStore,
    getContainerRaw,
    getServerConfiguration,
    getAgent,
    getWatchers,
    getErrorMessage,
    getErrorStatusCode,
    redactContainerRuntimeEnv,
    redactContainersRuntimeEnv,
    auditStore,
  };
}

function buildContainerListResponse(
  context: CrudHandlerContext,
  query: Request['query'],
  basePath: '/api/containers' | '/api/containers/watch',
): ContainerListResponse {
  const includeVulnerabilities = parseBooleanQueryParam(query.includeVulnerabilities, false);
  const filteredQuery = removeContainerListControlParams(query);
  const pagination = normalizeContainerListPagination(query);
  const pagedContainers = context.getContainersFromStore(filteredQuery, pagination);
  const total =
    pagination.limit === 0 && pagination.offset === 0
      ? pagedContainers.length
      : context.getContainerCountFromStore(filteredQuery);
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

function getContainerOrNotFound(context: CrudHandlerContext, id: string, res: Response) {
  const container = context.storeContainer.getContainer(id);
  if (!container) {
    sendErrorResponse(res, 404, 'Container not found');
    return undefined;
  }
  return container;
}

function resolveTargetedWatchTargets(
  context: CrudHandlerContext,
  containerIds: string[],
  watcherMap: Record<string, LocalContainerWatcher>,
): { targets: WatchTarget[] } | { targets?: undefined; status: number; error: string } {
  const selectedTargets: WatchTarget[] = [];

  for (const containerId of containerIds) {
    const container = context.storeContainer.getContainer(containerId);
    if (!container) {
      return { status: 404, error: 'Container not found' };
    }

    const watcherId = resolveWatcherIdForContainer(container);
    const watcher = watcherMap[watcherId];
    if (!watcher) {
      return {
        status: 500,
        error: `No provider found for container ${container.id} and provider ${watcherId}`,
      };
    }

    selectedTargets.push({
      container,
      watcher,
    });
  }

  return { targets: selectedTargets };
}

function extractContainerEnv(container: Container) {
  const details = container.details as { env?: unknown[] } | undefined;
  const rawEnv = Array.isArray(details?.env) ? details.env : [];

  return rawEnv
    .filter(
      (entry): entry is { key: string; value: string } =>
        !!entry &&
        typeof entry === 'object' &&
        typeof (entry as { key?: unknown }).key === 'string',
    )
    .map((entry) => ({
      key: entry.key,
      value: entry.value,
      sensitive: isSensitiveKey(entry.key),
    }));
}

function getContainersHandler(context: CrudHandlerContext, req: Request, res: Response) {
  res.status(200).json(buildContainerListResponse(context, req.query, '/api/containers'));
}

function getContainerSummaryHandler(context: CrudHandlerContext, _req: Request, res: Response) {
  const containers = context.getContainersFromStore({});
  const containerStatus = getContainerStatusSummary(containers);
  res.status(200).json({
    containers: containerStatus,
    security: {
      issues: getSecurityIssueCount(containers),
    },
  });
}

function getContainerSecurityVulnerabilitiesHandler(
  context: CrudHandlerContext,
  req: Request,
  res: Response<SecurityVulnerabilityOverviewResponse>,
) {
  const totalContainers = context.getContainerCountFromStore({});
  if (totalContainers <= 0) {
    res.status(200).json(buildSecurityVulnerabilityOverviewResponse([], req.query, 0));
    return;
  }
  const containers = context.getContainersFromStore({});
  res
    .status(200)
    .json(buildSecurityVulnerabilityOverviewResponse(containers, req.query, totalContainers));
}

function getContainerHandler(context: CrudHandlerContext, req: Request, res: Response) {
  const id = getPathParamValue(req.params.id);
  const container = context.storeContainer.getContainer(id);
  if (container) {
    res.status(200).json(context.redactContainerRuntimeEnv(container));
  } else {
    sendErrorResponse(res, 404, 'Container not found');
  }
}

function getContainerUpdateOperationsHandler(
  context: CrudHandlerContext,
  req: Request,
  res: Response,
) {
  const id = getPathParamValue(req.params.id);
  const container = getContainerOrNotFound(context, id, res);
  if (!container) {
    return;
  }

  const operations = context.updateOperationStore.getOperationsByContainerName(container.name);
  const pagination = normalizeContainerListPagination(req.query);
  const data = paginateCollection(operations, pagination);
  const hasMore = pagination.limit > 0 && pagination.offset + data.length < operations.length;
  const links = buildPaginationLinks({
    basePath: `/api/containers/${id}/update-operations`,
    query: req.query,
    limit: pagination.limit,
    offset: pagination.offset,
    total: operations.length,
    returnedCount: data.length,
  });
  res.status(200).json({
    data,
    total: operations.length,
    limit: pagination.limit,
    offset: pagination.offset,
    hasMore,
    ...(links ? { _links: links } : {}),
  });
}

async function deleteContainerHandler(context: CrudHandlerContext, req: Request, res: Response) {
  const serverConfiguration = context.getServerConfiguration();
  if (!serverConfiguration.feature.delete) {
    sendErrorResponse(res, 403, 'Container deletion is disabled');
    return;
  }

  const id = getPathParamValue(req.params.id);
  const container = getContainerOrNotFound(context, id, res);
  if (!container) {
    return;
  }

  if (!container.agent) {
    context.storeContainer.deleteContainer(id);
    res.sendStatus(204);
    return;
  }

  const agent = context.getAgent(container.agent);
  if (!agent) {
    sendErrorResponse(res, 500, `Agent ${container.agent} not found`);
    return;
  }

  try {
    await agent.deleteContainer(id);
    context.storeContainer.deleteContainer(id);
    res.sendStatus(204);
  } catch (error: unknown) {
    if (context.getErrorStatusCode(error) === 404) {
      context.storeContainer.deleteContainer(id);
      res.sendStatus(204);
    } else {
      sendErrorResponse(
        res,
        500,
        `Error deleting container on agent (${context.getErrorMessage(error)})`,
      );
    }
  }
}

async function watchContainersHandler(context: CrudHandlerContext, req: Request, res: Response) {
  const parsedBody = parseWatchContainersBody(req.body);
  if (parsedBody.error) {
    sendErrorResponse(res, 400, parsedBody.error);
    return;
  }

  const watcherMap = context.getWatchers();
  const containerIds = parsedBody.body?.containerIds;
  try {
    if (Array.isArray(containerIds) && containerIds.length > 0) {
      const selected = resolveTargetedWatchTargets(context, containerIds, watcherMap);
      if ('error' in selected) {
        sendErrorResponse(res, selected.status, selected.error);
        return;
      }
      await Promise.all(
        selected.targets.map((target) => target.watcher.watchContainer(target.container)),
      );
    } else {
      await Promise.all(Object.values(watcherMap).map((watcher) => watcher.watch()));
    }

    res.status(200).json(buildContainerListResponse(context, req.query, '/api/containers/watch'));
  } catch (error: unknown) {
    sendErrorResponse(res, 500, `Error when watching images (${context.getErrorMessage(error)})`);
  }
}

async function watchContainerHandler(context: CrudHandlerContext, req: Request, res: Response) {
  const id = getPathParamValue(req.params.id);
  const container = getContainerOrNotFound(context, id, res);
  if (!container) {
    return;
  }

  const watcherId = resolveWatcherIdForContainer(container);
  const watcher = context.getWatchers()[watcherId];
  if (!watcher) {
    sendErrorResponse(res, 500, `No provider found for container ${id} and provider ${watcherId}`);
    return;
  }

  try {
    if (typeof watcher.getContainers === 'function') {
      // Ensure container is still in store
      // (for cases where it has been removed before running a new watchAll)
      const containers = await watcher.getContainers();
      const containerFound = containers.some(
        (containerInList) => containerInList.id === container.id,
      );
      if (!containerFound) {
        sendErrorResponse(res, 404, 'Container not found');
        return;
      }
    }
    // Run watchContainer from the Provider
    const containerReport = await watcher.watchContainer(container);
    res.status(200).json(context.redactContainerRuntimeEnv(containerReport.container));
  } catch {
    sendErrorResponse(res, 500, `Error when watching container ${id}`);
  }
}

function revealContainerEnvHandler(context: CrudHandlerContext, req: Request, res: Response) {
  if (!context.getContainerRaw || !context.auditStore) {
    sendErrorResponse(res, 501, 'Environment reveal is not available');
    return;
  }

  const id = getPathParamValue(req.params.id);
  const container = context.getContainerRaw(id);
  if (!container) {
    sendErrorResponse(res, 404, 'Container not found');
    return;
  }

  const env = extractContainerEnv(container);
  context.auditStore.insertAudit({
    action: 'env-reveal',
    containerName: container.name,
    containerImage: container.image?.name,
    status: 'info',
    details: `Revealed ${env.filter((entry) => entry.sensitive).length} sensitive env var(s)`,
  });

  res.status(200).json({ env });
}

export function createCrudHandlers(dependencies: CrudHandlerDependencies) {
  const context = buildCrudHandlerContext(dependencies);
  return {
    getContainers(req: Request, res: Response) {
      getContainersHandler(context, req, res);
    },
    getContainerSummary(req: Request, res: Response) {
      getContainerSummaryHandler(context, req, res);
    },
    getContainerSecurityVulnerabilities(
      req: Request,
      res: Response<SecurityVulnerabilityOverviewResponse>,
    ) {
      getContainerSecurityVulnerabilitiesHandler(context, req, res);
    },
    getContainer(req: Request, res: Response) {
      getContainerHandler(context, req, res);
    },
    getContainerUpdateOperations(req: Request, res: Response) {
      getContainerUpdateOperationsHandler(context, req, res);
    },
    deleteContainer(req: Request, res: Response) {
      return deleteContainerHandler(context, req, res);
    },
    watchContainers(req: Request, res: Response) {
      return watchContainersHandler(context, req, res);
    },
    watchContainer(req: Request, res: Response) {
      return watchContainerHandler(context, req, res);
    },
    revealContainerEnv(req: Request, res: Response) {
      revealContainerEnvHandler(context, req, res);
    },
  };
}
