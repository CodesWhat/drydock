import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  resolveConfiguredPath,
  resolveConfiguredPathWithinBase,
  resolveFromRuntimeRoot,
} from '../../runtime/paths.js';
import * as store from '../../store/index.js';
import { BUNDLED_ICON_PROVIDERS } from './providers.js';
import {
  ICON_CACHE_ENFORCEMENT_INTERVAL_MS,
  ICON_CACHE_MAX_BYTES,
  ICON_CACHE_MAX_FILES,
  ICON_CACHE_TTL_MS,
} from './settings.js';

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

const ICON_CACHE_STAT_BATCH_SIZE = 64;
let lastIconCacheEnforcementMs = 0;
let iconCacheEnforcementPromise: Promise<void> | null = null;
const protectedCachePathsDuringEnforcement = new Set<string>();

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
    for (let index = 0; index < iconEntries.length; index += ICON_CACHE_STAT_BATCH_SIZE) {
      const iconBatch = iconEntries.slice(index, index + ICON_CACHE_STAT_BATCH_SIZE);
      const statResults = await Promise.all(
        iconBatch.map(async (iconEntry): Promise<IconCacheEntry | null> => {
          const iconPath = path.join(providerDirectory, iconEntry);
          try {
            const iconStats = await fs.stat(iconPath);
            if (!iconStats.isFile()) {
              return null;
            }
            return {
              path: iconPath,
              mtimeMs: iconStats.mtimeMs,
              size: iconStats.size,
            };
          } catch {
            // Ignore entries that disappear between directory scan and stat.
            return null;
          }
        }),
      );

      for (const statResult of statResults) {
        if (statResult) {
          cacheEntries.push(statResult);
        }
      }
    }
  }

  return cacheEntries;
}

async function runIconCacheEnforcement() {
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
      (cacheEntry) => !protectedCachePathsDuringEnforcement.has(cacheEntry.path),
    );
    if (indexToEvict === -1) {
      break;
    }

    const [entryToEvict] = activeEntries.splice(indexToEvict, 1);
    await fs.unlink(entryToEvict.path).catch(() => {});
    totalBytes = Math.max(0, totalBytes - entryToEvict.size);
  }
}

async function enforceIconCacheLimits(options: { protectedPath?: string } = {}) {
  if (options.protectedPath) {
    protectedCachePathsDuringEnforcement.add(options.protectedPath);
  }

  if (iconCacheEnforcementPromise) {
    await iconCacheEnforcementPromise;
    return;
  }

  if (Date.now() - lastIconCacheEnforcementMs < ICON_CACHE_ENFORCEMENT_INTERVAL_MS) {
    if (options.protectedPath) {
      protectedCachePathsDuringEnforcement.delete(options.protectedPath);
    }
    return;
  }

  iconCacheEnforcementPromise = runIconCacheEnforcement().finally(() => {
    lastIconCacheEnforcementMs = Date.now();
    iconCacheEnforcementPromise = null;
    protectedCachePathsDuringEnforcement.clear();
  });

  await iconCacheEnforcementPromise;
}

function resetIconCacheEnforcementStateForTests() {
  lastIconCacheEnforcementMs = 0;
  iconCacheEnforcementPromise = null;
  protectedCachePathsDuringEnforcement.clear();
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
  resetIconCacheEnforcementStateForTests,
  writeIconAtomically,
};
