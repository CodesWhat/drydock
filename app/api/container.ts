// @ts-nocheck
import express from 'express';
import nocache from 'nocache';
import rateLimit from 'express-rate-limit';
import { getAgent } from '../agent/manager.js';
import { getSecurityConfiguration, getServerConfiguration } from '../configuration/index.js';
import logger from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import * as registry from '../registry/index.js';
import {
  generateImageSbom,
  SECURITY_SBOM_FORMATS,
  type SecuritySbomFormat,
  scanImageForVulnerabilities,
  verifyImageSignature,
} from '../security/scan.js';
import * as storeContainer from '../store/container.js';
import Trigger from '../triggers/providers/Trigger.js';
import { mapComponentsToList } from './component.js';
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

function uniqStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string'))];
}

function normalizeUpdatePolicy(updatePolicy = {}) {
  const normalizedPolicy = {};

  if (Array.isArray(updatePolicy.skipTags)) {
    const skipTags = uniqStrings(updatePolicy.skipTags);
    if (skipTags.length > 0) {
      normalizedPolicy.skipTags = skipTags;
    }
  }

  if (Array.isArray(updatePolicy.skipDigests)) {
    const skipDigests = uniqStrings(updatePolicy.skipDigests);
    if (skipDigests.length > 0) {
      normalizedPolicy.skipDigests = skipDigests;
    }
  }

  if (updatePolicy.snoozeUntil) {
    const snoozeUntil = new Date(updatePolicy.snoozeUntil);
    if (!Number.isNaN(snoozeUntil.getTime())) {
      normalizedPolicy.snoozeUntil = snoozeUntil.toISOString();
    }
  }

  return normalizedPolicy;
}

function getCurrentUpdateValue(container, kind) {
  if (kind === 'tag') {
    return container.updateKind?.remoteValue || container.result?.tag;
  }
  if (kind === 'digest') {
    return container.updateKind?.remoteValue || container.result?.digest;
  }
  return undefined;
}

function getSnoozeUntilFromActionPayload(payload = {}) {
  if (payload.snoozeUntil) {
    const customDate = new Date(payload.snoozeUntil);
    if (Number.isNaN(customDate.getTime())) {
      throw new TypeError('Invalid snoozeUntil date');
    }
    return customDate.toISOString();
  }
  const days = Number(payload.days ?? 7);
  if (!Number.isFinite(days) || days <= 0 || days > 365) {
    throw new Error('Invalid snooze days value');
  }
  const snoozeUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return snoozeUntil.toISOString();
}

/**
 * Get all (filtered) containers.
 * @param req
 * @param res
 */
function getContainers(req, res) {
  const { query } = req;
  res.status(200).json(getContainersFromStore(query));
}

/**
 * Get a container by id.
 * @param req
 * @param res
 */
function getContainer(req, res) {
  const { id } = req.params;
  const container = storeContainer.getContainer(id);
  if (container) {
    res.status(200).json(container);
  } else {
    res.sendStatus(404);
  }
}

function getEmptyVulnerabilityResponse() {
  return {
    scanner: undefined,
    scannedAt: undefined,
    status: 'not-scanned',
    blockSeverities: [],
    blockingCount: 0,
    summary: {
      unknown: 0,
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    },
    vulnerabilities: [],
  };
}

function resolveSbomFormat(rawFormat: unknown): SecuritySbomFormat | undefined {
  const format = `${rawFormat || 'spdx-json'}`.toLowerCase();
  if (SECURITY_SBOM_FORMATS.includes(format as SecuritySbomFormat)) {
    return format as SecuritySbomFormat;
  }
  return undefined;
}

function getContainerImageFullName(container, tagOverride?: string) {
  const tag = tagOverride || container.image.tag.value;
  const registryState = registry.getState().registry || {};
  const containerRegistry = registryState[container.image.registry.name];
  if (containerRegistry && typeof containerRegistry.getImageFullName === 'function') {
    return containerRegistry.getImageFullName(container.image, tag);
  }
  return `${container.image.registry.url}/${container.image.name}:${tag}`;
}

