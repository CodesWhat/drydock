import express from 'express';
import type { Request, Response } from 'express';
import { registerSelfUpdateStarting } from '../event/index.js';
import log from '../log/index.js';

const router = express.Router();

const clients = new Set<Response>();

function eventsHandler(req: Request, res: Response): void {
  const logger = log.child({ component: 'sse' });

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
    logger.debug(`SSE client disconnected (${clients.size} total)`);
  });
}

function broadcastSelfUpdate(): void {
  for (const client of clients) {
    client.write('event: dd:self-update\ndata: {}\n\n');
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
export { clients as _clients, broadcastSelfUpdate as _broadcastSelfUpdate };
