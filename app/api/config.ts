import type { Request, Response } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import nocache from 'nocache';
import setValue from 'set-value';
import { getConfigFileInfo } from '../configuration/file/layer.js';
import { configFileSources, ddEnvVars, getServerConfiguration } from '../configuration/index.js';
import { redactConfigurationTree } from '../debug/redact.js';
import { recordAuditEvent } from './audit-events.js';
import { sendErrorResponse } from './error-response.js';
import {
  createAuthenticatedRouteRateLimitKeyGenerator,
  isIdentityAwareRateLimitKeyingEnabled,
} from './rate-limit-key.js';
import { SESSION_ONLY, scoped } from './route-scopes.js';

/**
 * `GET /api/v1/config` — the effective, redacted configuration
 * (roadmap 7.1 slice 4, spec-7.1-config-file.md section 4). This is a read
 * of already-computed module state: `ddEnvVars` and `configFileSources` are
 * populated once at boot (`configuration/index.ts`), and
 * `getConfigFileInfo()` is populated once at boot
 * (`configuration/file/layer.ts`). Nothing here does its own filesystem I/O,
 * at import time or at request time.
 *
 * `SESSION_ONLY`, not `read`: this is an environment reveal in the same
 * category as the debug dump and the container env reveal
 * (`route-scopes.ts`'s `SESSION_ONLY` doc comment), so an API key — even one
 * holding `admin` — never reaches it.
 */

const router = express.Router();

interface ConfigFileField {
  present: boolean;
  path?: string;
  modifiedAt?: string;
}

interface EffectiveConfigurationResponse {
  file: ConfigFileField;
  sections: Record<string, Record<string, unknown>>;
  sources: Record<string, string>;
  // Always empty in this slice — populated once reload lands (roadmap 7.1
  // slice 6), which is the first slice that can tell a reloadable section
  // change from one that needs a restart.
  restartRequired: string[];
}

function buildFileField(): ConfigFileField {
  const info = getConfigFileInfo();
  if (!info) {
    return { present: false };
  }
  return { present: true, path: info.path, modifiedAt: info.modifiedAt };
}

const DD_ENV_KEY_PREFIX = 'DD_';

/**
 * The inverse of `file/flatten.ts`'s `toEnvKey`: every underscore-delimited
 * segment after the `DD_` prefix becomes one nesting level, lowercased. The
 * first segment is the section name.
 */
function ddEnvKeyToSegments(envKey: string): string[] {
  return envKey
    .slice(DD_ENV_KEY_PREFIX.length)
    .split('_')
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase());
}

/**
 * Every section this endpoint can report, derived from `ddEnvVars` itself
 * rather than a hardcoded list of the components this codebase happens to
 * have routers for today. A key groups under its first segment
 * (`DD_AUTH_BASIC_JOHN_HASH` → `auth`; `DD_STORE_PATH` → `store`;
 * `DD_SERVER_PORT` → `server`), with every remaining segment
 * building one more level of nesting the same way for every section — no
 * per-kind builder, so nothing that reaches drydock only as a `DD_*`
 * variable (auth, agent, store, log, ui, security, hooks, webhooks, ...) can
 * silently vanish from the response the way a fixed five-name list would
 * drop it. A key with no segment past the section name (there is
 * currently exactly one, `DD_VERSION`) is skipped: it names a root-level
 * scalar, not a section, and this endpoint's contract is "sections", not
 * "everything at any depth".
 *
 * Redaction is the same key-name-substring rule for every section
 * (`redactConfigurationTree`, `app/debug/redact.ts`) rather than each
 * component's own `maskConfiguration()` allowlist — a generic, prefix-only
 * derivation has no component object to ask, and a single denylist applied
 * uniformly is the only rule that can cover a section (`auth`, `log`, ...)
 * nothing else in this codebase already knows how to mask.
 */
function buildSections(): Record<string, Record<string, unknown>> {
  const sections: Record<string, Record<string, unknown>> = {};

  for (const [envKey, value] of Object.entries(ddEnvVars)) {
    if (value === undefined || !envKey.toUpperCase().startsWith(DD_ENV_KEY_PREFIX)) {
      continue;
    }
    const segments = ddEnvKeyToSegments(envKey);
    // Fewer than two segments means no key past the section name (or, in
    // principle, no segments at all) — see this function's doc comment.
    if (segments.length < 2) {
      continue;
    }
    const [section, ...rest] = segments;
    sections[section] ??= {};
    setValue(sections[section], rest.join('.'), value);
  }

  for (const sectionName of Object.keys(sections)) {
    sections[sectionName] = redactConfigurationTree(sections[sectionName]);
  }

  return sections;
}

/**
 * Build the whole `GET /api/v1/config` payload. The disjointness test
 * (spec-7.1-config-file.md section 3: the set of section keys this can
 * report must never intersect the settings store's own keys) exercises this
 * through the real HTTP handler rather than calling it directly.
 */
function buildEffectiveConfigurationResponse(): EffectiveConfigurationResponse {
  return {
    file: buildFileField(),
    sections: buildSections(),
    sources: { ...configFileSources },
    restartRequired: [],
  };
}

function getEffectiveConfiguration(_req: Request, res: Response): void {
  try {
    const response = buildEffectiveConfigurationResponse();
    // Audited before the body is sent, matching debug.ts's ordering
    // rationale: an audit failure has to become the 500 below, and writing
    // after send() would throw ERR_HTTP_HEADERS_SENT.
    recordAuditEvent({
      action: 'config-read',
      containerName: 'diagnostics',
      status: 'info',
      details: 'Read the effective configuration',
    });
    res.status(200).json(response);
  } catch {
    sendErrorResponse(res, 500, 'Unable to build the effective configuration');
  }
}

function getConfigurationSection(req: Request<{ section: string }>, res: Response): void {
  try {
    const response = buildEffectiveConfigurationResponse();
    const section = response.sections[req.params.section];
    if (section === undefined) {
      sendErrorResponse(res, 404, 'Unknown configuration section');
      return;
    }
    recordAuditEvent({
      action: 'config-read',
      containerName: 'diagnostics',
      status: 'info',
      details: `Read the "${req.params.section}" configuration section`,
    });
    res.status(200).json(section);
  } catch {
    sendErrorResponse(res, 500, 'Unable to build the effective configuration');
  }
}

export function init() {
  const serverConfiguration = getServerConfiguration() as Record<string, unknown>;
  const identityAwareRateLimitKeyGenerator = createAuthenticatedRouteRateLimitKeyGenerator(
    isIdentityAwareRateLimitKeyingEnabled(serverConfiguration),
  );
  const identityAwareRateLimitOptions = identityAwareRateLimitKeyGenerator
    ? { keyGenerator: identityAwareRateLimitKeyGenerator }
    : {};
  const configReadRateLimit = rateLimit({
    windowMs: 60_000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: 'Config read rate limit exceeded. Max 5 per 60 seconds.',
    ...identityAwareRateLimitOptions,
  });

  router.use(nocache());
  router.get('/', configReadRateLimit, scoped(SESSION_ONLY, getEffectiveConfiguration));
  router.get('/:section', configReadRateLimit, scoped(SESSION_ONLY, getConfigurationSection));
  return router;
}
