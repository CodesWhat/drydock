import type { Request, Response } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import nocache from 'nocache';
import { getAgent } from '../agent/manager.js';
import { getSecurityConfiguration, getServerConfiguration } from '../configuration/index.js';
import { emitSecurityAlert, emitSecurityScanCycleComplete } from '../event/index.js';
import logger from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import { fullName } from '../model/container.js';
import * as registry from '../registry/index.js';
import { createConfiguredSbomStorage } from '../security/configured-sbom-storage.js';
import {
  generateImageSbom,
  SECURITY_SBOM_FORMATS,
  scanImageForVulnerabilities,
  updateDigestScanCache,
  verifyImageSignature,
} from '../security/scan.js';
import { createContainerStatsCollector } from '../stats/collector.js';
import * as auditStore from '../store/audit.js';
import * as storeContainer from '../store/container.js';
import * as updateOperationStore from '../store/update-operation.js';
import Trigger from '../triggers/providers/Trigger.js';
import { getErrorMessage } from '../util/error.js';
import { mapComponentsToList } from './component.js';
import { createBulkSecurityHandlers } from './container/bulk-security.js';
import { createCrudHandlers } from './container/crud.js';
import { createLogHandlers } from './container/logs.js';
import { createSecurityHandlers } from './container/security.js';
import {
  getErrorStatusCode,
  redactContainerRuntimeEnv,
  redactContainersRuntimeEnv,
  resolveContainerImageFullName,
  resolveContainerRegistryAuth,
} from './container/shared.js';
import { type ContainerSortMode, sortContainers } from './container/sorting.js';
import { createStatsHandlers } from './container/stats.js';
import { createTriggerHandlers } from './container/triggers.js';
import { updatePolicyHandlers } from './container/update-policy-writer.js';
import { requireDestructiveActionConfirmation } from './destructive-confirmation.js';
import {
  createAuthenticatedRouteRateLimitKeyGenerator,
  isIdentityAwareRateLimitKeyingEnabled,
} from './rate-limit-key.js';
import { DYNAMIC_SCOPE, SESSION_ONLY, scoped } from './route-scopes.js';
import { broadcastScanCompleted, broadcastScanStarted } from './sse.js';

const log = logger.child({ component: 'container' });
const sbomStorage = createConfiguredSbomStorage();

const router = express.Router();
const RECENT_STATUS_AUDIT_LIMIT = 100;

type RecentContainerStatus = 'updated' | 'pending' | 'failed';
type RecentContainerStatusResponse = {
  statuses: Record<string, RecentContainerStatus>;
  statusesByIdentity: Record<string, RecentContainerStatus>;
};

function mapAuditActionToRecentStatus(action: unknown): RecentContainerStatus | null {
  if (action === 'update-applied') return 'updated';
  if (action === 'update-failed') return 'failed';
  if (action === 'update-available') return 'pending';
  return null;
}

function buildRecentStatusResponse(entries: unknown): RecentContainerStatusResponse {
  if (!Array.isArray(entries)) {
    return {
      statuses: {},
      statusesByIdentity: {},
    };
  }

  const statusByContainer: Record<string, RecentContainerStatus> = {};
  const statusByIdentity: Record<string, RecentContainerStatus> = {};
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const mappedStatus = mapAuditActionToRecentStatus((entry as { action?: unknown }).action);
    if (!mappedStatus) continue;

    const containerNameRaw = (entry as { containerName?: unknown }).containerName;
    const containerName = typeof containerNameRaw === 'string' ? containerNameRaw.trim() : '';
    if (containerName && !statusByContainer[containerName]) {
      statusByContainer[containerName] = mappedStatus;
    }

    const containerIdentityKeyRaw = (entry as { containerIdentityKey?: unknown })
      .containerIdentityKey;
    const containerIdentityKey =
      typeof containerIdentityKeyRaw === 'string' ? containerIdentityKeyRaw.trim() : '';
    if (containerIdentityKey && !statusByIdentity[containerIdentityKey]) {
      statusByIdentity[containerIdentityKey] = mappedStatus;
    }
  }
  return {
    statuses: statusByContainer,
    statusesByIdentity: statusByIdentity,
  };
}

function getContainerRecentStatus(_req: Request, res: Response) {
  const recentEntries = auditStore.getRecentEntries(RECENT_STATUS_AUDIT_LIMIT);
  res.status(200).json(buildRecentStatusResponse(recentEntries));
}

