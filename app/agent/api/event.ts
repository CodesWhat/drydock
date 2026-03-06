import os from 'node:os';
import type { Request, Response } from 'express';
import { getVersion } from '../../configuration/index.js';
import * as event from '../../event/index.js';
import logger from '../../log/index.js';
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

const CONTAINER_SUMMARY_CACHE_TTL_MS = 2_000;

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
function sendSseEvent(eventName: string, data: any) {
  const message = {
    type: eventName,
    data: data,
  };
  const payload = JSON.stringify(message);
  sseClients.forEach((client) => {
    client.res.write(`data: ${payload}\n\n`);
  });
}

function computeContainerSummary(): ContainerSummary {
  const containers = storeContainer.getContainers();
  const containerStatus = getContainerStatusSummary(containers);
  const images = new Set(
    containers.map(
      (container: any) => container.image?.id ?? container.image?.name ?? container.id,
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
  log.info(`Controller drydock with ip ${req.ip} connected.`);

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
    log.info(`Controller drydock with ip ${req.ip} disconnected.`);
    sseClients = sseClients.filter((c) => c.id !== client.id);
  });
}

/**
 * Initialize event listeners.
 */
export function initEvents() {
  event.registerContainerAdded((container: event.ContainerLifecycleEventPayload) =>
    sendSseEvent('dd:container-added', container),
  );
  event.registerContainerUpdated((container: event.ContainerLifecycleEventPayload) =>
    sendSseEvent('dd:container-updated', container),
  );
  event.registerContainerRemoved((container: event.ContainerLifecycleEventPayload) =>
    sendSseEvent('dd:container-removed', { id: container.id }),
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
