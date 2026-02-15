import fs from 'node:fs';
import https from 'node:https';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { getServerConfiguration } from '../../configuration/index.js';
import { getEntries } from '../../log/buffer.js';
import logger from '../../log/index.js';
import * as containerApi from './container.js';
import * as eventApi from './event.js';
import * as triggerApi from './trigger.js';
import * as watcherApi from './watcher.js';

const log = logger.child({ component: 'agent-server' });

let cachedSecret: string | undefined;

/**
 * Authenticate Middleware.
 */
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const requestSecret = req.headers['x-dd-agent-secret'];
  if (!cachedSecret || requestSecret !== cachedSecret) {
    log.warn(`Unauthorized access attempt from ${req.ip}`);
    return res.status(401).send();
  }
  next();
}

/**
 * Init Agent Server.
 */
export async function init() {
  cachedSecret = undefined;
  const agentSecret = process.env.DD_AGENT_SECRET ?? process.env.WUD_AGENT_SECRET;
  const agentSecretFile = process.env.DD_AGENT_SECRET_FILE ?? process.env.WUD_AGENT_SECRET_FILE;

  if (agentSecret) {
    cachedSecret = agentSecret;
  } else if (agentSecretFile) {
    try {
      cachedSecret = fs.readFileSync(agentSecretFile, 'utf-8').trim();
    } catch (e: any) {
      log.error(`Error reading secret file: ${e.message}`);
      throw new Error(`Error reading secret file: ${e.message}`);
    }
  }

  if (!cachedSecret) {
    log.error(
      'Agent mode requires DD_AGENT_SECRET (or WUD_AGENT_SECRET) / DD_AGENT_SECRET_FILE (or WUD_AGENT_SECRET_FILE) to be defined.',
    );
    throw new Error(
      'Agent mode requires DD_AGENT_SECRET or DD_AGENT_SECRET_FILE (WUD_ prefix also accepted)',
    );
  }

  const configuration = getServerConfiguration();
  const app = express();
  app.disable('x-powered-by');

  app.use(express.json());
  if (configuration.cors.enabled) {
    app.use(
      cors({
        origin: configuration.cors.origin,
        methods: configuration.cors.methods,
      }),
    );
  }

  // Init Event Listeners
  eventApi.initEvents();

  // Health endpoint (unauthenticated, before auth middleware)
  app.get('/health', (_req, res) => res.json({ uptime: process.uptime() }));

  // Auth Middleware
  app.use(authenticate);

  // Routes
  app.get('/api/log/entries', (req: Request, res: Response) => {
    const level = req.query.level as string | undefined;
    const component = req.query.component as string | undefined;
    const tail = req.query.tail ? Number.parseInt(req.query.tail as string, 10) : undefined;
    const since = req.query.since ? Number.parseInt(req.query.since as string, 10) : undefined;
    res.status(200).json(getEntries({ level, component, tail, since }));
  });
  app.get('/api/containers', containerApi.getContainers);
  app.get('/api/containers/:id/logs', containerApi.getContainerLogs);
  app.delete('/api/containers/:id', containerApi.deleteContainer);
  app.get('/api/watchers', watcherApi.getWatchers);
  app.get('/api/triggers', triggerApi.getTriggers);
  app.get('/api/events', eventApi.subscribeEvents);
  app.post('/api/triggers/:type/:name', triggerApi.runTrigger);
  app.post('/api/triggers/:type/:name/batch', triggerApi.runTriggerBatch);
  app.post('/api/watchers/:type/:name', watcherApi.watchWatcher);
  app.post('/api/watchers/:type/:name/container/:id', watcherApi.watchContainer);

  // Start Server
  if (configuration.tls.enabled) {
    const options = {
      key: fs.readFileSync(configuration.tls.key),
      cert: fs.readFileSync(configuration.tls.cert),
    };
    https.createServer(options, app).listen(configuration.port, () => {
      log.info(`Agent Server listening on port ${configuration.port} (HTTPS)`);
    });
  } else {
    app.listen(configuration.port, () => {
      log.info(`Agent Server listening on port ${configuration.port} (HTTP)`);
    });
  }
}
