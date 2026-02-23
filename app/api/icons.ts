import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import axios from 'axios';
import express from 'express';
import joi from 'joi';
import logger from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import {
  resolveConfiguredPath,
  resolveConfiguredPathWithinBase,
  resolveFromRuntimeRoot,
} from '../runtime/paths.js';
import * as store from '../store/index.js';
import * as settingsStore from '../store/settings.js';

const router = express.Router();
const log = logger.child({ component: 'icons' });

const CACHE_CONTROL_HEADER = 'public, max-age=31536000, immutable';
const FALLBACK_ICON = 'fab fa-docker';
const inFlightIconFetches = new Map<string, Promise<void>>();
const BUNDLED_ICON_PROVIDERS = new Set(['selfhst']);

const providers = {
  homarr: {
    extension: 'png',
    url: (slug: string) =>
      `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/${slug}.png`,
    contentType: 'image/png',
  },
  selfhst: {
    extension: 'png',
    url: (slug: string) => `https://cdn.jsdelivr.net/gh/selfhst/icons/png/${slug}.png`,
    contentType: 'image/png',
  },
  simple: {
    extension: 'svg',
    url: (slug: string) => `https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/${slug}.svg`,
    contentType: 'image/svg+xml',
  },
};

const iconRequestSchema = joi.object({
  provider: joi
    .string()
    .valid(...Object.keys(providers))
    .required(),
  slug: joi
    .string()
    .pattern(/^[a-z0-9][a-z0-9._-]{0,127}$/i)
    .required(),
});

function normalizeSlug(slug: string, extension: string): string {
  const slugNormalized = slug.toLowerCase();
  const suffix = `.${extension}`;
  if (slugNormalized.endsWith(suffix)) {
    return slugNormalized.slice(0, -suffix.length);
  }
  return slugNormalized;
}

function getIconCacheBaseDirectory() {
  const storeDirectory = resolveConfiguredPath(store.getConfiguration().path, {
    label: 'DD_STORE_PATH',
  });
  return resolveConfiguredPathWithinBase(storeDirectory, 'icons', {
    label: 'Icon cache base path',
  });
}

function getIconCachePath(provider: string, slug: string, extension: string) {
  const cacheBase = getIconCacheBaseDirectory();
  const providerDirectory = resolveConfiguredPathWithinBase(cacheBase, provider, {
    label: 'Icon provider path',
  });
  return resolveConfiguredPathWithinBase(providerDirectory, `${slug}.${extension}`, {
    label: 'Icon slug path',
  });
}

function getBundledIconCandidates(provider: string, slug: string, extension: string) {
  const fileName = `${slug}.${extension}`;
  return Array.from(
    new Set([
      resolveFromRuntimeRoot('assets', 'icons', provider, fileName),
      // Source-tree fallback for local dev/test when runtime root resolves to dist.
      resolveFromRuntimeRoot('..', 'assets', 'icons', provider, fileName),
    ]),
  );
}

