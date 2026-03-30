import type { Response } from 'express';
import type { Logger } from 'pino';
import logger from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import type { AuditEntry } from '../model/audit.js';
import type { Container } from '../model/container.js';
import { getErrorMessage } from '../util/error.js';
import { recordAuditEvent } from './audit-events.js';
import { sendErrorResponse } from './error-response.js';

const log = logger.child({ component: 'api-helpers' });

const INVALID_REQUEST_PARAMETERS_MESSAGE = 'Invalid request parameters';
const INTERNAL_SERVER_ERROR_MESSAGE = 'Internal server error';

interface JoiValidationErrorLike {
  isJoi?: unknown;
  details?: { message?: unknown }[];
}

function isJoiValidationError(error: unknown): error is JoiValidationErrorLike {
  return Boolean(
    error &&
      typeof error === 'object' &&
      (error as JoiValidationErrorLike).isJoi === true &&
      Array.isArray((error as JoiValidationErrorLike).details),
  );
}

function getJoiValidationDetails(error: JoiValidationErrorLike): string {
  return error.details
    .map((detail) => (typeof detail?.message === 'string' ? detail.message.trim() : ''))
    .filter((message) => message !== '')
    .join(', ');
}

export function sanitizeApiError(error: unknown): string {
  if (isJoiValidationError(error)) {
    const detailMessage = getJoiValidationDetails(error);
    const fallbackMessage = getErrorMessage(error);
    const message = detailMessage || fallbackMessage;
    log.warn(`API validation error (${sanitizeLogParam(message, 500)})`);
    return INVALID_REQUEST_PARAMETERS_MESSAGE;
  }

  const message = getErrorMessage(error);
  log.error(`Unhandled API error (${sanitizeLogParam(message, 500)})`);
  return INTERNAL_SERVER_ERROR_MESSAGE;
}

/**
 * Handle a container action error by logging, recording an audit event, and sending a 500 response.
 */
export function handleContainerActionError({
  error,
  action,
  actionLabel,
  id,
  container,
  log,
  res,
}: {
  error: unknown;
  action: AuditEntry['action'];
  actionLabel: string;
  id: string;
  container: Container;
  log: Logger;
  res: Response;
}): string {
  const message = error instanceof Error ? error.message : String(error);
  log.warn(`Error ${actionLabel} container ${sanitizeLogParam(id)} (${sanitizeLogParam(message)})`);

  recordAuditEvent({
    action,
    container,
    status: 'error',
    details: message,
  });

  sendErrorResponse(res, 500, message);

  return message;
}
