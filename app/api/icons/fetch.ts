import axios from 'axios';
import { providers } from './providers.js';
import { getIconInFlightTimeoutMs } from './settings.js';
import { enforceIconCacheLimits, isCachedIconUsable, writeIconAtomically } from './storage.js';

const inFlightIconFetches = new Map<string, Promise<void>>();
const MAX_ICON_DOWNLOAD_BYTES = 2 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function looksLikePng(payload: Buffer) {
  return (
    payload.length >= PNG_SIGNATURE.length &&
    payload.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  );
}

function looksLikeSvg(payload: Buffer) {
  const head = payload
    .subarray(0, 2048)
    .toString('utf8')
    .replace(/^\uFEFF/u, '')
    .trimStart()
    .toLowerCase();
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'));
}

function validateFetchedIconPayload(data: unknown, extension: string): Buffer {
  let payload: Buffer;
  if (Buffer.isBuffer(data)) {
    payload = data;
  } else {
    try {
      payload = Buffer.from(data as ArrayBuffer);
    } catch {
      throw new Error('Invalid icon payload: upstream response is not binary');
    }
  }

  if (payload.length === 0 || payload.length > MAX_ICON_DOWNLOAD_BYTES) {
    throw new Error('Invalid icon payload: upstream icon size is out of bounds');
  }

  if (extension === 'png') {
    if (!looksLikePng(payload)) {
      throw new Error('Invalid icon payload: expected png bytes');
    }
    return payload;
  }

  if (extension === 'svg') {
    if (!looksLikeSvg(payload)) {
      throw new Error('Invalid icon payload: expected svg bytes');
    }
    return payload;
  }

  throw new Error('Invalid icon payload: unsupported icon extension');
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
  if (await isCachedIconUsable(cachePath)) {
    return;
  }
  const response = await axios.get(providerConfig.url(slug), {
    responseType: 'arraybuffer',
    timeout: 10000,
    maxContentLength: MAX_ICON_DOWNLOAD_BYTES,
    maxBodyLength: MAX_ICON_DOWNLOAD_BYTES,
  });
  const iconPayload = validateFetchedIconPayload(response.data, providerConfig.extension);
  await writeIconAtomically(cachePath, iconPayload);
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

function clearInFlightIconFetchesForTests() {
  inFlightIconFetches.clear();
}

export { clearInFlightIconFetchesForTests, fetchAndCacheIconOnce };
