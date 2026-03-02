const CACHE_CONTROL_HEADER = 'public, max-age=31536000, immutable';
const FALLBACK_ICON = 'fab fa-docker';
const FALLBACK_IMAGE_PROVIDER = 'selfhst';
const FALLBACK_IMAGE_SLUG = 'docker';
const MISSING_UPSTREAM_STATUS_CODES = new Set([403, 404]);

const DEFAULT_ICON_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_ICON_CACHE_MAX_FILES = 5000;
const DEFAULT_ICON_CACHE_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_ICON_IN_FLIGHT_TIMEOUT_MS = 15 * 1000;
const DEFAULT_ICON_PROXY_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const DEFAULT_ICON_PROXY_RATE_LIMIT_MAX = 100;

function toPositiveInteger(rawValue: string | undefined, fallbackValue: number): number {
  const parsedValue = Number.parseInt(String(rawValue ?? ''), 10);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return fallbackValue;
  }
  return parsedValue;
}

const ICON_CACHE_TTL_MS = toPositiveInteger(
  process.env.DD_ICON_CACHE_TTL_MS,
  DEFAULT_ICON_CACHE_TTL_MS,
);
const ICON_CACHE_MAX_FILES = toPositiveInteger(
  process.env.DD_ICON_CACHE_MAX_FILES,
  DEFAULT_ICON_CACHE_MAX_FILES,
);
const ICON_CACHE_MAX_BYTES = toPositiveInteger(
  process.env.DD_ICON_CACHE_MAX_BYTES,
  DEFAULT_ICON_CACHE_MAX_BYTES,
);
const ICON_PROXY_RATE_LIMIT_WINDOW_MS = toPositiveInteger(
  process.env.DD_ICON_PROXY_RATE_LIMIT_WINDOW_MS,
  DEFAULT_ICON_PROXY_RATE_LIMIT_WINDOW_MS,
);
const ICON_PROXY_RATE_LIMIT_MAX = toPositiveInteger(
  process.env.DD_ICON_PROXY_RATE_LIMIT_MAX,
  DEFAULT_ICON_PROXY_RATE_LIMIT_MAX,
);

function getIconInFlightTimeoutMs() {
  return toPositiveInteger(
    process.env.DD_ICON_IN_FLIGHT_TIMEOUT_MS,
    DEFAULT_ICON_IN_FLIGHT_TIMEOUT_MS,
  );
}

export {
  CACHE_CONTROL_HEADER,
  FALLBACK_ICON,
  FALLBACK_IMAGE_PROVIDER,
  FALLBACK_IMAGE_SLUG,
  ICON_CACHE_MAX_BYTES,
  ICON_CACHE_MAX_FILES,
  ICON_CACHE_TTL_MS,
  ICON_PROXY_RATE_LIMIT_MAX,
  ICON_PROXY_RATE_LIMIT_WINDOW_MS,
  MISSING_UPSTREAM_STATUS_CODES,
  getIconInFlightTimeoutMs,
};
