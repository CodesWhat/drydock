import {
  DEFAULT_CACHE_MAX_ENTRIES,
  DEFAULT_OUTBOUND_HTTP_TIMEOUT_MS,
  getDefaultCacheMaxEntries,
  getOutboundHttpTimeoutMs,
} from './runtime-defaults.js';

describe('configuration/runtime-defaults', () => {
  test('uses fallback defaults when env overrides are missing', () => {
    const previousTimeout = process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS;
    const previousCacheMaxEntries = process.env.DD_DEFAULT_CACHE_MAX_ENTRIES;

    try {
      delete process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS;
      delete process.env.DD_DEFAULT_CACHE_MAX_ENTRIES;

      expect(getOutboundHttpTimeoutMs()).toBe(DEFAULT_OUTBOUND_HTTP_TIMEOUT_MS);
      expect(getDefaultCacheMaxEntries()).toBe(DEFAULT_CACHE_MAX_ENTRIES);
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS;
      } else {
        process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS = previousTimeout;
      }
      if (previousCacheMaxEntries === undefined) {
        delete process.env.DD_DEFAULT_CACHE_MAX_ENTRIES;
      } else {
        process.env.DD_DEFAULT_CACHE_MAX_ENTRIES = previousCacheMaxEntries;
      }
    }
  });

  test('uses positive integer overrides when provided', () => {
    const previousTimeout = process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS;
    const previousCacheMaxEntries = process.env.DD_DEFAULT_CACHE_MAX_ENTRIES;

    try {
      process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS = '4567';
      process.env.DD_DEFAULT_CACHE_MAX_ENTRIES = '321';

      expect(getOutboundHttpTimeoutMs()).toBe(4567);
      expect(getDefaultCacheMaxEntries()).toBe(321);
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS;
      } else {
        process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS = previousTimeout;
      }
      if (previousCacheMaxEntries === undefined) {
        delete process.env.DD_DEFAULT_CACHE_MAX_ENTRIES;
      } else {
        process.env.DD_DEFAULT_CACHE_MAX_ENTRIES = previousCacheMaxEntries;
      }
    }
  });

  test('falls back to defaults for invalid override values', () => {
    const previousTimeout = process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS;
    const previousCacheMaxEntries = process.env.DD_DEFAULT_CACHE_MAX_ENTRIES;

    try {
      process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS = '0';
      process.env.DD_DEFAULT_CACHE_MAX_ENTRIES = '-1';

      expect(getOutboundHttpTimeoutMs()).toBe(DEFAULT_OUTBOUND_HTTP_TIMEOUT_MS);
      expect(getDefaultCacheMaxEntries()).toBe(DEFAULT_CACHE_MAX_ENTRIES);
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS;
      } else {
        process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS = previousTimeout;
      }
      if (previousCacheMaxEntries === undefined) {
        delete process.env.DD_DEFAULT_CACHE_MAX_ENTRIES;
      } else {
        process.env.DD_DEFAULT_CACHE_MAX_ENTRIES = previousCacheMaxEntries;
      }
    }
  });
});
