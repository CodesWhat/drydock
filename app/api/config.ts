import type { Request, Response } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import nocache from 'nocache';
import setValue from 'set-value';
import { getConfigFileInfo } from '../configuration/file/layer.js';
import { reloadConfiguration } from '../configuration/file/reload.js';
import {
  type ConfigWriteOutcome,
  writeConfigurationSection as writeConfigurationSectionToFile,
} from '../configuration/file/write.js';
import { configFileSources, ddEnvVars, getServerConfiguration } from '../configuration/index.js';
import { redactConfigurationTree } from '../debug/redact.js';
import { recordAuditEvent } from './audit-events.js';
import { validateCandidateConfiguration } from './config-validate.js';
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

/**
 * `POST /api/v1/config/reload` — re-read `drydock.yml` and reconcile
 * registered components by difference (roadmap 7.1 slice 6,
 * spec-7.1-config-file.md section 4.1). The engine
 * (`configuration/file/reload.ts`'s `reloadConfiguration`) owns every I/O
 * and mutation step; this handler's only job is the HTTP/audit wrapping
 * every other route in this file already follows — always `200` with an
 * outcome field in the body (`applied`), matching `/validate`'s
 * `valid`/errors shape, rather than a 4xx/5xx for "the candidate didn't
 * validate", which is an expected, well-formed outcome, not a request error.
 */
function summarizeReconcile(
  reconcile: Awaited<ReturnType<typeof reloadConfiguration>>['reconcile'],
) {
  if (!reconcile) {
    return undefined;
  }
  return {
    added: reconcile.added.length,
    changed: reconcile.changed.length,
    removed: reconcile.removed.length,
    unchanged: reconcile.unchanged.length,
    errors: reconcile.errors.length,
  };
}

// `reconcileSummary` is only ever undefined when `result.applied` is false
// (`reloadConfiguration`'s own contract: `reconcile` is set iff the reload
// applied), so the applied branch below can read it directly rather than
// guard against a case the type system can't rule out but the contract
// already does.
function describeReload(
  result: Awaited<ReturnType<typeof reloadConfiguration>>,
  reconcileSummary: ReturnType<typeof summarizeReconcile>,
): string {
  if (!result.applied) {
    return `Reloaded configuration: refused (${result.errors.length} error(s))`;
  }
  const summary = reconcileSummary as NonNullable<typeof reconcileSummary>;
  const orphanedRuleCount = result.orphanedRules?.length ?? 0;
  return (
    `Reloaded configuration: applied (added ${summary.added}, ` +
    `changed ${summary.changed}, removed ${summary.removed}, ` +
    `unchanged ${summary.unchanged}, errors ${summary.errors}, ` +
    `orphaned notification rule references ${orphanedRuleCount})`
  );
}

async function reloadEffectiveConfiguration(_req: Request, res: Response): Promise<void> {
  try {
    const result = await reloadConfiguration();
    const reconcileSummary = summarizeReconcile(result.reconcile);
    const details = describeReload(result, reconcileSummary);
    recordAuditEvent({
      action: 'config-reloaded',
      containerName: 'diagnostics',
      status: result.applied ? 'info' : 'error',
      details,
    });
    res.status(200).json({
      applied: result.applied,
      errors: result.errors,
      diff: result.diff,
      reconcile: reconcileSummary,
      orphanedRules: result.orphanedRules,
    });
  } catch {
    sendErrorResponse(res, 500, 'Unable to reload the configuration');
  }
}

/**
 * `PUT /api/v1/config/:section` — write a configuration section through the
 * file (roadmap 7.1 slice 7, spec-7.1-config-file.md section 4.4). The
 * engine (`configuration/file/write.ts`'s `writeConfigurationSection`) owns
 * every I/O, validation, and mutation step, exactly as `reload.ts` does for
 * `/reload`; this handler is the same HTTP/audit wrapping.
 *
 * `admin`, same reasoning as `/validate` and `/reload`: never returns a raw
 * configuration value, only a section name, key names, counts, and error
 * text. The audit `details` built below follow the same rule — key *names*
 * only, never a value — even for the refusal branches, none of which
 * include anything a caller supplied.
 */
function describeWrite(section: string, outcome: ConfigWriteOutcome): string {
  switch (outcome.kind) {
    case 'written':
      return (
        `Wrote configuration section "${section}": ${outcome.changedKeys.length} key(s) changed` +
        (outcome.restartRequired ? ' (restart required)' : '')
      );
    case 'no-file':
      return `Wrote configuration section "${section}": refused (no configuration file exists)`;
    case 'invalid':
      return `Wrote configuration section "${section}": refused (${outcome.errors.length} error(s))`;
    case 'env-sourced':
      return (
        `Wrote configuration section "${section}": refused ` +
        `(env-sourced keys: ${outcome.keys.join(', ')})`
      );
    case 'db-owned':
      return `Wrote configuration section "${section}": refused (DB-owned section)`;
  }
}

