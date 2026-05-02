import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import type { NotificationOutboxEntryStatus } from '../model/notification-outbox.js';
import {
  findOutboxEntriesByStatus,
  getOutboxEntry,
  removeOutboxEntry,
  requeueDeadLetterEntry,
} from '../store/notification-outbox.js';
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

function isNotificationOutboxEntryStatus(status: unknown): status is NotificationOutboxEntryStatus {
  return typeof status === 'string' && VALID_STATUSES.has(status as NotificationOutboxEntryStatus);
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
      data,
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
    res.status(200).json(requeued);
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
