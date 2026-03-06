import express from 'express';
import nocache from 'nocache';
import passport from 'passport';
import { getServerConfiguration } from '../configuration/index.js';
import { output } from '../prometheus/index.js';
import * as auth from './auth.js';

/**
 * Prometheus Metrics router.
 * @type {Router}
 */
const router = express.Router();

/**
 * Return Prometheus Metrics as String.
 * @param req
 * @param res
 */
async function outputMetrics(req, res) {
  res
    .status(200)
    .type('text')
    .send(await output());
}

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
  const configuration = getServerConfiguration();
  router.use(nocache());

  if (configuration.metrics?.auth !== false) {
    // Routes to protect after this line
    router.use(passport.authenticate(auth.getAllIds()));
  }

  router.get('/', outputMetrics);
  return router;
}
