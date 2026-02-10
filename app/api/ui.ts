// @ts-nocheck
import path from 'node:path';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { resolveUiDirectory } from '../runtime/paths.js';

/**
 * Init the UI router.
 * @returns {*|Router}
 */
export function init() {
    const uiDirectory = path.resolve(resolveUiDirectory());
    const router = express.Router();
    const uiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false });
    router.use(uiLimiter);
    router.use(express.static(uiDirectory));

    // Redirect all 404 to index.html (for vue history mode)
    const indexFile = path.resolve(path.join(uiDirectory, 'index.html'));
    router.get('/{*path}', (req, res) => {
        res.sendFile(indexFile);
    });
    return router;
}
