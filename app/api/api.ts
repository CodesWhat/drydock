// @ts-nocheck
import express from 'express';
import rateLimit from 'express-rate-limit';
import * as appRouter from './app.js';
import * as containerRouter from './container.js';
import * as watcherRouter from './watcher.js';
import * as triggerRouter from './trigger.js';
import * as registryRouter from './registry.js';
import * as authenticationRouter from './authentication.js';
import * as logRouter from './log.js';
import * as storeRouter from './store.js';
import * as serverRouter from './server.js';
import { requireAuthentication } from './auth.js';
import * as agentRouter from './agent.js';

/**
 * Init the API router.
 * @returns {*|Router}
 */
export function init() {
    const router = express.Router();

    const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, standardHeaders: true, legacyHeaders: false });
    router.use(apiLimiter);

    // Mount app router
    router.use('/app', appRouter.init());

    // Routes to protect after this line
    router.use(requireAuthentication);

    // Mount log router
    router.use('/log', logRouter.init());

    // Mount store router
    router.use('/store', storeRouter.init());

    // Mount server router
    router.use('/server', serverRouter.init());

    // Mount container router
    router.use('/containers', containerRouter.init());

    // Mount trigger router
    router.use('/triggers', triggerRouter.init());

    // Mount watcher router
    router.use('/watchers', watcherRouter.init());

    // Mount registry router
    router.use('/registries', registryRouter.init());

    // Mount auth
    router.use('/authentications', authenticationRouter.init());

    // Mount agents
    router.use('/agents', agentRouter.init());

    // All other API routes => 404
    router.get('/{*path}', (req, res) => res.sendStatus(404));

    return router;
}
