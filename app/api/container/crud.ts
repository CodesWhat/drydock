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

interface ContainerSecuritySummary {
  unknown: number;
  low: number;
  medium: number;
  high: number;
  critical: number;
}

interface SecurityViewVulnerability {
  id: string;
  severity: string;
  package: string;
  version: string;
  fixedIn: string | null;
  title: string;
  target: string;
  primaryUrl: string;
  publishedDate: string;
}

interface SecurityImageVulnerabilityGroup {
  image: string;
  containerIds: string[];
  updateSummary?: ContainerSecuritySummary;
  vulnerabilities: SecurityViewVulnerability[];
}

interface SecurityVulnerabilityOverviewResponse {
  totalContainers: number;
  scannedContainers: number;
  latestScannedAt: string | null;
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  _links?: PaginationLinks;
  images: SecurityImageVulnerabilityGroup[];
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

interface FlattenedSecurityVulnerability {
  image: string;
  vulnerability: SecurityViewVulnerability;
}

interface SecurityVulnerabilityPage {
  total: number;
  pagination: ContainerListPagination;
  hasMore: boolean;
  links?: PaginationLinks;
  pagedImages: SecurityImageVulnerabilityGroup[];
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

function getSecurityIssueCount(containers: Container[]): number {
  return containers.filter((container) => {
    const summary = container.security?.scan?.summary;
    return Number(summary?.critical ?? 0) > 0 || Number(summary?.high ?? 0) > 0;
  }).length;
}

function toNonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

function chooseLatestScannedAt(current: string | null, candidate: unknown): string | null {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return current;
  }
  if (current === null) {
    return candidate;
  }
  const currentTime = Date.parse(current);
  const candidateTime = Date.parse(candidate);
  if (Number.isFinite(currentTime) && Number.isFinite(candidateTime)) {
    return candidateTime > currentTime ? candidate : current;
  }
  return candidate > current ? candidate : current;
}

function readStringField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readVulnerabilityString(vulnerability: unknown, fields: string[], fallback = ''): string {
  if (!vulnerability || typeof vulnerability !== 'object') {
    return fallback;
  }
  const record = vulnerability as Record<string, unknown>;
  for (const field of fields) {
    const value = readStringField(record[field]);
    if (value !== undefined) {
      return value;
    }
  }
  return fallback;
}

function readVulnerabilityFixedIn(vulnerability: unknown): string | null {
  const fixedIn = readVulnerabilityString(vulnerability, ['fixedVersion', 'fixedIn']);
  return fixedIn.length > 0 ? fixedIn : null;
}

function normalizeUpdateSummary(summary: unknown): ContainerSecuritySummary {
  const record = summary && typeof summary === 'object' ? (summary as Record<string, unknown>) : {};
  return {
    unknown: toNonNegativeInteger(record.unknown),
    low: toNonNegativeInteger(record.low),
    medium: toNonNegativeInteger(record.medium),
    high: toNonNegativeInteger(record.high),
    critical: toNonNegativeInteger(record.critical),
  };
}

function normalizeSecurityVulnerability(vulnerability: unknown): SecurityViewVulnerability {
  return {
    id: readVulnerabilityString(vulnerability, ['id'], 'unknown'),
    severity: readVulnerabilityString(vulnerability, ['severity'], 'UNKNOWN'),
    package: readVulnerabilityString(vulnerability, ['packageName', 'package'], 'unknown'),
    version: readVulnerabilityString(vulnerability, ['installedVersion', 'version'], ''),
    fixedIn: readVulnerabilityFixedIn(vulnerability),
    title: readVulnerabilityString(vulnerability, ['title', 'Title'], ''),
    target: readVulnerabilityString(vulnerability, ['target', 'Target'], ''),
    primaryUrl: readVulnerabilityString(vulnerability, ['primaryUrl', 'PrimaryURL'], ''),
    publishedDate: readVulnerabilityString(vulnerability, ['publishedDate'], ''),
  };
}

function resolveSecurityImageName(container: Container): string {
  const displayName = readStringField(container.displayName)?.trim();
  if (displayName) {
    return displayName;
  }
  const name = readStringField(container.name)?.trim();
  if (name) {
    return name;
  }
  return 'unknown';
}

function paginateFlattenedVulnerabilities(
  vulnerabilities: FlattenedSecurityVulnerability[],
  pagination: ContainerListPagination,
): FlattenedSecurityVulnerability[] {
  if (pagination.limit === 0 && pagination.offset === 0) {
    return vulnerabilities;
  }
  if (pagination.limit === 0) {
    return vulnerabilities.slice(pagination.offset);
  }
  return vulnerabilities.slice(pagination.offset, pagination.offset + pagination.limit);
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

function appendContainerScanData(
  images: Map<string, SecurityImageVulnerabilityGroup>,
  flattenedVulnerabilities: FlattenedSecurityVulnerability[],
  container: Container,
) {
  const scan = container.security?.scan;
  if (!scan) {
    return false;
  }

  const image = resolveSecurityImageName(container);
  const existingGroup = images.get(image) || {
    image,
    containerIds: [],
    vulnerabilities: [],
  };

  if (
    typeof container.id === 'string' &&
    container.id.length > 0 &&
    !existingGroup.containerIds.includes(container.id)
  ) {
    existingGroup.containerIds.push(container.id);
  }

  const updateSummary = container.security?.updateScan?.summary;
  if (updateSummary) {
    existingGroup.updateSummary = normalizeUpdateSummary(updateSummary);
  }

  const vulnerabilityList = Array.isArray(scan.vulnerabilities) ? scan.vulnerabilities : [];
  for (const vulnerability of vulnerabilityList) {
    const normalizedVulnerability = normalizeSecurityVulnerability(vulnerability);
    existingGroup.vulnerabilities.push(normalizedVulnerability);
    flattenedVulnerabilities.push({
      image,
      vulnerability: normalizedVulnerability,
    });
  }

  images.set(image, existingGroup);
  return {
    scannedAt: scan.scannedAt,
  };
}

function collectSecurityVulnerabilityData(containers: Container[]) {
  const images = new Map<string, SecurityImageVulnerabilityGroup>();
  const flattenedVulnerabilities: FlattenedSecurityVulnerability[] = [];
  let scannedContainers = 0;
  let latestScannedAt: string | null = null;

  for (const container of containers) {
    const scanData = appendContainerScanData(images, flattenedVulnerabilities, container);
    if (!scanData) {
      continue;
    }
    scannedContainers += 1;
    latestScannedAt = chooseLatestScannedAt(latestScannedAt, scanData.scannedAt);
  }

  return {
    allImageGroups: [...images.values()],
    flattenedVulnerabilities,
    scannedContainers,
    latestScannedAt,
  };
}

function buildSecurityVulnerabilityPage(
  query: Request['query'],
  allImageGroups: SecurityImageVulnerabilityGroup[],
  flattenedVulnerabilities: FlattenedSecurityVulnerability[],
): SecurityVulnerabilityPage {
  const pagination = normalizeContainerListPagination(query);
  const pagedVulnerabilities = paginateFlattenedVulnerabilities(
    flattenedVulnerabilities,
    pagination,
  );
  const total = flattenedVulnerabilities.length;
  const hasMore = pagination.limit > 0 && pagination.offset + pagedVulnerabilities.length < total;
  const links = buildPaginationLinks({
    basePath: '/api/containers/security/vulnerabilities',
    query,
    limit: pagination.limit,
    offset: pagination.offset,
    total,
    returnedCount: pagedVulnerabilities.length,
  });
  const isPaginated = pagination.limit > 0 || pagination.offset > 0;
  const pagedImages = isPaginated
    ? buildPaginatedImageGroups(allImageGroups, pagedVulnerabilities)
    : allImageGroups;
  return {
    total,
    pagination,
    hasMore,
    ...(links ? { links } : {}),
    pagedImages,
  };
}

function buildSecurityVulnerabilityOverviewResponse(
  containers: Container[],
  query: Request['query'],
): SecurityVulnerabilityOverviewResponse {
  const { allImageGroups, flattenedVulnerabilities, scannedContainers, latestScannedAt } =
    collectSecurityVulnerabilityData(containers);
  const { total, pagination, hasMore, links, pagedImages } = buildSecurityVulnerabilityPage(
    query,
    allImageGroups,
    flattenedVulnerabilities,
  );
  return {
    totalContainers: containers.length,
    scannedContainers,
    latestScannedAt,
    total,
    limit: pagination.limit,
    offset: pagination.offset,
    hasMore,
    ...(links ? { _links: links } : {}),
    images: pagedImages,
  };
}

function buildPaginatedImageGroups(
  allImageGroups: SecurityImageVulnerabilityGroup[],
  pagedVulnerabilities: FlattenedSecurityVulnerability[],
): SecurityImageVulnerabilityGroup[] {
  const groupedImages = new Map<string, SecurityImageVulnerabilityGroup>();
  const imageTemplates = new Map(allImageGroups.map((group) => [group.image, group] as const));
  for (const { image, vulnerability } of pagedVulnerabilities) {
    const template = imageTemplates.get(image);
    if (!template) {
      continue;
    }
    let group = groupedImages.get(image);
    if (!group) {
      group = {
        image: template.image,
        containerIds: [...template.containerIds],
        vulnerabilities: [],
        ...(template.updateSummary ? { updateSummary: template.updateSummary } : {}),
      };
      groupedImages.set(image, group);
    }
    group.vulnerabilities.push(vulnerability);
  }
  return [...groupedImages.values()];
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
): { targets?: WatchTarget[]; status?: number; error?: string } {
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
  const containers = context.getContainersFromStore({});
  res.status(200).json(buildSecurityVulnerabilityOverviewResponse(containers, req.query));
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
  res.status(200).json({
    data: operations,
    total: operations.length,
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
      if (!selected.targets) {
        sendErrorResponse(res, selected.status ?? 500, selected.error ?? 'Unknown watch error');
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