async function getContainerRegistryAuth(container) {
  try {
    const registryState = registry.getState().registry || {};
    const containerRegistry = registryState[container.image.registry.name];
    if (containerRegistry && typeof containerRegistry.getAuthPull === 'function') {
      return await containerRegistry.getAuthPull();
    }
  } catch (e: any) {
    log.warn(
      `Unable to retrieve registry auth for SBOM generation (container=${sanitizeLogParam(
        container.id,
      )}): ${sanitizeLogParam(e.message)}`,
    );
  }
  return undefined;
}

/**
 * Get latest vulnerability scan result for a container.
 * @param req
 * @param res
 */
export function getContainerVulnerabilities(req, res) {
  const { id } = req.params;
  const container = storeContainer.getContainer(id);
  if (!container) {
    res.sendStatus(404);
    return;
  }
  if (!container.security?.scan) {
    res.status(200).json(getEmptyVulnerabilityResponse());
    return;
  }
  res.status(200).json(container.security.scan);
}

export async function getContainerSbom(req, res) {
  const { id } = req.params;
  const sbomFormat = resolveSbomFormat(req.query.format);
  if (!sbomFormat) {
    res.status(400).json({
      error: `Unsupported SBOM format. Supported values: ${SECURITY_SBOM_FORMATS.join(', ')}`,
    });
    return;
  }

  const container = storeContainer.getContainer(id);
  if (!container) {
    res.sendStatus(404);
    return;
  }

  const existingSbom = container.security?.sbom;
  const existingSbomDocument = existingSbom?.documents?.[sbomFormat];
  if (existingSbom?.status === 'generated' && existingSbomDocument) {
    res.status(200).json({
      generator: existingSbom.generator,
      image: existingSbom.image,
      generatedAt: existingSbom.generatedAt,
      format: sbomFormat,
      document: existingSbomDocument,
      error: existingSbom.error,
    });
    return;
  }

  try {
    const image = getContainerImageFullName(container);
    const auth = await getContainerRegistryAuth(container);
    const sbomResult = await generateImageSbom({
      image,
      auth,
      formats: [sbomFormat],
    });
    const existingSbomState = container.security?.sbom;
    const containerToStore = {
      ...container,
      security: {
        ...(container.security || {}),
        sbom: {
          ...existingSbomState,
          ...sbomResult,
          documents: {
            ...(existingSbomState?.documents || {}),
            ...sbomResult.documents,
          },
        },
      },
    };
    storeContainer.updateContainer(containerToStore);

    const generatedDocument = sbomResult.documents?.[sbomFormat];
    if (sbomResult.status !== 'generated' || !generatedDocument) {
      res.status(500).json({
        error: `Error generating SBOM (${sbomResult.error || 'unknown SBOM error'})`,
      });
      return;
    }

    res.status(200).json({
      generator: sbomResult.generator,
      image: sbomResult.image,
      generatedAt: sbomResult.generatedAt,
      format: sbomFormat,
      document: generatedDocument,
      error: sbomResult.error,
    });
  } catch (e: any) {
    res.status(500).json({
      error: `Error generating SBOM (${e.message})`,
    });
  }
}

/**
 * Delete a container by id.
 * @param req
 * @param res
 */
export async function deleteContainer(req, res) {
  const serverConfiguration = getServerConfiguration();
  if (!serverConfiguration.feature.delete) {
    res.sendStatus(403);
    return;
  }

  const { id } = req.params;
  const container = storeContainer.getContainer(id);
  if (!container) {
    res.sendStatus(404);
    return;
  }

  if (!container.agent) {
    storeContainer.deleteContainer(id);
    res.sendStatus(204);
    return;
  }

  const agent = getAgent(container.agent);
  if (!agent) {
    res.status(500).json({
      error: `Agent ${container.agent} not found`,
    });
    return;
  }

  try {
    await agent.deleteContainer(id);
    storeContainer.deleteContainer(id);
    res.sendStatus(204);
  } catch (e) {
    if (e.response?.status === 404) {
      storeContainer.deleteContainer(id);
      res.sendStatus(204);
    } else {
      res.status(500).json({
        error: `Error deleting container on agent (${e.message})`,
      });
    }
  }
}