/**
 * Return registered watchers.
 * @returns {{id: string}[]}
 */
function getWatchers() {
  return registry.getState().watcher;
}

/**
 * Return registered triggers.
 * @returns {{id: string}[]}
 */
function getTriggers() {
  return registry.getState().trigger;
}

/**
 * Get containers from store.
 * @param query
 * @returns {*}
 */
export function getContainersFromStore(
  query: Record<string, unknown>,
  pagination?: { limit: number; offset: number; sort?: ContainerSortMode },
) {
  if (pagination) {
    const { sort, ...normalizedPagination } = pagination;
    return storeContainer.getContainers(query, {
      ...normalizedPagination,
      ...(sort ? { sort: (containers) => sortContainers(containers, sort) } : {}),
    });
  }
  return storeContainer.getContainers(query);
}

/**
 * Get filtered container count from store.
 * @param query
 * @returns {number}
 */
export function getContainerCountFromStore(query: Record<string, unknown>) {
  return storeContainer.getContainerCount(query);
}

function getContainerImageFullName(container, tagOverride?: string) {
  return resolveContainerImageFullName(container, registry.getState().registry || {}, tagOverride);
}

async function getContainerRegistryAuth(container) {
  return await resolveContainerRegistryAuth(container, registry.getState().registry || {}, {
    log,
    sanitizeLogParam,
  });
}

const crudHandlers = createCrudHandlers({
  storeApi: {
    getContainersFromStore,
    getContainersForStats: storeContainer.getContainersForStats,
    getContainersRawFromStore: storeContainer.getContainersRaw,
    getContainerCountFromStore,
    storeContainer,
    updateOperationStore,
    getContainerRaw: storeContainer.getContainerRaw,
  },
  agentApi: {
    getServerConfiguration,
    getAgent,
    getWatchers,
    getTriggers,
  },
  errorApi: {
    getErrorMessage,
    getErrorStatusCode,
  },
  securityApi: {
    redactContainerRuntimeEnv,
    redactContainersRuntimeEnv,
    auditStore,
  },
});

const triggerHandlers = createTriggerHandlers({
  storeContainer,
  mapComponentsToList: (components) => mapComponentsToList(components, 'trigger'),
  getTriggers,
  Trigger,
  sanitizeLogParam,
  getErrorMessage,
  log,
});

const containerStatsCollector = createContainerStatsCollector({
  getContainerById: (id) => storeContainer.getContainer(id),
  getWatchers: () => registry.getState().watcher || {},
});

const securityHandlers = createSecurityHandlers({
  storeContainer,
  getSecurityConfiguration,
  SECURITY_SBOM_FORMATS,
  generateImageSbom,
  scanImageForVulnerabilities,
  verifyImageSignature,
  emitSecurityAlert,
  emitSecurityScanCycleComplete,
  fullName,
  broadcastScanStarted,
  broadcastScanCompleted,
  redactContainerRuntimeEnv,
  getErrorMessage,
  getContainerImageFullName,
  getContainerRegistryAuth,
  updateDigestScanCache,
  sbomStorage,
  log,
});

const bulkSecurityHandlers = createBulkSecurityHandlers({
  storeContainer: {
    getAllContainers: () => storeContainer.getContainers({}),
    getContainer: (id) => storeContainer.getContainer(id),
    getContainerRaw: (id) => storeContainer.getContainerRaw(id),
    updateContainer: (c, options?) => storeContainer.updateContainer(c, options),
  },
  getSecurityConfiguration,
  scanImageForVulnerabilities,
  emitSecurityAlert,
  emitSecurityScanCycleComplete,
  fullName,
  broadcastScanStarted,
  broadcastScanCompleted,
  getContainerImageFullName,
  getContainerRegistryAuth,
  getErrorMessage,
  updateDigestScanCache,
  log,
});

const logHandlers = createLogHandlers({
  storeContainer,
  getAgent,
  getWatchers,
  getErrorMessage,
});

const statsHandlers = createStatsHandlers({
  storeContainer,
  statsCollector: containerStatsCollector,
});

