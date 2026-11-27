import type { IncomingMessage } from 'node:http';
import type { NextFunction, Request, Response } from 'express';

/**
 * Remove a configured base path (DD_SERVER_BASEPATH) from a request URL.
 *
 * Both deployment shapes work: a reverse proxy that forwards the prefix
 * untouched (`/drydock/api/v1/...`) and one that strips it before proxying
 * (`/api/v1/...`). A URL that does not sit under the base path is returned as is.
 * Matching is on whole path segments, so `/drydockery` is not under `/drydock`.
 */
export function stripBasePath(url: string, basePath: string): string {
  if (!basePath || !url.startsWith(basePath)) {
    return url;
  }
  const rest = url.slice(basePath.length);
  if (rest === '') {
    return '/';
  }
  if (rest.startsWith('/')) {
    return rest;
  }
  if (rest.startsWith('?')) {
    return `/${rest}`;
  }
  return url;
}

/**
 * Express middleware that strips the base path so every router sees
 * root-relative paths.
 *
 * `req.originalUrl` is left as the browser's path, with the prefix: the session
 * cookie is scoped to the base path and express-session skips any request whose
 * `originalUrl` sits outside it, and the OIDC callback rebuilds its redirect
 * URI from it. Behind a proxy that strips the prefix the request arrives
 * without one, so the prefix is put back on `originalUrl` to make both shapes
 * look the same from here on.
 */
export function createBasePathMiddleware(basePath: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const stripped = stripBasePath(req.url, basePath);
    if (stripped === req.url && req.originalUrl === req.url) {
      req.originalUrl = `${basePath}${req.url}`;
    }
    req.url = stripped;
    next();
  };
}

/**
 * Strip the base path from WebSocket upgrade requests, which bypass Express.
 * Register with prependListener so the gateways see the stripped URL.
 */
export function stripBasePathFromUpgrade(request: IncomingMessage, basePath: string): void {
  request.url = stripBasePath(request.url ?? '/', basePath);
}
