import fs from 'fs';
import https from 'https';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import logger from '../../log';
import { getServerConfiguration } from '../../configuration';
import * as containerApi from './container';
import * as watcherApi from './watcher';
import * as triggerApi from './trigger';
import * as eventApi from './event';

const log = logger.child({ component: 'agent-server' });

let cachedSecret: string | undefined;

/**
 * Authenticate Middleware.
 */
export function authenticate(req: Request, res: Response, next: NextFunction) {
    const requestSecret = req.headers['x-wud-agent-secret'];
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
    const agentSecret = process.env.WUD_AGENT_SECRET;
    const agentSecretFile = process.env.WUD_AGENT_SECRET_FILE;

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
            'WUD Agent mode requires WUD_AGENT_SECRET or WUD_AGENT_SECRET_FILE to be defined.',
        );
        throw new Error(
            'WUD Agent mode requires WUD_AGENT_SECRET or WUD_AGENT_SECRET_FILE',
        );
    }

    const configuration = getServerConfiguration();
    const app = express();

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

    // Auth Middleware
    app.use(authenticate);

    // Routes
    app.get('/api/containers', containerApi.getContainers);
    app.delete('/api/containers/:id', containerApi.deleteContainer);
    app.get('/api/watchers', watcherApi.getWatchers);
    app.get('/api/triggers', triggerApi.getTriggers);
    app.get('/api/events', eventApi.subscribeEvents);
    app.post('/api/triggers/:type/:name', triggerApi.runTrigger);
    app.post('/api/triggers/:type/:name/batch', triggerApi.runTriggerBatch);
    app.post('/api/watchers/:type/:name', watcherApi.watchWatcher);
    app.post(
        '/api/watchers/:type/:name/container/:id',
        watcherApi.watchContainer,
    );

    // Start Server
    if (configuration.tls.enabled) {
        const options = {
            key: fs.readFileSync(configuration.tls.key),
            cert: fs.readFileSync(configuration.tls.cert),
        };
        https.createServer(options, app).listen(configuration.port, () => {
            log.info(
                `Agent Server listening on port ${configuration.port} (HTTPS)`,
            );
        });
    } else {
        app.listen(configuration.port, () => {
            log.info(
                `Agent Server listening on port ${configuration.port} (HTTP)`,
            );
        });
    }
}
