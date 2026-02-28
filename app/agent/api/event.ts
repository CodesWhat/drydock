import type { Request, Response } from 'express';
import os from 'node:os';
import { getVersion } from '../../configuration/index.js';
import * as event from '../../event/index.js';
import logger from '../../log/index.js';
import type { Container } from '../../model/container.js';
import * as storeContainer from '../../store/container.js';

const log = logger.child({ component: 'agent-api-event' });

interface SseClient {
  id: number;
  res: Response;
}

// SSE Clients
let sseClients: SseClient[] = [];

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

function getContainerSummary() {
  const containers = storeContainer.getContainers();
  const running = containers.filter(
    (container: any) => String(container.status ?? '').toLowerCase() === 'running',
  ).length;
  const total = containers.length;
  const images = new Set(
    containers.map((container: any) => container.image?.id ?? container.image?.name ?? container.id),
  ).size;
  return {
    containers: {
      total,
      running,
      stopped: Math.max(total - running, 0),
    },
    images,
  };
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
    id: Date.now(),
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
  event.registerContainerAdded((container: Container) =>
    sendSseEvent('dd:container-added', container),
  );
  event.registerContainerUpdated((container: Container) =>
    sendSseEvent('dd:container-updated', container),
  );
  event.registerContainerRemoved((container: Container) =>
    sendSseEvent('dd:container-removed', { id: container.id }),
  );
}
