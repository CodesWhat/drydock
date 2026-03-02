import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  resolveConfiguredPath,
  resolveConfiguredPathWithinBase,
  resolveFromRuntimeRoot,
} from '../runtime/paths.js';
import * as store from '../store/index.js';
import { BUNDLED_ICON_PROVIDERS } from './icons.providers.js';
import { ICON_CACHE_MAX_BYTES, ICON_CACHE_MAX_FILES, ICON_CACHE_TTL_MS } from './icons.settings.js';

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

async function iconExists(iconPath: string) {
  try {
    await fs.access(iconPath);
    return true;
  } catch {
    return false;
  }
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

async function isCachedIconUsable(iconPath: string) {
  if (!(await iconExists(iconPath))) {
    return false;
  }

  try {
    const iconStats = await fs.stat(iconPath);
    if (!iconStats.isFile()) {
      return false;
    }
    if (Date.now() - iconStats.mtimeMs > ICON_CACHE_TTL_MS) {
      await fs.unlink(iconPath).catch(() => {});
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

type IconCacheEntry = {
  path: string;
  mtimeMs: number;
  size: number;
};

async function listIconCacheEntries() {
  const cacheBase = getIconCacheBaseDirectory();
  const providerEntries = await fs.readdir(cacheBase, { withFileTypes: true }).catch(() => []);
  const cacheEntries: IconCacheEntry[] = [];

  for (const providerEntry of providerEntries) {
    if (!providerEntry.isDirectory()) {
      continue;
    }
    const providerDirectory = path.join(cacheBase, providerEntry.name);
    const iconEntries = await fs.readdir(providerDirectory).catch(() => []);
    for (const iconEntry of iconEntries) {
      const iconPath = path.join(providerDirectory, iconEntry);
      try {
        const iconStats = await fs.stat(iconPath);
        if (!iconStats.isFile()) {
          continue;
        }
        cacheEntries.push({
          path: iconPath,
          mtimeMs: iconStats.mtimeMs,
          size: iconStats.size,
        });
      } catch {
        // Ignore entries that disappear between directory scan and stat.
      }
    }
  }

  return cacheEntries;
}

async function enforceIconCacheLimits(options: { protectedPath?: string } = {}) {
  const nowMs = Date.now();
  const cacheEntries = await listIconCacheEntries();
  const activeEntries: IconCacheEntry[] = [];
  let totalBytes = 0;

  for (const cacheEntry of cacheEntries) {
    if (nowMs - cacheEntry.mtimeMs > ICON_CACHE_TTL_MS) {
      await fs.unlink(cacheEntry.path).catch(() => {});
      continue;
    }
    activeEntries.push(cacheEntry);
    totalBytes += cacheEntry.size;
  }

  activeEntries.sort((left, right) => left.mtimeMs - right.mtimeMs);
  while (activeEntries.length > ICON_CACHE_MAX_FILES || totalBytes > ICON_CACHE_MAX_BYTES) {
    const indexToEvict = activeEntries.findIndex(
      (cacheEntry) => cacheEntry.path !== options.protectedPath,
    );
    if (indexToEvict === -1) {
      break;
    }

    const [entryToEvict] = activeEntries.splice(indexToEvict, 1);
    await fs.unlink(entryToEvict.path).catch(() => {});
    totalBytes = Math.max(0, totalBytes - entryToEvict.size);
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

async function clearIconCache() {
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
  return cleared;
}

export {
  clearIconCache,
  enforceIconCacheLimits,
  findBundledIconPath,
  getIconCachePath,
  isCachedIconUsable,
  writeIconAtomically,
};
