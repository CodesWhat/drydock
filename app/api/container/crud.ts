import type { Request, Response } from 'express';
import joi from 'joi';
import type { AgentClient } from '../../agent/AgentClient.js';
import type { Container, ContainerReport } from '../../model/container.js';
import {
  maturityMinAgeDaysToMilliseconds,
  resolveMaturityMinAgeDays,
} from '../../model/maturity-policy.js';
import { getFullReleaseNotesForContainer } from '../../release-notes/index.js';
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
type ContainerMaturityFilter = 'hot' | 'mature' | 'established';
type ContainerSortMode =
  | 'name'
  | '-name'
  | 'status'
  | '-status'
  | 'age'
  | '-age'
  | 'created'
  | '-created';
const DEFAULT_CONTAINER_SORT_MODE: ContainerSortMode = 'name';
const DEFAULT_UI_MATURITY_THRESHOLD_DAYS = 7;
const ESTABLISHED_UPDATE_AGE_DAYS = 30;

const CONTAINER_LIST_QUERY_SCHEMA = joi.object({
  sort: joi
    .string()
    .valid('name', '-name', 'status', '-status', 'age', '-age', 'created', '-created')
    .messages({
      'any.only': 'Invalid sort value',
    }),
  status: joi.string().valid('update-available', 'up-to-date').messages({
    'any.only': 'Invalid status filter value',
  }),
  kind: joi.string().valid('major', 'minor', 'patch', 'digest').messages({
    'any.only': 'Invalid kind filter value',
  }),
  watcher: joi.string().trim().min(1).messages({
    'string.empty': 'Invalid watcher filter value',
    'string.min': 'Invalid watcher filter value',
  }),
  maturity: joi.string().valid('hot', 'mature', 'established').messages({
    'any.only': 'Invalid maturity filter value',
  }),
});

function removeContainerListControlParams(query: Request['query']): Request['query'] {
  const filteredQuery: Record<string, unknown> = {};
  Object.entries(query || {}).forEach(([key, value]) => {
    if (
      key === 'includeVulnerabilities' ||
      key === 'limit' ||
      key === 'offset' ||
      key === 'sort' ||
      key === 'maturity' ||
      key === 'status' ||
      key === 'kind' ||
      key === 'watcher'
    ) {
      return;
    }
    filteredQuery[key] = value;
  });
  return filteredQuery as Request['query'];
}

function getFirstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') {
        return item.trim();
      }
    }
    return undefined;
  }
  return typeof value === 'string' ? value.trim() : undefined;
}

function getFirstNonEmptyQueryValue(value: unknown): string | undefined {
  const queryValue = getFirstQueryValue(value);
  if (!queryValue || queryValue.length === 0) {
    return undefined;
  }
  return queryValue;
}

function parseContainerSortMode(sortQuery: unknown): ContainerSortMode {
  const sortValue = getFirstNonEmptyQueryValue(sortQuery);
  if (!sortValue) {
    return DEFAULT_CONTAINER_SORT_MODE;
  }
  return sortValue as ContainerSortMode;
}

function parseContainerMaturityFilter(maturityQuery: unknown): ContainerMaturityFilter | undefined {
  const normalized = getFirstNonEmptyQueryValue(maturityQuery)?.toLowerCase();
  if (normalized === 'hot' || normalized === 'mature' || normalized === 'established') {
    return normalized;
  }
  return undefined;
}

interface ValidatedContainerListQuery {
  sortMode: ContainerSortMode;
  status?: 'update-available' | 'up-to-date';
  kind?: 'major' | 'minor' | 'patch' | 'digest';
  watcher?: string;
  maturity?: ContainerMaturityFilter;
}

function validateContainerListQuery(query: Request['query']): ValidatedContainerListQuery {
  const { value, error } = CONTAINER_LIST_QUERY_SCHEMA.validate(
    {
      sort: getFirstQueryValue(query.sort),
      status: getFirstQueryValue(query.status),
      kind: getFirstQueryValue(query.kind),
      watcher: getFirstQueryValue(query.watcher),
      maturity: getFirstQueryValue(query.maturity),
    },
    {
      abortEarly: true,
    },
  );

  if (error) {
    throw new Error(error.details?.[0]?.message || 'Invalid query parameters');
  }

  return {
    sortMode: parseContainerSortMode(value.sort),
    status: value.status,
    kind: value.kind,
    watcher: value.watcher,
    maturity: value.maturity,
  };
}