async function writeConfigurationSection(
  req: Request<{ section: string }>,
  res: Response,
): Promise<void> {
  const { section } = req.params;
  try {
    const outcome = await writeConfigurationSectionToFile(section, req.body);
    // Audited before the body is sent, matching every other route in this
    // file, and unconditionally — a refusal is as much an "attempt" as a
    // success, exactly as `/reload` audits both `applied` and refused.
    recordAuditEvent({
      action: 'config-written',
      containerName: 'diagnostics',
      status: outcome.kind === 'written' ? 'info' : 'error',
      details: describeWrite(section, outcome),
    });

    switch (outcome.kind) {
      case 'written':
        res.status(200).json({
          applied: true,
          section,
          changedKeys: outcome.changedKeys,
          restartRequired: outcome.restartRequired,
          reload: {
            applied: outcome.reload.applied,
            diff: outcome.reload.diff,
            reconcile: summarizeReconcile(outcome.reload.reconcile),
            orphanedRules: outcome.reload.orphanedRules,
          },
        });
        return;
      case 'no-file':
        sendErrorResponse(
          res,
          409,
          'No configuration file exists to write to. Mount one at /config/drydock.yml ' +
            '(or wherever DD_CONFIG_FILE points) before writing a section through this endpoint.',
        );
        return;
      case 'invalid':
        res.status(400).json({ errors: outcome.errors });
        return;
      case 'env-sourced':
        sendErrorResponse(
          res,
          409,
          `Cannot write section "${section}": the following keys are set by the environment ` +
            `and would not take effect: ${outcome.keys.join(', ')}`,
        );
        return;
      case 'db-owned':
        sendErrorResponse(
          res,
          409,
          `Section "${section}" is managed through PATCH /api/v1/settings, not the configuration file.`,
        );
        return;
    }
  } catch {
    sendErrorResponse(res, 500, 'Unable to write the configuration section');
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
  // Same shape as the read limiter (5 per 60 s, identity-aware keying when
  // enabled) — a validate call is cheap for us but still worth bounding,
  // since a candidate document is attacker-controlled input run through
  // every component schema.
  const configValidateRateLimit = rateLimit({
    windowMs: 60_000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: 'Config validate rate limit exceeded. Max 5 per 60 seconds.',
    ...identityAwareRateLimitOptions,
  });
  // Same shape again: a reload is heavier than a validate (it also
  // reconciles every registered component), so if anything it deserves a
  // tighter cap, but 5/60s already bounds the expensive path and there is no
  // reason for this route's limit to diverge from its two siblings.
  const configReloadRateLimit = rateLimit({
    windowMs: 60_000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: 'Config reload rate limit exceeded. Max 5 per 60 seconds.',
    ...identityAwareRateLimitOptions,
  });
  // Same shape again: a write does everything reload does, plus a disk
  // write, so it is at least as expensive and no reason to diverge either.
  const configWriteRateLimit = rateLimit({
    windowMs: 60_000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: 'Config write rate limit exceeded. Max 5 per 60 seconds.',
    ...identityAwareRateLimitOptions,
  });

  router.use(nocache());
  router.get('/', configReadRateLimit, scoped(SESSION_ONLY, getEffectiveConfiguration));
  router.get('/:section', configReadRateLimit, scoped(SESSION_ONLY, getConfigurationSection));
  // `admin`, not SESSION_ONLY: this route never returns a configuration
  // value, only paths/env-key names/error text, so an API key holding
  // `admin` is the right reach — see config-validate.ts's module doc
  // comment.
  router.post(
    '/validate',
    configValidateRateLimit,
    scoped('admin', validateCandidateConfiguration),
  );
  // `admin`, same reasoning as `/validate` above: reload's response is the
  // same paths/env-key-names/error-text/counts shape, never a raw
  // configuration value.
  router.post('/reload', configReloadRateLimit, scoped('admin', reloadEffectiveConfiguration));
  // `admin`, same reasoning again: the response is a section name, key
  // names, counts and error text — never a raw configuration value, so this
  // never widens past what `/validate` and `/reload` already allow.
  router.put('/:section', configWriteRateLimit, scoped('admin', writeConfigurationSection));
  return router;
}