function getLegacyAggregateStats(_req: Request, res: Response) {
  res.status(410).json({
    error:
      'GET /api/v1/containers/stats has been removed. Use GET /api/v1/stats/summary for aggregate stats or GET /api/v1/containers/:id/stats for per-container stats.',
    migration: {
      aggregate: '/api/v1/stats/summary',
      container: '/api/v1/containers/:id/stats',
    },
  });
}

export const deleteContainer = crudHandlers.deleteContainer;
export const getContainerTriggers = triggerHandlers.getContainerTriggers;

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
  const serverConfiguration = getServerConfiguration() as Record<string, unknown>;
  const identityAwareRateLimitKeyGenerator = createAuthenticatedRouteRateLimitKeyGenerator(
    isIdentityAwareRateLimitKeyingEnabled(serverConfiguration),
  );
  const identityAwareRateLimitOptions = identityAwareRateLimitKeyGenerator
    ? { keyGenerator: identityAwareRateLimitKeyGenerator }
    : {};

  router.use(nocache());
  router.get('/', scoped('read', crudHandlers.getContainers));
  router.post('/watch', scoped('containers:watch', crudHandlers.watchContainers));
  router.get('/summary', scoped('read', crudHandlers.getContainerSummary));
  router.get('/recent-status', scoped('read', getContainerRecentStatus));
  router.get(
    '/security/vulnerabilities',
    scoped('read', crudHandlers.getContainerSecurityVulnerabilities),
  );
  router.post(
    '/scan-all',
    rateLimit({
      windowMs: 60_000,
      max: 1,
      standardHeaders: true,
      legacyHeaders: false,
      validate: { xForwardedForHeader: false },
      message: 'Bulk scan rate limit exceeded. Max 1 per 60 seconds.',
      ...identityAwareRateLimitOptions,
    }),
    scoped('containers:watch', bulkSecurityHandlers.scanAll),
  );
  router.get('/stats', scoped('read', getLegacyAggregateStats));
  router.get('/:id/stats', scoped('read', statsHandlers.getContainerStats));
  router.get('/:id/stats/stream', scoped('read', statsHandlers.streamContainerStats));
  router.get(
    '/:id/intermediate-release-notes',
    scoped('read', crudHandlers.getContainerIntermediateReleaseNotes),
  );
  router.get('/:id/release-notes', scoped('read', crudHandlers.getContainerReleaseNotes));
  router.get('/:id', scoped('read', crudHandlers.getContainer));
  router.get('/:id/update-operations', scoped('read', crudHandlers.getContainerUpdateOperations));
  router.delete(
    '/:id',
    requireDestructiveActionConfirmation('container-delete'),
    scoped('admin', crudHandlers.deleteContainer),
  );
  router.get('/:id/triggers', scoped('read', triggerHandlers.getContainerTriggers));
  // The one route whose required scope depends on a path parameter: a
  // docker/dockercompose trigger needs containers:update, a notification
  // trigger needs triggers:test. Resolved in the handler, not here.
  router.post(
    '/:id/triggers/:triggerType/:triggerName',
    scoped(DYNAMIC_SCOPE, triggerHandlers.runTrigger),
  );
  router.post(
    '/:id/triggers/:triggerType/:triggerName/:triggerAgent',
    scoped(DYNAMIC_SCOPE, triggerHandlers.runTrigger),
  );
  router.patch(
    '/:id/update-policy',
    scoped('containers:update', updatePolicyHandlers.patchContainerUpdatePolicy),
  );
  router.post('/:id/watch', scoped('containers:watch', crudHandlers.watchContainer));
  router.get('/:id/vulnerabilities', scoped('read', securityHandlers.getContainerVulnerabilities));
  router.get('/:id/sbom', scoped('read', securityHandlers.getContainerSbom));
  router.post(
    '/:id/env/reveal',
    rateLimit({
      windowMs: 60_000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      validate: { xForwardedForHeader: false },
      ...identityAwareRateLimitOptions,
    }),
    scoped(SESSION_ONLY, crudHandlers.revealContainerEnv),
  );
  router.post(
    '/:id/scan',
    rateLimit({
      windowMs: 60_000,
      max: 30,
      standardHeaders: true,
      legacyHeaders: false,
      validate: { xForwardedForHeader: false },
      ...identityAwareRateLimitOptions,
    }),
    scoped('containers:watch', securityHandlers.scanContainer),
  );
  router.get('/:id/logs', scoped('read', logHandlers.getContainerLogs));
  return router;
}
