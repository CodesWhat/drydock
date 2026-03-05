const ICON_ENV_KEYS = [
  'DD_ICON_CACHE_TTL_MS',
  'DD_ICON_CACHE_MAX_FILES',
  'DD_ICON_CACHE_MAX_BYTES',
  'DD_ICON_CACHE_ENFORCEMENT_INTERVAL_MS',
  'DD_ICON_IN_FLIGHT_TIMEOUT_MS',
  'DD_ICON_PROXY_RATE_LIMIT_WINDOW_MS',
  'DD_ICON_PROXY_RATE_LIMIT_MAX',
] as const;

let originalEnvValues: Record<string, string | undefined> = {};

async function importSettingsModule() {
  vi.resetModules();
  return import('./settings.js');
}

describe('icons/settings', () => {
  beforeEach(() => {
    originalEnvValues = {};
    for (const key of ICON_ENV_KEYS) {
      originalEnvValues[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ICON_ENV_KEYS) {
      const value = originalEnvValues[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test('uses documented defaults when icon cache env vars are unset', async () => {
    const settings = await importSettingsModule();

    expect(settings.ICON_CACHE_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(settings.ICON_CACHE_MAX_FILES).toBe(5000);
    expect(settings.ICON_CACHE_MAX_BYTES).toBe(100 * 1024 * 1024);
    expect(settings.ICON_CACHE_ENFORCEMENT_INTERVAL_MS).toBe(10 * 1000);
    expect(settings.ICON_PROXY_RATE_LIMIT_WINDOW_MS).toBe(60 * 1000);
    expect(settings.ICON_PROXY_RATE_LIMIT_MAX).toBe(100);
  });

  test('applies positive integer overrides from environment', async () => {
    process.env.DD_ICON_CACHE_TTL_MS = '9000';
    process.env.DD_ICON_CACHE_MAX_FILES = '7';
    process.env.DD_ICON_CACHE_MAX_BYTES = '4096';
    process.env.DD_ICON_CACHE_ENFORCEMENT_INTERVAL_MS = '250';
    process.env.DD_ICON_PROXY_RATE_LIMIT_WINDOW_MS = '1234';
    process.env.DD_ICON_PROXY_RATE_LIMIT_MAX = '9';

    const settings = await importSettingsModule();

    expect(settings.ICON_CACHE_TTL_MS).toBe(9000);
    expect(settings.ICON_CACHE_MAX_FILES).toBe(7);
    expect(settings.ICON_CACHE_MAX_BYTES).toBe(4096);
    expect(settings.ICON_CACHE_ENFORCEMENT_INTERVAL_MS).toBe(250);
    expect(settings.ICON_PROXY_RATE_LIMIT_WINDOW_MS).toBe(1234);
    expect(settings.ICON_PROXY_RATE_LIMIT_MAX).toBe(9);
  });

  test('falls back to defaults when env overrides are non-positive or invalid', async () => {
    process.env.DD_ICON_CACHE_TTL_MS = '0';
    process.env.DD_ICON_CACHE_MAX_FILES = '-1';
    process.env.DD_ICON_CACHE_MAX_BYTES = 'not-a-number';
    process.env.DD_ICON_CACHE_ENFORCEMENT_INTERVAL_MS = '';
    process.env.DD_ICON_PROXY_RATE_LIMIT_WINDOW_MS = '-100';
    process.env.DD_ICON_PROXY_RATE_LIMIT_MAX = '0';

    const settings = await importSettingsModule();

    expect(settings.ICON_CACHE_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(settings.ICON_CACHE_MAX_FILES).toBe(5000);
    expect(settings.ICON_CACHE_MAX_BYTES).toBe(100 * 1024 * 1024);
    expect(settings.ICON_CACHE_ENFORCEMENT_INTERVAL_MS).toBe(10 * 1000);
    expect(settings.ICON_PROXY_RATE_LIMIT_WINDOW_MS).toBe(60 * 1000);
    expect(settings.ICON_PROXY_RATE_LIMIT_MAX).toBe(100);
  });

  test('reads in-flight timeout from env at call time', async () => {
    const settings = await importSettingsModule();

    expect(settings.getIconInFlightTimeoutMs()).toBe(15 * 1000);

    process.env.DD_ICON_IN_FLIGHT_TIMEOUT_MS = '22';
    expect(settings.getIconInFlightTimeoutMs()).toBe(22);

    process.env.DD_ICON_IN_FLIGHT_TIMEOUT_MS = '-1';
    expect(settings.getIconInFlightTimeoutMs()).toBe(15 * 1000);
  });

  test('treats 403 and 404 as missing upstream icon statuses', async () => {
    const settings = await importSettingsModule();

    expect(settings.MISSING_UPSTREAM_STATUS_CODES.has(403)).toBe(true);
    expect(settings.MISSING_UPSTREAM_STATUS_CODES.has(404)).toBe(true);
    expect(settings.MISSING_UPSTREAM_STATUS_CODES.has(500)).toBe(false);
  });
});
