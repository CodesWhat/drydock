import os from 'node:os';
import type { Request, Response } from 'express';
import { getVersion } from '../../configuration/index.js';
import * as event from '../../event/index.js';
import logger from '../../log/index.js';
import { sanitizeLogParam } from '../../log/sanitize.js';
import * as storeContainer from '../../store/container.js';
import { getContainerStatusSummary } from '../../util/container-summary.js';

const log = logger.child({ component: 'agent-api-event' });

interface SseClient {
  id: number;
  res: Response;
}

interface ContainerSummary {
  containers: {
    total: number;
    running: number;
    stopped: number;
  };
  images: number;
}

interface ContainerSummaryCache {
  summary: ContainerSummary;
  expiresAtMs: number;
}

interface ContainerImageLike {
  id?: unknown;
  name?: unknown;
}

interface ContainerLike {
  id?: unknown;
  image?: ContainerImageLike;
}

const CONTAINER_SUMMARY_CACHE_TTL_MS = 2_000;

interface RuntimeEnvEntry {
  key: string;
  value: string;
}

// SSE Clients
let sseClients: SseClient[] = [];
let nextSseClientId = 0;
let containerSummaryCache: ContainerSummaryCache | undefined;

function allocateSseClientId(): number {
  if (nextSseClientId >= Number.MAX_SAFE_INTEGER) {
    nextSseClientId = 0;
  }
  nextSseClientId += 1;
  return nextSseClientId;
}

/**
 * Send SSE event to all clients.
 * @param eventName
 * @param data
 */
function sendSseEvent(eventName: string, data: unknown) {
  const message = {
    type: eventName,
    data: data,
  };
  const payload = JSON.stringify(message);
  sseClients.forEach((client) => {
    client.res.write(`data: ${payload}\n\n`);
  });
}

function toAgentRuntimeEnvEntries(env: unknown): RuntimeEnvEntry[] | undefined {
  if (!Array.isArray(env)) {
    return undefined;
  }

  return env
    .filter(
      (entry): entry is RuntimeEnvEntry =>
        !!entry &&
        typeof entry === 'object' &&
        typeof (entry as { key?: unknown }).key === 'string' &&
        typeof (entry as { value?: unknown }).value === 'string',
    )
    .map((entry) => ({
      key: entry.key,
      value: entry.value,
    }));
}

function sanitizeContainerDetailsForAgentSse(details: unknown): unknown {
  if (!details || typeof details !== 'object') {
    return details;
  }

  const detailsWithEnv = details as { env?: unknown };
  const env = toAgentRuntimeEnvEntries(detailsWithEnv.env);
  if (!env) {
    return details;
  }

  return {
    ...detailsWithEnv,
    env,
  };
}

function sanitizeContainerLifecyclePayloadForAgentSse(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const payloadWithDetails = payload as Record<string, unknown>;
  if (!Object.hasOwn(payloadWithDetails, 'details')) {
    return payload;
  }

  return {
    ...payloadWithDetails,
    details: sanitizeContainerDetailsForAgentSse(payloadWithDetails.details),
  };
}

function getAgentContainerSsePayload(payload: unknown): unknown {
  const containerId =
    payload && typeof payload === 'object' && typeof (payload as { id?: unknown }).id === 'string'
      ? ((payload as { id: string }).id as string)
      : undefined;
  if (containerId) {
    const containerRaw = storeContainer.getContainerRaw(containerId);
    if (containerRaw) {
      return containerRaw;
    }
  }
  return sanitizeContainerLifecyclePayloadForAgentSse(payload);
}

function sanitizeWatcherSnapshotPayloadForAgentSse(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const snapshotPayload = payload as {
    watcher?: unknown;
    containers?: unknown;
  };
  const containers = Array.isArray(snapshotPayload.containers)
    ? snapshotPayload.containers.map((container) => getAgentContainerSsePayload(container))
    : [];

  return {
    watcher: snapshotPayload.watcher,
    containers,
  };
}

function sanitizeSecurityAlertPayloadForAgentSse(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const securityAlertPayload = payload as Record<string, unknown>;
  return {
    containerName: securityAlertPayload.containerName,
    details: securityAlertPayload.details,
    status: securityAlertPayload.status,
    summary: securityAlertPayload.summary,
    blockingCount: securityAlertPayload.blockingCount,
    cycleId: securityAlertPayload.cycleId,
  };
}

