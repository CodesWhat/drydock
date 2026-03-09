import axios from 'axios';
import express, { type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { getServerConfiguration } from '../configuration/index.js';
import logger from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import * as settingsStore from '../store/settings.js';
import { sendErrorResponse } from './error-response.js';
import { sanitizeApiError } from './helpers.js';
import { fetchAndCacheIconOnce } from './icons/fetch.js';
import { normalizeSlug, providers } from './icons/providers.js';
import { sendCachedIcon, sendMissingIconResponse } from './icons/response.js';
import {
  ICON_PROXY_RATE_LIMIT_MAX,
  ICON_PROXY_RATE_LIMIT_WINDOW_MS,
  MISSING_UPSTREAM_STATUS_CODES,
} from './icons/settings.js';
import {
  clearIconCache,
  findBundledIconPath,
  getIconCachePath,
  isCachedIconUsable,
} from './icons/storage.js';
import { iconRequestSchema } from './icons/validation.js';
import {
  createAuthenticatedRouteRateLimitKeyGenerator,
  isIdentityAwareRateLimitKeyingEnabled,
} from './rate-limit-key.js';

const router = express.Router();
const log = logger.child({ component: 'icons' });

/**
 * Get icon from cache, bundled assets, or jsDelivr.
 */
async function getIcon(req: Request, res: Response) {
  const iconRequest = iconRequestSchema.validate(req.params || {}, { stripUnknown: true });
  if (iconRequest.error) {
    sendErrorResponse(res, 400, sanitizeApiError(iconRequest.error));
    return;
  }

  const provider = iconRequest.value.provider;
  const providerConfig = providers[provider];
  const slug = normalizeSlug(iconRequest.value.slug, providerConfig.extension);
  const cachePath = getIconCachePath(provider, slug, providerConfig.extension);

  if (await isCachedIconUsable(cachePath)) {
    sendCachedIcon(res, cachePath, providerConfig.contentType);
    return;
  }

  const bundledIconPath = await findBundledIconPath(provider, slug, providerConfig.extension);
  if (bundledIconPath) {
    sendCachedIcon(res, bundledIconPath, providerConfig.contentType);
    return;
  }

  if (settingsStore.isInternetlessModeEnabled()) {
    await sendMissingIconResponse({
      req,
      res,
      errorMessage: `Icon ${provider}/${slug} is not cached`,
    });
    return;
  }

  try {
    await fetchAndCacheIconOnce({
      provider,
      slug,
      cachePath,
    });
    sendCachedIcon(res, cachePath, providerConfig.contentType);
  } catch (e) {
    const statusCode = axios.isAxiosError(e) ? e.response?.status : undefined;
    if (statusCode && MISSING_UPSTREAM_STATUS_CODES.has(statusCode)) {
      await sendMissingIconResponse({
        req,
        res,
        errorMessage: `Icon ${provider}/${slug} was not found`,
      });
      return;
    }
    const errorMessage = e instanceof Error ? e.message : String(e);
    log.warn(
      `Unable to fetch icon provider=${sanitizeLogParam(provider)} slug=${sanitizeLogParam(slug)} (${sanitizeLogParam(errorMessage)})`,
    );
    sendErrorResponse(res, 502, `Unable to fetch icon ${provider}/${slug}`);
  }
}

/**
 * Clear icon cache.
 * Removes all cached icons from disk.
 */
async function clearCache(_req: Request, res: Response) {
  try {
    const cleared = await clearIconCache();
    log.info(`Cleared ${cleared} cached icons`);
    res.status(200).json({ cleared });
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    log.warn(`Failed to clear icon cache: ${sanitizeLogParam(errorMessage)}`);
    sendErrorResponse(res, 500, 'Failed to clear icon cache');
  }
}

/**
 * Init router.
 * @returns {*}
 */
export function init() {
  const serverConfiguration = getServerConfiguration() as Record<string, unknown>;
  const identityAwareRateLimitKeyGenerator = createAuthenticatedRouteRateLimitKeyGenerator(
    isIdentityAwareRateLimitKeyingEnabled(serverConfiguration),
  );

  const iconProxyRateLimiter = rateLimit({
    windowMs: ICON_PROXY_RATE_LIMIT_WINDOW_MS,
    max: ICON_PROXY_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    ...(identityAwareRateLimitKeyGenerator
      ? { keyGenerator: identityAwareRateLimitKeyGenerator }
      : {}),
  });
  router.get('/:provider/:slug', iconProxyRateLimiter, getIcon);
  router.delete('/cache', clearCache);
  return router;
}
