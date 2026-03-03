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
  verifyImageSignature,
} from '../security/scan.js';
import * as storeContainer from '../store/container.js';
import * as updateOperationStore from '../store/update-operation.js';
import Trigger from '../triggers/providers/Trigger.js';
import { uniqStrings } from '../util/string-array.js';
import { mapComponentsToList } from './component.js';
import { createCrudHandlers } from './container/crud.js';
import { createLogHandlers } from './container/logs.js';
import { createSecurityHandlers } from './container/security.js';
import {
  getErrorMessage,
  getErrorStatusCode,
  redactContainerRuntimeEnv,
  redactContainersRuntimeEnv,
  resolveContainerImageFullName,
  resolveContainerRegistryAuth,
} from './container/shared.js';
import { createTriggerHandlers } from './container/triggers.js';
import { createUpdatePolicyHandlers } from './container/update-policy.js';
import { broadcastScanCompleted, broadcastScanStarted } from './sse.js';

const log = logger.child({ component: 'container' });

const router = express.Router();

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
export function getContainersFromStore(query) {
  return storeContainer.getContainers(query);
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
  getContainersFromStore,
  storeContainer,
  updateOperationStore,
  getServerConfiguration,
  getAgent,
  getErrorMessage,
  getErrorStatusCode,
  getWatchers,
  redactContainerRuntimeEnv,
  redactContainersRuntimeEnv,
});

const triggerHandlers = createTriggerHandlers({
  storeContainer,
  mapComponentsToList,
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
export const getContainerVulnerabilities = securityHandlers.getContainerVulnerabilities;
export const getContainerSbom = securityHandlers.getContainerSbom;

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
  router.use(nocache());
  router.get('/', crudHandlers.getContainers);
  router.post('/watch', crudHandlers.watchContainers);
  router.get('/:id', crudHandlers.getContainer);
  router.get('/:id/update-operations', crudHandlers.getContainerUpdateOperations);
  router.delete('/:id', crudHandlers.deleteContainer);
  router.get('/:id/triggers', triggerHandlers.getContainerTriggers);
  router.post('/:id/triggers/:triggerType/:triggerName', triggerHandlers.runTrigger);
  router.post('/:id/triggers/:triggerAgent/:triggerType/:triggerName', triggerHandlers.runTrigger);
  router.patch('/:id/update-policy', updatePolicyHandlers.patchContainerUpdatePolicy);
  router.post('/:id/watch', crudHandlers.watchContainer);
  router.get('/:id/vulnerabilities', securityHandlers.getContainerVulnerabilities);
  router.get('/:id/sbom', securityHandlers.getContainerSbom);
  router.post(
    '/:id/scan',
    rateLimit({
      windowMs: 60_000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
      validate: { xForwardedForHeader: false },
    }),
    securityHandlers.scanContainer,
  );
  router.get('/:id/logs', logHandlers.getContainerLogs);
  return router;
}
