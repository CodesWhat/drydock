import type { Request } from 'express';
import logger from '../log/index.js';

const log = logger.child({ component: 'api' });

// Top-level resources the former unversioned /api/* alias exposed, taken from
// the v1 router mounts in app/api/api.ts. Fixed on purpose: the first path
// segment only becomes part of the legacy-input key when it is in this list,
// which keeps the key (a metric label and a map key) bounded.
export const LEGACY_API_ALIAS_RESOURCES = [
  'api-keys',
  'app',
  'agents',
  'approvals',
  'audit',
  'auth',
  'authentications',
  'config',
  'containers',
  'debug',
  'dependency-groups',
  'events',
  'group-policies',
  'icons',
  'images',
  'internal',
  'label-overrides',
  'log',
  'notifications',
  'openapi.json',
  'operations',
  'portwing',
  'preferences',
  'registries',
  'self-update',
  'server',
  'settings',
  'stats',
  'store',
  'triggers',
  'update-operations',
  'watchers',
  'webhook',
  'webhooks',
] as const;

export const LEGACY_API_ALIAS_CLIENTS = [
  'homepage',
  'home-assistant',
  'curl',
  'wget',
  'python',
  'go-http',
  'node',
  'browser',
  'other',
  'none',
] as const;

export type LegacyApiAliasClient = (typeof LEGACY_API_ALIAS_CLIENTS)[number];

const RESOURCE_SET: ReadonlySet<string> = new Set(LEGACY_API_ALIAS_RESOURCES);

// Checked in order, first match wins. Specific integrations come before the
// generic HTTP libraries and the browser catch-all.
const CLIENT_RULES: ReadonlyArray<readonly [LegacyApiAliasClient, readonly string[]]> = [
  ['homepage', ['homepage', 'gethomepage']],
  ['home-assistant', ['homeassistant', 'home assistant', 'home-assistant']],
  ['curl', ['curl']],
  ['wget', ['wget']],
  ['python', ['python', 'aiohttp', 'httpx']],
  ['go-http', ['go-http-client']],
  ['node', ['node', 'axios', 'undici']],
  ['browser', ['mozilla', 'chrome', 'safari', 'firefox', 'webkit']],
];

const LOG_INTERVAL_MS = 60 * 60 * 1000;
const MAX_LOGGED_PATH_LENGTH = 200;
const MAX_LOGGED_USER_AGENT_LENGTH = 120;
const lastLoggedAt = new Map<string, number>();

export function resetLegacyApiAliasLogState() {
  lastLoggedAt.clear();
}

function firstHeaderValue(value: unknown): string {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first : '';
}

export function classifyLegacyApiClient(userAgent: unknown): LegacyApiAliasClient {
  const ua = firstHeaderValue(userAgent).toLowerCase();
  if (ua === '') {
    return 'none';
  }
  const rule = CLIENT_RULES.find(([, needles]) => needles.some((needle) => ua.includes(needle)));
  return rule ? rule[0] : 'other';
}

// `path` is relative to the '/api' mount (req.path). Only the first segment is
// ever inspected, and only an allowlisted one is echoed back.
export function getLegacyApiAliasResourceKey(path: string): string {
  const cleaned = path.split(/[?#]/)[0];
  if (cleaned === '' || cleaned === '/') {
    return '/api';
  }
  const segment = cleaned.split('/')[1]?.toLowerCase() ?? '';
  return RESOURCE_SET.has(segment) ? `/api/${segment}/*` : 'unmatched';
}

export function buildLegacyApiAliasKey(req: Request): string {
  const client = classifyLegacyApiClient(req.headers?.['user-agent']);
  const resource = req.route
    ? `${req.baseUrl}${req.route.path}`
    : getLegacyApiAliasResourceKey(req.path);
  return `${resource} via ${client}`;
}

function sanitizeForLog(value: string, limit: number): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strips control characters to prevent log line forgery
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, limit);
}

export function logLegacyApiAliasHit(req: Request, now: number = Date.now()) {
  const userAgent = firstHeaderValue(req.headers?.['user-agent']);
  const client = classifyLegacyApiClient(userAgent);
  const resourceKey = getLegacyApiAliasResourceKey(req.path);
  const throttleKey = `${resourceKey}|${client}`;

  const previous = lastLoggedAt.get(throttleKey);
  if (previous !== undefined && now - previous < LOG_INTERVAL_MS) {
    return;
  }
  lastLoggedAt.set(throttleKey, now);
  // Entries only matter for an hour; drop stale ones so the map never holds
  // more than one live entry per (resource, client) pair.
  lastLoggedAt.forEach((timestamp, key) => {
    if (now - timestamp >= LOG_INTERVAL_MS) {
      lastLoggedAt.delete(key);
    }
  });

  const rawPath = (req.originalUrl ?? req.path).split('?')[0];
  const path = sanitizeForLog(rawPath, MAX_LOGGED_PATH_LENGTH);
  const ua = userAgent === '' ? 'none' : sanitizeForLog(userAgent, MAX_LOGGED_USER_AGENT_LENGTH);
  log.info(
    `Removed unversioned API path hit (${resourceKey}): ${req.method} ${path} from client=${client} user-agent="${ua}" remote=${req.ip ?? 'unknown'}. Migrate the caller to /api/v1/*; this line is logged at most once per hour per resource and client.`,
  );
}
