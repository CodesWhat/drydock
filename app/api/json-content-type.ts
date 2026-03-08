import type { NextFunction, Request, Response } from 'express';
import { sendErrorResponse } from './error-response.js';
import { getFirstHeaderValue } from './header-value.js';

function hasRequestBody(req: Request): boolean {
  const contentLength = getFirstHeaderValue(req.headers['content-length']);
  if (contentLength !== undefined) {
    const parsedLength = Number.parseInt(contentLength, 10);
    if (Number.isNaN(parsedLength)) {
      return contentLength.trim() !== '';
    }
    return parsedLength > 0;
  }

  const transferEncoding = getFirstHeaderValue(req.headers['transfer-encoding']);
  return typeof transferEncoding === 'string' && transferEncoding.trim() !== '';
}

export function shouldParseJsonBody(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH';
}

export function requireJsonContentTypeForMutations(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!shouldParseJsonBody(req.method) || !hasRequestBody(req)) {
    next();
    return;
  }

  if (req.is('application/json')) {
    next();
    return;
  }

  sendErrorResponse(res, 415, 'Content-Type must be application/json');
}
