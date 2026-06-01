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

function getFirstForwardedValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const firstValue = value
    .split(',')
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.length > 0);
  return firstValue || undefined;
}

function parseProtocol(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalizedValue = value.trim().toLowerCase().replace(/:$/, '');
  if (normalizedValue !== 'http' && normalizedValue !== 'https') {
    return undefined;
  }

  return normalizedValue;
}

function getExpectedOrigin(req: Request): string | undefined {
  // req.protocol is already trust-proxy-gated by Express: it reads X-Forwarded-Proto
  // only when "trust proxy" is enabled, so we do not need to read that header directly.
  const protocol = parseProtocol(req.protocol);
  if (!protocol) {
    return undefined;
  }

  // Only honour X-Forwarded-Host when Express trust proxy is enabled; otherwise a
  // client could forge the header to make the expected origin match an attacker origin.
  const trustProxyEnabled = Boolean(req.app?.get('trust proxy'));
  const host =
    (trustProxyEnabled ? getFirstForwardedValue(req.get('x-forwarded-host')) : undefined) ??
    req.get('host');
  if (typeof host !== 'string' || host.trim() === '') {
    return undefined;
  }

  return parseOrigin(`${protocol}://${host}`);
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
