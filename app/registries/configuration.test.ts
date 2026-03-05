import {
  getRegistryRequestTimeoutMs,
  REGISTRY_BEARER_TOKEN_CACHE_TTL_MS,
  REGISTRY_REQUEST_TIMEOUT_MS,
} from './configuration.js';

describe('registries/configuration', () => {
  test('exports centralized cache ttl and timeout defaults', () => {
    const previousTimeout = process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS;
    delete process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS;

    expect(REGISTRY_BEARER_TOKEN_CACHE_TTL_MS).toBe(5 * 60 * 1000);
    expect(getRegistryRequestTimeoutMs()).toBe(REGISTRY_REQUEST_TIMEOUT_MS);

    if (previousTimeout === undefined) {
      delete process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS;
    } else {
      process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS = previousTimeout;
    }
  });

  test('reads outbound timeout override from environment', () => {
    const previousTimeout = process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS;
    process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS = '2345';

    expect(getRegistryRequestTimeoutMs()).toBe(2345);

    if (previousTimeout === undefined) {
      delete process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS;
    } else {
      process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS = previousTimeout;
    }
  });
});
