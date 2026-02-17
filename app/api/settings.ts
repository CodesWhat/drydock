import express from 'express';
import joi from 'joi';
import nocache from 'nocache';
import * as settingsStore from '../store/settings.js';

const router = express.Router();

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
function getSettings(req, res) {
  res.status(200).json(settingsStore.getSettings());
}

/**
 * Update settings.
 * @param req
 * @param res
 */
function updateSettings(req, res) {
  const settingsToUpdate = settingsSchema.validate(req.body || {}, {
    stripUnknown: true,
  });
  if (settingsToUpdate.error) {
    res.status(400).json({
      error: settingsToUpdate.error.message,
    });
    return;
  }

  const settingsUpdated = settingsStore.updateSettings(settingsToUpdate.value);
  res.status(200).json(settingsUpdated);
}

/**
 * Init router.
 * @returns {*}
 */
export function init() {
  router.use(nocache());
  router.get('/', getSettings);
  router.put('/', updateSettings);
  return router;
}
