import type { Request, Response } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import nocache from 'nocache';
import { getAgent } from '../agent/manager.js';
import { getSecurityConfiguration, getServerConfiguration } from '../configuration/index.js';
import { emitSecurityAlert } from '../event/index.js';
import logger from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import { fullName } from '../model/container.js';
import * as registry from '../registry/index.js';
import {
  generateImageSbom,
  SECURITY_SBOM_FORMATS,
  scanImageForVulnerabilities,
  updateDigestScanCache,
  verifyImageSignature,
} from '../security/scan.js';
import * as auditStore from '../store/audit.js';
import * as storeContainer from '../store/container.js';
import * as updateOperationStore from '../store/update-operation.js';
import Trigger from '../triggers/providers/Trigger.js';
import { getErrorMessage } from '../util/error.js';
import { uniqStrings } from '../util/string-array.js';
import { mapComponentsToList } from './component.js';
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
import { createTriggerHandlers } from './container/triggers.js';
import { createUpdatePolicyHandlers } from './container/update-policy.js';
import { requireDestructiveActionConfirmation } from './destructive-confirmation.js';
import {
  createAuthenticatedRouteRateLimitKeyGenerator,
  isIdentityAwareRateLimitKeyingEnabled,
} from './rate-limit-key.js';
import { broadcastScanCompleted, broadcastScanStarted } from './sse.js';

const log = logger.child({ component: 'container' });

const router = express.Router();
const RECENT_STATUS_AUDIT_LIMIT = 100;

type RecentContainerStatus = 'updated' | 'pending' | 'failed';

function mapAuditActionToRecentStatus(action: unknown): RecentContainerStatus | null {
  if (action === 'update-applied') return 'updated';
  if (action === 'update-failed') return 'failed';
  if (action === 'update-available') return 'pending';
  return null;
}

function buildRecentStatusByContainer(entries: unknown): Record<string, RecentContainerStatus> {
  if (!Array.isArray(entries)) return {};
  const statusByContainer: Record<string, RecentContainerStatus> = {};
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const containerNameRaw = (entry as { containerName?: unknown }).containerName;
    const containerName = typeof containerNameRaw === 'string' ? containerNameRaw.trim() : '';
    if (!containerName || statusByContainer[containerName]) continue;
    const mappedStatus = mapAuditActionToRecentStatus((entry as { action?: unknown }).action);
    if (!mappedStatus) continue;
    statusByContainer[containerName] = mappedStatus;
  }
  return statusByContainer;
}

function getContainerRecentStatus(_req: Request, res: Response) {
  const recentEntries = auditStore.getRecentEntries(RECENT_STATUS_AUDIT_LIMIT);
  res.status(200).json({
    statuses: buildRecentStatusByContainer(recentEntries),
  });
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
  pagination?: { limit: number; offset: number },
) {
  if (pagination) {
    return storeContainer.getContainers(query, pagination);
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
    getContainerCountFromStore,
    storeContainer,
    updateOperationStore,
    getContainerRaw: storeContainer.getContainerRaw,
  },
  agentApi: {
    getServerConfiguration,
    getAgent,
    getWatchers,
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

const updatePolicyHandlers = createUpdatePolicyHandlers({
  storeContainer,
  uniqStrings,
  getErrorMessage,
  redactContainerRuntimeEnv,
});

const securityHandlers = createSecurityHandlers({
  storeContainer,
  getSecurityConfiguration,
  SECURITY_SBOM_FORMATS,
  generateImageSbom,
  scanImageForVulnerabilities,
  verifyImageSignature,
  emitSecurityAlert,
  fullName,
  broadcastScanStarted,
  broadcastScanCompleted,
  redactContainerRuntimeEnv,
  getErrorMessage,
  getContainerImageFullName,
  getContainerRegistryAuth,
  updateDigestScanCache,
  log,
});

const logHandlers = createLogHandlers({
  storeContainer,
  getAgent,
  getWatchers,
  getErrorMessage,
});

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
  router.get('/', crudHandlers.getContainers);
  router.post('/watch', crudHandlers.watchContainers);
  router.get('/summary', crudHandlers.getContainerSummary);
  router.get('/recent-status', getContainerRecentStatus);
  router.get('/security/vulnerabilities', crudHandlers.getContainerSecurityVulnerabilities);
  router.get('/:id', crudHandlers.getContainer);
  router.get('/:id/update-operations', crudHandlers.getContainerUpdateOperations);
  router.delete(
    '/:id',
    requireDestructiveActionConfirmation('container-delete'),
    crudHandlers.deleteContainer,
  );
  router.get('/:id/triggers', triggerHandlers.getContainerTriggers);
  router.post('/:id/triggers/:triggerType/:triggerName', triggerHandlers.runTrigger);
  router.post('/:id/triggers/:triggerType/:triggerName/:triggerAgent', triggerHandlers.runTrigger);
  router.patch('/:id/update-policy', updatePolicyHandlers.patchContainerUpdatePolicy);
  router.post('/:id/watch', crudHandlers.watchContainer);
  router.get('/:id/vulnerabilities', securityHandlers.getContainerVulnerabilities);
  router.get('/:id/sbom', securityHandlers.getContainerSbom);
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
    crudHandlers.revealContainerEnv,
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
    securityHandlers.scanContainer,
  );
  router.get('/:id/logs', logHandlers.getContainerLogs);
  return router;
}