function getContainerUpdateAge(container: Container): number | undefined {
  if (typeof container.updateAge === 'number' && Number.isFinite(container.updateAge)) {
    return container.updateAge;
  }

  const firstSeenAtMs = Date.parse(container.firstSeenAt || '');
  const publishedAtMs = Date.parse(container.result?.publishedAt || '');
  const updateDetectedAtMs = Date.parse(container.updateDetectedAt || '');
  let startedAtMs: number | undefined;
  if (Number.isFinite(firstSeenAtMs) && Number.isFinite(publishedAtMs)) {
    startedAtMs = Math.min(firstSeenAtMs, publishedAtMs);
  } else if (Number.isFinite(firstSeenAtMs)) {
    startedAtMs = firstSeenAtMs;
  } else if (Number.isFinite(publishedAtMs)) {
    startedAtMs = publishedAtMs;
  } else if (Number.isFinite(updateDetectedAtMs)) {
    startedAtMs = updateDetectedAtMs;
  }

  return startedAtMs === undefined ? undefined : Math.max(0, Date.now() - startedAtMs);
}

function resolveUiMaturityThresholdDays(): number {
  return resolveMaturityMinAgeDays(
    process.env.DD_UI_MATURITY_THRESHOLD_DAYS,
    DEFAULT_UI_MATURITY_THRESHOLD_DAYS,
  );
}

function getContainerMaturityLevel(container: Container): ContainerMaturityFilter | undefined {
  if (
    container.updateMaturityLevel === 'hot' ||
    container.updateMaturityLevel === 'mature' ||
    container.updateMaturityLevel === 'established'
  ) {
    return container.updateMaturityLevel;
  }

  const updateAge = getContainerUpdateAge(container);
  if (updateAge === undefined) {
    return undefined;
  }
  if (updateAge >= maturityMinAgeDaysToMilliseconds(ESTABLISHED_UPDATE_AGE_DAYS)) {
    return 'established';
  }
  return updateAge >= maturityMinAgeDaysToMilliseconds(resolveUiMaturityThresholdDays())
    ? 'mature'
    : 'hot';
}

function applyContainerMaturityFilter(
  containers: Container[],
  maturityFilter: ContainerMaturityFilter | undefined,
): Container[] {
  if (!maturityFilter) {
    return containers;
  }
  return containers.filter((container) => getContainerMaturityLevel(container) === maturityFilter);
}

function getContainerNameForSort(container: Container): string {
  return typeof container.name === 'string' ? container.name : '';
}

function getContainerIdForSort(container: Container): string {
  return typeof container.id === 'string' ? container.id : '';
}

function getContainerWatcherForSort(container: Container): string {
  return typeof container.watcher === 'string' ? container.watcher : '';
}

function sortContainersByAge(containers: Container[]): Container[] {
  const containersSorted = [...containers];
  containersSorted.sort((leftContainer, rightContainer) => {
    const leftAge = getContainerUpdateAge(leftContainer);
    const rightAge = getContainerUpdateAge(rightContainer);
    if (leftAge !== undefined && rightAge !== undefined && leftAge !== rightAge) {
      return rightAge - leftAge;
    }
    if (leftAge !== undefined && rightAge === undefined) {
      return -1;
    }
    if (leftAge === undefined && rightAge !== undefined) {
      return 1;
    }
    const leftName = `${getContainerWatcherForSort(leftContainer)}.${getContainerNameForSort(
      leftContainer,
    )}.${getContainerIdForSort(leftContainer)}`;
    const rightName = `${getContainerWatcherForSort(rightContainer)}.${getContainerNameForSort(
      rightContainer,
    )}.${getContainerIdForSort(rightContainer)}`;
    return leftName.localeCompare(rightName);
  });
  return containersSorted;
}

function sortContainersByStatus(containers: Container[]): Container[] {
  const containersSorted = [...containers];
  containersSorted.sort((leftContainer, rightContainer) => {
    if (leftContainer.updateAvailable !== rightContainer.updateAvailable) {
      return leftContainer.updateAvailable ? -1 : 1;
    }
    return getContainerNameForSort(leftContainer).localeCompare(
      getContainerNameForSort(rightContainer),
    );
  });
  return containersSorted;
}

function sortContainersByCreatedDate(containers: Container[]): Container[] {
  const containersSorted = [...containers];
  containersSorted.sort((leftContainer, rightContainer) => {
    const leftCreatedAtMs = Date.parse(leftContainer.image?.created || '');
    const rightCreatedAtMs = Date.parse(rightContainer.image?.created || '');
    if (Number.isFinite(leftCreatedAtMs) && Number.isFinite(rightCreatedAtMs)) {
      if (leftCreatedAtMs !== rightCreatedAtMs) {
        return leftCreatedAtMs - rightCreatedAtMs;
      }
      return getContainerNameForSort(leftContainer).localeCompare(
        getContainerNameForSort(rightContainer),
      );
    }
    if (Number.isFinite(leftCreatedAtMs)) {
      return -1;
    }
    if (Number.isFinite(rightCreatedAtMs)) {
      return 1;
    }
    return getContainerNameForSort(leftContainer).localeCompare(
      getContainerNameForSort(rightContainer),
    );
  });
  return containersSorted;
}

