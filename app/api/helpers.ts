import type { Response } from 'express';
import type { Logger } from 'pino';
import { sanitizeLogParam } from '../log/sanitize.js';
import type { AuditEntry } from '../model/audit.js';
import type { Container } from '../model/container.js';
import { recordAuditEvent } from './audit-events.js';
import { sendErrorResponse } from './error-response.js';

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
  const publicErrorMessage = `Error ${actionLabel} container`;
  log.warn(`Error ${actionLabel} container ${sanitizeLogParam(id)} (${sanitizeLogParam(message)})`);

  recordAuditEvent({
    action,
    container,
    status: 'error',
    details: message,
  });

  sendErrorResponse(res, 500, publicErrorMessage);

  return message;
}
