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
  'PUT /api/settings is deprecated and will be removed in API v2. Use PATCH /api/settings instead.';
// '@1772236800' = 2026-02-28T00:00:00Z, the v1.4.0 GA date (see CHANGELOG.md
// and the "PUT /api/settings" entry in DEPRECATIONS.md) — the date this
// route actually became deprecated. Per RFC 9745 the Deprecation value must
// be the instant the resource became deprecated, a past/current date, never
// the same instant as the future Sunset removal date below.
const deprecatedPutDeprecation = '@1772236800';
const deprecatedPutSunset = 'Fri, 01 Jan 2027 00:00:00 GMT';

const settingsSchema = joi
  .object({
    internetlessMode: joi.boolean(),
    updateMode: joi.string().valid(...settingsStore.UPDATE_MODES),
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
