import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import type {
  NotificationOutboxEntry,
  NotificationOutboxEntryStatus,
} from '../model/notification-outbox.js';
import {
  findOutboxEntriesByStatus,
  getOutboxEntry,
  removeOutboxEntry,
  requeueDeadLetterEntry,
} from '../store/notification-outbox.js';
import { scrubAuthorizationHeaderValues } from '../util/auth-redaction.js';
import { sendErrorResponse } from './error-response.js';
import { sanitizeApiError } from './helpers.js';

const router = express.Router();

const VALID_STATUSES = new Set<NotificationOutboxEntryStatus>([
  'pending',
  'delivered',
  'dead-letter',
]);
const INVALID_STATUS_QUERY_ERROR =
  'Invalid status query parameter. Must be one of: pending, delivered, dead-letter';
const TOP_LEVEL_PAYLOAD_FIELDS = [
  'containerId',
  'containerName',
  'agentName',
  'reason',
  'status',
  'blockingCount',
] as const;
const CONTAINER_PAYLOAD_FIELDS = [
  'id',
  'name',
  'displayName',
  'watcher',
  'agent',
  'status',
] as const;

type SanitizedOutboxEntry = Omit<NotificationOutboxEntry, 'payload'> & {
  payload: Record<string, unknown>;
};

function isNotificationOutboxEntryStatus(status: unknown): status is NotificationOutboxEntryStatus {
  return typeof status === 'string' && VALID_STATUSES.has(status as NotificationOutboxEntryStatus);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizePayloadScalar(value: unknown): unknown {
  if (typeof value === 'string') {
    return scrubAuthorizationHeaderValues(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return undefined;
}

function copyAllowedScalarFields(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  fields: readonly string[],
): void {
  for (const field of fields) {
    const value = sanitizePayloadScalar(source[field]);
    if (value !== undefined) {
      target[field] = value;
    }
  }
}

function sanitizeContainerImageSummary(image: unknown): Record<string, unknown> | undefined {
  if (!isRecord(image)) {
    return undefined;
  }

  const summary: Record<string, unknown> = {};
  if (typeof image.name === 'string') {
    summary.name = scrubAuthorizationHeaderValues(image.name);
  }
  if (isRecord(image.tag) && typeof image.tag.value === 'string') {
    summary.tag = scrubAuthorizationHeaderValues(image.tag.value);
  }
  return Object.keys(summary).length > 0 ? summary : undefined;
}

function sanitizeContainerSummary(container: unknown): Record<string, unknown> | undefined {
  if (!isRecord(container)) {
    return undefined;
  }

  const summary: Record<string, unknown> = {};
  copyAllowedScalarFields(summary, container, CONTAINER_PAYLOAD_FIELDS);
  const imageSummary = sanitizeContainerImageSummary(container.image);
  if (imageSummary) {
    summary.image = imageSummary;
  }
  return Object.keys(summary).length > 0 ? summary : undefined;
}

function sanitizeOutboxPayload(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) {
    return {};
  }

  const sanitized: Record<string, unknown> = {};
  copyAllowedScalarFields(sanitized, payload, TOP_LEVEL_PAYLOAD_FIELDS);
  const containerSummary = sanitizeContainerSummary(payload.container);
  if (containerSummary) {
    sanitized.container = containerSummary;
  }
  return sanitized;
}

function sanitizeOutboxEntryForResponse(entry: NotificationOutboxEntry): SanitizedOutboxEntry {
  return {
    ...entry,
    payload: sanitizeOutboxPayload(entry.payload),
    lastError:
      typeof entry.lastError === 'string'
        ? scrubAuthorizationHeaderValues(entry.lastError)
        : entry.lastError,
  };
}

function getOutboxEntries(req: Request, res: Response) {
  try {
    const { status } = req.query;
    let resolvedStatus: NotificationOutboxEntryStatus = 'dead-letter';

    if (status !== undefined) {
      if (!isNotificationOutboxEntryStatus(status)) {
        sendErrorResponse(res, 400, INVALID_STATUS_QUERY_ERROR);
        return;
      }
      resolvedStatus = status;
    }

    const pending = findOutboxEntriesByStatus('pending');
    const delivered = findOutboxEntriesByStatus('delivered');
    const deadLetter = findOutboxEntriesByStatus('dead-letter');

    const data =
      resolvedStatus === 'pending'
        ? pending
        : resolvedStatus === 'delivered'
          ? delivered
          : deadLetter;

    res.status(200).json({
      data: data.map(sanitizeOutboxEntryForResponse),
      total: data.length,
      counts: {
        pending: pending.length,
        delivered: delivered.length,
        deadLetter: deadLetter.length,
      },
    });
  } catch (e: unknown) {
    sendErrorResponse(res, 500, sanitizeApiError(e));
  }
}

function retryOutboxEntry(req: Request<{ id: string }>, res: Response) {
  try {
    const { id } = req.params;
    const requeued = requeueDeadLetterEntry(id);
    if (!requeued) {
      sendErrorResponse(res, 404, 'Outbox entry not found or not in dead-letter status');
      return;
    }
    res.status(200).json(sanitizeOutboxEntryForResponse(requeued));
  } catch (e: unknown) {
    sendErrorResponse(res, 500, sanitizeApiError(e));
  }
}

function deleteOutboxEntry(req: Request<{ id: string }>, res: Response) {
  try {
    const { id } = req.params;
    const existing = getOutboxEntry(id);
    if (!existing) {
      sendErrorResponse(res, 404, 'Outbox entry not found');
      return;
    }
    removeOutboxEntry(id);
    res.status(204).send();
  } catch (e: unknown) {
    sendErrorResponse(res, 500, sanitizeApiError(e));
  }
}

export function init() {
  router.use(nocache());
  router.get('/', getOutboxEntries);
  router.post('/:id/retry', retryOutboxEntry);
  router.delete('/:id', deleteOutboxEntry);
  return router;
}
