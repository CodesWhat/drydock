import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { getServerConfiguration } from '../configuration/index.js';
import { resolveUiDirectory } from '../runtime/paths.js';

const HTML_DOCUMENT_CACHE_CONTROL = 'no-store';
const STATIC_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';
// The service worker script must be revalidated on every request so a new
// deploy is never masked by a stale, previously-cached sw.js — that would
// pin clients to the old precached shell indefinitely.
const SERVICE_WORKER_CACHE_CONTROL = 'no-cache';

const FONT_CSS_PATTERN = /^\/fonts\/.+\.css$/;

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Point the root-absolute URLs of the built index.html at the sub-path and
 * publish the base path to the SPA through a meta tag (inline scripts are
 * blocked by the CSP, a meta tag is not).
 */
export function rewriteIndexHtml(html: string, basePath: string): string {
  const prefixed = html.replace(/\b(href|src)="\/(?!\/)/g, `$1="${basePath}/`);
  return prefixed.replace(
    '<head>',
    `<head>\n    <meta name="dd-base-path" content="${escapeHtmlAttribute(basePath)}">`,
  );
}

/** Point the PWA registration script at the service worker under the sub-path. */
export function rewriteRegisterServiceWorker(script: string, basePath: string): string {
  return script
    .replace("register('/sw.js'", `register('${basePath}/sw.js'`)
    .replace("scope: '/'", `scope: '${basePath}/'`);
}

/** Prefix the root-absolute URLs of the web app manifest. */
export function rewriteWebManifest(manifest: string, basePath: string): string {
  const parsed = JSON.parse(manifest) as {
    start_url?: string;
    scope?: string;
    icons?: { src: string }[];
  };
  const prefix = (value: string) => (value.startsWith('/') ? `${basePath}${value}` : value);
  if (parsed.start_url) {
    parsed.start_url = prefix(parsed.start_url);
  }
  if (parsed.scope) {
    parsed.scope = prefix(parsed.scope);
  }
  for (const icon of parsed.icons ?? []) {
    icon.src = prefix(icon.src);
  }
  return JSON.stringify(parsed);
}

/** Prefix the root-absolute url() references of the bundled font stylesheets. */
export function rewriteFontCss(css: string, basePath: string): string {
  return css.replace(/url\(\/(?!\/)/g, `url(${basePath}/`);
}

function resolveRewriter(requestPath: string, basePath: string) {
  if (requestPath === '/index.html') {
    return (content: string) => rewriteIndexHtml(content, basePath);
  }
  if (requestPath === '/registerSW.js') {
    return (content: string) => rewriteRegisterServiceWorker(content, basePath);
  }
  if (requestPath === '/site.webmanifest') {
    return (content: string) => rewriteWebManifest(content, basePath);
  }
  if (FONT_CSS_PATTERN.test(requestPath)) {
    return (content: string) => rewriteFontCss(content, basePath);
  }
  return undefined;
}

/**
 * When served under a sub-path, the few static files that carry root-absolute
 * URLs are rewritten once and answered from memory. Everything else is served
 * untouched by express.static (the hashed bundles resolve their own chunks at
 * runtime from the base path meta tag).
 */
function createBasePathRewriter(uiDirectory: string, basePath: string) {
  const cache = new Map<string, string>();

  /** Returns the rewritten body for a UI file, or undefined when the file is not rewritten. */
  return function rewrittenBody(requestPath: string): string | undefined {
    const rewrite = resolveRewriter(requestPath, basePath);
    if (!rewrite) {
      return undefined;
    }
    const filePath = path.resolve(path.join(uiDirectory, requestPath));
    if (!filePath.startsWith(`${uiDirectory}${path.sep}`)) {
      return undefined;
    }
    let body = cache.get(filePath);
    if (body === undefined) {
      try {
        body = rewrite(fs.readFileSync(filePath, 'utf8'));
      } catch {
        return undefined;
      }
      cache.set(filePath, body);
    }
    return body;
  };
}

/**
 * Init the UI router.
 * @returns {*|Router}
 */
export function init() {
  const uiDirectory = path.resolve(resolveUiDirectory());
  const basePath = (getServerConfiguration().basepath as string) || '';
  const rewrittenBody = basePath ? createBasePathRewriter(uiDirectory, basePath) : undefined;
  const router = express.Router();
  const uiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
  });
  if (rewrittenBody) {
    router.use((req, res, next) => {
      const requestPath = req.path === '/' ? '/index.html' : req.path;
      const body = req.method === 'GET' ? rewrittenBody(requestPath) : undefined;
      if (body === undefined) {
        next();
        return;
      }
      if (requestPath === '/index.html') {
        res.set('Cache-Control', HTML_DOCUMENT_CACHE_CONTROL);
      } else if (requestPath === '/registerSW.js') {
        res.set('Cache-Control', SERVICE_WORKER_CACHE_CONTROL);
      }
      res.type(path.extname(requestPath)).send(body);
    });
  }
  router.use(
    express.static(uiDirectory, {
      setHeaders: (res, filePath) => {
        const relativePath = path.relative(uiDirectory, filePath);
        const topLevelDirectory = relativePath.split(path.sep)[0];
        if (relativePath.endsWith('.html')) {
          res.setHeader('Cache-Control', HTML_DOCUMENT_CACHE_CONTROL);
          return;
        }
        if (relativePath === 'sw.js') {
          res.setHeader('Cache-Control', SERVICE_WORKER_CACHE_CONTROL);
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
    const shell = rewrittenBody?.('/index.html');
    if (shell !== undefined) {
      res.type('html').send(shell);
      return;
    }
    res.sendFile(indexFile);
  });
  return router;
}