/**
 * Watch all containers.
 * @param req
 * @param res
 * @returns {Promise<void>}
 */
async function watchContainers(req, res) {
  try {
    await Promise.all(Object.values(getWatchers()).map((watcher) => watcher.watch()));
    getContainers(req, res);
  } catch (e) {
    res.status(500).json({
      error: `Error when watching images (${e.message})`,
    });
  }
}

function parseTriggerList(triggerString) {
  if (!triggerString) {
    return undefined;
  }
  return triggerString
    .split(',')
    .map((entry) => entry.trim())
    .map((entry) => Trigger.parseIncludeOrIncludeTriggerString(entry));
}

function isTriggerAgentCompatible(trigger, container) {
  if (trigger.agent && trigger.agent !== container.agent) {
    return false;
  }
  if (container.agent && !trigger.agent && ['docker', 'dockercompose'].includes(trigger.type)) {
    return false;
  }
  return true;
}

function resolveTriggerAssociation(trigger, includedTriggers, excludedTriggers) {
  const triggerId = `${trigger.type}.${trigger.name}`;
  const triggerToAssociate = { ...trigger };

  if (includedTriggers) {
    const includedTrigger = includedTriggers.find((tr) =>
      Trigger.doesReferenceMatchId(tr.id, triggerId),
    );
    if (!includedTrigger) {
      return undefined;
    }
    triggerToAssociate.configuration.threshold = includedTrigger.threshold;
  }

  if (
    excludedTriggers?.some((excludedTrigger) =>
      Trigger.doesReferenceMatchId(excludedTrigger.id, triggerId),
    )
  ) {
    return undefined;
  }

  return triggerToAssociate;
}

export async function getContainerTriggers(req, res) {
  const { id } = req.params;

  const container = storeContainer.getContainer(id);
  if (!container) {
    res.sendStatus(404);
    return;
  }

  const allTriggers = mapComponentsToList(getTriggers());
  const includedTriggers = parseTriggerList(container.triggerInclude);
  const excludedTriggers = parseTriggerList(container.triggerExclude);

  const associatedTriggers = allTriggers
    .filter((trigger) => isTriggerAgentCompatible(trigger, container))
    .map((trigger) => resolveTriggerAssociation(trigger, includedTriggers, excludedTriggers))
    .filter((trigger) => trigger !== undefined);

  res.status(200).json(associatedTriggers);
}

/**
 * Run trigger.
 * @param {*} req
 * @param {*} res
 */
async function runTrigger(req, res) {
  const { id, triggerAgent, triggerType, triggerName } = req.params;

  const containerToTrigger = storeContainer.getContainer(id);
  const triggerId = triggerAgent
    ? `${triggerAgent}.${triggerType}.${triggerName}`
    : `${triggerType}.${triggerName}`;
  if (containerToTrigger) {
    if (
      containerToTrigger.agent &&
      !triggerAgent &&
      ['docker', 'dockercompose'].includes(triggerType)
    ) {
      res.status(400).json({
        error: `Cannot execute local ${triggerType} trigger on remote container ${containerToTrigger.agent}.${containerToTrigger.id}`,
      });
      return;
    }
    const triggerToRun = getTriggers()[triggerId];
    if (triggerToRun) {
      try {
        await triggerToRun.trigger(containerToTrigger);
        log.info(
          `Trigger executed with success (type=${sanitizeLogParam(triggerType)}, name=${sanitizeLogParam(triggerName)}, container=${sanitizeLogParam(JSON.stringify(containerToTrigger), 500)})`,
        );
        res.status(200).json({});
      } catch (e) {
        log.warn(
          `Error when running trigger (type=${sanitizeLogParam(triggerType)}, name=${sanitizeLogParam(triggerName)}) (${sanitizeLogParam(e.message)})`,
        );
        res.status(500).json({
          error: `Error when running trigger (type=${triggerType}, name=${triggerName}) (${e.message})`,
        });
      }
    } else {
      res.status(404).json({
        error: 'Trigger not found',
      });
    }
  } else {
    res.status(404).json({
      error: 'Container not found',
    });
  }
}

