import type { NextFunction, Request, Response } from 'express';
import { sendErrorResponse } from './error-response.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

function parseOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }

  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function getExpectedOrigin(req: Request): string | undefined {
  const host = req.get('host');
  if (typeof host !== 'string' || host.trim() === '') {
    return undefined;
  }

  return parseOrigin(`${req.protocol}://${host}`);
}

function getRequestOrigin(req: Request): string | undefined {
  const origin = parseOrigin(req.get('origin'));
  if (origin) {
    return origin;
  }

  return parseOrigin(req.get('referer'));
}

function isUnsafeMethod(method: unknown): boolean {
  return !SAFE_METHODS.has(String(method || '').toUpperCase());
}

function isSessionCookieRequest(req: Request): boolean {
  const cookieHeader = req.get('cookie');
  return typeof cookieHeader === 'string' && cookieHeader.trim() !== '';
}

function isCrossSiteFetch(req: Request): boolean {
  const secFetchSite = req.get('sec-fetch-site');
  return typeof secFetchSite === 'string' && secFetchSite.trim().toLowerCase() === 'cross-site';
}

/**
 * Enforce same-origin checks for cookie-authenticated state-changing requests.
 */
export function requireSameOriginForMutations(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isUnsafeMethod(req.method) || !isSessionCookieRequest(req)) {
    next();
    return;
  }

  if (isCrossSiteFetch(req)) {
    sendErrorResponse(res, 403, 'CSRF validation failed');
    return;
  }

  const expectedOrigin = getExpectedOrigin(req);
  const requestOrigin = getRequestOrigin(req);

  if (!expectedOrigin || !requestOrigin || requestOrigin !== expectedOrigin) {
    sendErrorResponse(res, 403, 'CSRF validation failed');
    return;
  }

  next();
}
