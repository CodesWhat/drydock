import path from 'node:path';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { resolveUiDirectory } from '../runtime/paths.js';

const HTML_DOCUMENT_CACHE_CONTROL = 'no-store';
const STATIC_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * Init the UI router.
 * @returns {*|Router}
 */
export function init() {
  const uiDirectory = path.resolve(resolveUiDirectory());
  const router = express.Router();
  const uiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
  });
  router.use(
    express.static(uiDirectory, {
      setHeaders: (res, filePath) => {
        const relativePath = path.relative(uiDirectory, filePath);
        const topLevelDirectory = relativePath.split(path.sep)[0];
        if (relativePath.endsWith('.html')) {
          res.setHeader('Cache-Control', HTML_DOCUMENT_CACHE_CONTROL);
          return;
        }
        if (topLevelDirectory === 'assets') {
          res.setHeader('Cache-Control', STATIC_ASSET_CACHE_CONTROL);
        }
      },
    }),
  );

  // Redirect all 404 to index.html (for vue history mode)
  const indexFile = path.resolve(path.join(uiDirectory, 'index.html'));
  router.get('/{*path}', uiLimiter, (req, res) => {
    res.set('Cache-Control', HTML_DOCUMENT_CACHE_CONTROL);
    // A request reaching the catch-all under /assets/ is a content-hashed bundle
    // that no longer exists (e.g. a chunk deleted by a prior upgrade). Return a
    // clean 404 rather than the SPA shell: serving index.html (text/html) for a
    // .js/.css URL trips the browser's strict MIME check and white-screens a stale
    // page, and lets caching reverse proxies poison the asset URL with HTML.
    if (req.path.startsWith('/assets/')) {
      res.status(404).end();
      return;
    }
    res.sendFile(indexFile);
  });
  return router;
}
