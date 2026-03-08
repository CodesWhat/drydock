import type { NextFunction, Request, Response } from 'express';
import { sendErrorResponse } from './error-response.js';
import { getFirstHeaderValue } from './header-value.js';

const DESTRUCTIVE_CONFIRMATION_HEADER_KEY = 'x-dd-confirm-action';
const DESTRUCTIVE_CONFIRMATION_HEADER_LABEL = 'X-DD-Confirm-Action';

function normalizeHeaderValue(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

export function requireDestructiveActionConfirmation(actionToken: string) {
  const expectedValue = actionToken.trim().toLowerCase();
  return (req: Request, res: Response, next: NextFunction): void => {
    const providedValue = normalizeHeaderValue(
      getFirstHeaderValue(req.headers[DESTRUCTIVE_CONFIRMATION_HEADER_KEY]),
    );
    if (providedValue === expectedValue) {
      next();
      return;
    }

    sendErrorResponse(
      res,
      428,
      `Confirmation required: ${DESTRUCTIVE_CONFIRMATION_HEADER_LABEL}=${actionToken}`,
    );
  };
}