async function findBundledIconPath(provider: string, slug: string, extension: string) {
  if (!BUNDLED_ICON_PROVIDERS.has(provider)) {
    return null;
  }
  const candidates = getBundledIconCandidates(provider, slug, extension);
  for (const candidate of candidates) {
    if (await iconExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function sendCachedIcon(res, iconPath: string, contentType: string) {
  res.set('Cache-Control', CACHE_CONTROL_HEADER);
  res.type(contentType);
  res.sendFile(iconPath);
}

async function iconExists(iconPath: string) {
  try {
    await fs.access(iconPath);
    return true;
  } catch {
    return false;
  }
}

async function writeIconAtomically(iconPath: string, data: Buffer) {
  const tmpPath = `${iconPath}.tmp.${crypto.randomUUID()}`;
  await fs.mkdir(path.dirname(iconPath), { recursive: true });
  try {
    await fs.writeFile(tmpPath, data);
    await fs.rename(tmpPath, iconPath);
  } catch (e) {
    await fs.unlink(tmpPath).catch(() => {});
    throw e;
  }
}

async function fetchAndCacheIcon({
  provider,
  slug,
  cachePath,
}: {
  provider: string;
  slug: string;
  cachePath: string;
}) {
  const providerConfig = providers[provider];
  if (await iconExists(cachePath)) {
    return;
  }
  const response = await axios.get(providerConfig.url(slug), {
    responseType: 'arraybuffer',
    timeout: 10000,
  });
  await writeIconAtomically(cachePath, Buffer.from(response.data));
}

function fetchAndCacheIconOnce({
  provider,
  slug,
  cachePath,
}: {
  provider: string;
  slug: string;
  cachePath: string;
}) {
  const cacheKey = `${provider}/${slug}`;
  const inFlightRequest = inFlightIconFetches.get(cacheKey);
  if (inFlightRequest) {
    return inFlightRequest;
  }

  const fetchPromise = fetchAndCacheIcon({
    provider,
    slug,
    cachePath,
  }).finally(() => {
    inFlightIconFetches.delete(cacheKey);
  });

  inFlightIconFetches.set(cacheKey, fetchPromise);
  return fetchPromise;
}

/**
 * Get icon from cache, bundled assets, or jsDelivr.
 * @param req
 * @param res
 */
async function getIcon(req, res) {
  const iconRequest = iconRequestSchema.validate(req.params || {}, { stripUnknown: true });
  if (iconRequest.error) {
    res.status(400).json({
      error: iconRequest.error.message,
    });
    return;
  }

  const provider = iconRequest.value.provider;
  const providerConfig = providers[provider];
  const slug = normalizeSlug(iconRequest.value.slug, providerConfig.extension);
  const cachePath = getIconCachePath(provider, slug, providerConfig.extension);

  if (await iconExists(cachePath)) {
    sendCachedIcon(res, cachePath, providerConfig.contentType);
    return;
  }

  const bundledIconPath = await findBundledIconPath(provider, slug, providerConfig.extension);
  if (bundledIconPath) {
    sendCachedIcon(res, bundledIconPath, providerConfig.contentType);
    return;
  }

  if (settingsStore.isInternetlessModeEnabled()) {
    res.status(404).json({
      error: `Icon ${provider}/${slug} is not cached`,
      fallbackIcon: FALLBACK_ICON,
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
    if (statusCode === 404) {
      res.status(404).json({
        error: `Icon ${provider}/${slug} was not found`,
        fallbackIcon: FALLBACK_ICON,
      });
      return;
    }
    const errorMessage = e instanceof Error ? e.message : String(e);
    log.warn(
      `Unable to fetch icon provider=${sanitizeLogParam(provider)} slug=${sanitizeLogParam(slug)} (${sanitizeLogParam(errorMessage)})`,
    );
    res.status(502).json({
      error: `Unable to fetch icon ${provider}/${slug} (${errorMessage})`,
    });
  }
}

/**
 * Clear icon cache.
 * Removes all cached icons from disk.
 * @param req
 * @param res
 */
async function clearCache(req, res) {
  try {
    const cacheBase = getIconCacheBaseDirectory();
    const entries = await fs.readdir(cacheBase, { withFileTypes: true }).catch(() => []);
    let cleared = 0;
    for (const entry of entries) {
      const entryPath = path.join(cacheBase, entry.name);
      if (entry.isDirectory()) {
        const files = await fs.readdir(entryPath).catch(() => []);
        for (const file of files) {
          await fs.unlink(path.join(entryPath, file)).catch(() => {});
          cleared++;
        }
      }
    }
    log.info(`Cleared ${cleared} cached icons`);
    res.status(200).json({ cleared });
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    log.warn(`Failed to clear icon cache: ${sanitizeLogParam(errorMessage)}`);
    res.status(500).json({ error: `Failed to clear icon cache: ${errorMessage}` });
  }
}

/**
 * Init router.
 * @returns {*}
 */
export function init() {
  router.get('/:provider/:slug', getIcon);
  router.delete('/cache', clearCache);
  return router;
}