/**
 * Watch an image.
 * @param req
 * @param res
 * @returns {Promise<void>}
 */
async function watchContainer(req, res) {
  const { id } = req.params;

  const container = storeContainer.getContainer(id);
  if (!container) {
    res.sendStatus(404);
    return;
  }

  let watcherId = `docker.${container.watcher}`;
  if (container.agent) {
    watcherId = `${container.agent}.${watcherId}`;
  }
  const watcher = getWatchers()[watcherId];
  if (!watcher) {
    res.status(500).json({
      error: `No provider found for container ${id} and provider ${watcherId}`,
    });
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
        res.status(404).send();
        return;
      }
    }
    // Run watchContainer from the Provider
    const containerReport = await watcher.watchContainer(container);
    res.status(200).json(containerReport.container);
  } catch (e) {
    res.status(500).json({
      error: `Error when watching container ${id} (${e.message})`,
    });
  }
}

/**
 * Update container update policy (skip/snooze controls).
 * @param req
 * @param res
 */
function applySkipCurrentAction(container, updatePolicy) {
  const updateKind = container.updateKind?.kind;
  const updateValue = getCurrentUpdateValue(container, updateKind);
  if (!['tag', 'digest'].includes(updateKind)) {
    return { error: 'No current update available to skip' };
  }
  if (!updateValue) {
    return { error: 'No update value available to skip' };
  }
  if (updateKind === 'tag') {
    updatePolicy.skipTags = uniqStrings([...(updatePolicy.skipTags || []), updateValue]);
  } else {
    updatePolicy.skipDigests = uniqStrings([...(updatePolicy.skipDigests || []), updateValue]);
  }
  return { policy: updatePolicy };
}

function applyPolicyAction(action, container, updatePolicy, body = {}) {
  switch (action) {
    case 'skip-current':
      return applySkipCurrentAction(container, updatePolicy);
    case 'clear-skips':
      delete updatePolicy.skipTags;
      delete updatePolicy.skipDigests;
      return { policy: updatePolicy };
    case 'snooze':
      updatePolicy.snoozeUntil = getSnoozeUntilFromActionPayload(body);
      return { policy: updatePolicy };
    case 'unsnooze':
      delete updatePolicy.snoozeUntil;
      return { policy: updatePolicy };
    case 'clear':
      return { policy: {} };
    default:
      return { error: `Unknown action ${action}` };
  }
}

