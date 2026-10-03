import express from 'express';
import nocache from 'nocache';
import { deriveVersionIdentity } from '../configuration/version-identity.js';
import * as storeApp from '../store/app.js';

/**
 * App infos router.
 * @type {Router}
 */
const router = express.Router();

/**
 * Get app infos.
 *
 * `version` is the base version a user reads (`1.6.1`); `build` is the full
 * build identity (`1.6.1-rc.15`). They differ on a stable release, which is
 * the promoted release candidate image.
 * @param req the request
 * @param res the response
 */
function getAppInfos(req, res) {
  const appInfos = storeApp.getAppInfos();
  res
    .status(200)
    .json(appInfos ? { ...appInfos, ...deriveVersionIdentity(appInfos.version) } : appInfos);
}
/**
 * Init Router.
 * @returns {*}
 */
export function init() {
  router.use(nocache());
  router.get('/', getAppInfos);
  return router;
}
