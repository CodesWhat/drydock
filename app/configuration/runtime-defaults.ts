import { toPositiveInteger } from '../util/parse.js';

export const DEFAULT_OUTBOUND_HTTP_TIMEOUT_MS = 30_000;
export const DEFAULT_CACHE_MAX_ENTRIES = 500;

export function getOutboundHttpTimeoutMs(): number {
  return toPositiveInteger(
    process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS,
    DEFAULT_OUTBOUND_HTTP_TIMEOUT_MS,
  );
}

export function getDefaultCacheMaxEntries(): number {
  return toPositiveInteger(process.env.DD_DEFAULT_CACHE_MAX_ENTRIES, DEFAULT_CACHE_MAX_ENTRIES);
}
