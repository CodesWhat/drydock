import express, { type Request, type Response } from 'express';
import joi from 'joi';
import nocache from 'nocache';
import logger from '../log/index.js';
import * as settingsStore from '../store/settings.js';
import { sendErrorResponse } from './error-response.js';
import { sanitizeApiError } from './helpers.js';

const router = express.Router();
const log = logger.child({ component: 'settings' });
const deprecatedPutWarning =
  'PUT /api/settings is deprecated and will be removed in v1.6.0. Use PATCH /api/settings instead.';
const deprecatedPutDeprecation = '@1798761600';
const deprecatedPutSunset = 'Wed, 01 Jan 2027 00:00:00 GMT';

const settingsSchema = joi
  .object({
    internetlessMode: joi.boolean(),
  })
  .min(1);

/**
 * Get settings.
 * @param req
 * @param res
 */
function getSettings(_req: Request, res: Response): void {
  res.status(200).json(settingsStore.getSettings());
}

/**
 * Update settings.
 * @param req
 * @param res
 */
function updateSettings(req: Request, res: Response): void {
  const settingsToUpdate = settingsSchema.validate(req.body || {}, {
    stripUnknown: true,
  });
  if (settingsToUpdate.error) {
    sendErrorResponse(res, 400, sanitizeApiError(settingsToUpdate.error));
    return;
  }

  const settingsUpdated = settingsStore.updateSettings(settingsToUpdate.value);
  res.status(200).json(settingsUpdated);
}

/**
 * Update settings via deprecated PUT alias.
 * @param req
 * @param res
 */
function updateSettingsDeprecatedPut(req: Request, res: Response): void {
  log.warn(deprecatedPutWarning);
  res.setHeader('Deprecation', deprecatedPutDeprecation);
  res.setHeader('Sunset', deprecatedPutSunset);
  updateSettings(req, res);
}

/**
 * Init router.
 * @returns {*}
 */
export function init() {
  router.use(nocache());
  router.get('/', getSettings);
  router.patch('/', updateSettings);
  // Backward compatibility alias: retained temporarily, prefer PATCH semantics.
  router.put('/', updateSettingsDeprecatedPut);
  return router;
}