function sanitizeSecurityScanCycleCompletePayloadForAgentSse(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }
  const p = payload as Record<string, unknown>;
  return {
    cycleId: p.cycleId,
    scannedCount: p.scannedCount,
    alertCount: p.alertCount,
    startedAt: p.startedAt,
    completedAt: p.completedAt,
  };
}

function computeContainerSummary(): ContainerSummary {
  const containers = storeContainer.getContainers();
  const containerStatus = getContainerStatusSummary(containers);
  const images = new Set(
    containers.map(
      (container: ContainerLike) => container.image?.id ?? container.image?.name ?? container.id,
    ),
  ).size;
  return {
    containers: containerStatus,
    images,
  };
}

function getContainerSummary(nowMs: number = Date.now()): ContainerSummary {
  if (containerSummaryCache && containerSummaryCache.expiresAtMs > nowMs) {
    return containerSummaryCache.summary;
  }

  const summary = computeContainerSummary();
  containerSummaryCache = {
    summary,
    expiresAtMs: nowMs + CONTAINER_SUMMARY_CACHE_TTL_MS,
  };
  return summary;
}

function getAckPayloadData() {
  const summary = getContainerSummary();
  return {
    version: getVersion(),
    os: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().length,
    memoryGb: Number((os.totalmem() / 1024 / 1024 / 1024).toFixed(1)),
    uptimeSeconds: Math.floor(process.uptime()),
    lastSeen: new Date().toISOString(),
    ...summary,
  };
}

/**
 * Subscribe to Events (SSE).
 */
export function subscribeEvents(req: Request, res: Response) {
  log.info(`Controller drydock with ip ${sanitizeLogParam(req.ip)} connected.`);

  const headers = {
    'Content-Type': 'text/event-stream',
    Connection: 'keep-alive',
    'Cache-Control': 'no-cache',
  };
  res.writeHead(200, headers);

  const client: SseClient = {
    id: allocateSseClientId(),
    res,
  };
  sseClients.push(client);

  // Send Welcome / Ack
  const ackMessage = {
    type: 'dd:ack',
    data: getAckPayloadData(),
  };
  client.res.write(`data: ${JSON.stringify(ackMessage)}\n\n`);

  req.on('close', () => {
    log.info(`Controller drydock with ip ${sanitizeLogParam(req.ip)} disconnected.`);
    sseClients = sseClients.filter((c) => c.id !== client.id);
  });
}

/**
 * Initialize event listeners.
 */
export function initEvents() {
  event.registerContainerAdded((container: event.ContainerLifecycleEventPayload) =>
    sendSseEvent('dd:container-added', getAgentContainerSsePayload(container)),
  );
  event.registerContainerUpdated((container: event.ContainerLifecycleEventPayload) =>
    sendSseEvent('dd:container-updated', getAgentContainerSsePayload(container)),
  );
  event.registerContainerRemoved((container: event.ContainerLifecycleEventPayload) =>
    sendSseEvent('dd:container-removed', { id: container.id }),
  );
  event.registerWatcherSnapshot((payload: event.WatcherSnapshotEventPayload) =>
    sendSseEvent('dd:watcher-snapshot', sanitizeWatcherSnapshotPayloadForAgentSse(payload)),
  );
  event.registerContainerUpdateApplied((payload: event.ContainerUpdateAppliedEvent) =>
    sendSseEvent('dd:update-applied', payload),
  );
  event.registerContainerUpdateFailed((payload: event.ContainerUpdateFailedEventPayload) =>
    sendSseEvent('dd:update-failed', payload),
  );
  event.registerSecurityAlert((payload: event.SecurityAlertEventPayload) =>
    sendSseEvent('dd:security-alert', sanitizeSecurityAlertPayloadForAgentSse(payload)),
  );
  event.registerSecurityScanCycleComplete((payload: event.SecurityScanCycleCompleteEventPayload) =>
    sendSseEvent(
      'dd:security-scan-cycle-complete',
      sanitizeSecurityScanCycleCompletePayloadForAgentSse(payload),
    ),
  );
}

export function _setNextSseClientIdForTests(value: number): void {
  nextSseClientId = value;
}

export function _resetAgentEventStateForTests(): void {
  sseClients = [];
  nextSseClientId = 0;
  containerSummaryCache = undefined;
}