function patchContainerUpdatePolicy(req, res) {
  const { id } = req.params;
  const { action } = req.body || {};
  const container = storeContainer.getContainer(id);

  if (!container) {
    res.sendStatus(404);
    return;
  }

  if (!action) {
    res.status(400).json({ error: 'Action is required' });
    return;
  }

  try {
    let updatePolicy = normalizeUpdatePolicy(container.updatePolicy || {});
    const result = applyPolicyAction(action, container, updatePolicy, req.body);

    if (result.error) {
      res.status(400).json({ error: result.error });
      return;
    }

    updatePolicy = normalizeUpdatePolicy(result.policy);
    container.updatePolicy = Object.keys(updatePolicy).length > 0 ? updatePolicy : undefined;
    const containerUpdated = storeContainer.updateContainer(container);
    res.status(200).json(containerUpdated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

/**
 * Demultiplex Docker stream output.
 * Docker uses an 8-byte header per frame: [streamType(1), padding(3), size(4BE)].
 * This strips those headers and returns the raw log text.
 */
function demuxDockerStream(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const lines = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset + 4);
    offset += 8;
    if (offset + size > buf.length) break;
    lines.push(buf.subarray(offset, offset + size).toString('utf-8'));
    offset += size;
  }
  return lines.join('');
}

/**
 * Get container logs.
 * @param req
 * @param res
 */
async function getContainerLogs(req, res) {
  const { id } = req.params;
  const container = storeContainer.getContainer(id);
  if (!container) {
    res.sendStatus(404);
    return;
  }

  const tail = Number.parseInt(req.query.tail, 10) || 100;
  const since = Number.parseInt(req.query.since, 10) || 0;
  const timestamps = req.query.timestamps !== 'false';

  if (container.agent) {
    try {
      const agent = getAgent(container.agent);
      if (!agent) {
        res.status(500).json({
          error: `Agent ${container.agent} not found`,
        });
        return;
      }
      const result = await agent.getContainerLogs(id, { tail, since, timestamps });
      res.status(200).json(result);
    } catch (e) {
      res.status(500).json({
        error: `Error fetching logs from agent (${e.message})`,
      });
    }
    return;
  }

  const watcherId = `docker.${container.watcher}`;
  const watcher = getWatchers()[watcherId];
  if (!watcher) {
    res.status(500).json({
      error: `No watcher found for container ${id}`,
    });
    return;
  }

  try {
    const logsBuffer = await watcher.dockerApi
      .getContainer(container.name)
      .logs({ stdout: true, stderr: true, tail, since, timestamps, follow: false });
    const logs = demuxDockerStream(logsBuffer);
    res.status(200).json({ logs });
  } catch (e) {
    res.status(500).json({
      error: `Error fetching container logs (${e.message})`,
    });
  }
}

async function scanContainer(req, res) {
  const { id } = req.params;
  const container = storeContainer.getContainer(id);
  if (!container) {
    res.sendStatus(404);
    return;
  }

  const securityConfiguration = getSecurityConfiguration();
  if (!securityConfiguration.enabled || securityConfiguration.scanner !== 'trivy') {
    res.status(400).json({ error: 'Security scanner is not configured' });
    return;
  }

  broadcastScanStarted(id);

  try {
    const updateTag = container.updateKind?.remoteValue;
    const image = getContainerImageFullName(container, updateTag);
    log.info(`Running on-demand security scan for ${image}`);
    const auth = await getContainerRegistryAuth(container);
    const securityPatch: Record<string, any> = {};

    // Run vulnerability scan
    const scanResult = await scanImageForVulnerabilities({ image, auth });
    securityPatch.scan = scanResult;

    // Run signature verification if configured
    if (securityConfiguration.signature.verify) {
      const signatureResult = await verifyImageSignature({ image, auth });
      securityPatch.signature = signatureResult;
    }

    // Generate SBOM if configured
    if (securityConfiguration.sbom.enabled) {
      const sbomResult = await generateImageSbom({
        image,
        auth,
        formats: securityConfiguration.sbom.formats,
      });
      securityPatch.sbom = sbomResult;
    }

    // Persist results
    const containerToStore = {
      ...container,
      security: {
        ...(container.security || {}),
        ...securityPatch,
      },
    };
    const updatedContainer = storeContainer.updateContainer(containerToStore);

    broadcastScanCompleted(id, scanResult.status);
    res.status(200).json(updatedContainer);
  } catch (e: any) {
    broadcastScanCompleted(id, 'error');
    res.status(500).json({
      error: `Security scan failed (${e.message})`,
    });
  }
}

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
  router.use(nocache());
  router.get('/', getContainers);
  router.post('/watch', watchContainers);
  router.get('/:id', getContainer);
  router.delete('/:id', deleteContainer);
  router.get('/:id/triggers', getContainerTriggers);
  router.post('/:id/triggers/:triggerType/:triggerName', runTrigger);
  router.post('/:id/triggers/:triggerAgent/:triggerType/:triggerName', runTrigger);
  router.patch('/:id/update-policy', patchContainerUpdatePolicy);
  router.post('/:id/watch', watchContainer);
  router.get('/:id/vulnerabilities', getContainerVulnerabilities);
  router.get('/:id/sbom', getContainerSbom);
  router.post(
    '/:id/scan',
    rateLimit({
      windowMs: 60_000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
      validate: { xForwardedForHeader: false },
    }),
    scanContainer,
  );
  router.get('/:id/logs', getContainerLogs);
  return router;
}
