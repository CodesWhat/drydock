import os from 'node:os';
import type { Request, Response } from 'express';
import { getLogLevel, getVersion } from '../../configuration/index.js';
import * as event from '../../event/index.js';
import logger from '../../log/index.js';
import { sanitizeLogParam } from '../../log/sanitize.js';
import * as registry from '../../registry/index.js';
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
// Cache of the latest sanitized watcher snapshot per watcher (keyed by "type:name").
// Replayed to each new SSE client on connect so the controller never misses the
// authoritative container list emitted mid-cron while disconnected (#386).
let lastWatcherSnapshotByWatcher = new Map<string, unknown>();

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

/**
 * Store the sanitized watcher snapshot in the per-watcher cache.
 * If the payload lacks a usable watcher key (missing type or name), it is skipped.
 */
function cacheWatcherSnapshot(sanitized: unknown): void {
  if (!sanitized || typeof sanitized !== 'object') {
    return;
  }
  const s = sanitized as { watcher?: unknown };
  if (!s.watcher || typeof s.watcher !== 'object') {
    return;
  }
  const w = s.watcher as { type?: unknown; name?: unknown };
  if (typeof w.type !== 'string' || !w.type || typeof w.name !== 'string' || !w.name) {
    return;
  }
  lastWatcherSnapshotByWatcher.set(`${w.type}:${w.name}`, sanitized);
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

function sanitizeUpdateAppliedPayloadForAgentSse(
  payload: event.ContainerUpdateAppliedEvent,
): unknown {
  if (typeof payload === 'string') {
    return payload;
  }
  if (!payload || typeof payload !== 'object') {
    return payload;
  }
  const p = payload as event.ContainerUpdateAppliedEventPayload;
  // container is included so notification triggers on the controller can render
  // messages even when the controller's container store hasn't caught up after a
  // recreate (closes the same race as #385 for multi-agent deployments).
  return {
    ...(typeof p.operationId === 'string' && p.operationId.length > 0
      ? { operationId: p.operationId }
      : {}),
    containerId: p.containerId ?? '',
    containerName: p.containerName,
    batchId: p.batchId ?? null,
    ...(p.phase === 'dryrun' ? { phase: 'dryrun' } : {}),
    ...(p.container && typeof p.container === 'object' ? { container: p.container } : {}),
  };
}

function sanitizeUpdateFailedPayloadForAgentSse(
  payload: event.ContainerUpdateFailedEventPayload,
): Record<string, unknown> {
  // container is included so notification triggers on the controller can render
  // messages even when the controller's container store hasn't caught up after a
  // recreate (closes the same race as #385 for multi-agent deployments).
  return {
    ...(typeof payload.operationId === 'string' && payload.operationId.length > 0
      ? { operationId: payload.operationId }
      : {}),
    containerId: payload.containerId ?? '',
    containerName: payload.containerName,
    error: payload.error,
    phase: payload.phase ?? '',
    batchId: payload.batchId ?? null,
    ...(typeof payload.rollbackReason === 'string' && payload.rollbackReason !== ''
      ? { rollbackReason: payload.rollbackReason }
      : {}),
    ...(payload.container && typeof payload.container === 'object'
      ? { container: payload.container }
      : {}),
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

function getAgentWatcherCron(): string | undefined {
  const watchers = registry.getState().watcher;
  for (const id of Object.keys(watchers).sort()) {
    const cron = (watchers[id]?.configuration as { cron?: unknown })?.cron;
    if (typeof cron === 'string' && cron) {
      return cron;
    }
  }
  return undefined;
}

function getAckPayloadData() {
  const summary = getContainerSummary();
  const pollInterval = getAgentWatcherCron();
  return {
    version: getVersion(),
    os: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().length,
    memoryGb: Number((os.totalmem() / 1024 / 1024 / 1024).toFixed(1)),
    uptimeSeconds: Math.floor(process.uptime()),
    lastSeen: new Date().toISOString(),
    logLevel: getLogLevel(),
    ...(pollInterval ? { pollInterval } : {}),
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

  // Replay the latest snapshot for each known watcher to this new client only (#386).
  // A snapshot emitted while the controller SSE was disconnected would otherwise be
  // lost until the next 6 h cron. Write directly to client.res — not sendSseEvent —
  // to avoid broadcasting to already-connected clients.
  for (const snapshot of lastWatcherSnapshotByWatcher.values()) {
    client.res.write(
      `data: ${JSON.stringify({ type: 'dd:watcher-snapshot', data: snapshot })}\n\n`,
    );
  }

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
  event.registerWatcherSnapshot((payload: event.WatcherSnapshotEventPayload) => {
    const sanitized = sanitizeWatcherSnapshotPayloadForAgentSse(payload);
    cacheWatcherSnapshot(sanitized);
    sendSseEvent('dd:watcher-snapshot', sanitized);
  });
  event.registerContainerUpdateApplied((payload: event.ContainerUpdateAppliedEvent) =>
    sendSseEvent('dd:update-applied', sanitizeUpdateAppliedPayloadForAgentSse(payload)),
  );
  event.registerContainerUpdateFailed((payload: event.ContainerUpdateFailedEventPayload) =>
    sendSseEvent('dd:update-failed', sanitizeUpdateFailedPayloadForAgentSse(payload)),
  );
  event.registerUpdateOperationChanged((payload: event.UpdateOperationChangedEventPayload) =>
    sendSseEvent('dd:update-operation-changed', payload),
  );
  event.registerBatchUpdateCompleted((payload: event.BatchUpdateCompletedEventPayload) =>
    sendSseEvent('dd:batch-update-completed', payload),
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
  lastWatcherSnapshotByWatcher = new Map();
}
