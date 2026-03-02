import axios from 'axios';
import { providers } from './icons.providers.js';
import { getIconInFlightTimeoutMs } from './icons.settings.js';
import {
  enforceIconCacheLimits,
  isCachedIconUsable,
  writeIconAtomically,
} from './icons.storage.js';

const inFlightIconFetches = new Map<string, Promise<void>>();

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
  if (await isCachedIconUsable(cachePath)) {
    return;
  }
  const response = await axios.get(providerConfig.url(slug), {
    responseType: 'arraybuffer',
    timeout: 10000,
  });
  await writeIconAtomically(cachePath, Buffer.from(response.data));
  await enforceIconCacheLimits({ protectedPath: cachePath });
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

  const timeoutMs = getIconInFlightTimeoutMs();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const fetchPromise = Promise.race([
    fetchAndCacheIcon({
      provider,
      slug,
      cachePath,
    }),
    new Promise<void>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`Icon fetch timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
    inFlightIconFetches.delete(cacheKey);
  });

  inFlightIconFetches.set(cacheKey, fetchPromise);
  return fetchPromise;
}

export { fetchAndCacheIconOnce };
