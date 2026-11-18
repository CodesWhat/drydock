import express, { type Request, type Response } from 'express';
import joi from 'joi';
import nocache from 'nocache';
import { sanitizeLogParam } from '../log/sanitize.js';
import {
  getQuietHoursPolicy,
  getSuppressedCounts,
  isQuietHoursActive,
} from '../notifications/suppression.js';
import { getNotificationRule } from '../store/notification.js';
import { addSilence, getActiveSilences, removeSilence } from '../store/notification-silence.js';
import { getAuditActorForRequest } from './audit-actor.js';
import { recordAuditEvent } from './audit-events.js';
import { sendErrorResponse } from './error-response.js';
import { sanitizeApiError } from './helpers.js';
import { scoped } from './route-scopes.js';

const router = express.Router();

const MAX_SILENCE_MINUTES = 30 * 24 * 60;
const MAX_REASON_LENGTH = 200;

const createSilenceSchema = joi
  .object({
    ruleId: joi.string().trim().min(1),
    durationMinutes: joi.number().integer().min(1).max(MAX_SILENCE_MINUTES),
    expiresAt: joi.date().iso(),
    reason: joi.string().trim().allow('').max(MAX_REASON_LENGTH),
  })
  .xor('durationMinutes', 'expiresAt');

function describeQuietHours() {
  const policy = getQuietHoursPolicy();
  if (!policy) {
    return null;
  }
  return {
    schedule: policy.schedule,
    timezone: policy.timezone,
    rules: [...policy.rules],
    exempt: [...policy.exempt],
    activeNow: isQuietHoursActive(policy),
  };
}

function listSilences(_req: Request, res: Response) {
  try {
    const silences = getActiveSilences();
    res.status(200).json({
      data: silences,
      total: silences.length,
      quietHours: describeQuietHours(),
      suppressed: getSuppressedCounts(),
    });
  } catch (e: unknown) {
    sendErrorResponse(res, 500, sanitizeApiError(e));
  }
}

function createSilence(req: Request, res: Response) {
  const request = createSilenceSchema.validate(req.body || {}, { stripUnknown: true });
  if (request.error) {
    sendErrorResponse(res, 400, sanitizeApiError(request.error));
    return;
  }

  try {
    const { durationMinutes, expiresAt, reason } = request.value;
    const ruleId = request.value.ruleId?.toLowerCase();
    if (ruleId !== undefined && !getNotificationRule(ruleId)) {
      sendErrorResponse(res, 404, 'Notification rule not found');
      return;
    }
    const expiry: Date =
      expiresAt !== undefined ? expiresAt : new Date(Date.now() + durationMinutes * 60_000);
    if (expiry.getTime() <= Date.now()) {
      sendErrorResponse(res, 400, 'expiresAt must be in the future');
      return;
    }
    if (expiry.getTime() - Date.now() > MAX_SILENCE_MINUTES * 60_000) {
      sendErrorResponse(res, 400, `A silence can last at most ${MAX_SILENCE_MINUTES} minutes`);
      return;
    }

    const silence = addSilence({
      ruleId,
      reason: reason === '' ? undefined : reason,
      createdBy: getAuditActorForRequest(req),
      expiresAt: expiry,
    });
    recordAuditEvent({
      action: 'notification-silence-set',
      status: 'success',
      containerName: 'notifications',
      details: `rule=${silence.ruleId ?? 'all'}; expires=${silence.expiresAt}${
        silence.reason ? `; reason=${sanitizeLogParam(silence.reason, MAX_REASON_LENGTH)}` : ''
      }`,
    });
    res.status(201).json(silence);
  } catch (e: unknown) {
    sendErrorResponse(res, 500, sanitizeApiError(e));
  }
}

function deleteSilence(req: Request<{ id: string }>, res: Response) {
  try {
    const removed = removeSilence(req.params.id);
    if (!removed) {
      sendErrorResponse(res, 404, 'Notification silence not found');
      return;
    }
    recordAuditEvent({
      action: 'notification-silence-cleared',
      status: 'success',
      containerName: 'notifications',
      details: `rule=${removed.ruleId ?? 'all'}; was set to expire ${removed.expiresAt}`,
    });
    res.status(204).send();
  } catch (e: unknown) {
    sendErrorResponse(res, 500, sanitizeApiError(e));
  }
}

export function init() {
  router.use(nocache());
  router.get('/', scoped('read', listSilences));
  router.post('/', scoped('admin', createSilence));
  router.delete('/:id', scoped('admin', deleteSilence));
  return router;
}
