import type { Request, Response } from 'express';
import express from 'express';
import { registerSelfUpdateStarting } from '../event/index.js';
import log from '../log/index.js';

const router = express.Router();

const clients = new Set<Response>();

// Per-IP connection tracking to prevent connection exhaustion
const MAX_CONNECTIONS_PER_IP = 10;
const connectionsPerIp = new Map<string, number>();

function getClientIp(req: Request): string {
  return req.ip ?? 'unknown';
}

function eventsHandler(req: Request, res: Response): void {
  const logger = log.child({ component: 'sse' });
  const ip = getClientIp(req);
  const currentCount = connectionsPerIp.get(ip) ?? 0;

  if (currentCount >= MAX_CONNECTIONS_PER_IP) {
    logger.warn(`SSE connection limit reached for ${ip} (${currentCount})`);
    res.status(429).json({ message: 'Too many SSE connections' });
    return;
  }

  connectionsPerIp.set(ip, currentCount + 1);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Send initial connection event
  res.write('event: dd:connected\ndata: {}\n\n');

  clients.add(res);
  logger.debug(`SSE client connected (${clients.size} total)`);

  // Heartbeat every 15s
  const heartbeatInterval = globalThis.setInterval(() => {
    res.write('event: dd:heartbeat\ndata: {}\n\n');
  }, 15000);

  req.on('close', () => {
    globalThis.clearInterval(heartbeatInterval);
    clients.delete(res);
    const count = connectionsPerIp.get(ip) ?? 1;
    if (count <= 1) {
      connectionsPerIp.delete(ip);
    } else {
      connectionsPerIp.set(ip, count - 1);
    }
    logger.debug(`SSE client disconnected (${clients.size} total)`);
  });
}

function broadcastSelfUpdate(): void {
  for (const client of clients) {
    client.write('event: dd:self-update\ndata: {}\n\n');
  }
}

export function broadcastScanStarted(containerId: string): void {
  const data = JSON.stringify({ containerId });
  for (const client of clients) {
    client.write(`event: dd:scan-started\ndata: ${data}\n\n`);
  }
}

export function broadcastScanCompleted(containerId: string, status: string): void {
  const data = JSON.stringify({ containerId, status });
  for (const client of clients) {
    client.write(`event: dd:scan-completed\ndata: ${data}\n\n`);
  }
}

export function init(): express.Router {
  // Register for self-update events from the trigger system
  registerSelfUpdateStarting(() => {
    broadcastSelfUpdate();
  });

  router.get('/', eventsHandler);
  return router;
}

// For testing
export {
  clients as _clients,
  connectionsPerIp as _connectionsPerIp,
  MAX_CONNECTIONS_PER_IP as _MAX_CONNECTIONS_PER_IP,
  broadcastSelfUpdate as _broadcastSelfUpdate,
  broadcastScanStarted as _broadcastScanStarted,
  broadcastScanCompleted as _broadcastScanCompleted,
};
