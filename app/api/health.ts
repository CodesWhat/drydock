import express from 'express';
import healthcheck from 'express-healthcheck';
import nocache from 'nocache';

/**
 * Healthcheck router.
 * @type {Router}
 */
const router = express.Router();

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
  router.use(nocache());
  router.get('/', healthcheck());
  return router;
}
