import {
  DEFAULT_OUTBOUND_HTTP_TIMEOUT_MS,
  getOutboundHttpTimeoutMs,
} from '../configuration/runtime-defaults.js';

export const REGISTRY_BEARER_TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;
export const REGISTRY_REQUEST_TIMEOUT_MS = DEFAULT_OUTBOUND_HTTP_TIMEOUT_MS;

export function getRegistryRequestTimeoutMs(): number {
  return getOutboundHttpTimeoutMs();
}