function sortContainersByName(containers: Container[], descending = false): Container[] {
  const containersSorted = [...containers];
  containersSorted.sort((leftContainer, rightContainer) => {
    const nameCompare = getContainerNameForSort(leftContainer).localeCompare(
      getContainerNameForSort(rightContainer),
    );
    return descending ? -nameCompare : nameCompare;
  });
  return containersSorted;
}

function sortContainers(containers: Container[], sortMode: ContainerSortMode): Container[] {
  const isDescending = sortMode.startsWith('-');
  const normalizedSortMode = (isDescending ? sortMode.slice(1) : sortMode) as Exclude<
    ContainerSortMode,
    '-name' | '-status' | '-age' | '-created'
  >;

  let containersSorted: Container[];
  if (normalizedSortMode === 'status') {
    containersSorted = sortContainersByStatus(containers);
  } else if (normalizedSortMode === 'age') {
    containersSorted = sortContainersByAge(containers);
  } else if (normalizedSortMode === 'created') {
    containersSorted = sortContainersByCreatedDate(containers);
  } else {
    containersSorted = sortContainersByName(containers);
  }

  if (isDescending) {
    containersSorted.reverse();
  }
  return containersSorted;
}

function mapContainerListStatusFilter(statusQuery: unknown): boolean | undefined {
  const statusFilter = getFirstNonEmptyQueryValue(statusQuery);
  if (statusFilter === 'update-available') {
    return true;
  }
  if (statusFilter === 'up-to-date') {
    return false;
  }
  return undefined;
}

function mapContainerListKindFilter(
  kindQuery: unknown,
):
  | { 'updateKind.kind': 'digest' }
  | { 'updateKind.semverDiff': 'major' | 'minor' | 'patch' }
  | undefined {
  const kindFilter = getFirstNonEmptyQueryValue(kindQuery);
  if (kindFilter === 'digest') {
    return { 'updateKind.kind': 'digest' };
  }
  if (kindFilter === 'major' || kindFilter === 'minor' || kindFilter === 'patch') {
    return { 'updateKind.semverDiff': kindFilter };
  }
  return undefined;
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
  const hasAdvancedQuery =
    getFirstNonEmptyQueryValue(query.sort) !== undefined ||
    getFirstNonEmptyQueryValue(query.status) !== undefined ||
    getFirstNonEmptyQueryValue(query.kind) !== undefined ||
    maturityFilter !== undefined;
  let pagedContainers: Container[];
  let total: number;

  if (hasAdvancedQuery) {
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

function getContainersHandler(context: CrudHandlerContext, req: Request, res: Response) {
  try {
    res.status(200).json(buildContainerListResponse(context, req.query, '/api/containers'));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    sendErrorResponse(res, 400, message);
  }
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

function getContainerSummaryHandler(context: CrudHandlerContext, _req: Request, res: Response) {
  const containers = context.getContainersFromStore({});
  const containerStatus = getContainerStatusSummary(containers);
  const hotUpdates = containers.filter(
    (container) => container.updateAvailable && container.updateMaturityLevel === 'hot',
  ).length;
  const matureUpdates = containers.filter(
    (container) =>
      container.updateAvailable &&
      (container.updateMaturityLevel === 'mature' ||
        container.updateMaturityLevel === 'established'),
  ).length;
  res.status(200).json({
    containers: containerStatus,
    security: {
      issues: getSecurityIssueCount(containers),
    },
    hotUpdates,
    matureUpdates,
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

async function getContainerReleaseNotesHandler(
  context: CrudHandlerContext,
  req: Request,
  res: Response,
) {
  const id = getPathParamValue(req.params.id);
  const container = getContainerOrNotFound(context, id, res);
  if (!container) {
    return;
  }

  try {
    const releaseNotes = await getFullReleaseNotesForContainer(container);
    if (!releaseNotes) {
      sendErrorResponse(res, 404, 'Release notes not available');
      return;
    }
    res.status(200).json(releaseNotes);
  } catch (error: unknown) {
    sendErrorResponse(
      res,
      500,
      `Error retrieving release notes (${context.getErrorMessage(error)})`,
    );
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
    getContainerReleaseNotes(req: Request, res: Response) {
      return getContainerReleaseNotesHandler(context, req, res);
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
