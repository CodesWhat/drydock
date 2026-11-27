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

/** Express middleware that strips the base path so every router sees root-relative paths. */
export function createBasePathMiddleware(basePath: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.url = stripBasePath(req.url, basePath);
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
