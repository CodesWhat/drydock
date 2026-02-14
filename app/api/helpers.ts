import type { Response } from 'express';
import type { Logger } from 'pino';
import { sanitizeLogParam } from '../log/sanitize.js';
import { recordAuditEvent } from './audit-events.js';

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
  action: string;
  actionLabel: string;
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  container: any;
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

  res.status(500).json({
    error: `Error ${actionLabel} container (${message})`,
  });

  return message;
}
